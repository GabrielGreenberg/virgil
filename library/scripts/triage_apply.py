"""Apply a reviewed triage JSONL: move files, append bib stubs, enqueue indexing.

Reads JSONL from --input (or stdin) where each line is one row produced by
`triage_batch.py` and possibly edited by the operator. For each row:

- `flags: ["whole-handbook"]`  → move file to pdfs/unsorted/_pending/, emit
                                  triage-needs-chapter-info notification, no queue
- `flags: ["variant-copy"]`    → move file to papers/<existingCitekey>/variants/
                                  if existingCitekey set; else fall through to
                                  normal new-paper flow with citekey suffix
- `flags: ["unsupported-ext"]` / `flags: ["error"]` → skip (logged)
- otherwise                    → append @<type>{<citekey>, ...} to master.bib,
                                  move file to pdfs/<citekey>.<ext>, write
                                  queue/<citekey>.json (kind=index)

Bumps catalog-version.txt once at the end so the frontend re-renders. Designed
to be idempotent on the queue side — if the queue file already exists, leaves it.

Usage:
  python3 triage_apply.py --input triage.jsonl [--library ~/Virgil-Library]
  python3 triage_batch.py | python3 triage_apply.py
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _emit_bib_stub(citekey: str, entry_type: str, fields: dict[str, str]) -> str:
    field_lines = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields.items() if v)
    return f"@{entry_type}{{{citekey},\n{field_lines}\n}}\n"


def _append_to_master_bib(library: Path, citekey: str, entry_type: str, fields: dict[str, str]) -> None:
    master = library / "master.bib"
    text = master.read_text() if master.exists() else ""
    if text and not text.endswith("\n"):
        text += "\n"
    text += "\n% bib.state = unverified\n" + _emit_bib_stub(citekey, entry_type, fields)
    master.write_text(text)


def _append_notification(library: Path, item: dict) -> None:
    inbox_path = library / "notifications" / "inbox.json"
    inbox = {"items": []}
    if inbox_path.exists():
        try:
            inbox = json.loads(inbox_path.read_text())
        except Exception:
            pass
    inbox.setdefault("items", []).append(item)
    inbox["items"] = inbox["items"][-200:]
    inbox_path.parent.mkdir(parents=True, exist_ok=True)
    inbox_path.write_text(json.dumps(inbox, indent=2) + "\n")


def _bump_catalog_version(library: Path) -> None:
    p = library / "catalog-version.txt"
    cur = 0
    if p.exists():
        try:
            cur = int(p.read_text().strip() or "0")
        except Exception:
            cur = 0
    p.write_text(str(cur + 1) + "\n")


def _write_queue_entry(library: Path, citekey: str, kind: str = "index") -> bool:
    """Write queue/<citekey>.json. Returns False if already present."""
    qdir = library / "queue"
    qdir.mkdir(parents=True, exist_ok=True)
    qf = qdir / f"{citekey}.json"
    if qf.exists():
        return False
    qf.write_text(json.dumps({
        "kind": kind,
        "status": "requested",
        "citekey": citekey,
        "requestedAt": _now(),
        "attempts": 0,
    }, indent=2) + "\n")
    return True


def _master_has_citekey(library: Path, citekey: str) -> bool:
    master = library / "master.bib"
    if not master.exists():
        return False
    text = master.read_text()
    import re
    return bool(re.search(r"@\w+\s*\{\s*" + re.escape(citekey) + r"\s*,", text))


def apply_row(row: dict[str, Any], library: Path) -> dict[str, str]:
    """Apply one triage row. Returns a result dict with `status` and `summary`."""
    filename = row.get("filename", "")
    flags = row.get("flags", []) or []
    src = library / "pdfs" / "unsorted" / filename
    if not src.exists():
        return {"status": "skipped", "summary": f"{filename}: source missing"}

    ext = row.get("extension") or src.suffix.lstrip(".").lower()

    # ── Whole-handbook: park in _pending, notify, no queue ─────────────
    if "whole-handbook" in flags:
        pending = library / "pdfs" / "unsorted" / "_pending"
        pending.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(pending / filename))
        _append_notification(library, {
            "kind": "triage-needs-chapter-info",
            "filename": filename,
            "candidateAuthor": row.get("filenameAuthor", ""),
            "handbookTitle": next((n for n in row.get("notes", []) if "handbook" in n.lower() or "edited volume" in n.lower()), ""),
            "at": _now(),
        })
        return {"status": "needs-chapter-info", "summary": f"{filename}: parked in _pending/"}

    # ── Variant-copy: archive under existing citekey ───────────────────
    if "variant-copy" in flags:
        existing = row.get("existingCitekey", "")
        if existing:
            variants_dir = library / "papers" / existing / "variants"
            variants_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(variants_dir / filename))
            _append_notification(library, {
                "kind": "triaged",
                "summary": f"Kept {filename} as variant archive of {existing}",
                "at": _now(),
            })
            return {"status": "variant", "summary": f"{filename} → papers/{existing}/variants/"}
        # Fall through with a citekey suffix bump if no existingCitekey.

    # ── Skip rows the batch script flagged as unprocessable ────────────
    if "unsupported-ext" in flags or "error" in flags:
        return {"status": "skipped", "summary": f"{filename}: {','.join(flags)}"}

    # ── Needs-title: park in _pending, notify, no queue ──────────────
    if "needs-title" in flags:
        pending = library / "pdfs" / "unsorted" / "_pending"
        pending.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(pending / filename))
        _append_notification(library, {
            "kind": "triage-needs-title",
            "filename": filename,
            "proposedCitekey": row.get("proposedCitekey", ""),
            "at": _now(),
        })
        return {"status": "needs-title", "summary": f"{filename}: parked in _pending/ (no title extracted)"}

    # ── Normal flow: bib stub + file move + queue ──────────────────────
    citekey = row.get("proposedCitekey", "")
    entry_type = row.get("proposedType") or "article"
    proposed_fields = dict(row.get("proposedFields", {}) or {})

    if not citekey:
        return {"status": "skipped", "summary": f"{filename}: no citekey"}

    # Filename mismatch: append a notification (audit trail).
    if "filename-mismatch" in flags:
        _append_notification(library, {
            "kind": "triage-filename-mismatch",
            "originalFilename": filename,
            "filenameAuthor": row.get("filenameAuthor", ""),
            "contentAuthor": row.get("contentAuthor", ""),
            "newCitekey": citekey,
            "at": _now(),
        })

    # Append bib stub if not already in master.bib.
    if not _master_has_citekey(library, citekey):
        _append_to_master_bib(library, citekey, entry_type, proposed_fields)

    # Move file to pdfs/<citekey>.<ext>.
    pdfs_dir = library / "pdfs"
    pdfs_dir.mkdir(parents=True, exist_ok=True)
    dest = pdfs_dir / f"{citekey}.{ext}"
    if dest.exists():
        # Don't overwrite — return a clear error so the operator can resolve.
        return {"status": "collision", "summary": f"{filename}: {dest.name} already exists"}
    shutil.move(str(src), str(dest))

    # Write queue entry.
    _write_queue_entry(library, citekey, kind="index")
    _append_notification(library, {
        "kind": "triaged",
        "summary": f"Triaged {filename} → {citekey} ({entry_type})",
        "at": _now(),
    })
    return {"status": "triaged", "summary": f"{filename} → {citekey} ({entry_type})"}


def main() -> int:
    p = argparse.ArgumentParser(description="Apply a reviewed triage JSONL.")
    p.add_argument("--input", default="-",
                   help="JSONL input path; '-' for stdin (default)")
    p.add_argument("--library", default=str(Path.cwd()),
                   help="Library root directory (defaults to CWD)")
    args = p.parse_args()

    library = Path(args.library).expanduser()

    if args.input == "-":
        text = sys.stdin.read()
    else:
        text = Path(args.input).expanduser().read_text()

    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError as e:
            print(f"Skipping malformed line: {e}", file=sys.stderr)

    if not rows:
        print("No rows to apply.", file=sys.stderr)
        return 0

    counts: dict[str, int] = {}
    for row in rows:
        try:
            result = apply_row(row, library)
        except Exception as e:
            result = {"status": "error", "summary": f"{row.get('filename','?')}: {e}"}
        status = result["status"]
        counts[status] = counts.get(status, 0) + 1
        print(f"  [{status}] {result['summary']}")

    if counts:
        _bump_catalog_version(library)

    print(f"\nDone. {len(rows)} rows: " + ", ".join(f"{n} {k}" for k, n in sorted(counts.items())))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
