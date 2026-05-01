"""Backfill authentication for master.bib entries missing a state comment.

Scans master.bib for entries that lack a `% bib.state = ...` comment,
cross-references catalog.json (skips entries already authenticated there),
and writes queue/<citekey>.json files with kind="authenticate" for each.

The existing /index-pending skill dispatches deferred "authenticate"
entries to /authenticate-bib, so the queue is drained by the normal
pipeline.

Usage:
  python3 backfill_auth.py [--library ~/Virgil-Library] [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


_ENTRY_RE = re.compile(r"@\w+\s*\{\s*([A-Za-z0-9_:.\-]+)\s*,")


def _parse_citekeys_with_state(master_path: Path) -> dict[str, str]:
    """Return {citekey: state_string} for every entry. Empty string if no state comment."""
    if not master_path.exists():
        return {}
    text = master_path.read_text()
    lines = text.splitlines()
    result: dict[str, str] = {}
    for i, line in enumerate(lines):
        m = _ENTRY_RE.match(line.strip())
        if not m:
            continue
        citekey = m.group(1)
        state = ""
        if i > 0:
            prev = lines[i - 1].strip()
            if prev.startswith("% bib.state"):
                eq = prev.find("=")
                if eq != -1:
                    state = prev[eq + 1:].strip()
        result[citekey] = state
    return result


def _read_catalog(library: Path) -> dict:
    p = library / "catalog.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"entries": []}


def _rotate_stale_done(qdir: Path, citekey: str) -> str:
    """If queue/<ck>.done exists, rename it out of the way so a new
    queue/<ck>.json doesn't get silently skipped by drain_queue. Returns
    the kind that was rotated (or '' if nothing to rotate)."""
    done = qdir / f"{citekey}.done"
    if not done.exists():
        return ""
    try:
        old_kind = json.loads(done.read_text()).get("kind", "unknown")
    except Exception:
        old_kind = "unknown"
    rotated = qdir / f"{citekey}.{old_kind}.done"
    try:
        done.rename(rotated)
    except OSError:
        done.unlink(missing_ok=True)
    return old_kind


def _restamp_from_catalog(library: Path, master_states: dict[str, str],
                          catalog_states: dict[str, str], dry_run: bool) -> int:
    """For entries where catalog.json has a terminal bib state but master.bib
    has no `% bib.state` comment, re-stamp master.bib from the catalog. This
    fixes the desync that backfill would otherwise hide from the operator."""
    needs_restamp = sorted(
        ck for ck, ms in master_states.items()
        if not ms and catalog_states.get(ck) in ("authenticated", "manuscript")
    )
    if not needs_restamp:
        return 0
    if dry_run:
        for ck in needs_restamp:
            print(f"  [dry-run] would restamp {ck} → % bib.state = {catalog_states[ck]}")
        return len(needs_restamp)
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from index_paper import _read_master_bib, _update_master_bib_entry  # type: ignore
    master = _read_master_bib(library / "master.bib")
    for ck in needs_restamp:
        entry = master.get(ck)
        if not entry:
            continue
        _update_master_bib_entry(
            library / "master.bib", ck,
            entry["type"], entry["fields"],
            bib_state=catalog_states[ck],
        )
        print(f"  [restamped] {ck} → {catalog_states[ck]}")
    return len(needs_restamp)


def main() -> int:
    p = argparse.ArgumentParser(description="Backfill bib authentication for entries without state.")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument("--dry-run", action="store_true",
                   help="Print what would be queued without writing")
    p.add_argument("--include-unverified", action="store_true",
                   help="Also re-queue entries marked as unverified (re-try the auth)")
    p.add_argument("--include-failed", action="store_true",
                   help="Also re-queue entries marked as failed (re-try the auth)")
    p.add_argument("--all", action="store_true",
                   help="Re-queue everything except 'authenticated' and 'manuscript' (terminal states)")
    args = p.parse_args()

    library = Path(args.library).expanduser()
    master = library / "master.bib"
    if not master.exists():
        print(f"No master.bib at {master}", file=sys.stderr)
        return 1

    entries = _parse_citekeys_with_state(master)
    catalog = _read_catalog(library)
    catalog_states: dict[str, str] = {}
    for e in catalog.get("entries", []):
        ck = e.get("citekey", "")
        bib = e.get("bib") or {}
        state = bib.get("state", "")
        if ck and state:
            catalog_states[ck] = state

    requeue_states: set[str] = {"", "needs-title"}
    if args.include_unverified or args.all:
        requeue_states.add("unverified")
    if args.include_failed or args.all:
        requeue_states.add("failed")

    # P10: Re-stamp pre-pass — fix master.bib for entries where catalog has a
    # terminal state but master.bib's `% bib.state` comment is missing or stale.
    restamped = _restamp_from_catalog(library, entries, catalog_states, args.dry_run)
    # Refresh in-memory state map so the re-stamped entries are now classified
    # as terminal.
    if restamped and not args.dry_run:
        entries = _parse_citekeys_with_state(master)

    qdir = library / "queue"
    if not args.dry_run:
        qdir.mkdir(parents=True, exist_ok=True)

    # Bucket every entry into one of: queue, terminal, other-state-skipped,
    # already-queued. Counts go to a clear summary; queueing is one pass.
    to_queue: list[tuple[str, str]] = []  # (citekey, current state)
    bucket_terminal = 0
    bucket_other_state: dict[str, int] = {}
    bucket_already_queued = 0
    bucket_catalog_authenticated = 0
    rotated_done: list[tuple[str, str]] = []  # (citekey, old_kind)

    for citekey, state in entries.items():
        if state in ("authenticated", "manuscript"):
            bucket_terminal += 1
            continue
        if citekey in catalog_states and catalog_states[citekey] in ("authenticated", "manuscript"):
            bucket_catalog_authenticated += 1
            continue
        if state not in requeue_states:
            bucket_other_state[state] = bucket_other_state.get(state, 0) + 1
            continue
        qf = qdir / f"{citekey}.json"
        if qf.exists():
            bucket_already_queued += 1
            continue
        to_queue.append((citekey, state))

    # Queue (or dry-run-print) — also rotate stale .done siblings (P9).
    queued = 0
    for citekey, state in to_queue:
        if args.dry_run:
            done_present = (qdir / f"{citekey}.done").exists()
            extra = " (will rotate stale .done)" if done_present else ""
            print(f"  [dry-run] would queue {citekey} (current state: {state or 'none'}){extra}")
        else:
            old_kind = _rotate_stale_done(qdir, citekey)
            if old_kind:
                rotated_done.append((citekey, old_kind))
            qf = qdir / f"{citekey}.json"
            qf.write_text(json.dumps({
                "kind": "authenticate",
                "status": "requested",
                "citekey": citekey,
                "requestedAt": _now(),
                "attempts": 0,
            }, indent=2) + "\n")
            print(f"  [queued] {citekey} (was: {state or 'none'})")
        queued += 1

    # P17: clear bucket-style summary.
    print()
    print("Plan:" if args.dry_run else "Done:")
    if to_queue:
        bucket_breakdown = ", ".join(
            f"{n} {s or 'no-state'}"
            for s, n in sorted(
                {st: sum(1 for _, x in to_queue if x == st) for _, st in to_queue}.items(),
                key=lambda kv: -kv[1],
            )
        )
        verb = "will be queued" if args.dry_run else "queued"
        print(f"  {len(to_queue)} {verb} ({bucket_breakdown})")
    if restamped:
        verb = "to re-stamp" if args.dry_run else "re-stamped"
        print(f"  {restamped} {verb} from catalog (master.bib comment missing/stale)")
    if rotated_done:
        print(f"  {len(rotated_done)} stale .done sibling(s) rotated out of the way")
    if bucket_terminal:
        print(f"  {bucket_terminal} terminal (authenticated/manuscript) — left alone")
    if bucket_catalog_authenticated:
        print(f"  {bucket_catalog_authenticated} authenticated in catalog only — left alone")
    if bucket_other_state:
        flag_hint = ""
        if "unverified" in bucket_other_state and not (args.include_unverified or args.all):
            flag_hint += " (use --include-unverified or --all to re-queue)"
        if "failed" in bucket_other_state and not (args.include_failed or args.all):
            flag_hint += " (use --include-failed or --all to re-queue)"
        breakdown = ", ".join(f"{n} {s}" for s, n in sorted(bucket_other_state.items()))
        print(f"  {sum(bucket_other_state.values())} in other states ({breakdown}){flag_hint}")
    if bucket_already_queued:
        print(f"  {bucket_already_queued} already in queue — left alone")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
