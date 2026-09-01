"""Shared helpers for editor-side Python scripts.

These run against a user's paper folder (passed as `<docPath>` to every
script). The folder layout is:

  <doc>/
    <something>.tex          one .tex at the root; we glob to find it
    references.bib           usually present
    virgil/
      ai-requests.json       unified queue (with status field)
      bib-review-requests.json
      notes.json, todos.json, cutter.json, revisions.json, ...
      virgil.json            paragraph fingerprint map
      notifications.json     append-only inbox we write to on completion
      version.txt            single integer, bumped on every writeback

All helpers here are stdlib-only (Python 3.10+) — no third-party deps.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


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


# ---------------------------------------------------------------------------
# Paragraph UUID regex (mirrors src/lib/uuid.ts).
#
# .tex paragraphs end with `%!v:<4hex>` markers, e.g. "Some text. %!v:f1c5".
# ---------------------------------------------------------------------------

NODE_UUID_REGEX = re.compile(r"%!v:([0-9a-f]{4})")
NODE_UUID_ANCHOR = re.compile(r"^[ \t]*%!v:([0-9a-f]{4})", re.MULTILINE)


def find_paragraph_uuids(text: str) -> list[dict]:
    """Return [{uuid, line}] for every `%!v:xxxx` marker in `text`.

    Lines are 1-based to match editor conventions. The marker line is the
    line that owns the trailing `%!v:xxxx` comment — for single-line
    paragraphs `startLine == endLine`, but inline-style assignments may
    have distinct start/end (we don't reconstruct those here; the marker
    line is what cards anchor to).
    """
    out = []
    for m in NODE_UUID_REGEX.finditer(text):
        line = text.count("\n", 0, m.start()) + 1
        out.append({"uuid": m.group(1), "line": line})
    return out


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def resolve_doc(doc_path: str) -> Path:
    """Resolve `<docPath>` to an absolute Path. Errors if it doesn't look
    like a Virgil paper folder (no `virgil/` subdir)."""
    p = Path(doc_path).expanduser().resolve()
    if not p.is_dir():
        die(f"docPath is not a directory: {p}")
    if not (p / "virgil").is_dir():
        die(f"docPath has no virgil/ subdir: {p}")
    return p


def find_tex_file(doc: Path) -> Path:
    """Find the doc's main .tex file. Errors if not exactly one .tex sits
    at the folder root."""
    candidates = sorted([f for f in doc.iterdir() if f.suffix == ".tex"])
    if len(candidates) == 0:
        die(f"no .tex file found in {doc}")
    if len(candidates) == 1:
        return candidates[0]
    # Heuristics matching storage-fsa.ts resolveBibFilename:
    stem = doc.name
    by_stem = [c for c in candidates if c.stem == stem]
    if by_stem:
        return by_stem[0]
    for preferred in ("main.tex", "document.tex"):
        for c in candidates:
            if c.name == preferred:
                return c
    return candidates[0]


def find_bib_file(doc: Path) -> Path | None:
    """Find the references .bib for the doc, or None if absent."""
    tex = find_tex_file(doc)
    text = tex.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"\\(?:bibliography|addbibresource)\{([^}]+)\}", text)
    if m:
        name = m.group(1).strip()
        if not name.endswith(".bib"):
            name += ".bib"
        cand = doc / name
        if cand.exists():
            return cand
    bibs = sorted([f for f in doc.iterdir() if f.suffix == ".bib"])
    if len(bibs) == 1:
        return bibs[0]
    if len(bibs) > 1:
        stem_match = next((b for b in bibs if b.stem == tex.stem), None)
        return stem_match or bibs[0]
    return None


def virgil_dir(doc: Path) -> Path:
    return doc / "virgil"


def sidecar(doc: Path, name: str) -> Path:
    return virgil_dir(doc) / name


# ---------------------------------------------------------------------------
# JSON I/O
# ---------------------------------------------------------------------------


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"invalid JSON in {path}: {e}")


def json_dumps(data: Any) -> str:
    """Canonical JSON serialization for every sidecar we write — 2-space
    indent, non-ASCII preserved, trailing newline. Single source of truth so
    every writer (atomic or not) produces byte-identical output."""
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


# ---------------------------------------------------------------------------
# Atomic multi-file transaction
#
# The writeback contract (EDITOR_SKILLS_V1 §12) needs "write these N files,
# all-or-nothing": a footnote write must land footnotes.json AND the .tex AND
# ai-requests.json AND notifications.json AND version.txt together, or none.
#
# Generalizes the single-file os.replace writer that shipped in
# rename_citekey.py. POSIX gives us atomic *rename* per file, not atomic rename
# across files, so true serializable isolation against a concurrent reader is
# not achievable with plain os.replace. What we guarantee is **all-or-nothing
# on failure**: every destination is snapshotted before the commit phase, and
# any error (staging or mid-swap) rolls every already-swapped file back to its
# snapshot. A crash strictly between two os.replace calls is the only residual
# window; the sidecars' idempotent re-run (duplicate-id rejection, no-op on
# already-complete requests) covers that tail.
# ---------------------------------------------------------------------------

# Test-only fault injection. When set to an int K, atomic_write raises after
# committing K files so the atomicity guarantee can be exercised end-to-end
# (the rollback must then restore the K committed files). Never set in prod.
_FAULT_ENV = "VIRGIL_TEST_FAIL_AFTER_WRITES"


def _read_prior(path: Path) -> str | None:
    """Snapshot a destination's current bytes, or None if it doesn't exist."""
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None


def atomic_write(
    writes: list[tuple[Path, str | None]], *, fault_injectable: bool = True
) -> None:
    """Write (or delete) N files all-or-nothing.

    `writes` is a list of `(path, content)`:
      - content is a `str`  → that file is created/overwritten.
      - content is `None`   → that file is deleted if present.

    Stages every content-write to a same-directory `.tmp` sibling first, then
    commits (os.replace / a tolerant delete) tracking what landed; on any
    failure it restores every committed file from its pre-commit snapshot and
    re-raises.

    Every DELETE here — the `content is None` arm, the rollback's undo of a
    file that had no prior, and both `.tmp` cleanups — goes through
    `unlink_tolerant`, so a mount that refuses deletion cannot convert a
    landed write-set into a raise (task 496). A refused delete leaves a stale
    file behind and warns on stderr; it never rolls the commit back.

    `fault_injectable` gates the test-only fault hook. Pen/infra writes pass
    `False` so the atomicity test can target a subcommand's main write-set
    without tripping the pen dance that wraps it.
    """
    norm = [(Path(p), c) for p, c in writes]
    priors: dict[Path, str | None] = {p: _read_prior(p) for p, _ in norm}

    fault_raw = os.environ.get(_FAULT_ENV) if fault_injectable else None
    fail_after = int(fault_raw) if fault_raw not in (None, "") else None

    # 1. Stage all content-writes to temp siblings (same dir → atomic rename).
    temps: dict[Path, Path] = {}
    try:
        for p, content in norm:
            if content is None:
                continue
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_text(content, encoding="utf-8")
            temps[p] = tmp
    except Exception:
        for tmp in temps.values():
            unlink_tolerant(tmp, what="staged temp")
        raise

    # 2. Commit: swap temps in / delete removals, tracking each for rollback.
    committed: list[Path] = []
    try:
        for p, content in norm:
            if content is None:
                # A refused delete is NOT a failed commit: this arm is only
                # ever cleanup (task 496), so it warns and moves on rather
                # than dropping into the rollback below.
                unlink_tolerant(p)
            else:
                os.replace(temps[p], p)
            committed.append(p)
            if fail_after is not None and len(committed) >= fail_after:
                raise RuntimeError(
                    f"{_FAULT_ENV}={fail_after}: injected mid-commit failure "
                    f"after {len(committed)} file(s)"
                )
    except Exception:
        # Roll back every file we already touched, newest first.
        for p in reversed(committed):
            prior = priors.get(p)
            try:
                if prior is None:
                    unlink_tolerant(p, what="rolled-back file")
                else:
                    p.write_text(prior, encoding="utf-8")
            except OSError:
                pass
        for tmp in temps.values():
            unlink_tolerant(tmp, what="staged temp")
        raise


def write_json(path: Path, data: Any) -> None:
    """Single-file atomic JSON write (temp + os.replace). Used by standalone
    callers; the multi-file contract paths build a write-set and call
    `atomic_write` directly."""
    atomic_write([(path, json_dumps(data))])


# ---------------------------------------------------------------------------
# Card → paragraph helpers (mirrors src/links/links.ts).
# ---------------------------------------------------------------------------


def card_paragraph_ids(card: dict) -> list[str]:
    """Pull the TextObject UUID(s) a card's anchor links cover. Mirrors
    `getLinkedTextObjectIds()` in src/links/links.ts.

    The canonical on-disk anchor shape (SSOT: src/links/_shared/types.ts
    `LinkAnchor`, docs/workspace/anchoring.md) is
    `{ type: "textObject", textObjectIds: [...] }` — a card's paragraph UUIDs
    live in `textObjectIds` on a `type == "textObject"` anchor (Mode A *and*
    Mode B; for Mode B `textObjectIds` still names the containing block(s)).

    A legacy `{ type: "anchor", paragraphIds: [...] }` shape is *tolerated* — a
    handful of old sidecars / pre-v1 skill-doc examples used it — so both
    round-trip, matching `apply_response._suggestion_anchor_uuid`'s tolerance.
    (chip 14: this read ONLY the legacy shape, so it returned `[]` for every
    real card on disk, silently breaking cards_for_paragraph.py and the virtual
    request `paragraphIds` in list_requests.py.)"""
    out: list[str] = []
    for link in card.get("links", []) or []:
        anchor = link.get("anchor") or {}
        if anchor.get("type") not in ("textObject", "anchor"):
            continue
        for pid in anchor.get("textObjectIds") or anchor.get("paragraphIds") or []:
            if pid not in out:
                out.append(pid)
    return out


def card_text_anchor(card: dict) -> str | None:
    """Mode B text snapshot if any."""
    for link in card.get("links", []) or []:
        anchor = link.get("anchor") or {}
        tr = anchor.get("textRange")
        if isinstance(tr, dict) and tr.get("textSnapshot"):
            return tr["textSnapshot"]
    return None


# ---------------------------------------------------------------------------
# Notification + version writers
# ---------------------------------------------------------------------------


# Each writer comes in two forms: a `*_planned`/`*_appended` form that READS
# current state and RETURNS the (path, new-content) pair without touching disk
# — so the contract paths can fold it into a single atomic_write — and a
# standalone form that commits it on its own (atomically) for other callers.


def notification_appended(doc: Path, item: dict) -> tuple[Path, str]:
    """Compute the next notifications.json content with `item` appended (cap
    200). Returns `(path, serialized)`; does not write."""
    path = sidecar(doc, "notifications.json")
    inbox = read_json(path, default={"items": []}) or {"items": []}
    items = inbox.get("items", []) if isinstance(inbox, dict) else []
    items = list(items) + [item]
    if len(items) > 200:
        items = items[-200:]
    return path, json_dumps({"items": items})


def append_notification(doc: Path, item: dict) -> None:
    path, content = notification_appended(doc, item)
    atomic_write([(path, content)])


def read_version(doc: Path) -> int:
    path = sidecar(doc, "version.txt")
    if path.exists():
        try:
            return int(path.read_text(encoding="utf-8").strip() or "0")
        except ValueError:
            return 0
    return 0


def version_bumped(doc: Path) -> tuple[Path, str, int]:
    """Compute the next version.txt content (current + 1). Returns
    `(path, serialized, new_int)`; does not write."""
    path = sidecar(doc, "version.txt")
    n = read_version(doc) + 1
    return path, str(n) + "\n", n


def bump_version(doc: Path) -> int:
    path, content, n = version_bumped(doc)
    atomic_write([(path, content)])
    return n


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


def die(msg: str, code: int = 2) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


# ---------------------------------------------------------------------------
# ISO timestamp
# ---------------------------------------------------------------------------


def now_iso() -> str:
    from datetime import datetime, timezone

    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


# ---------------------------------------------------------------------------
# DEV mode — the dev-dream capture-layer toggle (EDITOR_SKILLS_V1 §14)
#
# DEV mode is a per-session *developer* affordance: when on, every editor-skill
# invocation is followed by a reflection that writes a tiered memo (the "day"
# half of the dev-dream self-improvement loop — see editor/dev/README.md). The
# toggle is the `VIRGIL_DEV` env var, deliberately NOT a sidecar flag: it has no
# UI surface and no on-disk presence, so it is truly per-session and **cannot
# ship to an end user**. An end-user folder may carry the (inert) reflect skill,
# but the gate stays off, so no memo is ever written outside a dev session.
#
# This is the single source of truth for "is the capture layer live" — both
# reflect.py's gate and the /editor/review enforcement read it. Keep the read
# here so no caller re-implements the truthiness rule.
# ---------------------------------------------------------------------------

DEV_MODE_ENV = "VIRGIL_DEV"
_DEV_TRUE_TOKENS = {"1", "true", "yes", "on"}
DEV_MODE_MARKER = "dev-mode"  # file under dev_home(); its EXISTENCE means on


def dev_mode_enabled() -> bool:
    """True iff `VIRGIL_DEV` is set truthy, or — with the env entirely unset —
    the checkout carries the `<dev_home()>/dev-mode` marker file
    (`<primary checkout>/editor/dev/dev-mode`, gitignored).

    Two rungs, in order:
    1. An EXPLICIT env value always wins, both ways: a truthy token
       ({1, true, yes, on}, case-insensitive) is ON; anything else set
       (`0`, `false`, empty, garbage) is OFF — which is how a test simulates
       a non-dev machine on a dev machine.
    2. Env unset → the marker file decides. The marker exists so dev mode is
       a fact about the CHECKOUT, not about which shells sourced which rc file:
       a session type that doesn't inherit `~/.zshenv` (2026-08-16: a cowork
       session refused a "dream memo" over exactly this doubt) still gates
       correctly, because every process resolves the same primary checkout
       (task 431 moved the home under the repo; `VIRGIL_REPO_ROOT` at user
       scope is what reaches a paper-folder cwd). An unresolvable home reads
       as OFF — no checkout, no dev loop.

    OFF stays the safe default for end users: their machines have no Virgil
    source checkout at all, so nothing ships capture to them."""
    raw = os.environ.get(DEV_MODE_ENV)
    if raw is not None:
        return raw.strip().lower() in _DEV_TRUE_TOKENS
    home = dev_home_or_none()
    if home is None:
        return False  # no resolvable home → no marker → not a dev checkout
    try:
        return (home / DEV_MODE_MARKER).is_file()
    except OSError:
        return False


# ---------------------------------------------------------------------------
# Dev-loop sink — the one home for dev-dream artifacts, under the PRIMARY repo
#
# The capture layer (reflect.py), the dream (dream.py), and iterate
# (dev_loop.py) must ALL resolve the memo / digest / iteration roots
# identically, from ANY cwd — a repo checkout, a git worktree, or a *synced
# paper folder* (where the scripts run from `<paper>/.virgil/scripts/editor/`
# and a `__file__`-relative REPO_ROOT would land *inside* the paper's
# `.virgil/`). That is the one hard invariant: the writer (reflect) and the
# reader (dream) must agree, since a silent divergence makes the dream read an
# empty dir with no error.
#
# History, because the home has moved TWICE and each move was about that
# invariant. It began REPO-relative (`editor/dev/memos`), diverged for a
# paper-folder writer, and moved to a machine-global `~/.virgil-dev` (2026-08).
# Then the dev-machine move (28fc58fd) carried every tracked file and left the
# untracked `~/.virgil-dev` behind: the loop's entire memory — every memo, every
# digest, the high-water marker — started at zero, and the dream read that as
# a quiet night (task 431). So the home is now `<primary checkout>/editor/dev`
# (gitignored, so it moves with the clone and never with the account), and the
# two lessons are kept at once. (The MEMO stream has since moved on again, to
# the synced `Virgil-Inbox/dev-loop/memos` — see the next section. What this
# section resolves is still the base for the digests, the iterations and the
# dev-mode marker, and is still the LAST rung of the memo ladder.)
#
#   * "primary checkout" is RESOLVED, never inferred from `__file__`: the
#     `VIRGIL_REPO_ROOT` pin first (set at user scope it reaches a paper-folder
#     cwd — see editor/dev/README.md), else the git COMMON dir of the tree this
#     file lives in, which is the primary even from a worktree. A worktree's own
#     `editor/dev/` is a different, always-empty directory whose tracked
#     `.gitkeep` would make it LOOK present — reading it is exactly the silent
#     divergence above, which is why the git common dir is load-bearing.
#   * where the primary cannot be resolved there is NO fallback home. A second
#     default is a second place memos can land unread; the honest answer is a
#     `DevHomeUnresolved` the gate reads as "dev mode off" and every writer
#     reports as a loud refusal naming the two env vars that fix it.
#
# Each root still honors its explicit env override first (the test seam + the
# user pin): `VIRGIL_DEV_HOME` for the base, per-stream `VIRGIL_DEV_*_DIR`.
# ---------------------------------------------------------------------------

DEV_HOME_ENV = "VIRGIL_DEV_HOME"
DEV_HOME_SUBDIR = "editor/dev"  # under the PRIMARY checkout; gitignored bar .gitkeeps
SOURCE_REPO_ENV = "VIRGIL_REPO_ROOT"


class DevHomeUnresolved(RuntimeError):
    """No dev home: `VIRGIL_DEV_HOME` is unset, `VIRGIL_REPO_ROOT` is unset or
    wrong, and this file does not live inside a Virgil source checkout. Raised
    rather than defaulted — see the header above."""


def _dir_override(env_name: str) -> Path | None:
    """Resolve a dev-dir env override to an ABSOLUTE, cwd-INDEPENDENT path, or
    None if unset. A relative value is anchored to `$HOME`, never to `cwd` — the
    writer (paper-folder cwd) and reader (repo cwd) must resolve the SAME dir, so
    `Path.resolve()` alone (which anchors a relative path to cwd) would silently
    diverge them. Absolute values pass through `.resolve()` unchanged."""
    env = os.environ.get(env_name, "").strip()
    if not env:
        return None
    p = Path(env).expanduser()
    return (p if p.is_absolute() else Path.home() / p).resolve()


_PRIMARY_CACHE: dict[Path, Path] = {}


def _primary_checkout(root: Path) -> Path:
    """The PRIMARY working tree of the repo `root` belongs to — `root` itself
    for an ordinary clone, the main checkout for a git worktree (whose
    `--git-common-dir` is `<primary>/.git`). Falls back to `root` when git is
    unavailable or the dir is not a repo (a synced copy pinned by env), so the
    pinned path still wins. Cached per root: the answer cannot change within a
    process and a subprocess per `dev_home()` call would be a real cost."""
    root = root.resolve()
    hit = _PRIMARY_CACHE.get(root)
    if hit is not None:
        return hit
    primary = root
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--git-common-dir"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0 and r.stdout.strip():
            common = Path(r.stdout.strip())
            if not common.is_absolute():
                common = root / common
            common = common.resolve()
            if common.name == ".git" and (common.parent / "editor" / "skills").is_dir():
                primary = common.parent
    except Exception:
        pass
    _PRIMARY_CACHE[root] = primary
    return primary


def dev_home() -> Path:
    """The root for dev-dream artifacts (memos / digests / iterations):
    `VIRGIL_DEV_HOME` if set; else `<primary checkout>/editor/dev`, where the
    primary checkout is `VIRGIL_REPO_ROOT` or the git common dir of the tree
    this file lives in (so a worktree resolves the MAIN checkout's sink, not
    its own empty twin). Always absolute and cwd-independent. Raises
    `DevHomeUnresolved` when none of those resolve — there is deliberately no
    second default (header above)."""
    pinned = _dir_override(DEV_HOME_ENV)
    if pinned is not None:
        return pinned
    repo = source_repo_root()
    if repo is None:
        raise DevHomeUnresolved(
            "virgil dev home unresolved: no synced Virgil-Inbox was found and this "
            "script is not running inside a Virgil checkout, so there is nowhere to "
            "put dev-loop artifacts. Fix ONE of: create ~/Dropbox/Virgil-Inbox (or "
            "set VIRGIL_INBOX) so the shared mailbox resolves — the remedy on a "
            "machine with no checkout; set VIRGIL_REPO_ROOT to the Virgil source "
            "checkout; or set VIRGIL_DEV_HOME to an explicit sink"
        )
    return _primary_checkout(repo) / DEV_HOME_SUBDIR


def dev_home_or_none() -> Path | None:
    """`dev_home()` for callers that want "unresolved" as a value (the gate,
    the throwaway guard) rather than an exception."""
    try:
        return dev_home()
    except DevHomeUnresolved:
        return None


# ---------------------------------------------------------------------------
# The SYNCED dev-loop home — one mailbox, every machine (task 521)
#
# All Virgil cowork now happens on a DIFFERENT computer from the one running
# the scheduled loops (dream, worker, heartbeat, deploy). `dev_home()` above is
# resolved from the PRIMARY CHECKOUT, and a laptop with no checkout resolves
# nothing at all — so a reflection memo written from cowork there is not merely
# invisible to the dream, it is never written. The famine the dream has
# reported every night since 2026-08-26 stops being an accident and becomes
# STRUCTURAL: the writer and the reader are on different disks.
#
# A checkout-relative home cannot answer that, and neither can a HOME-relative
# one (the `~/.virgil-dev` the 431 move retired for exactly that reason: it
# travels with neither the clone nor the account). What CAN is the transport
# that already crosses these two machines and already carries Virgil traffic —
# the Dropbox-synced `Virgil-Inbox/` the bug-report button writes into and the
# heartbeat drains. Its `dev-loop/` subtree is this loop's synced home:
#
#   dev-loop/memos/    written from ANY machine, read here by the dream
#   dev-loop/reports/  a COURTESY COPY of each nightly digest, readable there
#
# Three rules the shape rests on, all from the sync doctrine (AGENTS.md → "The
# daemon half"), and the first is stated precisely because the tidy version of
# it is false here:
#
#   * NO FILE HAS TWO WRITERS. A memo is not write-once — the reflection
#     convention enriches the mechanical floor in place and tallies `runs: N`
#     (`reflect._find_existing`) — but its identity is `(skill, taskId)` or
#     `(skill, doc, day)`, so the only machine that ever writes it is the one
#     that ran that skill. Two writers never meet on one file, which is the
#     property that matters; write-once is merely the usual way of getting it.
#   * the DIGEST does have a second reader-and-rewriter — `<date>.md` ROTATES
#     in place on a same-day re-run and is the marker store — so it stays in
#     the LOCAL `dev_home()`, and what crosses is an immutable timestamped
#     copy under `reports/`.
#   * a conflicted copy is READ-SIDE debris, never content — `_scan_sink`
#     skips it rather than counting a daemon's rename as a second memo. That
#     is the net under rule one rather than a substitute for it: a daemon can
#     still rename a file aside mid-sync with only one writer involved.
#
# The ladder is PINS FIRST, then the synced home, then the computed local one,
# and it FAILS OPEN at every rung: an explicit `VIRGIL_DEV_MEMOS_DIR` /
# `VIRGIL_DEV_HOME` is a caller saying where these go and outranks discovery;
# no synced home found is a SAID thing (see `memo_sink_kind`, which the dream
# publishes and banners) and never a silent local fallback.
# ---------------------------------------------------------------------------

INBOX_ENV = "VIRGIL_INBOX"
INBOX_DIRNAME = "Virgil-Inbox"
DEV_LOOP_SUBDIR = "dev-loop"

# Where the synced inbox is looked for, in order. `~/Dropbox` and the macOS
# `CloudStorage` path are the same folder on a stock install (the first is a
# symlink to the second) — both are listed because which one EXISTS differs by
# machine and by Dropbox version, and `.resolve()` collapses them so a machine
# carrying both never yields two sinks. `~/Virgil-Inbox` is last because it is
# the hand-made symlink `virgil-tasks/REMOTE_INBOX.md` names: a machine whose
# Dropbox lives somewhere unusual is reachable through it without an env pin.
_SYNCED_INBOX_CANDIDATES = (
    Path("Dropbox") / INBOX_DIRNAME,
    Path("Library") / "CloudStorage" / "Dropbox" / INBOX_DIRNAME,
    Path(INBOX_DIRNAME),
)


def synced_inbox_root() -> Path | None:
    """The Dropbox-synced `Virgil-Inbox/`, or None on a machine that has none.

    `VIRGIL_INBOX` pins it (the laptop's escape hatch when its Dropbox lives
    elsewhere, and the test seam) and is honored WHETHER OR NOT it exists — a
    pin is a caller statement, and the dir is created on first write, exactly
    as `_dir_override` is treated everywhere else. Discovery, by contrast,
    requires the directory to EXIST: an inbox nobody has ever synced is not a
    transport, and inventing one would put memos in a folder no daemon
    watches. Never raises."""
    pinned = _dir_override(INBOX_ENV)
    if pinned is not None:
        return pinned
    # A caller who has redirected ANY of the loop's sinks is running a
    # sandboxed loop, and DISCOVERY may not reach past the sandbox into the
    # human's real synced folder. This is the same rule `extra_memos_roots`
    # states on the READ side — "a caller who has said where the memos go has
    # said where all of them are" — and it belongs at this door because the
    # WRITE side needs it just as much: `_publish_report` resolves through here,
    # and without this every dev-loop suite's `dream.py digest` run dropped a
    # junk copy into the real Dropbox inbox (measured 2026-09-01: 87 files in
    # twenty minutes, from suites that had correctly pinned every sink they
    # knew about). An explicit `VIRGIL_INBOX` is never suppressed — that IS the
    # caller naming this one.
    if any(_dir_override(k) is not None for k in
           (DEV_HOME_ENV, "VIRGIL_DEV_MEMOS_DIR", "VIRGIL_DREAM_DIGESTS_DIR")):
        return None
    for rel in _SYNCED_INBOX_CANDIDATES:
        cand = Path.home() / rel
        try:
            if cand.is_dir():
                return cand.resolve()
        except OSError:
            continue
    return None


def dev_loop_root() -> Path | None:
    """`<synced inbox>/dev-loop` — the loop's synced home, or None."""
    inbox = synced_inbox_root()
    return None if inbox is None else inbox / DEV_LOOP_SUBDIR


