"""The Library work-queue SLOT LIFECYCLE — one contract for every writer (task 618).

`<library>/.virgil/queue/` holds one JSON request per SLOT. Before this module,
three writers (the app's `library/lib/queue.ts`, `triage_apply.py`,
`backfill_auth.py`) and one reader (`drain_queue.py`) each had their own idea of
what an existing file in a slot meant, and a user's request could vanish
without a word:

  * a request written next to a `<slot>.done` left by an EARLIER run of the same
    kind was skipped by the drain as "already done", forever;
  * `index` and `authenticate` shared `<citekey>.json`, so the last writer
    silently replaced the other's request;
  * triage ignored a refused write and reported "triaged".

The contract, stated once:

1. **One slot per kind.** `slot_filename(kind, citekey)` is the table. `index`
   and `reindex` share `<citekey>.json` (the same work); every other kind has
   its own file. `library/lib/queue.ts` `queueFilename` mirrors it and a vitest
   parity test pins the two (`queue-slot-parity.test.ts`).
2. **Retire on write.** Before a request lands in a slot, a `<slot>.done` left by
   a previous run is rotated to `<slot>.<kind>.<stamp>.done`. A fresh request
   therefore never sits next to a stale `.done` — by construction.
3. **Never clobber in-flight work.** A slot holding `status: running` refuses
   the write (`IN_FLIGHT`). A slot holding a pending request of the same kind
   is left alone (`ALREADY_QUEUED`) unless the caller asks to replace it.
4. **A legacy occupant is moved, not overwritten.** An `authenticate` request
   written under the old shared `<citekey>.json` is migrated to its own slot
   before anything else is written there.
5. **The drain's belt.** `done_retires(json, done)` says whether a `.done` is
   the retirement of THIS request (same kind + same `requestedAt`), which is
   the only case in which the drain may skip it.

CLI (the door for skill prompts that enqueue work)::

    python3 queue_slot.py write --kind index --citekey smith2020 [--library .]
    python3 queue_slot.py retire --kind index --citekey smith2020

`write` prints one JSON line `{"result": ..., "file": ...}` and exits 0 when a
request is (or already was) queued, 3 when the slot refused it.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import unlink_tolerant  # noqa: E402

# kind → filename suffix appended to the citekey. `None` = the bare
# `<citekey>.json` slot. Mirrored by `queueFilename` in library/lib/queue.ts.
SLOT_SUFFIX: dict[str, Optional[str]] = {
    "index": None,
    "reindex": None,
    "authenticate": "-auth",
    "bib-edit": "-bibedit",
    "paper-review": "-paperreview",
    "deepIndex": "-deepindex",
    "import-bib": "-importbib",
    "delete": "-delete",
}

# Kinds whose requests were written to the bare slot before per-kind slots.
LEGACY_BARE_SLOT_KINDS = ("authenticate",)

WRITTEN = "written"
ALREADY_QUEUED = "already-queued"
IN_FLIGHT = "in-flight"
OCCUPIED = "occupied"
REFUSED_RESULTS = (IN_FLIGHT, OCCUPIED)


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def queue_dir(library: Path) -> Path:
    return Path(library) / ".virgil" / "queue"


def slot_filename(kind: str, citekey: str) -> str:
    """The queue filename for a (kind, citekey) request."""
    if not citekey:
        raise ValueError("citekey required for a queue slot")
    if kind == "richIndex":  # legacy spelling of deepIndex
        kind = "deepIndex"
    if kind not in SLOT_SUFFIX:
        raise ValueError(f"unknown queue kind {kind!r}")
    return f"{citekey}{SLOT_SUFFIX[kind] or ''}.json"


def slot_suffixes() -> tuple[str, ...]:
    """Every per-citekey queue filename SUFFIX — each slot's `.json` and its
    `.done` marker, plus the legacy `-richindex` spelling. The table a citekey
    rename walks, derived rather than hand-listed (task 618)."""
    stems = sorted({v or "" for v in SLOT_SUFFIX.values()} | {"-richindex"})
    return tuple(f"{stem}{ext}" for stem in stems for ext in (".json", ".done"))


def _read(path: Path) -> Optional[dict[str, Any]]:
    try:
        data = json.loads(path.read_text())
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def retire_done(qdir: Path, stem: str) -> str:
    """Rotate `<stem>.done` out of the slot. Returns the rotated name ('' if
    there was nothing to rotate). A mount that refuses the rename gets the
    stale marker deleted instead (task 496: a fallback must not raise)."""
    done = qdir / f"{stem}.done"
    if not done.exists():
        return ""
    old = _read(done) or {}
    kind = str(old.get("kind") or "unknown")
    rotated = qdir / f"{stem}.{kind}.{_stamp()}.done"
    try:
        done.rename(rotated)
    except OSError:
        unlink_tolerant(done, what="superseded .done")
        return ""
    return rotated.name


def done_retires(json_path: Path, done_path: Path) -> bool:
    """True when `done_path` records the retirement of the request now sitting
    in `json_path` — i.e. the work is genuinely finished and only the entry's
    unlink was refused. Anything else (a different kind, an older request, an
    unreadable marker older than the request) is a STALE marker."""
    if not done_path.exists():
        return False
    done = _read(done_path)
    cur = _read(json_path)
    if done is not None and cur is not None:
        return (
            done.get("kind") == cur.get("kind")
            and done.get("requestedAt") == cur.get("requestedAt")
        )
    # `_mark_done`'s fallback writes an empty marker; judge it by age.
    try:
        return done_path.stat().st_mtime >= json_path.stat().st_mtime
    except OSError:
        return False


def _migrate_legacy_occupant(qdir: Path, citekey: str, target_kind: str) -> bool:
    """Move a legacy request out of the bare `<citekey>.json` slot into its own
    per-kind slot, so a bare-slot write never overwrites it. Returns False
    when the occupant could not be moved (the bare slot must then be left
    alone)."""
    bare = qdir / f"{citekey}.json"
    cur = _read(bare) if bare.exists() else None
    if not cur:
        return True
    kind = cur.get("kind")
    if kind not in LEGACY_BARE_SLOT_KINDS or kind == target_kind:
        return True
    dest = qdir / slot_filename(kind, citekey)
    if dest.exists():
        dest_cur = _read(dest) or {}
        if dest_cur.get("status") == "requested":
            # The per-kind slot already carries a pending request of this
            # kind; the legacy copy is redundant.
            return unlink_tolerant(bare, what="duplicate legacy queue entry")
        # The per-kind slot holds something else (running / failed): moving
        # the legacy request over it would lose one of the two.
        return False
    if cur.get("status") == "running":
        return False
    retire_done(qdir, dest.stem)
    try:
        bare.rename(dest)
    except OSError:
        return False
    return True


def write_request(
    library: Path,
    kind: str,
    citekey: str,
    *,
    extra: Optional[dict[str, Any]] = None,
    replace_requested: bool = False,
) -> tuple[str, Path]:
    """Queue a `kind` request for `citekey` under the slot contract.

    Returns `(result, path)` where result is WRITTEN, ALREADY_QUEUED (a pending
    request of the same kind is already there and `replace_requested` is off)
    IN_FLIGHT (the slot is being worked; nothing was written) or OCCUPIED (a
    legacy request of another kind holds the bare slot and could not be moved
    aside; nothing was written)."""
    qdir = queue_dir(library)
    qdir.mkdir(parents=True, exist_ok=True)
    name = slot_filename(kind, citekey)
    path = qdir / name
    if name == f"{citekey}.json" and not _migrate_legacy_occupant(qdir, citekey, kind):
        return OCCUPIED, path
    cur = _read(path) if path.exists() else None
    if cur is not None:
        status = cur.get("status")
        if status == "running":
            return IN_FLIGHT, path
        if (
            status == "requested"
            and not replace_requested
            and cur.get("kind") == kind
            and not done_retires(path, path.with_suffix(".done"))
        ):
            return ALREADY_QUEUED, path
    retire_done(qdir, path.stem)
    entry: dict[str, Any] = {
        "kind": kind,
        "status": "requested",
        "citekey": citekey,
        "requestedAt": _now(),
        "attempts": 0,
    }
    if extra:
        entry.update(extra)
    path.write_text(json.dumps(entry, indent=2) + "\n")
    return WRITTEN, path


def find_request(library: Path, kind: str, citekey: str) -> Optional[Path]:
    """The file holding a pending `kind` request for `citekey`, looking in the
    per-kind slot and (for legacy kinds) the bare slot."""
    qdir = queue_dir(library)
    candidates = [qdir / slot_filename(kind, citekey)]
    if kind in LEGACY_BARE_SLOT_KINDS:
        candidates.append(qdir / f"{citekey}.json")
    for p in candidates:
        cur = _read(p) if p.exists() else None
        if cur and cur.get("kind") == kind and cur.get("status") in ("requested", "running"):
            return p
    return None


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Library queue slot door.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write", help="queue a request under the slot contract")
    w.add_argument("--kind", required=True)
    w.add_argument("--citekey", required=True)
    w.add_argument("--library", default=str(Path.cwd()))
    w.add_argument("--replace", action="store_true",
                   help="replace a pending request of the same kind")
    r = sub.add_parser("retire", help="mark a finished request done")
    r.add_argument("--kind", required=True)
    r.add_argument("--citekey", required=True)
    r.add_argument("--library", default=str(Path.cwd()))
    args = ap.parse_args(argv)
    library = Path(args.library).expanduser()

    if args.cmd == "write":
        result, path = write_request(
            library, args.kind, args.citekey, replace_requested=args.replace,
        )
        print(json.dumps({"result": result, "file": path.name}))
        return 3 if result in REFUSED_RESULTS else 0

    path = find_request(library, args.kind, args.citekey)
    if path is None:
        print(json.dumps({"result": "nothing-queued"}))
        return 0
    qdir = path.parent
    retire_done(qdir, path.stem)
    done = path.with_suffix(".done")
    done.write_text(path.read_text())
    unlink_tolerant(path, what="retired queue entry")
    print(json.dumps({"result": "retired", "file": done.name}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
