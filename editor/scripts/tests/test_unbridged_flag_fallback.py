#!/usr/bin/env python3
r"""Registry-parity pins for `list_requests.py`'s unbridged-flag fallback.

The fallback surfaces `aiRequest: true` cards that never got a bridged
`ai-requests.json` entry (pre-bridge libraries or a best-effort bridge-write
failure). Its wire kind + panel per card kind come from the registry-derived
manifest `ai_request_routing.json`, joined with the Python `STORAGE_ADAPTER`.

Pins the drops the pre-manifest hand-kept `PANEL_FILES` had:
  1. notes.json list_key was "notes" but the real key is "cards" → the whole
     note/highlight fallback was DEAD (0 rows ever). Now note + highlight both
     surface, each with its own wire kind (note→note, highlight→highlight).
  2. reports had NO fallback row → an unbridged report-request flag was dropped.
     Now it surfaces as kind "report".
  3. cutter/revisions surface only the `comment` subkind (suggestion cards bear
     no aiRequest) as kind "suggestion" — the frozen bridge wire token.
  4. A BRIDGED flag is never duplicated (dedupe on (panel, cardId)).
  5. STORAGE_ADAPTER covers EXACTLY the manifest's flag-bearing kinds (so a new
     registry kind can't ship without a storage row).

Run from anywhere:  python3 editor/scripts/tests/test_unbridged_flag_fallback.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

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


def make_doc(sidecars: dict, ai_requests=None):
    """A minimal Virgil doc folder: a .tex + the given virgil/ sidecars."""
    d = Path(tempfile.mkdtemp(prefix="unbridged-"))
    (d / "document.tex").write_text(
        "\\documentclass{article}\n\\begin{document}\nx\n\\end{document}\n"
    )
    v = d / "virgil"
    v.mkdir()
    for name, data in sidecars.items():
        (v / name).write_text(json.dumps(data, indent=2))
    (v / "ai-requests.json").write_text(
        json.dumps({"requests": ai_requests or []}, indent=2)
    )
    return d


def list_rows(doc):
    r = subprocess.run(
        [sys.executable, LIST, str(doc)],
        capture_output=True, text=True, env=dict(os.environ),
    )
    assert r.returncode == 0, f"list_requests failed: {r.stderr}"
    return [
        json.loads(line)
        for line in r.stdout.splitlines()
        if line.strip().startswith("{")
    ]


def row_by_id(rows, rid):
    matches = [r for r in rows if r["id"] == rid]
    return matches[0] if matches else {}


print("\n=== notes.json: a flagged NOTE and HIGHLIGHT both surface (was dead) ===")
doc = make_doc({
    "notes.json": {"cards": [
        {"id": "nA", "kind": "note", "title": "Check this claim", "aiRequest": True,
         "createdAt": "2026-01-01T00:00:00.000Z", "links": []},
        {"id": "hB", "kind": "highlight", "title": "", "aiRequest": True,
         "createdAt": "2026-01-01T00:00:00.000Z", "links": []},
        {"id": "nC", "kind": "note", "title": "unflagged", "links": []},
    ]},
})
rows = list_rows(doc)
note_row = row_by_id(rows, "virtual:notes:nA")
hl_row = row_by_id(rows, "virtual:notes:hB")
check(note_row.get("kind") == "note", "flagged note surfaces as kind 'note'")
check(note_row.get("text") == "Check this claim", "note row text is its title")
check(hl_row.get("kind") == "highlight",
      "flagged highlight surfaces as kind 'highlight' (own wire kind, not 'note')")
check(hl_row.get("linkedTo") == {"panel": "notes", "cardId": "hB"},
      "highlight linkedTo panel is 'notes' (shared sidecar)")
check(not any(r["id"] == "virtual:notes:nC" for r in rows),
      "an unflagged note is not surfaced")

print("\n=== reports.json: an unbridged report-request flag surfaces (was dropped) ===")
doc = make_doc({
    "reports.json": {"cards": [
        {"id": "rr1", "kind": "report-request", "text": "Summarize the lit",
         "aiRequest": True, "createdAt": "2026-01-01T00:00:00.000Z", "links": []},
        {"id": "rep1", "kind": "report", "title": "A report", "text": "body",
         "aiRequest": True, "links": []},  # a 'report' bears no routing → ignored
    ]},
})
rows = list_rows(doc)
rr = row_by_id(rows, "virtual:reports:rr1")
check(rr.get("kind") == "report", "report-request surfaces as kind 'report'")
check(rr.get("text") == "Summarize the lit", "report-request text is its `text`")
check(not any(r["id"] == "virtual:reports:rep1" for r in rows),
      "a plain 'report' card (no routing) is never surfaced, even if flagged")

print("\n=== cutter/revisions: only the comment subkind, as kind 'suggestion' ===")
doc = make_doc({
    "cutter.json": {"cards": [
        {"id": "cc1", "kind": "comment", "text": "cut this?", "aiRequest": True,
         "createdAt": "2026-01-01T00:00:00.000Z", "links": []},
        {"id": "cs1", "kind": "suggestion", "text": "a cut", "aiRequest": True, "links": []},
    ]},
    "revisions.json": {"cards": [
        {"id": "rc1", "kind": "comment", "text": "rewrite?", "aiRequest": True,
         "createdAt": "2026-01-01T00:00:00.000Z", "links": []},
    ]},
})
rows = list_rows(doc)
cc = row_by_id(rows, "virtual:cutter:cc1")
rc = row_by_id(rows, "virtual:revisions:rc1")
check(cc.get("kind") == "suggestion", "cutter comment surfaces as kind 'suggestion'")
check(rc.get("kind") == "suggestion", "revision comment surfaces as kind 'suggestion'")
check(not any(r["id"] == "virtual:cutter:cs1" for r in rows),
      "a cutter SUGGESTION card (no routing) is never surfaced")

print("\n=== dedupe: a BRIDGED flag is not duplicated by the fallback ===")
doc = make_doc(
    {"notes.json": {"cards": [
        {"id": "nD", "kind": "note", "title": "bridged note", "aiRequest": True,
         "createdAt": "2026-01-01T00:00:00.000Z", "links": []},
    ]}},
    ai_requests=[{
        "id": "req-x", "kind": "note", "text": "bridged note",
        "createdAt": "2026-01-01T00:00:00.000Z", "status": "pending",
        "linkedTo": {"panel": "notes", "cardId": "nD"},
    }],
)
rows = list_rows(doc)
check(not any(r["id"] == "virtual:notes:nD" for r in rows),
      "no virtual row when the note flag is already bridged")
check(sum(1 for r in rows if r.get("kind") == "note") == 1,
      "exactly one note row (the bridged one) surfaces")

print("\n=== manifest/adapter key parity ===")
manifest = json.loads((SCRIPTS / "ai_request_routing.json").read_text())["routing"]
# Import the adapter without running main.
sys.path.insert(0, str(SCRIPTS))
import list_requests as LR  # noqa: E402
check(set(manifest.keys()) == set(LR.STORAGE_ADAPTER.keys()),
      "STORAGE_ADAPTER covers EXACTLY the manifest's flag-bearing kinds")
check(
    all(LR.STORAGE_ADAPTER[k]["file"].endswith(".json") for k in LR.STORAGE_ADAPTER),
    "every adapter row names a .json sidecar",
)

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