def synced_memos_root() -> Path | None:
    """`<synced inbox>/dev-loop/memos` — the cross-machine memo sink, or None."""
    root = dev_loop_root()
    return None if root is None else root / "memos"


def synced_reports_root() -> Path | None:
    """`<synced inbox>/dev-loop/reports` — where the dream drops a read-only
    copy of each nightly digest so it can be read from another machine. A
    COURTESY channel only: nothing that needs attention may live only here (the
    task pipeline is the one attention surface). None on a machine with no
    synced inbox."""
    root = dev_loop_root()
    return None if root is None else root / "reports"


# The rungs `memo_sink_kind` reports, in ladder order.
SINK_PINNED = "pinned"    # VIRGIL_DEV_MEMOS_DIR / VIRGIL_DEV_HOME — caller said so
SINK_SYNCED = "synced"    # the cross-machine Virgil-Inbox/dev-loop/memos
SINK_LOCAL = "local"      # the computed <primary checkout>/editor/dev/memos


def _default_memos_root() -> Path:
    """The memo sink the ladder resolves IGNORING `VIRGIL_DEV_MEMOS_DIR`.

    Split out from `memos_root` because two callers need the ladder's answer
    without the pin: `_is_throwaway_paper`, whose whole rule is "a pin AT the
    default expresses no intent" (and which therefore has to know what the
    default is), and `memo_sink_kind`. Raises `DevHomeUnresolved` only when
    there is no synced home AND no resolvable checkout."""
    pinned_home = _dir_override(DEV_HOME_ENV)
    if pinned_home is not None:
        return pinned_home / "memos"
    synced = synced_memos_root()
    if synced is not None:
        return synced
    return dev_home() / "memos"


