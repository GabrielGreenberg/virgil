#!/usr/bin/env python3
r"""Test the #55b unbridged-flag fallback for footnotes in `list_requests.py`.

A footnote AI request is ALWAYS bridged into `ai-requests.json` on toggle (with
its anchoring `paragraphIds`), so the unified queue is the primary drain path.
But the bridge is best-effort — it swallows I/O errors. Before #55b, "footnotes"
was absent from `list_requests.py`'s `PANEL_FILES`, so a failed bridge write
SILENTLY DROPPED the request (the only other flag source, the panel fallback,
didn't cover footnotes). #55b added the footnote row to that fallback so the
request still surfaces to the drain.

This pins:
  1. An `aiRequest: true` footnote with NO matching ai-requests entry surfaces as
     a virtual `kind: "footnote"` row (the bridge-failed / pre-bridge case).
  2. The virtual row's `text` is the body flattened from rich JSONContent (not a
     raw JSON blob, not "<footnotes card>").
  3. When the footnote IS bridged (a matching ai-requests entry exists), NO
     duplicate virtual row is emitted — the bridged row wins (dedupe).
  4. A footnote WITHOUT the flag emits nothing.

Run from anywhere:  python3 editor/scripts/tests/test_footnote_flag_fallback.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# repo root = tests/ -> scripts/ -> editor/ -> <root>
ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
LIST = str(SCRIPTS / "list_requests.py")

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def make_doc(footnotes, ai_requests=None):
    """A minimal Virgil doc folder: a .tex + virgil/ sidecars."""
    d = Path(tempfile.mkdtemp(prefix="fn55b-"))
    (d / "document.tex").write_text("\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n")
    v = d / "virgil"
    v.mkdir()
    (v / "footnotes.json").write_text(json.dumps({"footnotes": footnotes}, indent=2))
    (v / "ai-requests.json").write_text(json.dumps({"requests": ai_requests or []}, indent=2))
    return d


def list_rows(doc):
    r = subprocess.run(
        [sys.executable, LIST, str(doc)],
        capture_output=True, text=True, env=dict(os.environ),
    )
    assert r.returncode == 0, f"list_requests failed: {r.stderr}"
    return [json.loads(line) for line in r.stdout.splitlines() if line.strip().startswith("{")]


RICH_BODY = {
    "type": "doc",
    "content": [
        {"type": "paragraph", "content": [
            {"type": "text", "text": "See "},
            {"type": "text", "text": "Grafton 1997", "marks": [{"type": "italic"}]},
            {"type": "text", "text": " for the long history."},
        ]},
    ],
}


print("\n=== #55b: an unbridged footnote flag surfaces as a virtual footnote row ===")
doc = make_doc([
    {"id": "fnAAAA", "aiRequest": True, "content": RICH_BODY, "createdAt": "2026-01-01T00:00:00.000Z"},
])
rows = list_rows(doc)
fn_rows = [r for r in rows if r["id"] == "virtual:footnotes:fnAAAA"]
check(len(fn_rows) == 1, "exactly one virtual:footnotes:fnAAAA row emitted")
row = fn_rows[0] if fn_rows else {}
check(row.get("kind") == "footnote", "virtual row kind == 'footnote' (routes to /editor/draft-footnote)")
check(row.get("source") == "card-flag", "virtual row source == 'card-flag'")
check(row.get("linkedTo") == {"panel": "footnotes", "cardId": "fnAAAA"},
      "virtual row linkedTo points at the footnote (act-on-existing path)")
check("Grafton 1997" in (row.get("text") or "") and "long history" in (row.get("text") or ""),
      "virtual row text is the rich body FLATTENED to plain text")
check("{" not in (row.get("text") or ""), "virtual row text is NOT a raw JSON blob")
check(row.get("text") != "<footnotes card>", "virtual row text is NOT the empty-summary placeholder")

print("\n=== #55b: a BRIDGED footnote flag is NOT duplicated by the fallback ===")
doc = make_doc(
    [{"id": "fnBBBB", "aiRequest": True, "content": RICH_BODY, "createdAt": "2026-01-01T00:00:00.000Z"}],
    ai_requests=[{
        "id": "req-1", "kind": "footnote", "text": "Grafton 1997 …",
        "createdAt": "2026-01-01T00:00:00.000Z", "status": "pending",
        "paragraphIds": ["6607"],
        "linkedTo": {"panel": "footnotes", "cardId": "fnBBBB"},
    }],
)
rows = list_rows(doc)
virtual = [r for r in rows if r["id"] == "virtual:footnotes:fnBBBB"]
bridged = [r for r in rows if r.get("source") == "ai-requests" and r.get("kind") == "footnote"]
check(len(virtual) == 0, "no virtual row when the footnote flag is already bridged (dedupe)")
check(len(bridged) == 1, "the bridged ai-requests row is the one that surfaces")
check(bridged[0].get("paragraphIds") == ["6607"],
      "the bridged row carries paragraphIds (drainable — the primary path)")

print("\n=== #55b: a footnote WITHOUT the flag surfaces nothing ===")
doc = make_doc([
    {"id": "fnCCCC", "content": RICH_BODY, "createdAt": "2026-01-01T00:00:00.000Z"},
])
rows = list_rows(doc)
check(not any(r["id"] == "virtual:footnotes:fnCCCC" for r in rows),
      "an unflagged footnote is not surfaced as a request")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
