"""Shared helpers for the Virgil Library Python pipeline.

Two concerns live here:

1. **Tool detection** (the original purpose) — `Tools` dataclass + `detect()`,
   used by the indexing pipeline to degrade gracefully when poppler /
   marker / ocrmypdf aren't installed.
2. **Concurrency-safe writes to shared library state** — POSIX advisory
   locks for `master.bib`, `.virgil/catalog.json`, and
   `.virgil/notifications/inbox.json`, plus the helpers that grab them.

## Concurrency-safe writes

Three files in a Virgil Library are shared across all skills/scripts:
`master.bib`, `.virgil/catalog.json`, and `.virgil/notifications/inbox.json`.
On 2026-05-09 a concurrent drain race truncated master.bib to a single
entry — two index_paper.py processes each read the file, computed an
updated version against their stale read, and wrote it back; the later
writer's set lost everything the earlier had added. The same failure
mode is latent on the other two files. We protect every read-modify-
write here with `fcntl.flock` on a sidecar `.lock` file, and write data
files atomically via temp-file + fsync + rename so concurrent readers
always see either the old or the new contents.

POSIX `flock` is advisory — the kernel does not enforce it against
processes that don't ask for the lock. Claude-driven Write/Edit calls
bypass it unless they go through a Python script that acquires the
lock. That's why the library skills shell out to
`update_catalog_entry.py`, `append_inbox_item.py`, and
`update_master_bib_entry.py` for catalog/inbox/bib edits — those are
the lock-respecting writers.

Sidecar `.lock` files (rather than locks on the data file itself)
because `Path.write_text` does open/truncate/write/close — closing the
data file would release a lock held on its FD before the next reader
acquires it. The sidecar's FD stays open across the rewrite.

Each helper grabs only its own lock; we never compose locks across
multiple files in one critical section, so there is no ordering rule
to remember and no deadlock surface.

Library runs on macOS / Linux. If Virgil ever ports to Windows,
replace `fcntl.flock` with `msvcrt.locking`.
"""

from __future__ import annotations

import atexit
import fcntl
import importlib.util
import json
import os
import re
import shutil
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


# --- BEGIN MIRRORED: refused-delete policy (task 496) ----------------------
# A DELETE is the one filesystem capability a transport may not grant: a cloud
# mount (the reported Dropbox one) refuses `unlink` on a file it will happily
# let you REWRITE. And every delete in this silo is CLEANUP — a `.tmp` sibling,
# a retired lock, a superseded `.done`, a temp file handed to a subprocess — so
# a refusal is a TIDINESS failure, never a correctness one.
#
# The law: **no delete may raise out of the operation it cleans up for**, and
# it is ONE helper rather than per-site care, because per-site care is exactly
# what shipped — the pen release's bare `os.remove` turned a landed write into
# exit 2 AND rolled the collab restore back to Claude-held, wedging the paper
# read-only until the record aged out.
#
# The warning goes to STDERR: stdout carries the writeback-contract JSON.
#
# This block is MIRRORED byte-for-byte in the other silo; the parity leg in
# editor/scripts/tests/test_unlink_tolerant.py pins the two together, because
# the two script trees ship as independent bundles and cannot import each
# other. Edit one, edit both.
def unlink_tolerant(path, *, what: str = "file") -> bool:
    """Delete `path` if it is there. True iff it is gone afterwards.

    Never raises. A mount that refuses deletion gets one stderr warning and
    the caller carries on with whatever it was doing.
    """
    p = Path(path)
    try:
        p.unlink(missing_ok=True)
        return True
    except OSError as e:
        print(
            f"warning: could not delete {what} {p}: {type(e).__name__}: {e}",
            file=sys.stderr,
        )
        return False


def rmtree_tolerant(path, *, what: str = "directory") -> bool:
    """`shutil.rmtree` twin of `unlink_tolerant`. Never raises."""
    p = Path(path)
    if not p.exists():
        return True
    try:
        shutil.rmtree(p)
        return True
    except OSError as e:
        print(
            f"warning: could not delete {what} {p}: {type(e).__name__}: {e}",
            file=sys.stderr,
        )
        return False
# --- END MIRRORED ----------------------------------------------------------


# ── work-identity guard error ─────────────────────────────────────────


class DuplicateWorkError(Exception):
    """Raised by `upsert_catalog_entry` when a work-identity guard finds that
    an incoming (new-citekey) row denotes the SAME work as an existing row under
    a DIFFERENT citekey — so appending would mint a duplicate holdings record.

    Attributes
    ----------
    existing_citekey : str
        The citekey of the already-present row that matches the incoming work.
    verdict : work_identity.Verdict | None
        The classifier verdict that fired (relation ``"same"``), for the caller
        to log / surface. May be ``None`` if the caller constructs the error
        without one.
    """

    def __init__(self, existing_citekey: str, verdict=None):
        self.existing_citekey = existing_citekey
        self.verdict = verdict
        rel = getattr(verdict, "relation", "same")
        conf = getattr(verdict, "confidence", None)
        detail = f" ({rel}" + (f" {conf:.2f}" if isinstance(conf, float) else "") + ")"
        super().__init__(
            f"incoming work matches existing citekey {existing_citekey!r}{detail}; "
            "refusing to append a duplicate row"
        )


# ── master.bib writer refusal ─────────────────────────────────────────


class BibEntryUnbalanced(Exception):
    """Raised by `update_master_bib_entry` when the entry it was asked to
    rewrite has unbalanced braces, so its extent cannot be established.

    `bib_entry_extent` answers such an entry with a CAPPED guess — the next
    entry opener — which is right for a READER (it mis-reports one entry and
    contains the damage) and wrong for a WRITER (it splices over whatever the
    guess got wrong). The sibling refusal `BibSpliceRefused` in `_bib_parse`
    makes the same call for `references.bib`: losing entries is never the
    fallback. Report the message verbatim and leave the file for a human.
    """

    def __init__(self, citekey: str):
        self.citekey = citekey
        super().__init__(
            f"master.bib: the entry for {citekey!r} has unbalanced braces, so "
            "its extent cannot be established — refusing to rewrite it rather "
            "than risk splicing over the entries that follow. Repair the "
            "braces by hand and re-run."
        )


# ── tool detection (original purpose) ─────────────────────────────────


@dataclass
class Tools:
    pdfinfo: bool
    pdftotext: bool
    pdffonts: bool
    pymupdf: bool
    marker: bool
    ocrmypdf: bool
    tesseract: bool
    python_docx: bool

    def missing_required(self) -> list[str]:
        missing = []
        if not self.pdfinfo:
            missing.append("pdfinfo (brew install poppler)")
        if not self.pdftotext:
            missing.append("pdftotext (brew install poppler)")
        if not self.pdffonts:
            missing.append("pdffonts (brew install poppler)")
        if not self.pymupdf:
            missing.append("PyMuPDF (pip install PyMuPDF)")
        return missing

    def summary(self) -> str:
        rows = [
            f"  poppler:    pdfinfo={self.pdfinfo}, pdftotext={self.pdftotext}, pdffonts={self.pdffonts}",
            f"  pymupdf:    {self.pymupdf}",
            f"  marker:     {self.marker}  (default PDF extractor — install via /library/setup)",
            f"  ocrmypdf:   {self.ocrmypdf}  (required for scanned-PDF input — install via /library/setup)",
            f"  tesseract:  {self.tesseract}  (ocrmypdf backend — brew install tesseract)",
            f"  python-docx:{self.python_docx}  (required only when indexing .docx sources)",
        ]
        return "\n".join(rows)


def _has_binary(name: str) -> bool:
    """Check PATH plus known Homebrew install dirs.

    A common footgun: the user installs a brew package, then re-runs a
    skill from a shell whose PATH doesn't yet include `/opt/homebrew/bin`
    (or `/usr/local/bin` on Intel Macs). Without this fallback,
    `tesseract` / `ocrmypdf` etc. show up as missing for an entire
    session after install. The hardcoded paths are a stable contract
    Homebrew commits to.
    """
    if shutil.which(name):
        return True
    for prefix in ("/opt/homebrew/bin", "/usr/local/bin"):
        if (Path(prefix) / name).exists():
            return True
    return False


def detect() -> Tools:
    return Tools(
        pdfinfo=_has_binary("pdfinfo"),
        pdftotext=_has_binary("pdftotext"),
        pdffonts=_has_binary("pdffonts"),
        pymupdf=importlib.util.find_spec("fitz") is not None,
        marker=importlib.util.find_spec("marker") is not None,
        ocrmypdf=_has_binary("ocrmypdf"),
        tesseract=_has_binary("tesseract"),
        python_docx=importlib.util.find_spec("docx") is not None,
    )


# ── model cache (library-local) ───────────────────────────────────────
#
# Heavy ML models (marker's ~1 GB of weights) live inside the library at
# `<library>/.virgil/models/huggingface/`, not in the user's global
# `~/.cache/huggingface/`. The choice keeps each library self-contained
# (portable across machines / backed up with the library), and lets the
# index-paper pipeline and the deep-index PDF re-reads share one cache.
#
# Setup script writes the manifest; every other script that imports
# `marker` MUST call `ensure_model_env(library)` first so huggingface_hub
# stamps the right cache directory before it loads its config.