def memos_root() -> Path:
    """Where reflect writes and the dream reads the capture memos.

    Ladder: `VIRGIL_DEV_MEMOS_DIR` → `VIRGIL_DEV_HOME/memos` → the SYNCED
    `Virgil-Inbox/dev-loop/memos` → `dev_home()/memos` (the primary checkout).
    Raises `DevHomeUnresolved` only at the last rung — a machine with a synced
    inbox needs no checkout at all, which is the whole point (task 521)."""
    return _dir_override("VIRGIL_DEV_MEMOS_DIR") or _default_memos_root()


def memo_sink_kind() -> str:
    """Which rung of the memo ladder answered: `pinned` / `synced` / `local`.

    The honesty half of the ladder. `memos_root()` alone cannot say whether a
    memo written on another machine could ever arrive — a local answer and a
    synced one are the same `Path` type — so "no synced sink found" would be a
    silent fallback rather than a said thing. The dream publishes this and
    banners `local`, the same treatment `memoSinkPresent` and `driftChecked`
    get one field over. `local` on the machine that HOLDS the checkout is
    merely narrow; on a cowork laptop it is the structural famine."""
    if _dir_override("VIRGIL_DEV_MEMOS_DIR") is not None:
        return SINK_PINNED
    if _dir_override(DEV_HOME_ENV) is not None:
        return SINK_PINNED
    return SINK_SYNCED if synced_memos_root() is not None else SINK_LOCAL


