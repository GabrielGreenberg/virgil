"""Drain ~/Virgil-Library/queue/ — process all index/reindex entries.

Walks `queue/*.json`, groups by citekey, and processes each entry by
shelling out to `index_paper.py`. Updates queue file states (.done /
.failed / .poisoned) on the way. Prints a per-entry classified summary
at the end.

Out of scope (skipped, with a note): `bib-edit`, `triage`, `authenticate`
kinds — those are handled by their respective skill prompts. Run this
script first; rerun the skills afterwards for the remaining kinds.

Usage:
  python3 drain_queue.py [--library ~/Virgil-Library]
  python3 drain_queue.py --max 20  # cap entries per run
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import unlink_tolerant  # noqa: E402


SCRIPT_DIR = Path(__file__).resolve().parent
LOCK_TTL_SECONDS = 60 * 60  # ignore stale locks older than 1h

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
# so the caller (skill) can dispatch them.
NATIVE_KINDS = {"index", "reindex"}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_catalog(library: Path) -> dict:
    p = library / ".virgil" / "catalog.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"entries": []}


def _is_lock_stale(lock_path: Path) -> bool:
    if not lock_path.exists():
        return True
    try:
        age = time.time() - lock_path.stat().st_mtime
    except FileNotFoundError:
        return True
    return age > LOCK_TTL_SECONDS


def _peek_kind(p: Path) -> str:
    """Read just the `kind` field from a queue JSON. Returns '' on failure."""
    try:
        return json.loads(p.read_text()).get("kind", "") or ""
    except Exception:
        return ""


def _list_pending(library: Path, skip_counts: Optional[dict[str, int]] = None) -> list[dict[str, Any]]:
    """Return queue entries ready to process. Mutates `skip_counts` in
    place (when provided) with reasons entries were skipped, so the caller
    can surface them in the summary."""
    qdir = library / ".virgil" / "queue"
    if not qdir.exists():
        return []
    if skip_counts is None:
        skip_counts = {}
    out: list[dict[str, Any]] = []
    for p in sorted(qdir.glob("*.json")):
        if p.name.endswith(".done.json"):
            continue
        # P8: kind-aware .done skip. A stale .done from a prior `index` run
        # should NOT block a new `authenticate` queue entry for the same
        # citekey. Rotate the stale .done out of the way so this entry
        # gets processed.
        done_sibling = p.with_suffix(".done")
        if done_sibling.exists():
            done_kind = _peek_kind(done_sibling)
            new_kind = _peek_kind(p)
            if done_kind and new_kind and done_kind == new_kind:
                # Same kind already done — genuinely already processed.
                skip_counts["already-done"] = skip_counts.get("already-done", 0) + 1
                continue
            # Different kind (or unparseable .done) — rotate.
            rotated = qdir / f"{p.stem}.{done_kind or 'unknown'}.done"
            try:
                done_sibling.rename(rotated)
            except OSError:
                # A fallback that can itself raise is not a fallback (496).
                unlink_tolerant(done_sibling, what="superseded .done")
            skip_counts["rotated-done"] = skip_counts.get("rotated-done", 0) + 1
        # Skip if .lock sibling is fresh.
        lock_sibling = p.with_suffix(".lock")
        if lock_sibling.exists() and not _is_lock_stale(lock_sibling):
            skip_counts["locked"] = skip_counts.get("locked", 0) + 1
            continue
        try:
            data = json.loads(p.read_text())
        except Exception as e:
            out.append({"_path": p, "_error": str(e), "kind": "?"})
            continue
        if data.get("status") == "poisoned":
            skip_counts["poisoned"] = skip_counts.get("poisoned", 0) + 1
            continue
        data["_path"] = p
        out.append(data)
    return out


def _sort_key(entry: dict) -> tuple:
    citekey = entry.get("citekey", "")
    kind = entry.get("kind", "")
    return (citekey, KIND_PRIORITY.get(kind, 99))


def _bump_attempts(entry_path: Path, error: str) -> int:
    """Read entry, increment attempts, write back. Returns new attempts count."""
    try:
        data = json.loads(entry_path.read_text())
    except Exception:
        data = {}
    attempts = int(data.get("attempts", 0)) + 1
    data["attempts"] = attempts
    data["status"] = "failed" if attempts < 3 else "poisoned"
    data["lastError"] = error[:1000]
    data["lastAttemptAt"] = _now()
    entry_path.write_text(json.dumps(data, indent=2) + "\n")
    return attempts


def _mark_done(entry_path: Path) -> None:
    """Replace queue file with `.done` sibling.

    The `.done` WRITE is what retires the entry — `_list_pending` skips a
    queue file whose same-kind `.done` sibling exists — so the unlink is
    tidiness, and a mount that refuses it must not raise out of a drain that
    has already completed the work (task 496). Left behind, the entry file is
    inert: the `.done` sibling keeps it out of the next pass.
    """
    done = entry_path.with_suffix(".done")
    try:
        done.write_text(entry_path.read_text())
    except Exception:
        done.write_text("")
    unlink_tolerant(entry_path, what="retired queue entry")


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
            "citekey": citekey,
            "kind": kind,
            "status": "skipped-non-native",
            "summary": f"{kind!r} not handled by drain_queue; needs skill",
        }

    if not citekey:
        return {"kind": kind, "status": "error", "summary": "missing citekey"}

    # Lock.
    lock = path.with_suffix(".lock")
    lock.write_text(_now())
    try:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT_DIR / "index_paper.py"), citekey,
             "--library", str(library)],
            capture_output=True, text=True, timeout=600, check=False,
        )
        if proc.returncode == 0:
            symbol, desc = _classify_entry(library, citekey)
            _mark_done(path)
            return {
                "citekey": citekey,
                "kind": kind,
                "status": "ok",
                "symbol": symbol,
                "summary": desc,
            }
        else:
            err = (proc.stderr or proc.stdout or "").strip()[-1000:]
            attempts = _bump_attempts(path, err)
            return {
                "citekey": citekey,
                "kind": kind,
                "status": "poisoned" if attempts >= 3 else "failed",
                "symbol": "X",
                "summary": err.splitlines()[-1] if err else "non-zero exit",
            }
    except subprocess.TimeoutExpired:
        _bump_attempts(path, "timeout")
        return {"citekey": citekey, "kind": kind, "status": "failed",
                "symbol": "X", "summary": "timeout (10m)"}
    finally:
        # A finally-positioned delete must never replace the entry's own
        # result with an OSError (task 496); the lock is stale-timeout'd
        # anyway (`_is_lock_stale`), so a leftover self-clears.
        unlink_tolerant(lock, what="queue lock")


def main() -> int:
    p = argparse.ArgumentParser(description="Drain ~/Virgil-Library/queue/ in batch.")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    p.add_argument("--max", type=int, default=0,
                   help="Cap the number of native entries processed (0 = no cap)")
    args = p.parse_args()
    library = Path(args.library).expanduser()

    skip_counts: dict[str, int] = {}
    pending = _list_pending(library, skip_counts=skip_counts)
    rotated = skip_counts.get("rotated-done", 0)
    if rotated:
        print(f"  (rotated {rotated} stale .done sibling(s) out of the way)")
    if not pending:
        already_done = skip_counts.get("already-done", 0)
        if already_done:
            print(f"queue empty ({already_done} entries skipped — same kind already done)")
        else:
            print("queue empty")
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
            print(f"  [defer]  {citekey:30s} kind={result['kind']!r} (skill needed)")
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
        skip_extras.append(f"{skip_counts['already-done']} same-kind already done")
    if skip_counts.get("locked"):
        skip_extras.append(f"{skip_counts['locked']} locked (in-flight elsewhere)")
    if skip_counts.get("poisoned"):
        skip_extras.append(f"{skip_counts['poisoned']} poisoned (max attempts exceeded)")
    if skip_extras:
        print("  (skipped: " + ", ".join(skip_extras) + ")")

    if deferred:
        print("\nRemaining (need skill dispatch):")
        for r in deferred:
            print(f"  - {r['kind']} for {r.get('citekey','?')}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
