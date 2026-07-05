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
import subprocess
import sys
from pathlib import Path
from typing import Any


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
    commits (os.replace / os.remove) tracking what landed; on any failure it
    restores every committed file from its pre-commit snapshot and re-raises.

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
            tmp.unlink(missing_ok=True)
        raise

    # 2. Commit: swap temps in / delete removals, tracking each for rollback.
    committed: list[Path] = []
    try:
        for p, content in norm:
            if content is None:
                if p.exists():
                    os.remove(p)
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
                    if p.exists():
                        os.remove(p)
                else:
                    p.write_text(prior, encoding="utf-8")
            except OSError:
                pass
        for tmp in temps.values():
            tmp.unlink(missing_ok=True)
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


def dev_mode_enabled() -> bool:
    """True iff `VIRGIL_DEV` is set to a truthy token.

    Truthy == one of {1, true, yes, on} (case-insensitive, surrounding
    whitespace ignored). Everything else — unset, empty, `0`, `false`, `no`,
    `off`, or any unrecognized value — is OFF. OFF is the safe default, so a
    typo'd or forgotten export never silently turns capture on (or, worse, on
    in a context that ships to a user)."""
    return os.environ.get(DEV_MODE_ENV, "").strip().lower() in _DEV_TRUE_TOKENS


# ---------------------------------------------------------------------------
# Dev-loop sink — the one machine-global home for dev-dream artifacts
#
# The capture layer (reflect.py), the dream (dream.py), and iterate
# (dev_loop.py) must ALL resolve the memo / digest / iteration roots
# identically, from ANY cwd — a repo checkout, a git worktree, or a *synced
# paper folder* (where the scripts run from `<paper>/.virgil/scripts/editor/`
# and a `__file__`-relative REPO_ROOT would land *inside* the paper's
# `.virgil/`). So the roots default to a machine-global home (`~/.virgil-dev`),
# NOT a REPO_ROOT-relative path: the writer (reflect) and the reader (dream)
# then agree even when no env var is set — the one hard invariant, since a
# silent divergence makes the dream read an empty dir with no error. Each root
# still honors its explicit env override first (the test seam + the user pin).
#
# This is what lets a paper-directed cowork session accumulate memos the
# repo-side dream can later consume: memos land in the shared home regardless of
# which checkout (if any) the running script physically lives in.
# ---------------------------------------------------------------------------

DEV_HOME_ENV = "VIRGIL_DEV_HOME"
_DEV_HOME_DEFAULT = Path.home() / ".virgil-dev"
SOURCE_REPO_ENV = "VIRGIL_REPO_ROOT"


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


def dev_home() -> Path:
    """The machine-global root for dev-dream artifacts (memos / digests /
    iterations). `VIRGIL_DEV_HOME` overrides; default `~/.virgil-dev`. Always
    absolute and cwd-independent, so every session resolves the same home."""
    return _dir_override(DEV_HOME_ENV) or _DEV_HOME_DEFAULT


def memos_root() -> Path:
    """Where reflect writes and the dream reads the capture memos.
    `VIRGIL_DEV_MEMOS_DIR` overrides (test seam + user pin); else
    `dev_home()/memos`."""
    return _dir_override("VIRGIL_DEV_MEMOS_DIR") or dev_home() / "memos"


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
    qualitative buckets are enriched later via the reflection convention; this
    writes the correctly-classified frontmatter floor."""
    if not dev_mode_enabled():
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
    touched it) and deletes .virgil/pen-context.json. Idempotent: a no-op if no
    pen-context.json is present."""
    ctx = read_json(pen_context_path(doc), default=None)
    if not isinstance(ctx, dict):
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

    writes.append((pen_context_path(doc), None))  # delete the lock record
    atomic_write(writes, fault_injectable=False)


def commit_under_pen(doc: Path, writes: list[tuple[Path, str | None]]) -> None:
    """Run an atomic multi-file write while holding the pen. Acquire → commit →
    release; the release runs in a finally so a failed/rolled-back write still
    frees the pen and restores collab state."""
    acquire_pen(doc)
    try:
        atomic_write(writes)
    finally:
        release_pen(doc)