# Only the two UNAMBIGUOUS grammars are matched. iCloud's bare " 2" suffix is
# deliberately NOT one: `reflect.py` mints exactly that shape itself (`-2.md`)
# to disambiguate two memos written in the same second, so matching it would
# discard real memos to avoid debris — the wrong trade in both directions.
_SYNC_CONFLICT_RE = re.compile(r"conflicted copy|\.sync-conflict-", re.IGNORECASE)


def is_sync_conflict_name(name: str) -> bool:
    """Is this path COMPONENT a sync daemon's conflicted copy rather than
    content?

    Callers pass the memo's path RELATIVE to its sink and every component is
    tested, not just the basename: the sink is `<day>/<time>-<skill>.md`, so a
    daemon can rename the DAY folder exactly as easily as the file — and a
    basename-only test then reads every memo under
    `2026-08-30 (conflicted copy …)/` as new content, which is the double-count
    this predicate exists to prevent, one level up.

    A daemon that meets a file it cannot reconcile RENAMES one side aside. In
    the synced memo sink that is read-side DEBRIS at both ends and must be
    skipped by BOTH — the dream's corpus scan (where counting it inflates
    `nonDreamLifetimeCount`, the very number the union exists to make honest,
    and re-reports a memo the corpus already holds) and `reflect._find_existing`
    (where PICKING one as the memo to enrich lands the update in the orphaned
    copy and leaves the real memo un-updated). One predicate, both readers: two
    spellings of this rule is how the writer and the reader come to disagree
    about which files are memos, which is the class this whole subsystem is
    about."""
    return any(_SYNC_CONFLICT_RE.search(part) for part in Path(name).parts)


