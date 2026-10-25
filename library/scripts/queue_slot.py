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
6. **One answer to "what does the queue hold?"** (task 794). Not every
   `*.json` in the queue is a request: `pending-reviews.json` is a manifest
   the app keeps forever, and `*.done.json` is a rotated marker.
   `is_request_filename` is the file-level predicate and `PENDING_STATUS` the
   status one; `pending_requests` applies both (plus the done-sibling belt).
   The drain lists through it, the skill's detached-drain poll counts through
   it (`pending --native`), and the app's reader (`scanQueue`) mirrors the
   exclusion set as `QUEUE_NON_REQUEST_FILENAMES` — pinned by
   `queue-slot-parity.test.ts`.
7. **A deep index brings its own index** (task 809). `/library/deep-index`
   needs an indexed paper, so `write_deep_index` mirrors the app's
   `queueDeepIndex` (`library/lib/bib-edit.ts`): when `papers/<citekey>/main.tex`
   is absent it also plants an `index` request tagged
   `companionOf: "deepIndex"` — only into an EMPTY index slot, so an index
   the user already queued (or one in flight) is left exactly as it is. The
   CLI's `write --kind deepIndex` goes through it, which makes this the one
   enqueue a skill prompt (the front door's Queue branch) needs.
8. **The review manifest is the shadow of the authenticate slot** (task 1041).
   `pending-reviews.json` lists the pending `authenticate` requests. The app
   keeps it beside its own writes (`queueBibReview` adds, `cancelBibReview`
   drops — `library/lib/queue.ts`); here `write_request(kind="authenticate")`
   adds the row and `retire --kind authenticate` drops it, under one sidecar
   lock with an atomic write and an argv citekey. No skill edits the file by
   hand. The row arithmetic (`with_pending_review` / `without_pending_review`)
   is pinned to queue.ts's by `queue-slot-parity.test.ts`.

9. **A worker CLAIMS before it works, and retires only what it claimed**
   (task 1291). `claim_request` rewrites the entry to `status: running` +
   `startedAt` — the one in-flight signal both writers refuse on
   (`is_in_flight`; the drain's old `.lock` sidecar told neither of them).
   `retire_claimed` / `release_claimed` act only while the slot still holds
   the claimed request (`same_request`: kind + `requestedAt`), so a request
   the user queues mid-run stays queued instead of being copied into `.done`
   unworked. A claim older than `RUNNING_TTL_SECONDS` is abandoned and
   re-claimable. "Is there a live request?" is ONE predicate in both silos:
   `LIVE_STATUSES` over `slot_kinds` (`index` ≈ `reindex`), pinned by
   `queue-slot-parity.test.ts`.

CLI (the door for skill prompts that enqueue work)::

    python3 queue_slot.py write --kind index --citekey smith2020 [--library .]
    python3 queue_slot.py write --kind deepIndex --citekey smith2020 [--note "…"]
    python3 queue_slot.py claim --kind index --citekey smith2020
    python3 queue_slot.py retire --kind index --citekey smith2020 [--requested-at <claimed>]
    python3 queue_slot.py pending [--native] [--count]

`pending` prints the pending requests as JSON lines (`{"kind", "citekey",
"file"}`), or with `--count` just their number. `--native` limits it to the
kinds `drain_queue.py` processes itself (`DRAIN_NATIVE_KINDS`) — the count a
detached drain drives to zero while the kinds it defers to skills stay queued.

`write` prints one JSON line `{"result": ..., "file": ...}` (plus
`"companion": {"result", "file"}` when a deep index planted or found its index)
and exits 0 when a request is (or already was) queued, 3 when the slot refused
it.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import (  # noqa: E402
    StateFileUnreadable,
    _atomic_write_text,
    _flock_path,
    citekey_matches,
    is_path_safe_citekey,
    paper_folder,
    read_json_state,
    require_path_safe_citekey,
    unlink_tolerant,
)

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

# Legacy kind spellings → the current kind. Read paths normalize through it.
LEGACY_KIND_ALIASES: dict[str, str] = {"richIndex": "deepIndex"}
# Legacy slot suffixes still read (never written): kind → extra suffixes.
LEGACY_SLOT_SUFFIXES: dict[str, tuple[str, ...]] = {"deepIndex": ("-richindex",)}

# Files in the queue folder that are NOT requests, whatever their extension.
# `pending-reviews.json` is the bib-review manifest (contract item 8),
# written and never deleted.
# Mirrored by `QUEUE_NON_REQUEST_FILENAMES` in library/lib/queue.ts.
PENDING_REVIEWS_FILENAME = "pending-reviews.json"
NON_REQUEST_FILENAMES: tuple[str, ...] = (PENDING_REVIEWS_FILENAME,)
# A rotated/legacy retirement marker that happens to end in `.json`.
DONE_JSON_SUFFIX = ".done.json"

# The one status that means "waiting to be worked". `running` is in flight,
# `failed` is a retry the drain may pick up again, `poisoned` is given up on,
# `done` is finished. Mirrored by `scanQueue`'s status test.
PENDING_STATUS = "requested"

# The status a CLAIM writes (contract item 9). Mirrored by queue.ts.
RUNNING_STATUS = "running"

# "Is there a live request in this slot?" — the statuses `find_request` and
# queue.ts `findQueuedRequest` both answer with (task 1291). A `failed` or
# `poisoned` entry is not a live request: a deep index must still plant its
# companion over it. Pinned TS↔py by `queue-slot-parity.test.ts`.
LIVE_STATUSES: tuple[str, ...] = (PENDING_STATUS, RUNNING_STATUS)

# A claim older than this is ABANDONED (its worker was killed mid-run): the
# writers may replace it and the drain may re-claim it. The same hour the
# drain's old `.lock` sidecar used. Pinned TS↔py (`QUEUE_RUNNING_TTL_MS`).
RUNNING_TTL_SECONDS = 60 * 60

# Statuses a worker may claim: a fresh request and a failed one it retries.
CLAIMABLE_STATUSES: tuple[str, ...] = (PENDING_STATUS, "failed")

# Kinds `drain_queue.py` processes itself; every other kind is deferred to a
# skill (index-pending.md step 2).
DRAIN_NATIVE_KINDS: tuple[str, ...] = ("index", "reindex")

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


def normalize_kind(kind: str) -> str:
    return LEGACY_KIND_ALIASES.get(kind, kind)


def slot_kinds(kind: str) -> tuple[str, ...]:
    """Every kind that shares `kind`'s slot — derived from `SLOT_SUFFIX`, so
    `index` and `reindex` (both the bare slot) answer for each other (task
    1291). Mirrored by queue.ts `queueSlotKinds`."""
    kind = normalize_kind(kind)
    if kind not in SLOT_SUFFIX:
        return (kind,)
    return tuple(k for k, v in SLOT_SUFFIX.items() if v == SLOT_SUFFIX[kind])


def _parse_stamp(value: Any) -> Optional[float]:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def is_in_flight(entry: Optional[dict[str, Any]], now: Optional[float] = None) -> bool:
    """True when `entry` is being worked: `status: running` under a claim that
    is not yet ABANDONED (`RUNNING_TTL_SECONDS` since `startedAt`). A running
    entry with no readable `startedAt` was claimed by something that predates
    the claim door — treated as in flight, the conservative answer. Mirrored
    by queue.ts `isQueueEntryInFlight`."""
    if not isinstance(entry, dict) or entry.get("status") != RUNNING_STATUS:
        return False
    started = _parse_stamp(entry.get("startedAt"))
    if started is None:
        return True
    now = datetime.now(timezone.utc).timestamp() if now is None else now
    return now - started < RUNNING_TTL_SECONDS


def same_request(a: Optional[dict[str, Any]], b: Optional[dict[str, Any]]) -> bool:
    """Do `a` and `b` record the SAME request — same kind and same
    `requestedAt`? The identity a claim is retired against (task 1291) and
    the one `done_retires` already uses."""
    if not isinstance(a, dict) or not isinstance(b, dict):
        return False
    return (
        normalize_kind(str(a.get("kind") or "")) == normalize_kind(str(b.get("kind") or ""))
        and a.get("requestedAt") == b.get("requestedAt")
    )


def slot_filename(kind: str, citekey: str) -> str:
    """The queue filename for a (kind, citekey) request."""
    if not citekey:
        raise ValueError("citekey required for a queue slot")
    require_path_safe_citekey(citekey)  # task 894: `queue/../x.json` escapes
    kind = normalize_kind(kind)
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
    if is_in_flight(cur):
        return False
    retire_done(qdir, dest.stem)
    try:
        bare.rename(dest)
    except OSError:
        return False
    return True


# ── the review manifest (contract item 8) ─────────────────────────────

# The kind whose pending requests the manifest shadows.
REVIEW_KIND = "authenticate"


def _row_is(row: Any, citekey: str) -> bool:
    """Is this manifest row `citekey`'s? NFC-insensitive (`citekey_matches`);
    a malformed row is nobody's."""
    stored = row.get("citekey") if isinstance(row, dict) else None
    return isinstance(stored, str) and citekey_matches(stored, citekey)


def without_pending_review(doc: Any, citekey: str) -> list[Any]:
    """The manifest's rows without `citekey`'s row. A malformed row (not an
    object, no citekey) is kept, never raised on — mirrors queue.ts
    `withoutPendingReview`."""
    rows = doc.get("pendingReviews") if isinstance(doc, dict) else None
    if not isinstance(rows, list):
        return []
    return [r for r in rows if not _row_is(r, citekey)]


def with_pending_review(doc: Any, citekey: str, requested_at: str) -> list[Any]:
    """The manifest's rows with `citekey`'s row (re)placed last — mirrors
    queue.ts `withPendingReview`."""
    return without_pending_review(doc, citekey) + [
        {"citekey": citekey, "requestedAt": requested_at}
    ]


def pending_reviews_path(library: Path) -> Path:
    return queue_dir(library) / PENDING_REVIEWS_FILENAME


def _update_pending_reviews(library: Path, citekey: str, requested_at: Optional[str]) -> str:
    """Add (`requested_at` given) or drop `citekey`'s manifest row under the
    manifest's sidecar lock, written atomically. Returns "added", "removed",
    "absent" (drop with no manifest or no row: nothing written) or
    "unreadable" (the file exists but is not a manifest: left byte-identical,
    a copy preserved aside by `read_json_state`). Never raises for the
    manifest's own state — it is a shadow, and a broken shadow must not fail
    the request write or retirement it rides on."""
    require_path_safe_citekey(citekey)
    path = pending_reviews_path(library)
    with _flock_path(path.with_name(path.name + ".lock")):
        try:
            doc = read_json_state(path, lambda: None, shape={"pendingReviews": list})
        except StateFileUnreadable as e:
            print(f"queue_slot: {e}", file=sys.stderr)
            return "unreadable"
        if requested_at is None:
            if doc is None:
                return "absent"
            rows = without_pending_review(doc, citekey)
            if not any(_row_is(r, citekey) for r in doc.get("pendingReviews") or []):
                return "absent"
            result = "removed"
        else:
            rows = with_pending_review(doc, citekey, requested_at)
            result = "added"
        out = dict(doc) if isinstance(doc, dict) else {}
        out["pendingReviews"] = rows
        out["updatedAt"] = _now()
        _atomic_write_text(path, json.dumps(out, indent=2) + "\n")
        return result


def add_pending_review(library: Path, citekey: str, requested_at: str) -> str:
    return _update_pending_reviews(library, citekey, requested_at)


def remove_pending_review(library: Path, citekey: str) -> str:
    return _update_pending_reviews(library, citekey, None)


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
        if is_in_flight(cur):
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
    _atomic_write_text(path, json.dumps(entry, indent=2) + "\n")
    if normalize_kind(kind) == REVIEW_KIND:
        add_pending_review(library, citekey, entry["requestedAt"])
    return WRITTEN, path


def paper_indexed(library: Path, citekey: str) -> bool:
    """True when the paper has an extracted `main.tex` — the precondition
    `/library/deep-index` checks before it will run."""
    return is_path_safe_citekey(citekey) and (
        paper_folder(Path(library), citekey) / "main.tex"
    ).is_file()


def write_deep_index(
    library: Path,
    citekey: str,
    *,
    note: Optional[str] = None,
    replace_requested: bool = False,
) -> tuple[str, Path, Optional[tuple[str, Path]]]:
    """Queue a deep index the way the app's `queueDeepIndex` does (contract
    item 7). Returns `(result, path, companion)`; `companion` is the index
    write's `(result, path)` — `(ALREADY_QUEUED, path)` when an index request
    was already there — or None when the paper is indexed or the deep index
    itself was refused (a slot being worked means a paper under way, and
    nothing the user asked for was queued to need it)."""
    extra = {"note": note.strip()} if note and note.strip() else None
    result, path = write_request(
        library, "deepIndex", citekey, extra=extra, replace_requested=replace_requested,
    )
    if result in REFUSED_RESULTS or paper_indexed(library, citekey):
        return result, path, None
    existing = find_request(library, "index", citekey)
    if existing is not None:
        return result, path, (ALREADY_QUEUED, existing)
    return result, path, write_request(
        library, "index", citekey, extra={"companionOf": "deepIndex"},
    )


def find_request(library: Path, kind: str, citekey: str) -> Optional[Path]:
    """The file holding a LIVE (`LIVE_STATUSES`) request of `kind` — or of any
    kind sharing its slot (`slot_kinds`: a `reindex` answers for `index`) —
    for `citekey`, looking in the per-kind slot, (for legacy kinds) the bare
    slot, and any legacy slot spelling (`-richindex` for deepIndex). Mirrored
    by queue.ts `findQueuedRequest` (task 1291)."""
    qdir = queue_dir(library)
    kind = normalize_kind(kind)
    kinds = slot_kinds(kind)
    candidates = [qdir / slot_filename(kind, citekey)]
    if kind in LEGACY_BARE_SLOT_KINDS:
        candidates.append(qdir / f"{citekey}.json")
    candidates += [qdir / f"{citekey}{sfx}.json" for sfx in LEGACY_SLOT_SUFFIXES.get(kind, ())]
    for p in candidates:
        cur = _read(p) if p.exists() else None
        if (
            cur
            and normalize_kind(str(cur.get("kind") or "")) in kinds
            and cur.get("status") in LIVE_STATUSES
        ):
            return p
    return None


# ── the claim (contract item 9, task 1291) ────────────────────────────


def _slot_lock(path: Path) -> Path:
    """The flock sidecar that serializes Python claimants of one slot. (The
    app cannot take it; `retire_claimed`'s identity check is what makes an
    app write that lands mid-claim safe.)"""
    return path.with_name(path.name + ".lock")


def claim_request(path: Path) -> Optional[dict[str, Any]]:
    """CLAIM the request in `path` for working: rewrite it to
    `status: running` + `startedAt`, atomically, so both writers (this
    module's `write_request` and the app's `writeQueueEntry`) refuse to
    replace it while it is worked. Returns the claimed entry — the identity
    `retire_claimed` / `release_claimed` check — or None when there is
    nothing claimable there (absent, unreadable, already in flight, poisoned,
    done). An ABANDONED claim (`is_in_flight` false on a running entry) is
    re-claimable."""
    with _flock_path(_slot_lock(path)):
        cur = _read(path) if path.exists() else None
        if cur is None:
            return None
        status = cur.get("status")
        abandoned = status == RUNNING_STATUS and not is_in_flight(cur)
        if status not in CLAIMABLE_STATUSES and not abandoned:
            return None
        cur["status"] = RUNNING_STATUS
        cur["startedAt"] = _now()
        _atomic_write_text(path, json.dumps(cur, indent=2) + "\n")
        return cur


def _claim_still_holds(path: Path, claimed: dict[str, Any]) -> Optional[dict[str, Any]]:
    cur = _read(path) if path.exists() else None
    return cur if same_request(cur, claimed) else None


def retire_claimed(path: Path, claimed: dict[str, Any]) -> bool:
    """Retire the request this worker CLAIMED and finished: write its
    `.done` marker and drop the entry — but only if the slot still holds
    that request. A request written into the slot after the claim (the user
    re-queued mid-run) is a different request: it is left live, never
    copied into `.done` unworked. Returns whether the claim was retired.

    The `.done` WRITE is what retires the entry (`done_retires`); the
    unlink is tidiness and a mount that refuses it must not raise (task 496)."""
    with _flock_path(_slot_lock(path)):
        cur = _claim_still_holds(path, claimed)
        if cur is None:
            return False
        retire_done(path.parent, path.stem)
        cur["status"] = "done"
        cur["finishedAt"] = _now()
        _atomic_write_text(path.with_suffix(".done"), json.dumps(cur, indent=2) + "\n")
        unlink_tolerant(path, what="retired queue entry")
        return True


def release_claimed(path: Path, claimed: dict[str, Any], error: str) -> Optional[str]:
    """Release a claim whose work FAILED: bump `attempts` and set `failed`
    (or `poisoned` on the third failure) with `lastError`. Returns the new
    status, or None when the slot no longer holds the claimed request — a
    newer request is not charged with this run's failure."""
    with _flock_path(_slot_lock(path)):
        cur = _claim_still_holds(path, claimed)
        if cur is None:
            return None
        attempts = int(cur.get("attempts", 0) or 0) + 1
        cur["attempts"] = attempts
        cur["status"] = "failed" if attempts < 3 else "poisoned"
        cur["lastError"] = error[:1000]
        cur["lastAttemptAt"] = _now()
        cur.pop("startedAt", None)
        _atomic_write_text(path, json.dumps(cur, indent=2) + "\n")
        return cur["status"]


def in_flight_requests(qdir: Path) -> list[Path]:
    """The request files currently CLAIMED and not abandoned — the one
    answer to "is a worker in this queue right now?" (the merge-bibs
    preflight asks it)."""
    return [p for p in request_files(qdir) if is_in_flight(_read(p))]


def is_request_filename(name: str) -> bool:
    """True when a queue-folder filename can hold a request: a `.json` that is
    neither a known non-request file (the review manifest) nor a `.done`
    marker. Says nothing about status — see `pending_requests`."""
    return (
        name.endswith(".json")
        and not name.endswith(DONE_JSON_SUFFIX)
        and name not in NON_REQUEST_FILENAMES
    )


def request_files(qdir: Path) -> list[Path]:
    """Every file in `qdir` that `is_request_filename` admits, sorted."""
    if not qdir.is_dir():
        return []
    return sorted(p for p in qdir.iterdir() if p.is_file() and is_request_filename(p.name))


def pending_requests(qdir: Path, *, native_only: bool = False) -> list[dict[str, Any]]:
    """The requests waiting to be worked: request files whose entry reads as a
    dict with `status == PENDING_STATUS`, not already retired by a `.done`
    sibling (`done_retires`). Each item is the entry with `kind` normalized
    and `_path` set. `native_only` keeps just `DRAIN_NATIVE_KINDS`.

    Read-only: no stale marker is rotated here (the drain does that)."""
    out: list[dict[str, Any]] = []
    for p in request_files(qdir):
        data = _read(p)
        if data is None or data.get("status") != PENDING_STATUS:
            continue
        if done_retires(p, p.with_suffix(".done")):
            continue
        data["kind"] = normalize_kind(str(data.get("kind") or ""))
        if native_only and data["kind"] not in DRAIN_NATIVE_KINDS:
            continue
        data["_path"] = p
        out.append(data)
    return out


from _library_root import library_root_or_exit  # noqa: E402  (task 896)


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Library queue slot door.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    w = sub.add_parser("write", help="queue a request under the slot contract")
    w.add_argument("--kind", required=True)
    w.add_argument("--citekey", required=True)
    w.add_argument("--library", default=None)
    w.add_argument("--replace", action="store_true",
                   help="replace a pending request of the same kind")
    w.add_argument("--note", default=None,
                   help="the user's own words, carried on the request")
    c = sub.add_parser("claim", help="claim a queued request before working it")
    c.add_argument("--kind", required=True)
    c.add_argument("--citekey", required=True)
    c.add_argument("--library", default=None)
    r = sub.add_parser("retire", help="mark a finished request done")
    r.add_argument("--kind", required=True)
    r.add_argument("--citekey", required=True)
    r.add_argument("--library", default=None)
    r.add_argument("--requested-at", default=None,
                   help="retire only the request `claim` returned (its requestedAt)")
    q = sub.add_parser("pending", help="list (or count) the pending requests")
    q.add_argument("--native", action="store_true",
                   help="only the kinds drain_queue.py processes itself")
    q.add_argument("--count", action="store_true", help="print just the number")
    q.add_argument("--library", default=None)
    args = ap.parse_args(argv)
    library = library_root_or_exit(args.library)

    if args.cmd == "pending":
        items = pending_requests(queue_dir(library), native_only=args.native)
        if args.count:
            print(len(items))
        else:
            for it in items:
                print(json.dumps({
                    "kind": it.get("kind", ""),
                    "citekey": it.get("citekey", ""),
                    "file": it["_path"].name,
                }))
        return 0

    if args.cmd == "write":
        if normalize_kind(args.kind) == "deepIndex":
            result, path, companion = write_deep_index(
                library, args.citekey, note=args.note, replace_requested=args.replace,
            )
        else:
            note = args.note.strip() if args.note else ""
            result, path = write_request(
                library, args.kind, args.citekey,
                extra={"note": note} if note else None,
                replace_requested=args.replace,
            )
            companion = None
        out: dict[str, Any] = {"result": result, "file": path.name}
        if companion is not None:
            out["companion"] = {"result": companion[0], "file": companion[1].name}
        print(json.dumps(out))
        return 3 if result in REFUSED_RESULTS else 0

    if args.cmd == "claim":
        return claim(library, args.kind, args.citekey)

    return retire(library, args.kind, args.citekey, requested_at=args.requested_at)


def claim(library: Path, kind: str, citekey: str) -> int:
    """CLI half of `claim_request`: claim the live `kind` request for
    `citekey` before working it. Prints `{"result": "claimed", "file",
    "requestedAt"}` — the `requestedAt` a skill hands back to `retire
    --requested-at` — or `{"result": "nothing-claimable"}` (no request
    queued: the skill was invoked directly; or it is already in flight).
    Always exits 0: a skill run with nothing queued still does its work."""
    path = find_request(library, kind, citekey)
    claimed = claim_request(path) if path is not None else None
    if claimed is None:
        out: dict[str, Any] = {"result": "nothing-claimable"}
        if path is not None:
            out["file"] = path.name
    else:
        out = {"result": "claimed", "file": path.name,
               "requestedAt": claimed.get("requestedAt")}
    print(json.dumps(out))
    return 0


def retire(
    library: Path, kind: str, citekey: str, *, requested_at: Optional[str] = None,
) -> int:
    """Mark the live `kind` request for `citekey` done. With `requested_at`
    (what `claim` printed) only THAT request is retired: a newer one written
    into the slot while the skill worked is left queued (`"superseded"`) —
    the identity check `retire_claimed` makes (task 1291). Retiring an
    `authenticate` request also drops its review-manifest row — even when no
    request is queued, so a stale row left by an older run is cleaned up
    (but not when a newer request superseded the claim: its row is live)."""
    path = find_request(library, kind, citekey)
    out: dict[str, Any]
    superseded = False
    if path is None:
        out = {"result": "nothing-queued"}
    else:
        cur = _read(path) or {}
        claimed = dict(cur) if requested_at is None else {
            "kind": cur.get("kind"), "requestedAt": requested_at,
        }
        if retire_claimed(path, claimed):
            out = {"result": "retired", "file": path.with_suffix(".done").name}
        else:
            superseded = True
            out = {"result": "superseded", "file": path.name}
    if normalize_kind(kind) == REVIEW_KIND and not superseded:
        out["manifest"] = remove_pending_review(library, citekey)
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
