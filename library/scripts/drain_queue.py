"""Drain ~/Virgil-Library/queue/ — process all index/reindex entries.

Walks `queue/*.json`, groups by citekey, and processes each entry by
shelling out to `index_paper.py`. Each entry is CLAIMED first (`status:
running`, `queue_slot.claim_request` — task 1291) and retired/released only
while the slot still holds that request, so one the user queues mid-run is
never retired unworked. Updates queue file states (.done / failed /
poisoned) on the way. Prints a per-entry classified summary
at the end.

Out of scope (skipped, with a note): every kind but `index`/`reindex`
(`queue_slot.DRAIN_NATIVE_KINDS`) — those are handled by their respective
skill prompts (index-pending.md step 2). Run this script first; rerun the
skills afterwards for the remaining kinds. What counts as a queue entry at
all is `queue_slot.request_files` (task 794).

Usage:
  python3 drain_queue.py [--library ~/Virgil-Library]
  python3 drain_queue.py --max 20  # cap entries per run
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from queue_slot import (  # noqa: E402
    CLAIMABLE_STATUSES,
    DRAIN_NATIVE_KINDS,
    RUNNING_STATUS,
    claim_request,
    done_retires,
    is_in_flight,
    normalize_kind,
    release_claimed,
    request_files,
    retire_claimed,
    retire_done,
)


SCRIPT_DIR = Path(__file__).resolve().parent

# Within-citekey processing order.
KIND_PRIORITY = {
    "bib-edit": 0,
    "authenticate": 1,
    "index": 2,
    "reindex": 2,
    "deepIndex": 4,
    # Legacy alias from before the rich-index → deep-index rename. Old
    # queue files may still use this kind; treat them at the same priority.
    "richIndex": 4,
    "triage": 5,
}

# Kinds this script processes natively. Others get reported and skipped
# so the caller (skill) can dispatch them. Owned by `queue_slot` so the
# skill's `queue_slot.py pending --native` poll counts the same set.
NATIVE_KINDS = set(DRAIN_NATIVE_KINDS)

# Statuses the drain works: a fresh request, and a failed one it retries
# (`release_claimed` poisons it on the third failure) — `queue_slot`'s
# CLAIMABLE set, plus an ABANDONED claim (`running` past its TTL). A live
# `running` claim is in flight elsewhere, `poisoned` is given up on — both
# are skipped and counted.
WORK_STATUSES = CLAIMABLE_STATUSES


def _read_catalog(library: Path) -> dict:
    # The one door (task 893): a malformed catalog refuses, never reads empty.
    from _tools import read_catalog
    return read_catalog(library)


def _peek_kind(p: Path) -> str:
    """Read just the `kind` field from a queue JSON. Returns '' on failure."""
    try:
        return json.loads(p.read_text()).get("kind", "") or ""
    except Exception:
        return ""


def _list_pending(library: Path, skip_counts: Optional[dict[str, int]] = None) -> list[dict[str, Any]]:
    """Return queue entries ready to process. Mutates `skip_counts` in
    place (when provided) with reasons entries were skipped, so the caller
    can surface them in the summary.

    Which files are requests at all is `queue_slot.request_files` (task 794):
    the `pending-reviews.json` manifest and `*.done.json` markers are never
    entries."""
    qdir = library / ".virgil" / "queue"
    if skip_counts is None:
        skip_counts = {}

    def skip(reason: str) -> None:
        skip_counts[reason] = skip_counts.get(reason, 0) + 1

    out: list[dict[str, Any]] = []
    for p in request_files(qdir):
        # A `.done` sibling is either the retirement of THIS request (its
        # entry unlink was refused — genuinely done) or a stale marker from an
        # EARLIER request in the same slot, which must never hide a new one
        # (task 618). Writers retire stale markers on write (`queue_slot`);
        # this is the belt for any file that arrived another way.
        done_sibling = p.with_suffix(".done")
        if done_sibling.exists():
            if done_retires(p, done_sibling):
                skip("already-done")
                continue
            if retire_done(qdir, p.stem):
                skip("rotated-done")
        try:
            data = json.loads(p.read_text())
        except Exception as e:
            out.append({"_path": p, "_error": str(e), "kind": "?"})
            continue
        if not isinstance(data, dict):
            out.append({"_path": p, "_error": "not a JSON object", "kind": "?"})
            continue
        status = data.get("status")
        if status == "poisoned":
            skip("poisoned")
            continue
        if is_in_flight(data):
            skip("running")
            continue
        if status not in WORK_STATUSES and status != RUNNING_STATUS:
            skip("other-status")
            continue
        if not data.get("kind"):
            out.append({"_path": p, "_error": "entry has no `kind`", "kind": "?"})
            continue
        data["kind"] = normalize_kind(str(data["kind"]))
        data["_path"] = p
        out.append(data)
    return out


def _sort_key(entry: dict) -> tuple:
    citekey = entry.get("citekey", "")
    kind = entry.get("kind", "")
    return (citekey, KIND_PRIORITY.get(kind, 99))


def _classify_entry(library: Path, citekey: str) -> tuple[str, str]:
    """Return (symbol, description) classifying the entry's bib state.

    Symbols match the index-pending summary table:
      ' ' indexed OK; 'M' manuscript; 'C' canonical (pre-digital classic);
      '?' unverified-with-DOI; '!' unverified-no-DOI; 'X' failed.
    """
    # NFC-insensitive row lookup (the `citekey_matches` SSOT); lazy import
    # keeps this standalone script's module-level dependency shape unchanged.
    from _tools import citekey_matches  # noqa: PLC0415
    catalog = _read_catalog(library)
    entry = next(
        (e for e in catalog.get("entries", [])
         if citekey_matches(e.get("citekey", ""), citekey)),
        None,
    )
    if not entry:
        return "X", "no catalog entry after run"
    bib = entry.get("bib", {}) or {}
    state = bib.get("state", "")
    has_doi = bool(entry.get("doi") or bib.get("doiVerified"))
    if state == "authenticated":
        return " ", "authenticated"
    if state == "manuscript":
        return "M", "manuscript (no DOI expected)"
    if state == "canonical":
        return "C", "canonical (pre-digital classic; no external registry)"
    if state == "unverified" and has_doi:
        return "?", "unverified — DOI present, auth conservative"
    if state == "unverified":
        return "!", "unverified — no DOI, needs manual review"
    if state == "failed":
        return "X", bib.get("note") or "failed"
    return "X", f"state={state!r}"


def _process_one(entry: dict, library: Path) -> dict:
    """Run one queue entry. Returns a result dict."""
    path = entry["_path"]
    kind = entry.get("kind", "")
    citekey = entry.get("citekey", "")

    if kind not in NATIVE_KINDS:
        return {
            # A triage stub has no citekey; name it by its unsorted file.
            "citekey": citekey or entry.get("filename", "") or path.name,
            "kind": kind,
            "status": "skipped-non-native",
            # A user note routes the request to /library/ai-requests
            # (index-pending.md step 2, ai-requests.md "What counts").
            "noted": bool(str(entry.get("note") or "").strip()),
            "summary": f"{kind!r} not handled by drain_queue; needs skill",
        }

    if not citekey:
        return {"kind": kind, "status": "error", "summary": "missing citekey"}

    # Claim (task 1291): the slot reads `running` while we work it, so
    # neither writer replaces it, and retirement below touches only the
    # request we claimed — one queued mid-run stays queued.
    claimed = claim_request(path)
    if claimed is None:
        return {"citekey": citekey, "kind": kind, "status": "skipped-claimed",
                "summary": "claimed by another worker"}
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT_DIR / "index_paper.py"), citekey,
             "--library", str(library)],
            capture_output=True, text=True, timeout=600, check=False,
        )
    except subprocess.TimeoutExpired:
        status = release_claimed(path, claimed, "timeout")
        return {"citekey": citekey, "kind": kind,
                "status": status or "failed", "symbol": "X",
                "summary": "timeout (10m)" + _superseded_note(status)}
    if proc.returncode == 0:
        symbol, desc = _classify_entry(library, citekey)
        retired = retire_claimed(path, claimed)
        return {
            "citekey": citekey,
            "kind": kind,
            "status": "ok",
            "symbol": symbol,
            "summary": desc + ("" if retired else
                               " (a newer request arrived mid-run; left queued)"),
        }
    err = (proc.stderr or proc.stdout or "").strip()[-1000:]
    status = release_claimed(path, claimed, err)
    return {
        "citekey": citekey,
        "kind": kind,
        "status": status or "failed",
        "symbol": "X",
        "summary": (err.splitlines()[-1] if err else "non-zero exit")
        + _superseded_note(status),
    }


def _superseded_note(status: Optional[str]) -> str:
    return "" if status is not None else " (a newer request arrived mid-run; left queued)"


from _library_root import library_root_or_exit  # noqa: E402  (task 896)


def main() -> int:
    p = argparse.ArgumentParser(description="Drain ~/Virgil-Library/queue/ in batch.")
    p.add_argument("--library", default=None,
                   help="Library root (default: the one validated resolver, _library_root.py)")
    p.add_argument("--max", type=int, default=0,
                   help="Cap the number of native entries processed (0 = no cap)")
    args = p.parse_args()
    library = library_root_or_exit(args.library)

    skip_counts: dict[str, int] = {}
    pending = _list_pending(library, skip_counts=skip_counts)
    rotated = skip_counts.get("rotated-done", 0)
    if rotated:
        print(f"  (rotated {rotated} stale .done sibling(s) out of the way)")
    if not pending:
        notes = [
            f"{skip_counts[k]} {label}"
            for k, label in (
                ("already-done", "already done"),
                ("running", "running"),
                ("poisoned", "poisoned"),
                ("other-status", "with an unrecognised status"),
            )
            if skip_counts.get(k)
        ]
        print("queue empty" + (f" ({', '.join(notes)} skipped)" if notes else ""))
        return 0

    pending.sort(key=_sort_key)

    counts = {"ok": 0, "failed": 0, "poisoned": 0, "skipped-non-native": 0,
              "M": 0, "?": 0, "!": 0, "X": 0, " ": 0}
    deferred: list[dict] = []  # non-native; surfaced in summary

    native_processed = 0
    for entry in pending:
        if entry.get("_error"):
            print(f"  [error] {entry['_path'].name}: {entry['_error']}")
            counts["failed"] += 1
            continue

        if args.max and native_processed >= args.max and entry.get("kind") in NATIVE_KINDS:
            break

        result = _process_one(entry, library)
        status = result["status"]
        symbol = result.get("symbol", "")
        citekey = result.get("citekey", "?")

        if status == "skipped-non-native":
            counts["skipped-non-native"] += 1
            deferred.append(result)
            noted = " [note]" if result.get("noted") else ""
            print(f"  [defer]  {citekey:30s} kind={result['kind']!r}{noted} (skill needed)")
            continue
        if status == "skipped-claimed":
            # Claimed by a concurrent drain between our listing and our
            # claim — in flight elsewhere, the same as a listed `running`.
            skip_counts["running"] = skip_counts.get("running", 0) + 1
            continue

        native_processed += 1
        counts[status] = counts.get(status, 0) + 1
        if symbol:
            counts[symbol] = counts.get(symbol, 0) + 1

        # Per-entry line, only for non-OK or interesting states.
        if symbol and symbol != " ":
            print(f"  {symbol}  {citekey:30s} {result['summary']}")
        elif status != "ok":
            print(f"  X  {citekey:30s} {result['summary']}")

    # Summary
    total = native_processed
    indexed = counts.get(" ", 0)
    manuscript = counts.get("M", 0)
    unv_doi = counts.get("?", 0)
    unv_nodoi = counts.get("!", 0)
    failed = counts.get("X", 0)
    deferred_n = counts["skipped-non-native"]
    print()
    bits = [f"{indexed} indexed"]
    if manuscript:
        bits.append(f"{manuscript}M manuscript")
    if unv_doi:
        bits.append(f"{unv_doi}? unverified-with-DOI")
    if unv_nodoi:
        bits.append(f"{unv_nodoi}! unverified-no-DOI")
    if failed:
        bits.append(f"{failed}X failed")
    if deferred_n:
        bits.append(f"{deferred_n} deferred-to-skill")
    print(f"Drained {total} entries: " + ", ".join(bits) + ".")
    skip_extras = []
    if skip_counts.get("already-done"):
        skip_extras.append(f"{skip_counts['already-done']} already done")
    if skip_counts.get("poisoned"):
        skip_extras.append(f"{skip_counts['poisoned']} poisoned (max attempts exceeded)")
    if skip_counts.get("running"):
        skip_extras.append(f"{skip_counts['running']} running (in flight elsewhere)")
    if skip_counts.get("other-status"):
        skip_extras.append(f"{skip_counts['other-status']} with an unrecognised status")
    if skip_extras:
        print("  (skipped: " + ", ".join(skip_extras) + ")")

    if deferred:
        print("\nRemaining (need skill dispatch):")
        for r in deferred:
            noted = " [note]" if r.get("noted") else ""
            print(f"  - {r['kind']} for {r.get('citekey','?')}{noted}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