RETIRED_DEV_HOMES: tuple[tuple[str, str], ...] = (
    # ("retired on", $HOME-relative base) — every base `dev_home()` has ever
    # resolved to and no longer does. READ-SIDE ONLY; nothing may WRITE to one.
    # Stored RELATIVE and joined at call time, never `Path.home()` at import:
    # a home frozen at module load is the same class of cwd/env-independence
    # bug `_dir_override` exists to prevent, and it makes the sink untestable.
    ("2026-08-23", ".virgil-dev"),  # the machine-global home (task 431)
)


def _known_sinks() -> list[Path]:
    """Every memo sink this build can name — the ladder's current answer plus
    every superseded one. Read by `_is_throwaway_paper` (a pin AT one of these
    expresses no caller intent) and by `extra_memos_roots` (all but the first
    are READ-only). Never raises."""
    out: list[Path] = []
    try:
        out.append(_default_memos_root())
    except DevHomeUnresolved:
        pass
    local = dev_home_or_none()
    if local is not None:
        out.append(local / "memos")
    out.extend(Path.home() / rel / "memos" for _at, rel in RETIRED_DEV_HOMES)
    return out


def extra_memos_roots() -> list[tuple[str, Path]]:
    """Memo sinks this build no longer WRITES to but must still READ.

    `memos_root()` is resolved independently by the READER (the dream, running
    from the source checkout at HEAD) and by every WRITER (`reflect.py`,
    running from whatever vintage of the skill bundle a paper folder happens to
    carry — bundles re-sync on doc-open, so a paper the human has not opened
    since a migration keeps writing with the OLD resolution, indefinitely).
    There is no handshake between the two, so every sink migration SPLITS the
    corpus silently: the reader's sink stays empty while real memos land in the
    superseded one, and `nonDreamLifetimeCount: 0` then means "somebody wrote
    where I no longer read" while reading exactly like "nobody has ever
    written."

    That is a fact about the SEAM rather than about the reader's own state —
    the one question none of `driftChecked` / `memoSinkPresent` / the empty
    `marker` / `everCapturedNonDream` / `nightsSinceLastDigest` can ask, and
    the one that can make every one of them report healthily over a corpus
    arriving somewhere else. Measured 2026-09-01, thirteen days after the 08-23
    migration: five of eight bootstrapped paper folders (the most-worked-on
    among them) still resolved `~/.virgil-dev/memos`.

    The fix has to sit on the READ side, and that is a property of the problem
    rather than a preference: the divergent writers are historical code in
    folders the loop does not control, so nothing done to `reflect.py` today
    reaches them. Migrating the writers forward (a re-sync) helps the papers it
    reaches and cannot be relied on for the rest; reading EVERY sink is
    complete over every writer, past and future, and costs one entry per
    migration. Task 521's move to the synced home is the second such migration
    and inherits the same treatment by construction — the LOCAL home joins this
    list the moment the synced one is in use.

    An explicit PIN (`VIRGIL_DEV_MEMOS_DIR` / `VIRGIL_DEV_HOME`) suppresses
    this entirely, and that is the same rule `_is_throwaway_paper` states in
    the WRITE direction: a caller who has said where the memos go has said
    where ALL of them are. It is load-bearing rather than tidy — every dev-loop
    suite pins a temp sink, so without it the union folds the human's real,
    durable corpus into every test run.

    Returns `(label, dir)` for each sink that EXISTS and is not the one in use,
    so on a fresh machine this is empty and the union is a no-op. Never
    raises: an unresolvable dev home is the gate's problem, not this
    function's."""
    if (_dir_override("VIRGIL_DEV_MEMOS_DIR") is not None
            or _dir_override(DEV_HOME_ENV) is not None):
        return []
    try:
        current = memos_root().resolve()
    except (DevHomeUnresolved, OSError):
        current = None

    candidates: list[tuple[str, Path]] = []
    local = dev_home_or_none()
    if local is not None:
        candidates.append((SINK_LOCAL, local / "memos"))
    candidates.extend((retired_at, Path.home() / rel / "memos")
                      for retired_at, rel in RETIRED_DEV_HOMES)

    out: list[tuple[str, Path]] = []
    seen: set[Path] = set()
    for label, root in candidates:
        try:
            if not root.is_dir():
                continue
            real = root.resolve()
        except OSError:
            continue
        if current is not None and real == current:
            continue
        if real in seen:
            continue
        seen.add(real)
        out.append((label, root))
    return out


def digests_root() -> Path:
    """Where the dream writes its morning digests and reads the since-last-dream
    marker. `VIRGIL_DREAM_DIGESTS_DIR` overrides; else `dev_home()/dream-digests`."""
    return _dir_override("VIRGIL_DREAM_DIGESTS_DIR") or dev_home() / "dream-digests"


def iterations_root() -> Path:
    """Where iterate-virgil-editor writes its synthesized-stress-test memos.
    `VIRGIL_DEV_ITERATIONS_DIR` overrides; else `dev_home()/iterations`."""
    return _dir_override("VIRGIL_DEV_ITERATIONS_DIR") or dev_home() / "iterations"


def source_repo_root() -> Path | None:
    """Best-effort location of the Virgil SOURCE repo — for the reflect / dream
    `git rev-parse HEAD:editor/skills/<skill>.md` sha lookups, which must hit the
    real source tree, NOT a paper's `.virgil/` (where a `__file__`-relative
    REPO_ROOT lands from a synced copy). Resolution: `VIRGIL_REPO_ROOT` env →
    walk up from this file for a dir containing `editor/skills` → None (the
    caller records 'unknown'). Never raises."""
    env = os.environ.get(SOURCE_REPO_ENV, "").strip()
    if env:
        p = Path(env).expanduser().resolve()
        if (p / "editor" / "skills").is_dir():
            return p
    for parent in Path(__file__).resolve().parents:
        if (parent / "editor" / "skills").is_dir():
            return parent
    return None