SETUP_MANIFEST_REL = ".virgil/models/manifest.json"


def models_dir(library: Path) -> Path:
    """Where library-local ML models live."""
    return library / ".virgil" / "models"


def hf_cache_dir(library: Path) -> Path:
    """Where huggingface_hub puts marker's model snapshots."""
    return models_dir(library) / "huggingface"


def datalab_cache_dir(library: Path) -> Path:
    """Where surya-ocr (marker's OCR/layout/table backend) puts its
    `datalab/models/<name>/<date>` weight tree.

    Surya's settings module reads MODEL_CACHE_DIR as a plain env var
    (pydantic-settings, no prefix) and defaults to
    `platformdirs.user_cache_dir("datalab")/models` — i.e. somewhere
    under `~/Library/Caches/datalab/` or `~/.cache/datalab/`. Without
    this redirect, the largest chunk of marker's footprint (3 GB+ of
    surya weights) lands in the user's global cache despite HF_HOME
    pointing into the library.
    """
    return models_dir(library) / "datalab"


def ensure_model_env(library: Path) -> None:
    """Point all marker-related model caches at the library-local dirs.

    Must be called BEFORE `import marker` / `import surya` / any
    huggingface_hub usage. Idempotent: safe to call repeatedly.

    Sets three env vars:
    - `HF_HOME` + `TRANSFORMERS_CACHE` → `<library>/.virgil/models/huggingface/`
      (covers anything pulled through huggingface_hub).
    - `MODEL_CACHE_DIR` → `<library>/.virgil/models/datalab/`
      (covers surya-ocr's weight tree, which is the bulk of the
      download).

    No-op when the manifest is missing — the caller can still proceed
    with the global cache, but the setup script hasn't run yet so the
    user will see a slow first-use download. Higher layers should
    surface the missing-setup signal via `setup_manifest_path` /
    `read_setup_manifest`.
    """
    hf = hf_cache_dir(library)
    datalab = datalab_cache_dir(library)
    hf.mkdir(parents=True, exist_ok=True)
    datalab.mkdir(parents=True, exist_ok=True)
    os.environ["HF_HOME"] = str(hf)
    os.environ["TRANSFORMERS_CACHE"] = str(hf)
    os.environ["MODEL_CACHE_DIR"] = str(datalab)


def setup_manifest_path(library: Path) -> Path:
    return library / SETUP_MANIFEST_REL


def read_setup_manifest(library: Path) -> dict | None:
    """Return the parsed setup manifest, or None if it doesn't exist / is malformed.

    The presence of a valid manifest is the canonical signal that
    `/library/setup` has run for this library.
    """
    p = setup_manifest_path(library)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def require_setup_or_die(library: Path, *, for_tool: str = "marker-pdf") -> None:
    """Raise RuntimeError with the install command if setup hasn't run.

    `for_tool` is the package name surfaced in the error message — use
    whichever heavy tool the caller is about to invoke (marker-pdf,
    ocrmypdf, etc.) so the user sees a relevant pointer.
    """
    manifest = read_setup_manifest(library)
    if manifest is None:
        raise RuntimeError(
            f"{for_tool} requires Virgil Library setup to run first.\n"
            f"Library: {library}\n"
            f"Fix: run /library/setup  (or `python3 .virgil/scripts/library/setup.py`)"
        )
    tool_state = manifest.get("tools", {}).get(for_tool, {})
    if not tool_state.get("installed"):
        raise RuntimeError(
            f"{for_tool} not installed in this library's setup.\n"
            f"Manifest: {setup_manifest_path(library)}\n"
            f"Fix: run /library/setup --force  to (re)install."
        )


# ── canonical bib.state vocabulary ────────────────────────────────────
#
# ONE shared source of truth for the set of legal `% bib.state = <state>`
# values, imported by every writer (merge_paper_references, triage_apply,
# apply_metadata_mismatch_policy, …) and mirrored by the reader-side
# VALID_BIB_STATES in library/lib/bib-index.ts. Keep the two in lockstep:
# a state written here but absent from the TS set is silently dropped to
# "none" by the bib-index reader (the exact `needs-reauth` round-trip bug
# F#4 fixes).
#
# Semantics (see library/CLAUDE.md §Bib states):
#   none          — no state assigned yet (the implicit default; no comment)
#   unverified    — single source matched at lower threshold (action needed)
#   authenticated — DOI verified / ≥2 sources agreed (terminal)
#   manuscript    — explicitly unpublished/forthcoming (terminal)
#   canonical     — pre-digital descriptor, no modern agreement (terminal,
#                   re-runnable)
#   failed        — no source matched above threshold (action needed)
#   needs-reauth  — metadata-mismatch policy rewrote fields from the file;
#                   awaiting a re-authentication pass before the new fields
#                   are trusted (action needed — try /library/authenticate-bib)
CANONICAL_BIB_STATES: frozenset[str] = frozenset({
    "none",
    "unverified",
    "authenticated",
    "manuscript",
    "canonical",
    "failed",
    "needs-reauth",
})


# The TERMINAL subset — states that mean "this entry is settled; do not
# overwrite it from a lower-evidence source". Spelled ONCE, because the two
# readers that gate on it (merge_paper_references' defer branch, triage_apply's
# .bib-drop guard) had two hand lists that disagreed: the drop guard named only
# `authenticated`/`manuscript`, so a `canonical` entry's fields were replaced
# wholesale by a drop and its state stamped back down to `unverified`.
#
# `needs-reauth` is deliberately NOT terminal — it means "awaiting a
# re-authentication pass", i.e. action needed.
TERMINAL_BIB_STATES: frozenset[str] = frozenset({
    "authenticated",
    "manuscript",
    "canonical",
})


def is_canonical_bib_state(state: str) -> bool:
    """True iff `state` is one of the canonical `% bib.state` values."""
    return state in CANONICAL_BIB_STATES


def is_terminal_bib_state(state: str) -> bool:
    """True iff `state` is settled (see `TERMINAL_BIB_STATES`)."""
    return state in TERMINAL_BIB_STATES


