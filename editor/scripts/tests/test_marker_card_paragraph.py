#!/usr/bin/env python3
r"""Task 1418 — a marker-anchored card's paragraph is answered by ONE door.

A footnote / citation / example card carries no `links`: its paragraph is the
one holding its `\vfid{}` / `\vcid{}` / `\vexid{}` marker in the .tex. The
drain and the create door used to ask only the links half
(`card_paragraph_ids`), so for every footnote they answered `[]`:

  1. an unbridged flagged footnote's virtual row carried `paragraphIds: []`;
  2. `create_card` on `virtual:footnotes:<id>` with no `--anchor` refused
     (`--anchor <uuid> is required …`), so a findings ask re-routed to a
     report could not land;
  3. a bridged footnote row's live refresh fell back to its bridge-time
     snapshot, so a footnote moved to another paragraph kept the OLD one.

All three now read `_common.CardLocator`.

Run from anywhere:  python3 editor/scripts/tests/test_marker_card_paragraph.py
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
sys.path.insert(0, str(SCRIPTS))

from _common import CardLocator  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def tex(marker_para: str) -> str:
    """Two paragraphs; the footnote marker sits in `marker_para`."""
    a = "First claim\\vfid{f0ac}\\footnote{A note.} here." if marker_para == "aa11" else "First claim here."
    b = "Second claim\\vfid{f0ac}\\footnote{A note.} here." if marker_para == "bb22" else "Second claim here."
    return ("\\documentclass{article}\n\\begin{document}\n\n"
            f"{a} %!v:aa11\n\n{b} %!v:bb22\n\n\\end{{document}}\n")


def footnote(flag: bool) -> dict:
    fn = {"id": "f0ac", "content": {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "Check this quote against the source."}]}]}}
    if flag:
        fn["aiRequest"] = True
    return fn


def make_doc(marker_para: str, *, flag: bool, requests: list | None = None) -> Path:
    d = Path(tempfile.mkdtemp(prefix="marker-card-para-"))
    (d / "document.tex").write_text(tex(marker_para))
    v = d / "virgil"
    v.mkdir()
    (v / "footnotes.json").write_text(json.dumps({"footnotes": [footnote(flag)]}, indent=2))
    (v / "ai-requests.json").write_text(json.dumps({"requests": requests or []}, indent=2))
    return d


def run(script: str, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / script), *map(str, args)],
                          capture_output=True, text=True, env=dict(os.environ))


def rows(doc: Path) -> list[dict]:
    r = run("list_requests.py", doc)
    assert r.returncode == 0, r.stderr
    return [json.loads(l) for l in r.stdout.splitlines() if l.strip().startswith("{")]


def row(doc: Path, rid: str) -> dict | None:
    return next((r for r in rows(doc) if r["id"] == rid), None)


print("\n=== CardLocator: links half and marker half ===")
doc = make_doc("bb22", flag=False)
loc = CardLocator(doc)
check(loc.paragraph_ids(footnote(False), "footnotes") == ["bb22"],
      "a footnote's paragraph is its \\vfid marker's")
linked = {"id": "n1", "links": [{"anchor": {"type": "textObject", "textObjectIds": ["aa11"]}}]}
check(loc.paragraph_ids(linked, "notes") == ["aa11"], "a link-anchored card's paragraph is its link's")
check(loc.paragraph_ids({"id": "zzzz"}, "footnotes") == [], "an unplaced marker id locates nothing")

print("\n=== member 1: an unbridged flagged footnote's virtual row ===")
doc = make_doc("aa11", flag=True)
r = row(doc, "virtual:footnotes:f0ac")
check(r is not None and r.get("paragraphIds") == ["aa11"],
      f"virtual row carries the marker's paragraph (got {r and r.get('paragraphIds')})")

print("\n=== member 3: a bridged footnote row follows its moved marker ===")
bridged = {"id": "11111111-1111-4111-8111-111111111111", "kind": "footnote",
           "text": "Check this quote", "status": "pending",
           "createdAt": "2026-11-01T00:00:00.000Z", "paragraphIds": ["aa11"],
           "linkedTo": {"panel": "footnotes", "cardId": "f0ac"}}
doc = make_doc("bb22", flag=True, requests=[bridged])
r = row(doc, bridged["id"])
check(r is not None and r.get("paragraphIds") == ["bb22"],
      f"live paragraphIds is the NEW paragraph, not the bridge-time snapshot (got {r and r.get('paragraphIds')})")
check(row(doc, "virtual:footnotes:f0ac") is None, "the bridged flag is not also surfaced as virtual")

print("\n=== member 2: the door inherits the marker's paragraph for a virtual id ===")
doc = make_doc("bb22", flag=True)
body = doc / "body.txt"
body.write_text("The quote matches page 12 of the 1697 edition.")
res = run("create_card.py", doc, "virtual:footnotes:f0ac", "--kind=report",
          "--accept-task-kind", "footnote", "--body", f"@{body}")
check(res.returncode == 0, f"report re-route lands with no --anchor (stderr: {res.stderr.strip()[:200]})")
reports = json.loads((doc / "virgil/reports.json").read_text()) if (doc / "virgil/reports.json").exists() else {}
cards = reports.get("cards") or reports.get("reports") or []
anchors = [l["anchor"]["textObjectIds"] for c in cards for l in c.get("links", [])]
check(anchors == [["bb22"]], f"the report is anchored at the marker's paragraph (got {anchors})")
fns = json.loads((doc / "virgil/footnotes.json").read_text())["footnotes"]
check(not fns[0].get("aiRequest"), "the footnote's flag is lowered")

print("\n=== the door's inheritance follows a moved marker for a bridged Task too ===")
doc = make_doc("bb22", flag=True, requests=[dict(bridged)])
body = doc / "body.txt"
body.write_text("Findings.")
res = run("create_card.py", doc, bridged["id"], "--kind=report",
          "--accept-task-kind", "footnote", "--body", f"@{body}")
check(res.returncode == 0, f"bridged report re-route lands (stderr: {res.stderr.strip()[:200]})")
reports = json.loads((doc / "virgil/reports.json").read_text()) if (doc / "virgil/reports.json").exists() else {}
cards = reports.get("cards") or reports.get("reports") or []
anchors = [l["anchor"]["textObjectIds"] for c in cards for l in c.get("links", [])]
check(anchors == [["bb22"]], f"anchored at the marker's CURRENT paragraph (got {anchors})")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