def _is_throwaway_paper(doc: Path) -> bool:
    """True for a reflection about a paper that lives in the system temp dir
    while the memo sink is the machine-global DEFAULT — i.e. a test sandbox
    about to write into the human's real dev-loop stream.

    This is the chokepoint fix for the dominant source of dev-loop noise, found
    on the night of 2026-08-09 and diagnosable in one grep only because the
    memo now records which paper it is about. The editor test suite runs under
    `VIRGIL_DEV=1`; the tests that drive `reflect.py` DIRECTLY pin the
    `VIRGIL_DEV_MEMOS_DIR` seam, but the ones that drive `apply_response` reach
    reflect through THIS function, which spawns a subprocess inheriting the
    ambient environment — so the seam they never set resolves to
    `~/.virgil-dev/memos` and every sandboxed card op files a memo about a
    `/private/var/folders/.../chip12-xxxx/paper` that ceased to exist seconds
    later. One suite run adds ~280 of them. The 32-minute, 435-memo burst this
    night's dream had to read was, on the evidence of its skill mix and its
    68-per-minute rate, exactly that.

    Fixing it test-side would mean pinning the seam in sixteen files and
    trusting the seventeenth to remember — which is the shape that produced the
    bug. So the guard lives at the ONE place every tail-trigger passes through,
    is derived from `tempfile.gettempdir()` rather than a naming convention,
    and is scoped so it can only ever suppress the accidental case: a sink
    pinned AWAY from the default always writes (that is a caller who has said
    where the memos go, including every test that pins a temp sink on purpose),
    a pin at the default sink expresses no intent and leaves the guard armed
    (an ambient `~/.zshenv` export at the default disarmed it machine-wide for
    ten weeks), and a real paper is never under `$TMPDIR`."""
    override = _dir_override("VIRGIL_DEV_MEMOS_DIR")
    if override is not None:
        # A pin only counts as caller intent when it points AWAY from the
        # default sink. A pin whose value equals the computed default expresses
        # no intent — it is an ambient convenience export — and honoring it
        # disarmed this guard machine-wide for every test run (2026-08-14: 30
        # synthetic memos per suite run into the human's real stream).
        # A pin counts as intent only when it points away from EVERY sink this
        # build knows about — the ladder's current answer AND every superseded
        # one. Reading only `dev_home()/memos` would make a pin at the synced
        # default look like intent; reading only the ladder's answer would make
        # a pin at the OLD default look like intent, which re-opens the same
        # ten-week machine-wide disarm one migration later. The set is derived
        # (`_known_sinks`), so a future migration inherits it.
        try:
            known = {p.resolve() for p in _known_sinks()}
        except OSError:
            known = set()
        if not known or override.resolve() not in known:
            return False  # pinned away from the default — the caller has said where these go
    try:
        return Path(tempfile.gettempdir()).resolve() in doc.resolve().parents
    except OSError:
        return False


def spawn_reflection(doc: Path, skill: str, task_id: str = "-", *, timeout: int = 20) -> None:
    """Best-effort DEV-mode capture: fire `/editor/reflect` for a just-completed
    skill so a memo lands for EVERY writeback — the mechanical "day" floor that
    makes paper-cowork sessions accumulate dev-dream memos without relying on the
    agent to remember. No-op unless `VIRGIL_DEV` is on; never raises (all errors
    swallowed). It runs `reflect.py` **synchronously but time-bounded** (blocks
    the caller up to `timeout` s). It fires from a commit finalizer AFTER
    `commit_under_pen` (the write is durable) but BEFORE the caller prints its
    result JSON — so it can never perturb the committed contract result; it only
    adds a bounded tail latency before the caller sees stdout, in a DEV session.
    `reflect.py` is a sibling of this module, so it resolves from a synced paper
    folder too — sidestepping the skills' markdown script-paths. The four
    qualitative buckets are enriched later via the reflection convention (which
    task-less floors can now actually receive — see `reflect._find_existing`);
    this writes the correctly-classified frontmatter floor."""
    if not dev_mode_enabled():
        return
    if _is_throwaway_paper(doc):
        return
    # The sink must resolve BEFORE the subprocess, whose stderr is captured and
    # dropped: an unresolved home would otherwise be the silent loss the home
    # relocation (task 431) exists to end. One line on OUR stderr, never stdout
    # (the caller's result JSON lives there).
    try:
        memos_root()
    except DevHomeUnresolved as e:
        print(f"reflect: no memo written — {e}", file=sys.stderr)
        return
    try:
        script = Path(__file__).resolve().parent / "reflect.py"
        subprocess.run(
            [sys.executable, str(script), str(doc), skill, task_id],
            capture_output=True, text=True, timeout=timeout,
            cwd=str(script.parent),
        )
    except Exception:
        pass


# ---------------------------------------------------------------------------
# The editing pen (EDITOR_SKILLS_V1 §9)
#
# Before Claude writes any files, it briefly takes the editing pen so the user
# can't be typing simultaneously and lose work. Fully scripted here — no LLM in
# the loop, no token cost. The pen wraps the atomic write: acquire → commit →
# release. Two on-disk surfaces:
#
#   .virgil/pen-context.json   the lock record (always written/deleted). Lives
#                              in the hidden working dir; the browser doesn't
#                              render it. Carries the TTL for crash recovery.
#   virgil/collab.json         the browser-facing turn-taking state. Its `pen`
#                              object is what useCollab.ts / collab.ts read to
#                              show the "locked" UI. We only touch this file if
#                              it already exists, so a paper that never opted
#                              into collab gets no fabricated collab.json.
#
# Schema reconciliation (src/lib/collab.ts): collab.json is a `CollabSidecar`
#   { enabled: bool, participants[], pen: CollabPenState, presence: {} }
# and pen is
#   { holder: str|null, since: str|null, lastHeartbeat: str|null,
#     lastActivity: str|null, requestedBy: {name, requestedAt}[] }
# We write exactly that shape so the browser shows its existing locked UI
# rather than breaking.
# ---------------------------------------------------------------------------

PEN_TTL_SECONDS = 30
# Internal holder id stamped into .virgil/pen-context.json (spec §9, verbatim).
PEN_CONTEXT_HOLDER = "claude"
# Display name stamped into collab.json `pen.holder`. Matches the AI
# participant entry ("Claude") so the browser resolves the partner color /
# identity for the locked-UI chrome; the spec's lowercase "claude" would miss
# the participant lookup. (Surfaced divergence — see VIRGIL.md Cowork.)
COLLAB_PEN_HOLDER = "Claude"

FREE_PEN: dict = {
    "holder": None,
    "since": None,
    "lastHeartbeat": None,
    "lastActivity": None,
    "requestedBy": [],
}


def dot_virgil_dir(doc: Path) -> Path:
    """The hidden working dir (pen-context, memos, queue) — sibling of virgil/."""
    return doc / ".virgil"


def pen_context_path(doc: Path) -> Path:
    return dot_virgil_dir(doc) / "pen-context.json"


def collab_path(doc: Path) -> Path:
    return sidecar(doc, "collab.json")


def _iso_at(offset_seconds: int = 0) -> str:
    from datetime import datetime, timedelta, timezone

    dt = datetime.now(timezone.utc) + timedelta(seconds=offset_seconds)
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def acquire_pen(doc: Path, *, ttl: int = PEN_TTL_SECONDS) -> dict:
    """Take the pen. Writes .virgil/pen-context.json (always) and flips
    collab.json's pen to Claude-held + collab enabled (only if collab.json
    exists). Returns the pen-context record."""
    now_s = _iso_at(0)
    expires_s = _iso_at(ttl)

    collab_file = collab_path(doc)
    collab = read_json(collab_file, default=None)
    collab_existed = isinstance(collab, dict)

    prior_enabled = bool(collab.get("enabled", False)) if collab_existed else False
    prior_pen = (
        collab.get("pen")
        if collab_existed and isinstance(collab.get("pen"), dict)
        else dict(FREE_PEN)
    )

    pen_ctx = {
        "holder": PEN_CONTEXT_HOLDER,
        "acquired_at": now_s,
        "expires_at": expires_s,
        "prior_collab_enabled": prior_enabled,
        "collab_existed": collab_existed,
        "prior_pen": prior_pen,
    }

    writes: list[tuple[Path, str | None]] = []
    if collab_existed:
        new_collab = dict(collab)
        new_collab["enabled"] = True
        new_collab["pen"] = {
            "holder": COLLAB_PEN_HOLDER,
            "since": now_s,
            "lastHeartbeat": now_s,
            "lastActivity": now_s,
            "requestedBy": prior_pen.get("requestedBy", []) if isinstance(prior_pen, dict) else [],
        }
        writes.append((collab_file, json_dumps(new_collab)))
    writes.append((pen_context_path(doc), json_dumps(pen_ctx)))

    atomic_write(writes, fault_injectable=False)
    return pen_ctx