# ── small utilities ───────────────────────────────────────────────────


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _atomic_write_text(path: Path, text: str) -> None:
    """Write `text` to `path` via temp-file + fsync + rename.

    Crash-safe and atomic from a reader's perspective: the file at
    `path` is either the old contents or the new contents, never a
    half-written truncation.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


# ── locks ─────────────────────────────────────────────────────────────


@contextmanager
def _flock_path(lock_path: Path):
    """Acquire an exclusive POSIX advisory lock on `lock_path`.

    Auto-released on FD close (so crashed processes can't leak the
    lock indefinitely).
    """
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.touch(exist_ok=True)
    fd = open(lock_path, "r+")
    try:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(fd.fileno(), fcntl.LOCK_UN)
        finally:
            fd.close()


@contextmanager
def lock_master_bib(library: Path):
    """Hold `<library>/master.bib.lock` for the with-block.

    Required around any read-modify-write of master.bib. The 2026-05-09
    truncation incident is what this lock prevents.
    """
    with _flock_path(library / "master.bib.lock"):
        yield


@contextmanager
def lock_catalog(library: Path):
    """Hold `<library>/.virgil/catalog.json.lock` for the with-block.

    Required around any read-modify-write of catalog.json. Catalog
    writes are full-file rewrites; unlocked concurrent writers will
    silently drop each other's row updates.
    """
    with _flock_path(library / ".virgil" / "catalog.json.lock"):
        yield


@contextmanager
def lock_inbox(library: Path):
    """Hold `<library>/.virgil/notifications/inbox.json.lock` for the with-block.

    Required around any append to inbox.json (the notification ring
    buffer). Same race shape as catalog.json.
    """
    with _flock_path(library / ".virgil" / "notifications" / "inbox.json.lock"):
        yield


# ── catalog ──────────────────────────────────────────────────────────


def read_catalog(library: Path) -> dict:
    """Read catalog.json. No lock held — readers see whatever is on disk.

    Atomic writes (`_atomic_write_text`) ensure readers never see a
    half-written file. Returns the default empty structure if the file
    is missing or malformed.
    """
    p = library / ".virgil" / "catalog.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"version": 1, "generatedAt": _now(), "entries": []}


def write_catalog(library: Path, catalog: dict) -> None:
    """Write catalog.json atomically and bump catalog-version.txt.
    CALLER must hold `lock_catalog`.

    Stamps `generatedAt` to now before writing. Always bumps the
    version — every catalog change needs to be visible to the frontend
    poller, and there's no scenario where you want a silent write.
    """
    catalog["generatedAt"] = _now()
    _atomic_write_text(
        library / ".virgil" / "catalog.json",
        json.dumps(catalog, indent=2) + "\n",
    )
    _bump_version_locked(library)
    _mark_bib_index_dirty(library)


# Shared parser for the `<category>-false-positive:` suppression-warning
# convention written by `add_validator_suppression.py`. Both the pgmark
# validator's baseline reader and audit_deepindex's category reader consume
# this — factoring it here stops the two from drifting (the pgmark reader
# previously kept the `-false-positive` suffix, silently ignoring every
# suppression an operator wrote; audit_deepindex's regex stripped it). The
# `[a-z][a-z-]*` class matches every real category (pgmark finding kinds and
# audit categories are all lowercase + dashes, no digits); `\s` after the
# colon matches the writer's `"<kind>-false-positive: <reason>"` format.
_SUPPRESSION_FALSE_POSITIVE_RE = re.compile(r"^([a-z][a-z-]*)-false-positive:\s")


def suppression_categories_from_catalog(
    catalog: dict, citekey: str, prefix: str | None = None,
) -> set[str]:
    """Return the `<category>` tokens the catalog flagged as
    `<category>-false-positive:` warnings for `citekey`, per the shared
    validator/audit suppression convention (see `add_validator_suppression.py`).

    - `prefix=None`  → each category verbatim, e.g. `"case-errors"`,
      `"pgmark-low-confidence-flood"` (audit_deepindex's use — it wants all
      categories and matches them against its own bare-category findings).
    - `prefix="pgmark-"` → only categories under that prefix, WITH the prefix
      stripped, e.g. `"low-confidence-flood"` (pgmark_validate's baseline use —
      it matches against bare finding kinds like `gap` / `duplicate`).
      Categories outside the prefix are ignored.

    The greedy `[a-z-]*` strips exactly the trailing `-false-positive` suffix
    (regex backtracks to leave the literal in place), so a
    `pgmark-gap-false-positive:` warning yields the bare kind `gap`.
    """
    out: set[str] = set()
    for e in catalog.get("entries", []):
        # NFC-insensitive, like every other row lookup in this module: the
        # WRITE side normalizes (`add_validator_suppression` calls
        # `normalize_citekey`), so a raw `!=` here returns nothing at all on
        # an NFD-spelled row (Tichý / Čerić / López) and the suppression the
        # operator just added reads as absent.
        if not citekey_matches(e.get("citekey", ""), citekey):
            continue
        indexed = e.get("indexed") or {}
        for w in indexed.get("warnings", []) or []:
            if not isinstance(w, str):
                continue
            m = _SUPPRESSION_FALSE_POSITIVE_RE.match(w)
            if not m:
                continue
            category = m.group(1)
            if prefix is None:
                out.add(category)
            elif category.startswith(prefix):
                out.add(category[len(prefix):])
        break
    return out


def _bump_version_locked(library: Path) -> None:
    """Bump catalog-version.txt. CALLER must hold `lock_catalog`."""
    p = library / ".virgil" / "catalog-version.txt"
    cur = 0
    if p.exists():
        try:
            cur = int(p.read_text().strip() or "0")
        except Exception:
            cur = 0
    _atomic_write_text(p, str(cur + 1) + "\n")


# ── slim browse index (bib-index.json) ───────────────────────────────
#
# `.virgil/bib-index.json` is a flat, slim projection of master.bib — one
# record per citekey with only the fields the frontend BROWSE path reads
# (list, search, citation picker). It exists so the browser never has to
# run citation-js over the multi-MB master.bib just to draw a list: parsing
# the real 34k-entry master.bib via citation-js blocks the main thread for
# ~2.6s (and ~6s at 100k); JSON.parse of this slim index is ~15ms. See
# MEMO_LIBRARY_SCALE_RESEARCH.md.
#
# Coherence: the index is a pure function of master.bib. We DON'T rebuild it
# inside write_catalog (merge/index loops call that per-entry — thousands of
# full re-parses). Instead any write that can touch master.bib OR the catalog
# marks the library "dirty"; one rebuild fires at process exit (atexit),
# stamp-gated so it's a no-op when master.bib is unchanged (e.g. catalog-only
# status writes). The frontend polls the tiny `.virgil/bib-index.stamp` file
# and re-reads bib-index.json only when the stamp changes.
#
# Schema (compact keys; the file is ~6-8MB at 34k). These are exactly the
# fields the BROWSE path reads — list author column + sort (author/editor),
# fuzzy search (title/author/year/journal/booktitle), and the citation
# picker's expanded details (volume/number/pages/publisher/series). Anything
# the browse path does NOT render stays out (it's fetched on demand for edit):
#   k=citekey t=title a=author e=editor y=year d=doi
#   j=journal b=booktitle v=volume n=number p=pages q=publisher s=series
# Empty fields are omitted. The frontend maps these back to a BibEntry shape.

BIB_INDEX_REL = ".virgil/bib-index.json"
BIB_INDEX_STAMP_REL = ".virgil/bib-index.stamp"

_BIB_INDEX_FIELDS = (
    ("title", "t"),
    ("author", "a"),
    ("editor", "e"),
    ("year", "y"),
    ("doi", "d"),
    ("journal", "j"),
    ("booktitle", "b"),
    ("volume", "v"),
    ("number", "n"),
    ("pages", "p"),
    ("publisher", "q"),
    ("series", "s"),
)


# Entry starts are line-anchored in master.bib (`@type{key,` at column 0).
# We delimit entries by THIS marker rather than by global brace-matching,
# because a single malformed entry with an unbalanced brace makes brace-
# matching overrun and swallow the rest of the file (the real master.bib has
# exactly such an entry — `read_master_bib` drops ~82% of the bibliography on
# it). Line-anchored splitting contains any malformation to its own entry.
_BIB_ENTRY_START_RE = re.compile(r"(?m)^@(\w+)[ \t]*\{[ \t]*([^,\s]+)[ \t]*,")

# The per-entry auth state lives in a `% bib.state = <state>` comment written
# immediately before the entry by update_master_bib_entry. Pair each comment
# with the citekey of the entry that follows it (tolerating blank lines).
# This is the authoritative state home for the reference universe (F#4): the
# bib-index projects it into each record's `bs` so the fileless mass of
# citation-only references carries real auth state without a catalog row.
# State token is `[\w-]+` (not `\w+`) so hyphenated canonical states like
# `needs-reauth` round-trip; `\w+` silently dropped them mid-hyphen → "none".
_BIB_STATE_COMMENT_RE = re.compile(
    r"(?m)^%[ \t]*bib\.state[ \t]*=[ \t]*([\w-]+)[ \t]*\n(?:[ \t]*\n)*@\w+[ \t]*\{[ \t]*([^,\s]+)"
)


def iter_master_bib_states(text: str):
    """Yield (citekey, state) for every `% bib.state = <state>` comment paired
    with the entry it precedes. Later duplicates win (matches the file order
    update_master_bib_entry maintains)."""
    for m in _BIB_STATE_COMMENT_RE.finditer(text):
        state = m.group(1).strip()
        citekey = m.group(2).strip()
        if citekey:
            yield citekey, state


def iter_master_bib_slim(text: str):
    """Yield (citekey, entry_type, fields) for every entry in master.bib text.

    Robust to malformed (brace-unbalanced) entries: each entry's body is the
    text between its line-anchored `@type{key,` opener and the next opener
    (or EOF), so a desync can never cross an entry boundary. `_parse_bib_fields`
    is brace-aware within the body and ignores the trailing `}`.
    """
    starts = list(_BIB_ENTRY_START_RE.finditer(text))
    for idx, m in enumerate(starts):
        entry_type = m.group(1).lower()
        citekey = m.group(2).strip()
        body_start = m.end()
        body_end = starts[idx + 1].start() if idx + 1 < len(starts) else len(text)
        fields = _parse_bib_fields(text[body_start:body_end])
        yield citekey, entry_type, fields


def _bib_index_schema_stamp() -> str:
    """A signal for "what SHAPE does this build project?".

    The stamp beside it answers "did master.bib change"; this answers "would
    a rebuild produce different fields for the SAME master.bib". They are
    different questions and the gate needs both, because the index is a
    derived cache and the projection is code that ships.

    Without it a schema change is invisible to the gate: F#4 added the `bs`
    field, and every library whose index had been built BEFORE that kept
    serving `bs`-less rows forever — `_master_bib_stamp` still matched, so
    `build_bib_index` returned False without parsing. What healed it was an
    accident: `update_master_bib_entry` inserted a blank line on every
    rewrite, so the mtime moved on every re-assert. Task 443 fixed that
    accident (a no-op write is now skipped), which would have left the
    schema hole with no healer at all — so it is closed properly here
    instead. DERIVED from the projection, never hand-versioned: a future
    field added to `_BIB_INDEX_FIELDS` invalidates every stale index by
    shipping.
    """
    return ",".join(short for _full, short in _BIB_INDEX_FIELDS) + ",bs"


def _master_bib_stamp(library: Path) -> str:
    """A cheap change signal for the bib index (mtime_ns:size + schema).

    Avoids hashing the whole 10MB file on every dirty-flush; mtime+size
    is sufficient to detect "did master.bib change since the last index",
    and the schema half detects "did the projection change" — see
    `_bib_index_schema_stamp`.
    """
    p = library / "master.bib"
    try:
        st = p.stat()
        base = f"{st.st_mtime_ns}:{st.st_size}"
    except FileNotFoundError:
        base = "0:0"
    return f"{base}:{_bib_index_schema_stamp()}"


def build_bib_index(library: Path, *, force: bool = False) -> bool:
    """Emit `.virgil/bib-index.json` + `.virgil/bib-index.stamp`.

    Stamp-gated: when master.bib is unchanged since the last build, this is
    a tiny stamp-file read and returns False (no parse, no write). When it
    changed (or `force`), it re-parses master.bib with the lightweight
    `read_master_bib` parser, projects each entry to its slim fields, and
    atomically writes both files. Returns True if it (re)wrote.

    No lock is required: `read_master_bib` reads atomically-written files
    (old-or-new, never partial), and the index is a derived cache the
    frontend only reads. Safe to call repeatedly and from atexit.
    """
    stamp = _master_bib_stamp(library)
    out_path = library / BIB_INDEX_REL
    stamp_path = library / BIB_INDEX_STAMP_REL
    if not force and out_path.exists() and stamp_path.exists():
        try:
            if stamp_path.read_text().strip() == stamp:
                return False
        except Exception:
            pass

    master_path = library / "master.bib"
    text = master_path.read_text() if master_path.exists() else ""
    # Project the per-entry `% bib.state` comments into the index (F#4).
    state_by_key = dict(iter_master_bib_states(text))
    entries: list[dict] = []
    seen: set[str] = set()
    for citekey, _entry_type, fields in iter_master_bib_slim(text):
        if not citekey or citekey in seen:
            continue
        seen.add(citekey)
        slim: dict = {"k": citekey}
        for full, short in _BIB_INDEX_FIELDS:
            val = fields.get(full)
            if val:
                slim[short] = val
        state = state_by_key.get(citekey)
        if state:
            slim["bs"] = state
        entries.append(slim)

    payload = {
        "v": 1,
        "stamp": stamp,
        "generatedAt": _now(),
        "schema": "k=citekey t=title a=author e=editor y=year d=doi "
                  "j=journal b=booktitle v=volume n=number p=pages q=publisher s=series "
                  "bs=bib.state",
        "count": len(entries),
        "entries": entries,
    }
    _atomic_write_text(out_path, json.dumps(payload, separators=(",", ":")) + "\n")
    _atomic_write_text(stamp_path, stamp + "\n")
    return True


# Coalesce all master/catalog writes in a process to ONE bib-index rebuild
# at exit. Marking is O(1); the rebuild (stamp-gated) runs once when the
# process ends, so a 1000-entry merge re-parses master.bib once, not 1000x.
_BIB_INDEX_DIRTY: set[Path] = set()
_bib_index_atexit_registered = False


def _flush_bib_index_atexit() -> None:
    for lib in list(_BIB_INDEX_DIRTY):
        try:
            build_bib_index(lib)
        except Exception:
            # A derived-cache rebuild must never crash a skill on the way out.
            pass


def _mark_bib_index_dirty(library: Path) -> None:
    """Schedule a bib-index rebuild at process exit for `library`."""
    global _bib_index_atexit_registered
    try:
        _BIB_INDEX_DIRTY.add(Path(library))
        if not _bib_index_atexit_registered:
            atexit.register(_flush_bib_index_atexit)
            _bib_index_atexit_registered = True
    except Exception:
        pass


def bump_catalog_version(library: Path) -> None:
    """Increment `.virgil/catalog-version.txt`. Self-locks via `lock_catalog`.

    The frontend polls this file every 6s and re-reads catalog.json
    when the number changes. Any change triggers a refresh, so the
    value just needs to differ — we use a monotonically increasing
    integer.
    """
    with lock_catalog(library):
        _bump_version_locked(library)


def normalize_citekey(citekey: str) -> str:
    """Canonicalize a citekey to NFC so it byte-matches the form Python
    JSON writers produce. Any caller comparing user-supplied citekeys
    against catalog entries must normalize first (1976-Tichý memo:
    NFC vs NFD `Tich + y + U+0301` mismatch was silently dropping
    matches).
    """
    import unicodedata
    return unicodedata.normalize("NFC", citekey)


def citekey_matches(stored: str, query: str) -> bool:
    """True if `stored` and `query` refer to the same citekey,
    independent of Unicode normalization form. Catalog and master.bib
    files may carry pre-composed (NFC) or decomposed (NFD) Latin-1
    Supplement codepoints (Tichý, Čerić, López) depending on how the
    source data was prepared. Compare under NFC to defang the drift.
    """
    return normalize_citekey(stored) == normalize_citekey(query)


def _deep_merge(dst: dict, src: dict) -> None:
    """Recursively merge `src` into `dst`.

    Nested dicts merge; arrays and scalars replace.
    """
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_merge(dst[k], v)
        else:
            dst[k] = v


def merge_indexed_warnings(
    existing: list, owned_kinds, fresh: list,
) -> list:
    """Per-KIND recompute-replace over an `indexed.warnings` array.

    For each declared kind K, drop every existing line whose HEAD
    (`line.split(":", 1)[0]`) EQUALS K, then append `fresh` in order.
    Every other line survives byte-identically and in its original
    order — including lines of kinds this pass did not recompute, and
    including non-string junk (preserved rather than silently dropped).

    Why this exists
    ---------------
    The catalog patch channel replaces arrays (`_deep_merge`: "arrays
    and scalars replace"), so a subskill that wanted to persist its own
    freshly-computed warnings had exactly two options — clobber every
    other kind on the row, or defer the write to one late owner. The
    library chose deferral, which is why `/library/clean-bibliography`'s
    `missing-bib-entry:` lines were persisted by `deep-index.md` step 5
    AFTER the Bibliography-synthesis step that reads them (task 323).

    Why EXACT head-equality, not `startswith`
    -----------------------------------------
    `<kind>-false-positive:` is a real, operator-authored suppression
    family with its OWN append-if-absent writer
    (`add_validator_suppression.py`), and readers rely on the two
    families staying distinguishable (`pgmark_validate.py`'s baseline,
    `suppression_categories_from_catalog`). `missing-bib-entry-
    false-positive:` is representable, so a `startswith("missing-bib-
    entry")` drop would eat a verified suppression. Two semantics for
    two families — recompute-replace here, append-if-absent there; do
    not unify them.

    Why REPLACE, not union-by-line
    ------------------------------
    These prefixes are defined as recomputed-per-pass (`_doctrine.md`
    §Persistence convergence): "if a missing entry from a prior pass has
    since been added to references.bib, the rerun drops it from
    warnings." Union is monotone — it can never drop — so resolved gaps
    would stay flagged forever.

    Authority scoping (the rule that keeps the fix from becoming the
    bug): a caller declares ONLY the kinds it actually recomputed this
    pass. Declaring a kind with zero fresh lines correctly CLEARS stale
    ones; declaring a kind you did not recompute silently deletes
    another pass's findings.
    """
    owned = {
        k.strip() for k in (owned_kinds or [])
        if isinstance(k, str) and k.strip()
    }
    out = [
        w for w in (existing or [])
        if not (isinstance(w, str) and w.split(":", 1)[0] in owned)
    ]
    out.extend(fresh or [])
    return out


def update_catalog_entry(
    library: Path,
    citekey: str,
    patch: dict,
    *,
    recompute_warning_kinds=None,
) -> None:
    """Apply `patch` to the catalog entry for `citekey`. Self-locks.

    Deep-merge semantics: nested objects merge, arrays/scalars replace.
    Also stamps `updatedAt` on the entry, refreshes `generatedAt` on
    the catalog, and bumps `.virgil/catalog-version.txt` (via
    `write_catalog`).

    Raises `KeyError` if the entry is not present — callers update
    rows that already exist. Use `upsert_catalog_entry` to add new
    rows.

    `recompute_warning_kinds` (opt-in, keyword-only)
    ------------------------------------------------
    When supplied, `patch["indexed"]["warnings"]` is read as the FRESH
    lines for those kinds and merged against the row's CURRENT array via
    `merge_indexed_warnings` — inside this lock, so the read-modify-write
    is atomic — before `_deep_merge` runs. Called WITHOUT it, behavior is
    byte-identical to before: the patch's array replaces the row's.

    `_deep_merge` itself is deliberately UNMODIFIED. It is shared with
    `upsert_catalog_entry` (index_paper, merge_paper_references), where
    list-replace governs `authors`/`tags`/`importedKeys`/`pdf`/`bib` and
    is pinned by `test_parser_hardening.py`. The merge is opt-in AT THE
    CALL because only the caller knows which kinds it recomputed.

    `None` selects the legacy whole-array replace; a LIST — even an empty
    one — selects merge mode. The two are deliberately distinguishable:
    a caller that computes its kind list and gets `[]` means "I dropped
    nothing", and silently handing that back the CLOBBER path is the one
    surprise this whole change exists to remove.

    Three shapes REFUSE with `ValueError`, all before anything is
    written, because each is a way for a well-formed call to corrupt the
    row silently:

    * declaring kinds with no `indexed.warnings` array in the patch — an
      implied empty would let a patch that meant to set only
      `indexed.state` wipe every line of the declared kinds;
    * a FRESH line whose head is not among the declared kinds — that
      line can never be dropped by a later pass, so it duplicates on
      every run (the typo'd-kind shape: declare `missing-bib-entrie`,
      supply `missing-bib-entry:` lines, and the merge degrades to
      append-only while the shim reports success); and
    * a row whose stored `indexed.warnings` is not a list — iterating a
      string yields one entry per CHARACTER and would rewrite the row
      from them. A malformed row is for a human to repair, not for this
      to guess at.
    """
    if recompute_warning_kinds is not None:
        indexed_patch = patch.get("indexed")
        fresh = indexed_patch.get("warnings") if isinstance(indexed_patch, dict) else None
        if not isinstance(fresh, list):
            raise ValueError(
                "recompute_warning_kinds requires patch['indexed']['warnings'] "
                "to be a list of the fresh lines for those kinds (use [] to "
                "clear them); got "
                f"{type(fresh).__name__}"
            )
        declared = {
            k.strip() for k in recompute_warning_kinds
            if isinstance(k, str) and k.strip()
        }
        undeclared = sorted({
            w.split(":", 1)[0] for w in fresh
            if isinstance(w, str) and w.split(":", 1)[0] not in declared
        } | {
            "<non-string>" for w in fresh if not isinstance(w, str)
        })
        if undeclared:
            raise ValueError(
                "every fresh warning line's head must be a declared kind — "
                f"undeclared: {', '.join(undeclared)}; declared: "
                f"{', '.join(sorted(declared)) or '(none)'}. An undeclared "
                "line is never dropped by a later pass, so it duplicates on "
                "every run."
            )
    with lock_catalog(library):
        catalog = read_catalog(library)
        target = None
        for e in catalog.get("entries", []):
            if citekey_matches(e.get("citekey", ""), citekey):
                target = e
                break
        if target is None:
            raise KeyError(f"catalog.json: no entry for citekey {citekey!r}")
        if recompute_warning_kinds is not None:
            current = (target.get("indexed") or {}).get("warnings")
            if current is None:
                current = []
            if not isinstance(current, list):
                raise ValueError(
                    f"catalog.json: indexed.warnings for {citekey!r} is a "
                    f"{type(current).__name__}, not a list — refusing to merge "
                    "into a malformed row"
                )
            merged = merge_indexed_warnings(
                current, recompute_warning_kinds, patch["indexed"]["warnings"],
            )
            # Copy rather than mutate — the caller's patch is theirs.
            patch = {
                **patch,
                "indexed": {**patch["indexed"], "warnings": merged},
            }
        _deep_merge(target, patch)
        target["updatedAt"] = _now()
        write_catalog(library, catalog)


def upsert_catalog_entry(
    catalog: dict,
    citekey: str,
    *,
    _guard=None,
    _guard_fields=None,
    _guard_type=None,
    **fields,
) -> dict:
    """In-memory upsert against a catalog dict (no I/O, no lock).

    Caller is responsible for reading + writing the catalog under
    `lock_catalog`. Used by the indexing pipeline which already has
    the catalog in hand when it computes new row fields.

    Merge semantics
    ---------------
    On an EXISTING row, a nested-dict field (`bib`, `indexed`, `pdf`, or any
    other dict-valued field) is DEEP-MERGED (`_deep_merge`), not replaced —
    so a `bib={"state": "x"}` patch preserves sibling keys like
    `importedKeys`/`authenticatedAt` that a caller didn't re-supply. Scalar and
    list fields keep REPLACE semantics (the caller's value wins outright).

    Duplicate-work guard (optional, keyword-only)
    ---------------------------------------------
    When `_guard` (a `work_identity.WorkIndex`) is provided AND no row matches
    `citekey` exactly AND `_guard.find(_guard_fields, _guard_type)` yields a
    `same`-work row under a DIFFERENT citekey, raise `DuplicateWorkError`
    instead of appending a second holdings record. Callers passing no `_guard`
    are completely unaffected (the guard block is skipped). The `work_identity`
    import is lazy (inside this function) to avoid any import cycle.
    """
    for e in catalog.get("entries", []):
        if citekey_matches(e.get("citekey", ""), citekey):
            # Deep-merge nested dicts (bib/indexed/pdf/…); replace scalars+lists.
            for k, v in fields.items():
                if isinstance(v, dict) and isinstance(e.get(k), dict):
                    _deep_merge(e[k], v)
                else:
                    e[k] = v
            e["updatedAt"] = _now()
            return e

    # No exact-citekey row. Consult the work-identity guard (if supplied) before
    # minting a NEW row, so an incoming holding that duplicates an existing work
    # under a different citekey is refused rather than silently added.
    if _guard is not None:
        matches = _guard.find(_guard_fields or {}, _guard_type or "", exclude_ck=citekey)
        for existing_ck, verdict in matches:
            if verdict.relation == "same" and not citekey_matches(existing_ck, citekey):
                raise DuplicateWorkError(existing_ck, verdict)

    e = {
        "citekey": citekey,
        "addedAt": _now(),
        "updatedAt": _now(),
        "pdf": {"present": False},
        "indexed": {"state": "none"},
        "bib": {"state": "none"},
        **fields,
    }
    catalog.setdefault("entries", []).append(e)
    return e


# ── per-paper references.bib writer ───────────────────────────────────
#
# THE single writer for a paper's own row in papers/<citekey>/references.bib.
# Every caller goes through it (index_paper's index-time stamp and its
# `_resync_references_bib`, triage_apply's bib-only folder creation) so the
# upsert contract can't be re-opened by one of them.
#
# Why an upsert and not a re-emit: `references.bib` is a single-entry mirror
# of the master.bib row only UNTIL /library/deep-index runs. Its step 3f
# (/library/clean-bibliography) replaces the file with the paper's **actual
# cited works** — see clean-bibliography.md ("we're replacing it with the
# paper's actual cited works") and deep-index.md ("Each paper's
# references.bib is self-contained"). Three writers used to `write_text` a
# single emitted entry over the whole file, so authenticating, applying a
# manual bib edit to, or re-indexing a deep-indexed paper silently collapsed
# a dozens-entry bibliography to one. The loss then propagated: the next
# /library/merge-bibs found one entry where there had been many and reported
# a clean run (task 168).
#
# No lock: unlike master.bib / catalog.json / inbox.json this file is
# per-paper, and library skills are parallel-safe only ACROSS citekeys.


def write_paper_bib_entry(
    paper_dir: Path,
    citekey: str,
    entry_type: str,
    fields: dict[str, str],
) -> None:
    """Upsert ONE entry into `paper_dir/references.bib`.

    Creates the file (and folder) when absent — that's the first-index path,
    and it yields the familiar single-entry mirror. When the file already
    holds other entries they survive byte-identically.
    """
    from _bib_parse import upsert_entry_text  # lazy: sibling, avoids a cycle

    paper_dir.mkdir(parents=True, exist_ok=True)
    refs = paper_dir / "references.bib"
    existing = refs.read_text() if refs.exists() else ""
    refs.write_text(upsert_entry_text(existing, citekey, entry_type, fields))


# ── bib-import flag (per-paper references.bib → master.bib) ───────────
#
# `bib.imported` marks that a paper's references.bib has been folded into
# master.bib (via merge_paper_references.py / /library/import-bib). The
# companion `bib.importedKeys` snapshots the citekey set at import time so we
# can detect *additions* later: if references.bib gains a citekey not in the
# snapshot, the flag is cleared. Removals are ignored (additions-only — a
# product decision). This is the single switch behind both the merge-bibs
# worklist skip-gate (req 4) and the on-bib-change invalidation (req 5).


def references_bib_keys(library: Path, citekey: str) -> list[str]:
    """Sorted NFC citekeys in papers/<citekey>/references.bib (empty if
    the file is absent or unparseable)."""
    refs = library / "papers" / citekey / "references.bib"
    if not refs.exists():
        return []
    try:
        from _bib_parse import read_bib_file  # lazy: sibling, avoids import cycle
        entries = read_bib_file(refs)
    except Exception:
        return []
    return sorted({
        normalize_citekey(e["citekey"]) for e in entries if e.get("citekey")
    })


def mark_bib_imported(
    library: Path, citekey: str, keys: list[str] | None = None
) -> None:
    """Stamp bib.imported=true + importedAt + importedKeys on the catalog row.
    Self-locks via `update_catalog_entry`. `keys` defaults to the current
    references.bib citekey set. Raises KeyError if the row is missing."""
    if keys is None:
        keys = references_bib_keys(library, citekey)
    update_catalog_entry(library, citekey, {"bib": {
        "imported": True,
        "importedAt": _now(),
        "importedKeys": sorted(set(keys)),
    }})


def bib_import_added_keys(library: Path, citekey: str) -> list[str]:
    """Citekeys now in references.bib that were NOT present at import time.
    Empty list => nothing added since import (or the row isn't marked
    imported — no baseline to compare). Additions-only; removals ignored."""
    cat = read_catalog(library)
    entry = None
    for e in cat.get("entries", []):
        if citekey_matches(e.get("citekey", ""), citekey):
            entry = e
            break
    if entry is None:
        return []
    bib = entry.get("bib") or {}
    if not bib.get("imported"):
        return []
    baseline = {normalize_citekey(k) for k in (bib.get("importedKeys") or [])}
    current = set(references_bib_keys(library, citekey))
    return sorted(current - baseline)


def invalidate_bib_imported_if_added(library: Path, citekey: str) -> bool:
    """If bib.imported is set and references.bib gained a citekey since
    import, clear bib.imported. Returns True if it flipped, False on no-op
    (not imported, nothing added, or no catalog row). Safe to call from any
    references.bib writer — it's a no-op when the paper isn't imported."""
    if not bib_import_added_keys(library, citekey):
        return False
    try:
        update_catalog_entry(library, citekey, {"bib": {"imported": False}})
    except KeyError:
        return False
    return True


def invalidate_changed_imports(library: Path) -> list[str]:
    """Sweep every imported catalog row and clear bib.imported on any paper
    whose references.bib has gained a citekey since import (additions-only).
    Returns the citekeys that flipped. This is the steady-state catch-all for
    requirement 5 — run it from the drain so the "imported" badge clears on
    the next skill pass no matter which writer changed references.bib."""
    flipped: list[str] = []
    for e in read_catalog(library).get("entries", []):
        ck = e.get("citekey")
        if not ck:
            continue
        if not (e.get("bib") or {}).get("imported"):
            continue
        if invalidate_bib_imported_if_added(library, ck):
            flipped.append(ck)
    return flipped


# ── inbox ────────────────────────────────────────────────────────────


def append_inbox_item(library: Path, item: dict, *, cap: int = 200) -> None:
    """Append `item` to `.virgil/notifications/inbox.json`. Self-locks.

    Caps the ring buffer at `cap` items so it doesn't grow forever.
    Tolerates missing/malformed inbox by starting fresh.
    """
    with lock_inbox(library):
        inbox_path = library / ".virgil" / "notifications" / "inbox.json"
        inbox: dict = {"items": []}
        if inbox_path.exists():
            try:
                inbox = json.loads(inbox_path.read_text())
            except Exception:
                pass
        inbox.setdefault("items", []).append(item)
        inbox["items"] = inbox["items"][-cap:]
        _atomic_write_text(
            inbox_path,
            json.dumps(inbox, indent=2) + "\n",
        )


# ── master.bib ───────────────────────────────────────────────────────


def _parse_bib_fields(body: str) -> dict[str, str]:
    out: dict[str, str] = {}
    i = 0
    while i < len(body):
        while i < len(body) and body[i] in " \t\n\r,":
            i += 1
        if i >= len(body):
            break
        eq = body.find("=", i)
        if eq == -1:
            break
        name = body[i:eq].strip().lower()
        i = eq + 1
        while i < len(body) and body[i] in " \t\n\r":
            i += 1
        if i >= len(body):
            break
        if body[i] == "{":
            depth = 1
            j = i + 1
            while j < len(body) and depth > 0:
                if body[j] == "{":
                    depth += 1
                elif body[j] == "}":
                    depth -= 1
                j += 1
            out[name] = body[i + 1:j - 1].strip()
            i = j
        elif body[i] == '"':
            # Hazard 5(a): a `"`-quoted value's closing quote is the `"` at
            # brace-depth 0 that is not backslash-escaped. The old
            # `body.find('"', i+1)` stopped at the FIRST inner quote, truncating
            # values like `title = "He said \"hi\""` (escaped) or ones carrying a
            # braced quote `title = "a {"} b"` — which corrupted every following
            # field name and DROPPED the entry's later fields (e.g. its doi).
            # Walk instead, tracking brace depth and skipping `\"`.
            j = i + 1
            qdepth = 0
            while j < len(body):
                c = body[j]
                if c == "\\" and j + 1 < len(body):
                    j += 2  # escaped char (\" or \\) — never a delimiter
                    continue
                if c == "{":
                    qdepth += 1
                elif c == "}":
                    if qdepth > 0:
                        qdepth -= 1
                elif c == '"' and qdepth == 0:
                    break
                j += 1
            if j >= len(body):
                out[name] = body[i + 1:].strip()
                break
            out[name] = body[i + 1:j].strip()
            i = j + 1
        else:
            j = i
            while j < len(body) and body[j] not in ",\n":
                j += 1
            out[name] = body[i:j].strip()
            i = j
    return out


def read_master_bib(path: Path, *, text: str | None = None) -> dict[str, dict]:
    """Lightweight bib parser. Returns {citekey: {type, fields, raw}}.

    Robust to malformed entries: entries are delimited by their line-anchored
    `@type{key,` openers (`_BIB_ENTRY_START_RE`), and brace-matching for each
    entry's `raw`/body is CAPPED at the next opener. A single brace-unbalanced
    entry therefore overruns to (at most) the next entry boundary instead of
    swallowing the rest of the file — the failure mode of the old global
    brace-matcher, which silently dropped ~82% of a real 34k-entry library on
    one bad entry (a `citekey in read_master_bib(...)` check then wrongly
    reported real entries as missing). Last-wins on duplicate citekeys.

    No lock held — readers see whatever is on disk. Atomic writes
    (`_atomic_write_text`) ensure readers never see a partially-written file.

    `text` lets a caller that has ALREADY read master.bib pass the bytes in,
    so a caller needing both the entries and their `% bib.state` comments
    (`master_bib_state_map`) pays ONE read of a ~10 MB file instead of two.
    """
    if text is None:
        if not path.exists():
            return {}
        text = path.read_text()
    entries: dict[str, dict] = {}
    starts = list(_BIB_ENTRY_START_RE.finditer(text))
    consumed_until = 0  # end offset of the last brace-balanced entry
    for idx, m in enumerate(starts):
        # Hazard 5(b): skip a `@type{key,` that sits inside a prior BALANCED
        # entry's brace span — it was a value (e.g. a column-0 `@article{...}`
        # inside a `note = {...}`), not a real entry. Capping at the next opener
        # (the old behavior) would have truncated the enclosing entry, dropping
        # its remaining fields (its doi) and minting a phantom. Containment for
        # genuinely malformed (unbalanced) entries is preserved below.
        if m.start() < consumed_until:
            continue
        entry_type = m.group(1).lower()
        citekey = m.group(2).strip()
        brace = text.find("{", m.start())
        # ONE extent rule, shared with `update_master_bib_entry` — see
        # `bib_entry_extent`. Uncapped first (so a value holding a column-0
        # `@type{...}` still balances), capped at the next opener only when it
        # never balances (so one bad entry can't swallow the rest).
        j, balanced = bib_entry_extent(text, m.start())
        if balanced:
            consumed_until = j
        raw = text[m.start():j]
        body_start = text.find(",", brace) + 1
        body = text[body_start:(j - 1) if balanced else j]
        fields = _parse_bib_fields(body)
        if citekey:
            entries[citekey] = {"type": entry_type, "fields": fields, "raw": raw}
    return entries


def bib_entry_extent(text: str, opener_start: int) -> tuple[int, bool]:
    """End offset (exclusive) of the entry opening at `opener_start`, + balanced?

    THE spelling of "how far does one master.bib entry reach", read by both
    halves of the file's round trip — `read_master_bib` and
    `update_master_bib_entry`. It has to be one rule: the reader was CAPPED and
    the writer was not, so a brace-unbalanced entry that the reader correctly
    contained was, at the writer, walked to EOF — and the splice then replaced
    every following entry with one emitted block. `read_master_bib`'s own
    docstring records that this failure mode once dropped ~82% of a real
    34 k-entry library; the writer kept it, and task 443 gave it a new, high-
    volume reacher by making `/library/authenticate-bib` step 7 a master.bib
    writer for the first time.

    Two passes, in this order, and the order is load-bearing:

      1. match braces with NO cap, so a value containing a column-0 `@type{...}`
         (a `note = {@article{x, ...}}`) still balances and the entry keeps its
         remaining fields;
      2. only if that never balances, cap at the next entry opener, so ONE bad
         entry cannot swallow the rest of the file.

    Returns `(end, balanced)`. On the capped path `end` is the next opener (or
    EOF) and `balanced` is False — a caller that REWRITES must treat that as
    "do not touch", because the extent is a guess about malformed bytes.
    """
    brace = text.find("{", opener_start)
    if brace == -1:
        return len(text), False
    depth = 1
    j = brace + 1
    while j < len(text) and depth > 0:
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
        j += 1
    if depth == 0:
        return j, True
    nxt = _BIB_ENTRY_START_RE.search(text, brace + 1)
    return (nxt.start() if nxt else len(text)), False


def emit_bib_entry(citekey: str, entry_type: str, fields: dict[str, str]) -> str:
    field_lines = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields.items() if v)
    return f"@{entry_type}{{{citekey},\n{field_lines}\n}}\n"


def rename_master_bib_entry(library: Path, old: str, new: str) -> bool:
    """Rewrite the citekey on a single master.bib entry. Self-locks.

    Replaces the `@<type>{<old>,` opener with `@<type>{<new>,` and
    leaves the rest of the entry untouched. Returns True if `old` was
    found and rewritten, False otherwise. No-op (returns False) if the
    file is missing.

    Citekeys with diacritics are looked up under both NFC and NFD
    forms; the rewrite writes the NFC form (1976-Tichý memo).
    """
    import unicodedata
    master_path = library / "master.bib"
    new_nfc = unicodedata.normalize("NFC", new)
    with lock_master_bib(library):
        if not master_path.exists():
            return False
        text = master_path.read_text()
        new_text = text
        n = 0
        for form in ("NFC", "NFD"):
            old_form = unicodedata.normalize(form, old)
            pattern = re.compile(
                r"(@\w+\s*\{\s*)" + re.escape(old_form) + r"(\s*,)"
            )
            new_text, n = pattern.subn(
                rf"\g<1>{new_nfc}\g<2>", new_text, count=1,
            )
            if n > 0:
                break
        if n == 0:
            return False
        _atomic_write_text(master_path, new_text)
    _mark_bib_index_dirty(library)
    return True


def rename_catalog_entry(library: Path, old: str, new: str) -> bool:
    """Mutate the `citekey` field of one catalog row. Self-locks.

    Returns True if a row with citekey `old` was found and renamed.
    Bumps `catalog-version.txt` on success via `write_catalog`.
    """
    with lock_catalog(library):
        catalog = read_catalog(library)
        for e in catalog.get("entries", []):
            if citekey_matches(e.get("citekey", ""), old):
                e["citekey"] = normalize_citekey(new)
                e["updatedAt"] = _now()
                write_catalog(library, catalog)
                return True
        return False


def update_master_bib_entry(
    library: Path,
    citekey: str,
    entry_type: str,
    fields: dict[str, str],
    bib_state: str = "",
) -> None:
    """Replace (or append) one entry in master.bib. Self-locks.

    Finds the @type{citekey, ...} block, replaces it (and any
    preceding `% bib.state = ...` comment line) with a freshly emitted
    block. If the citekey is not found, appends at the end.

    Citekeys with diacritics are matched under both NFC and NFD forms
    (1976-Tichý memo: the file may hold either normalization). The
    writeback uses NFC for consistency.
    """
    import unicodedata
    master_path = library / "master.bib"
    citekey = unicodedata.normalize("NFC", citekey)
    with lock_master_bib(library):
        if not master_path.exists():
            master_path.write_text("")
        text = master_path.read_text()
        original_text = text
        # Try NFC first, then NFD if NFC isn't present.
        m = None
        for form in ("NFC", "NFD"):
            key_form = unicodedata.normalize(form, citekey)
            pattern = re.compile(
                r"@\w+\s*\{\s*" + re.escape(key_form) + r"\s*,"
            )
            m = pattern.search(text)
            if m:
                break
        if m:
            entry_start = m.start()
            # ONE extent rule, shared with `read_master_bib` — see
            # `bib_entry_extent`. This walk used to be UNCAPPED here while the
            # reader was capped, so a brace-unbalanced entry was walked to EOF
            # and the splice below replaced every following entry with one
            # emitted block: silent, unbounded entry loss on a file the reader
            # reports perfectly.
            entry_end, balanced = bib_entry_extent(text, m.start())
            if not balanced:
                # The extent is a GUESS about malformed bytes. A reader may act
                # on a guess (it only mis-reports one entry); a writer may not
                # (it destroys whatever the guess got wrong). Leave the file
                # exactly as it is — a malformed entry needs a human repair,
                # and losing its neighbours is never the fallback.
                raise BibEntryUnbalanced(citekey)
            at_line_start = text.rfind("\n", 0, entry_start)
            if at_line_start == -1:
                at_line_start = 0
            else:
                at_line_start += 1
            prev_line_start = text.rfind("\n", 0, max(0, at_line_start - 1))
            if prev_line_start == -1:
                prev_line_start = 0
            else:
                prev_line_start += 1
            prev_line = text[prev_line_start:at_line_start].strip()
            # F#4: the `% bib.state` comment is the authoritative state home,
            # so a fields-only writeback (no `bib_state` arg) must NOT erase it.
            # When we're swallowing an existing comment, carry its state forward
            # unless the caller passed an explicit new state.
            existing_comment_state = ""
            if prev_line.startswith("% bib.state"):
                entry_start = prev_line_start
                # `[\w-]+` so hyphenated states (needs-reauth) survive a
                # fields-only writeback instead of truncating to "needs".
                cm = re.match(r"%\s*bib\.state\s*=\s*([\w-]+)", prev_line)
                if cm:
                    existing_comment_state = cm.group(1)
            effective_bib_state = bib_state or existing_comment_state
            replacement = ""
            if effective_bib_state:
                replacement += f"% bib.state = {effective_bib_state}\n"
            replacement += emit_bib_entry(citekey, entry_type, fields)
            # `entry_end` stops at the closing `}`; `emit_bib_entry` ends with
            # `}\n`. Splicing the two together therefore INSERTED a newline on
            # every rewrite — so a re-assert of an unchanged entry was not a
            # no-op at all, it grew master.bib by one blank line, every time,
            # forever (task 443: the F#4 write gate re-asserts once per refused
            # row, which on a 500-entry `.bib` import is 500 blank lines a run).
            # Hand the newline back to the tail that already has it.
            if replacement.endswith("\n") and text[entry_end:entry_end + 1] == "\n":
                replacement = replacement[:-1]
            text = text[:entry_start] + replacement + text[entry_end:]
        else:
            replacement = ""
            if bib_state:
                replacement += f"% bib.state = {bib_state}\n"
            replacement += emit_bib_entry(citekey, entry_type, fields)
            if text and not text.endswith("\n"):
                text += "\n"
            text += "\n" + replacement
        # Skip a write that would change nothing. master.bib is ~10 MB /
        # 24 k entries in the reporting library, and this writer is
        # RE-ASSERTED far more often than it is asked to change anything:
        # every `ensure_bib_state_comment` call site has already stamped the
        # comment through its own write a moment earlier, and since task 443
        # the F#4 write gate (`admit_catalog_row`) re-asserts it once per
        # refused row — which on a 500-entry `.bib` import is 500 rewrites of
        # the file for no change at all. Skipping here is what makes that
        # door free to ask, and it is exact: the comparison is the whole
        # resulting text against the whole text read under this same lock.
        #
        # `_mark_bib_index_dirty` stays UNCONDITIONAL — it only schedules a
        # rebuild at process exit and it is cheap. It is deliberately NOT
        # claimed as a repair path for an index that is stale for some other
        # reason: `build_bib_index` is stamp-gated, so a skipped write leaves
        # the stamp matching and the flush is a no-op. Pre-443 the ONLY thing
        # that healed such an index was the accidental blank-line growth two
        # branches up, which moved the mtime on every re-assert — an accident,
        # not a mechanism. The real hole it was papering over (a projection
        # whose SHAPE changed) is closed at the gate instead, by
        # `_bib_index_schema_stamp`.
        if text != original_text:
            _atomic_write_text(master_path, text)
    _mark_bib_index_dirty(library)


# ── F#4 holdings model ────────────────────────────────────────────────
#
# catalog.json carries ONLY holdings rows (pdf.present=true). Reference-only
# entries (no source file on disk) no longer get a catalog row; their auth
# state lives solely as a `% bib.state = <state>` comment in master.bib,
# projected into bib-index.json by build_bib_index. These helpers are the
# single decision point shared by every writer (merge_paper_references,
# triage_apply).

# Source-format priority — THE spelling of "what counts as a source document
# for a paper, and which one wins". When more than one source file exists for a
# citekey (the user dropped a .docx alongside an existing .pdf), the FIRST in
# this tuple wins: DOCX carries explicit structure (paragraph styles, headings,
# tables) that the PDF pipeline has to reverse-engineer with heuristics, and a
# `.tex` source needs no extraction at all.
#
# It lives HERE, on the stdlib-only leaf, rather than in `index_paper.py` where
# it was born, because the layers that need it cannot import that module: it
# pulls in marker / pymupdf / the whole extraction stack, so a cheap local
# pre-flight (`validate_bib_coherence.py`) that imported it would drag the
# indexer's dependency tree into a step that must be fast and offline — and
# would fail outright on a machine where the extractors aren't installed. A
# vocabulary the layer that needs it cannot import gets re-copied, every time;
# `_HOLDINGS_EXTS` (dotted, differently ordered) was already the second copy.
SOURCE_FORMAT_PRIORITY = ("tex", "docx", "pdf")


def resolve_paper_source(library: Path, citekey: str) -> "tuple[Path, str] | None":
    """Return `(path, ext)` for `citekey`'s highest-priority source, or None.

    Scans `papers/<citekey>/<citekey>.<ext>` in `SOURCE_FORMAT_PRIORITY`
    order; first hit wins. Lower-priority sources for the same citekey stay
    on disk as archives.

    Citekeys with diacritics are looked up under both NFC and NFD forms
    (the 1976-Tichý memo class), and the path returned is the one that
    actually exists on disk.
    """
    import unicodedata
    paper_dir = library / "papers"
    for ext in SOURCE_FORMAT_PRIORITY:
        for form in ("NFC", "NFD"):
            ck = unicodedata.normalize(form, citekey)
            p = paper_dir / ck / f"{ck}.{ext}"
            if p.exists():
                return p, ext
    return None


def paper_has_holdings(library: Path, citekey: str) -> bool:
    """True iff `papers/<citekey>/` holds an actual source document.

    A holding is a `<citekey>.{tex,docx,pdf}` source file. This is the F#4
    gate: only holdings get a catalog row. A reference-only entry (cited but
    not held) has a master.bib entry + `% bib.state` comment but no source
    file, so this returns False and the writer skips the catalog row.

    Derived from `resolve_paper_source` so the extension set is stated once —
    the answer is a boolean, so the priority ORDER cannot change it.
    """
    return resolve_paper_source(library, citekey) is not None


# ── F#4 READ side: one door, master-first ─────────────────────────────
#
# The mirror of `ensure_bib_state_comment` below. F#4 moved a FILELESS
# reference's auth state out of catalog.json and into master.bib's
# `% bib.state` comment; the writers and the TypeScript reader migrated and
# the Python readers did not, so for 85% of the corpus every Python caller
# asking the catalog got "none" (task 442). Every reader now enters here.


def master_bib_state_map(text: str) -> dict[str, str]:
    """`{NFC citekey: state}` for every `% bib.state` comment in master.bib.

    ONE regex sweep — build it once per master read and thread it into a hot
    loop via `resolve_bib_state(..., master_states=...)`. `master.bib` is
    ~10 MB / 24 k entries in the reporting library, so a per-citekey re-read
    would be the read fix's own regression.
    """
    return {
        normalize_citekey(ck): state
        for ck, state in iter_master_bib_states(text)
    }


def resolve_bib_state(
    library: Path,
    citekey: str,
    *,
    master_states: "dict[str, str] | None" = None,
    master_text: str | None = None,
    catalog: dict | None = None,
) -> str:
    """What is this citekey's bibliography auth state?

    THE F#4 read. Resolution order is load-bearing and is the OPPOSITE of the
    pre-442 code:

      1. master.bib's `% bib.state = <state>` comment — the HOME. Every
         current writer stamps it (`update_master_bib_entry`,
         `ensure_bib_state_comment`), `build_bib_index` projects it into the
         frontend's `bs` field, and it is the only copy a fileless
         reference-only entry has.
      2. A catalog row's `bib.state` — the pre-F#4 FALLBACK. A library that
         has not run `prune_catalog_present_false` still carries holdings
         rows whose state may be the only copy, so the catalog stays a
         fallback rather than being dropped. It loses a disagreement.
      3. `"none"` when neither speaks.

    Costs: pass `master_states` (a `master_bib_state_map`) inside a loop;
    otherwise `master_text` for one already-read file; otherwise the master
    is read from disk. `catalog` is likewise reused when supplied.
    """
    key = normalize_citekey(citekey)

    if master_states is None:
        if master_text is None:
            master_path = library / "master.bib"
            master_text = master_path.read_text() if master_path.exists() else ""
        master_states = master_bib_state_map(master_text)
    state = master_states.get(key)
    if state:
        return state

    if catalog is None:
        catalog = read_catalog(library)
    for e in catalog.get("entries", []):
        if citekey_matches(e.get("citekey", ""), citekey):
            return catalog_row_bib_state(e) or "none"
    return "none"


def catalog_row_bib_state(row: dict) -> str:
    """The pre-F#4 FALLBACK read, spelled once: a catalog row's `bib.state`.

    Public only so a caller that already HAS the row (rather than a citekey to
    look up) can take the fallback arm without re-implementing it — which is
    what the census exists to prevent. Never the whole answer on its own: ask
    `resolve_bib_state` unless the master half is already in hand.
    """
    return ((row.get("bib") or {}).get("state")) or ""


def ensure_bib_state_comment(
    library: Path,
    citekey: str,
    entry_type: str,
    fields: dict[str, str],
    state: str,
) -> None:
    """Write/refresh the `% bib.state = <state>` comment for `citekey` in
    master.bib WITHOUT minting a catalog row (the F#4 reference-only path).

    Thin wrapper over `update_master_bib_entry` so callers read at the
    intent level ("record this reference's auth state") rather than the
    mechanism. The state is validated against the canonical set so a typo
    can't write a value the bib-index reader will silently drop to "none".
    """
    if state and state not in CANONICAL_BIB_STATES:
        raise ValueError(
            f"bib.state {state!r} is not canonical (see CANONICAL_BIB_STATES); "
            "the bib-index reader would drop it to 'none'."
        )
    update_master_bib_entry(library, citekey, entry_type, fields, bib_state=state)


# ── F#4 WRITE side: ONE door, asked before every catalog row is minted ─
#
# The gate below is the mirror of `resolve_bib_state` above: that one is the
# single place a READER asks "what is this citekey's auth state?", this one is
# the single place a WRITER asks "is this citekey even entitled to a catalog
# row, and if not, where does its state go?".
#
# It exists because the gate had three enforcers and one of them forgot
# (task 443). `merge_paper_references._upsert_catalog_row` and
# `triage_apply._upsert_catalog_row_bib_only` each asked `paper_has_holdings`
# and each discharged the state to master.bib by hand;
# `index_paper._sync_catalog_entry_from_master` — reached by
# `/library/authenticate-bib` step 7, i.e. once per entry of every `.bib`
# import — asked nothing and called `upsert_catalog_entry` unconditionally,
# whose no-match branch APPENDS. So a 500-entry `.bib` drop minted 500 rows
# the other two writers had refused three lines earlier: a frozen snapshot of
# the `bib` block shadowing the live bib-index projection the frontend reads
# for a fileless reference, and the one path that grows the catalog without
# bound (the reporting library: 3 722 rows against 24 082 master entries).
#
# The lesson is the one this repo keeps re-learning: a rule enforced by each
# caller is a rule the next caller can skip in silence. What is shared here is
# not the row PAYLOAD — the three writers' rows genuinely differ (a merge
# carries accumulated `fieldChanges`, a triage row preserves `addedAt`/`tags`,
# the indexer writes an `indexed` block) — it is the QUESTION and the
# OBLIGATION its `False` answer carries. Fusing the two is what makes the
# obligation unforgettable: a caller cannot ask without discharging.


def admit_catalog_row(
    library: Path,
    citekey: str,
    *,
    entry_type: str,
    fields: dict[str, str],
    bib_state: str,
    bib: "dict | None" = None,
    top: "dict | None" = None,
) -> bool:
    """THE F#4 write gate. Ask BEFORE minting a catalog row.

    Returns **True** iff `citekey` is a HOLDING — a source document sits at
    `papers/<citekey>/<citekey>.{tex,docx,pdf}` — i.e. iff it is entitled to
    a row in catalog.json. The caller then writes its row however its own
    payload requires; this door has touched nothing.

    Returns **False** for a reference-only entry (cited but not held), and
    before returning does the TWO things that answer owes:

    1. DISCHARGE the auth state to its home — the `% bib.state = <state>`
       comment in master.bib, which `build_bib_index` projects into
       bib-index.json and every reader resolves through `resolve_bib_state`.
    2. REFRESH an already-existing row, and never mint one. A pre-F#4 library
       still carries rows for fileless citekeys (the reporting library: 3 722
       rows against 24 082 master entries), and `LibraryView` suppresses its
       bib-index-backed synthetic row for any citekey the catalog already
       names — so a row left un-refreshed does not merely sit there, it
       SHADOWS the live projection and freezes the state and title the user
       sees. Leaving it stale is the same defect this door exists to close,
       arriving from the other side. `prune_catalog_present_false --apply` is
       the migration that removes such rows, and nothing in the shipped flow
       invokes it.

    So a `False` caller has nothing left to do but return — which is the point
    of fusing the ask, the discharge and the refresh into one call rather than
    leaving them as three things to remember. (`triage_apply` had 2 by hand
    and not 1; `index_paper` had neither; `merge_paper_references` had 1 and
    not 2. One door, one rule, three writers.)

    `bib` is the row's `bib` block for the refresh, defaulting to just the
    state; its `fieldChanges` are APPENDED to whatever the row already holds,
    so history accumulates across runs exactly as it does on a holdings row.
    `top` is any top-level fields (title/authors/year/doi) the caller has
    derived — passed only by a caller that used to write them, because the
    three writers derive them differently and this door is not entitled to
    pick one derivation for all of them.

    The discharge is a RE-ASSERT in every shipped caller (each one's own
    master.bib write has already stamped the comment), and is idempotent:
    `update_master_bib_entry` skips the write outright when the resulting text
    is byte-identical to what it read, so asking this on a per-entry hot path
    costs one read of master.bib, not one rewrite of it.

    `bib_state` falsy or `"none"` discharges NOTHING. "I have no state to
    record" must never overwrite a state some earlier run authenticated —
    `update_master_bib_entry` writes `% bib.state = none` verbatim, so passing
    it through would be a silent downgrade rather than a no-op. **That is the
    whole of the guard, and the wider rule is deliberately NOT here:** a
    weaker CANONICAL state (an `unverified` over an `authenticated`) still
    lands, because deciding whether re-authentication may downgrade is a
    question about the auth pipeline, not about this gate.
    `merge_paper_references._write_master` holds its own no-downgrade guard
    for the case it owns.
    """
    if paper_has_holdings(library, citekey):
        return True
    if bib_state and bib_state != "none":
        ensure_bib_state_comment(library, citekey, entry_type, fields, bib_state)
    patch = dict(bib) if bib else ({"state": bib_state} if bib_state else None)
    if patch or top:
        with lock_catalog(library):
            catalog = read_catalog(library)
            for i, e in enumerate(catalog.get("entries", [])):
                if not citekey_matches(e.get("citekey", ""), citekey):
                    continue
                if patch:
                    merged = dict(e.get("bib") or {})
                    merged.update(patch)
                    prior = (e.get("bib") or {}).get("fieldChanges") or []
                    fresh = patch.get("fieldChanges") or []
                    if prior or fresh:
                        merged["fieldChanges"] = list(prior) + list(fresh)
                    e["bib"] = merged
                for k, v in (top or {}).items():
                    e[k] = v
                e["updatedAt"] = _now()
                catalog["entries"][i] = e
                write_catalog(library, catalog)
                break
    return False