def release_pen(doc: Path) -> None:
    """Release the pen. Restores collab.json's prior enabled/pen state (if we
    touched it) and REWRITES .virgil/pen-context.json as a released record.
    Idempotent: a no-op if no pen-context.json is present, and a no-op on a
    record that already says released.

    **Release by REWRITE, not by delete (task 496).** The obvious release is
    to remove the lock file, and that is what shipped — a bare `os.remove`
    inside `atomic_write`'s write-set. On a mount that refuses deletion (the
    reported cloud/Dropbox one) the raise fired AFTER the collab restore had
    already committed, so `atomic_write`'s rollback put collab.json back to
    the ACQUIRE-time state: `enabled: true`, pen held by Claude. The paper was
    then wedged read-only long past the app's 60 s pen-context ceiling, and the
    next acquire snapshotted the poisoned state as its own `prior_*` — sticky
    across runs.

    A `holder: null` record is read as RELEASED **instantly** by the app
    (`coworkPenFromContext` bails on a non-cowork holder, src/lib/cowork-pen.ts),
    which is strictly better than delete-then-TTL: no 60 s window in which a
    crashed-looking hold still reads as live. And it costs the sync daemon
    nothing extra — a delete is already one filesystem event, an ~80-byte
    rewrite of a `.virgil/` file is one too (write-traffic doctrine, 363/415).
    """
    ctx = read_json(pen_context_path(doc), default=None)
    if not isinstance(ctx, dict):
        return
    if ctx.get("holder") is None:
        # Already released: the restore below has run, and re-writing the
        # released record would be a filesystem event that says nothing.
        return

    writes: list[tuple[Path, str | None]] = []

    collab_file = collab_path(doc)
    if ctx.get("collab_existed") and collab_file.exists():
        collab = read_json(collab_file, default=None)
        if isinstance(collab, dict):
            restored = dict(collab)
            restored["enabled"] = bool(ctx.get("prior_collab_enabled", False))
            prior_pen = ctx.get("prior_pen")
            restored["pen"] = prior_pen if isinstance(prior_pen, dict) else dict(FREE_PEN)
            writes.append((collab_file, json_dumps(restored)))

    # The released record carries NOTHING from the acquire: its `prior_*`
    # snapshot has just been spent, and keeping it would let a later release
    # re-restore a state the user has since changed.
    released = {"holder": None, "released_at": _iso_at(0)}
    writes.append((pen_context_path(doc), json_dumps(released)))
    atomic_write(writes, fault_injectable=False)


def commit_under_pen(doc: Path, writes: list[tuple[Path, str | None]]) -> None:
    """Run an atomic multi-file write while holding the pen. Acquire → commit →
    release; the release runs in a finally so a failed/rolled-back write still
    frees the pen and restores collab state.

    **A release-time IO error may not replace the commit's outcome (task 496).**
    The write-set is already on disk by the time the finally runs, so a raise
    from `release_pen` would escape to the CLI top, be converted to `die()`, and
    report exit 2 with no result JSON printed — a landed write reported as a
    failure, i.e. a double-apply retry hazard. The rewrite-not-delete release
    above removes the one delete that could realistically raise here; this wrap
    is the general net, for every other IO failure a release can hit.

    A failure of the WRITE itself still propagates: the guard is around the
    release only, so `atomic_write`'s exception leaves the finally normally.
    """
    acquire_pen(doc)
    try:
        atomic_write(writes)
    finally:
        try:
            release_pen(doc)
        except Exception as e:  # noqa: BLE001 — never poison a landed commit
            print(
                f"warning: pen release failed for {doc}: "
                f"{type(e).__name__}: {e}",
                file=sys.stderr,
            )


# ---------------------------------------------------------------------------
# The preservation measure — a PORT of src/lib/tex-preservation.ts (task 357).
#
# The `/editor/*` skills are the THIRD writer of a paper's `.tex` (the two
# in-app backends being the others), and until now the only one with no net
# under it at all: `apply_response.py`'s `region-replace` rewrites the whole
# preamble from MODEL OUTPUT, unchecked.
#
# A rule reimplemented in a second language drifts. Nothing can share code
# across the seam, so what holds the two halves together is a shared FIXTURE
# CORPUS both must answer identically —
# `src/lib/__tests__/fixtures/preservation-corpus.json`, driven from the TS side
# by `preservation-measure-parity.test.ts` and from here by
# `tests/test_preservation_measure.py`. Change the rule in one language and the
# corpus makes the other one say so.
#
# Read the TS module for WHY each choice is what it is (words rather than
# characters; Virgil's own markers projected away on both sides; user comments
# deliberately NOT projected; the preamble and body weighed separately; and the
# per-token SHORTFALL rather than a net count, which is what survives a pass
# that loses one thing while adding another).
# ---------------------------------------------------------------------------

PRESERVATION_SLACK_RATIO = 0.01
PRESERVATION_SLACK_WORDS = 4

# Mirrors VIRGIL_MARKER_COMMANDS in src/lib/latex-markers.ts. Python cannot
# import the SSOT, so the list is pinned against it by the parity suite's
# membership leg — the same instrument the marker census uses for the skill
# markdown it likewise cannot reach.
VIRGIL_MARKER_COMMANDS = (
    "vfid",
    "vcid",
    "vbid",
    "vexid",
    "vxid",
    "vlid",
    "vlidend",
)

_MARKER_COMMAND_RE = re.compile(
    r"\\(?:" + "|".join(VIRGIL_MARKER_COMMANDS) + r")\{[^}]*\}"
)
_MARKER_COMMENT_RE = re.compile(r"%!v(?:tex)?:[^\s]*")
_WORD_RE = re.compile(r"[A-Za-z0-9]+")

DOCUMENT_MARKER = "\\begin{document}"

# ---------------------------------------------------------------------------
# The preamble/body boundary — a PORT of `findDocumentBoundary` in
# src/lib/latex-lexer.ts (task 375).
#
# Held to the TS rule by the same shared FIXTURE CORPUS the measure is (the
# `boundary` cases), because a gate that split the document differently from the
# parser is structurally blind to the defect it exists to catch: a boundary that
# MOVED measures with everything under body on both sides and reports a
# shortfall of 0 while the paper has been cut in half.
#
# Two rules, each a member of task 375:
#   - only LIVE bytes count (a `%`-commented, `\verb`-quoted or verbatim-quoted
#     token does not move the boundary), and
#   - the end is searched FROM the end of the begin token, never from 0.
#
# The projection BLANKS rather than deletes, so an index into it is an index
# into the original — which is what lets a caller slice the raw string at it.
# ---------------------------------------------------------------------------

# The FULL verbatim family, mirroring VERBATIM_ENVS_FULL in
# src/lib/latex-lexer.ts. Python cannot import the SSOT; the parity suite's
# membership leg pins the list, the same instrument the marker list above uses.
VERBATIM_ENVS_FULL = (
    "verbatim",
    "verbatim*",
    "lstlisting",
    "minted",
    "Verbatim",
    "Verbatim*",
    "BVerbatim",
    "BVerbatim*",
    "LVerbatim",
    "LVerbatim*",
    "comment",
)

_VERB_ALT = "|".join(
    re.escape(e) for e in sorted(VERBATIM_ENVS_FULL, key=len, reverse=True)
)
_VERB_BEGIN_RE = re.compile(r"\\begin\{(?:" + _VERB_ALT + r")\}")
_VERB_END_RE = re.compile(r"\\end\{(?:" + _VERB_ALT + r")\}")
# Group 1 is the (unescaped) run right before the `%`; the `%` sits at
# m.start() + len(m.group(1)). Mirrors `commentTailStart`.
_COMMENT_TAIL_RE = re.compile(r"((?:^|[^\\])(?:\\\\)*)%")
# `\verb<delim>` / `\verb*<delim>` — delimiter is any single non-letter,
# non-`*`, non-space char, so `\verbatim` / `\verbdef` are not mis-lexed.
_INLINE_VERB_RE = re.compile(r"\\verb(\*?)([^A-Za-z*\s])")

BEGIN_DOCUMENT_RE = re.compile(r"\\begin[ \t]*\{[ \t]*document[ \t]*\}")
END_DOCUMENT_RE = re.compile(r"\\end[ \t]*\{[ \t]*document[ \t]*\}")


def _comment_tail_start(line: str) -> int:
    m = _COMMENT_TAIL_RE.search(line)
    return m.start() + len(m.group(1)) if m else -1


def _blank_inline_verb(text: str) -> str:
    out = []
    i = 0
    while True:
        m = _INLINE_VERB_RE.search(text, i)
        if not m:
            out.append(text[i:])
            break
        out.append(text[i : m.start()])
        delim = m.group(2)
        payload = m.end()
        close = text.find(delim, payload)
        if close == -1:
            out.append(" " * (len(text) - m.start()))
            break
        out.append(" " * (close + 1 - m.start()))
        i = close + 1
    return "".join(out)


def project_structural_latex(src: str) -> str:
    r"""`src` with every inert byte BLANKED to a space — comment tails, the FULL
    verbatim family's contents, and inline `\verb` runs. Same length as `src`,
    so an index into the result is an index into `src`.

    Unterminated ⇒ TRANSPARENT: a family `\begin` with no matching `\end` below
    it is not an open, so a half-typed `\begin{comment}` in a preamble cannot
    erase the `\begin{document}` under it. Mirrors the `unterminatedIsLive`
    option `projectStructuralLatex` passes on the TypeScript side.
    """
    out = []
    lines = src.split("\n")
    # Backward pass: does any line at or after i carry a family close? One O(n)
    # sweep, so the terminated-ness test at each open is O(1).
    close_at_or_after = [False] * (len(lines) + 1)
    for i in range(len(lines) - 1, -1, -1):
        close_at_or_after[i] = (
            bool(_VERB_END_RE.search(lines[i])) or close_at_or_after[i + 1]
        )
    in_verbatim = False
    for li, raw_line in enumerate(lines):
        line = raw_line
        kept = ""
        while True:
            if in_verbatim:
                end = _VERB_END_RE.search(line)
                if not end:
                    kept += " " * len(line)
                    break
                in_verbatim = False
                kept += " " * end.end()
                line = line[end.end() :]
                continue
            begin = _VERB_BEGIN_RE.search(line)
            comment = _comment_tail_start(line)
            if not begin or (comment != -1 and begin.start() >= comment):
                visible = line if comment == -1 else line[:comment]
                kept += _blank_inline_verb(visible)
                if comment != -1:
                    kept += " " * (len(line) - comment)
                break
            rest = line[begin.end() :]
            if not _VERB_END_RE.search(rest) and not close_at_or_after[li + 1]:
                visible = line if comment == -1 else line[:comment]
                kept += _blank_inline_verb(visible)
                if comment != -1:
                    kept += " " * (len(line) - comment)
                break
            kept += _blank_inline_verb(line[: begin.start()])
            in_verbatim = True
            kept += " " * len(begin.group(0))
            line = rest
        out.append(kept)
    return "\n".join(out)


def first_live_index_of(tex: str, token: str, start: int = 0) -> int:
    """Index of the first LIVE occurrence of `token` at or after `start`, or -1.

    An offset into `tex` itself — `project_structural_latex` BLANKS rather than
    deletes, so a caller may splice the raw string at it. That is the whole
    point: `apply_response.py`'s `region-replace` splices at this offset and
    replaces everything before it, so a raw `find` landing inside a
    `% \begin{document}` comment would un-comment the token AND take the user's
    real preamble with it (task 375 M3, on the writer that composes preambles
    from model output).

    The TypeScript side has no equivalent export, deliberately: over there every
    boundary question is the document boundary and goes through
    `findDocumentBoundary`, and an exported primitive with no caller is the
    dead-SSOT shape AGENTS.md outlaws. Here `endMarker` is caller-supplied, so
    the generic form has a real consumer.
    """
    live = project_structural_latex(tex)
    return live.find(token, start)


def count_live_document_begins(tex: str) -> int:
    """How many LIVE `\begin{document}` tokens `tex` carries. The structural
    invariant `region-replace` rests on — counted live, so a marker the model
    left commented out or inside a verbatim example neither satisfies the
    invariant nor trips the duplicate refusal."""
    return len(BEGIN_DOCUMENT_RE.findall(project_structural_latex(tex)))


def find_document_boundary(tex: str) -> tuple[int, int, int]:
    """(begin_doc, body_start, end_doc) as offsets into `tex`; -1 for absent.
    `end_doc` is searched from `body_start`, so it can never precede
    `begin_doc`."""
    live = project_structural_latex(tex)
    begin = BEGIN_DOCUMENT_RE.search(live)
    if not begin:
        return -1, -1, -1
    body_start = begin.end()
    end = END_DOCUMENT_RE.search(live, body_start)
    return begin.start(), body_start, (end.start() if end else -1)


def measure_content_bag(tex: str) -> dict[str, int]:
    """The user's content as a multiset of word tokens, Virgil's own markers
    projected away on the way (they are ADDED by the very passes being gated)."""
    projected = _MARKER_COMMENT_RE.sub(" ", _MARKER_COMMAND_RE.sub(" ", tex))
    bag: dict[str, int] = {}
    for w in _WORD_RE.findall(projected):
        bag[w] = bag.get(w, 0) + 1
    return bag


def measure_content_words(tex: str) -> int:
    return sum(measure_content_bag(tex).values())


def missing_words(before: dict[str, int], after: dict[str, int]) -> int:
    """Word OCCURRENCES present before and missing after. Always >= the net
    difference, and unlike it cannot be paid off by unrelated growth."""
    return sum(max(0, n - after.get(t, 0)) for t, n in before.items())


def split_regions(tex: str) -> tuple[str, str]:
    """(preamble, body), split at the LIVE `\\begin{document}` (task 375) so this
    gate weighs the same regions the parser and the in-app gates do. A source
    with no live marker is ALL BODY — the fail-safe direction, since it puts
    every word under a comparison."""
    i, _, _ = find_document_boundary(tex)
    if i == -1:
        return "", tex
    return tex[:i], tex[i:]


def check_region_preservation(before: str, after: str) -> dict[str, Any]:
    b = measure_content_bag(before)
    a = measure_content_bag(after)
    b_total = sum(b.values())
    allowed = max(PRESERVATION_SLACK_WORDS, int(b_total * PRESERVATION_SLACK_RATIO))
    lost = missing_words(b, a)
    return {
        "before": b_total,
        "after": sum(a.values()),
        "lost": lost,
        "allowed": allowed,
        "ok": lost <= allowed,
    }


def check_tex_preservation(before: str, after: str) -> dict[str, Any]:
    """Would writing `after` over `before` lose content? The two regions are
    weighed independently and EITHER shrinking is a refusal."""
    b_pre, b_body = split_regions(before)
    a_pre, a_body = split_regions(after)
    body = check_region_preservation(b_body, a_body)
    preamble = check_region_preservation(b_pre, a_pre)
    return {"ok": body["ok"] and preamble["ok"], "body": body, "preamble": preamble}
