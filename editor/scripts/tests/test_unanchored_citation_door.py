#!/usr/bin/env python3
r"""find-citation lands through the ONE create door (task 1238).

`create_card.py --kind=citation --unanchored --bib-entry @f` builds the card the
user drags into place: its id is ALLOCATED (4-hex, free across the shared
\vfid/\vcid/\vexid namespace) — never agent-invented — because that id becomes
the `\vcid{}` the serializer writes on drop. The `.bib` entry rides the same
atomic op, the `.tex` stays byte-unchanged, and a re-run is a no-op. A todo
handed off by answer-todo-request (`virtual:todos:<id>`) drains through the same
call and lowers the todo's flag.

Runs the real CLI against fresh copies of samples/annotation-history.

Run from anywhere:  python3 editor/scripts/tests/test_unanchored_citation_door.py
"""
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
CREATE = str(SCRIPTS / "create_card.py")
sys.path.insert(0, str(SCRIPTS))

from card_by_id import MARKER_ANCHORED_PANELS  # noqa: E402
import apply_response as AR  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="cit1238-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst, d


def run(*args):
    return subprocess.run([sys.executable, CREATE, *args], capture_output=True, text=True)


def load(sb, name):
    return json.loads((sb / "virgil" / name).read_text())


def tex_digest(sb):
    return hashlib.sha256(next(sb.glob("*.tex")).read_bytes()).hexdigest()


def held_ids(sb):
    """Every id already held by a marker-anchored card, across all its panels."""
    out = set()
    for panel in MARKER_ANCHORED_PANELS:
        filename, key = AR.ALL_CARD_SIDECARS[panel]
        p = sb / "virgil" / filename
        if p.exists():
            out |= {c["id"] for c in json.loads(p.read_text()).get(key, []) if c.get("id")}
    return out


ENTRY = (
    "@book{lessig2006,\n"
    "  author    = {Lawrence Lessig},\n"
    "  title     = {Code: Version 2.0},\n"
    "  publisher = {Basic Books},\n"
    "  year      = {2006},\n"
    "}"
)

# ============================================================ citation Task
print("\n=== citation Task: --unanchored --bib-entry lands an allocated 4-hex card + the .bib entry ===")
sb, tmp = sandbox()
cit = next(r["id"] for r in load(sb, "ai-requests.json")["requests"] if r["kind"] == "citation")
before_ids = held_ids(sb)
before_tex = tex_digest(sb)
entry_file = tmp / "entry.bib"
entry_file.write_text(ENTRY)
summary_file = tmp / "summary"
summary_file.write_text("Added lessig2006 (chose the 2006 edition for verifiability)\n")
r = run(str(sb), cit, "--kind=citation", "--citekey", "lessig2006", "--unanchored",
        "--bib-entry", f"@{entry_file}", "--summary", f"@{summary_file}")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:200]})")
res = json.loads(r.stdout) if r.returncode == 0 else {}
cid = res.get("cardId", "")
check(re.fullmatch(r"[0-9a-f]{4}", cid or "") is not None, f"card id is ALLOCATED 4-hex (got {cid!r})")
check(cid not in before_ids, "id is free across the shared marker namespace")
card = next((c for c in load(sb, "citations.json")["citations"] if c["id"] == cid), None)
check(card is not None and card.get("unanchored") is True, "citations.json gained an unanchored card")
check(card is not None and card.get("keys") == ["lessig2006"], "card cites lessig2006")
check(card is not None and "aiOriginRequestId" not in card, "atom card carries no aiOriginRequestId")
check(card is not None and card.get("command", "").endswith("{lessig2006}"), "command from the family door")
bib = (sb / "references.bib").read_text()
check("@book{lessig2006" in bib, "references.bib gained the entry in the same op")
check(tex_digest(sb) == before_tex, ".tex byte-unchanged (nothing spliced)")
req = next(x for x in load(sb, "ai-requests.json")["requests"] if x["id"] == cit)
check(req["status"] == "complete", "Task status=complete")
check(req.get("result") == "direct-created", f"Task result=direct-created (got {req.get('result')})")
check(req.get("resultId") == cid, "Task resultId names the card")
check("chose the 2006 edition" in "".join(p.read_text() for p in (sb / "virgil").glob("*.json")),
      "--summary replaces the default completion summary")

print("\n=== re-run is a no-op ===")
n_before = len(load(sb, "citations.json")["citations"])
r = run(str(sb), cit, "--kind=citation", "--citekey", "lessig2006", "--unanchored",
        "--bib-entry", f"@{entry_file}")
check(r.returncode == 0 and json.loads(r.stdout).get("noop") is True, f"re-run returns noop ({r.stdout.strip()[:120]})")
check(len(load(sb, "citations.json")["citations"]) == n_before, "no second card")

# ============================================================ virtual todo hand-off
print("\n=== virtual:todos:<id> hand-off drains through the same call and lowers the todo flag ===")
sb, tmp = sandbox()
todo_id = next(c["id"] for c in load(sb, "todos.json")["items"] if c.get("aiRequest"))
entry_file = tmp / "entry.bib"
entry_file.write_text(ENTRY)
r = run(str(sb), f"virtual:todos:{todo_id}", "--kind=citation", "--citekey", "lessig2006",
        "--unanchored", "--bib-entry", f"@{entry_file}", "--accept-task-kind", "todo")
check(r.returncode == 0, f"virtual create exited 0 (stderr={r.stderr.strip()[:200]})")
todo = next(c for c in load(sb, "todos.json")["items"] if c["id"] == todo_id)
check(not todo.get("aiRequest"), "source todo's aiRequest flag lowered")
check("@book{lessig2006" in (sb / "references.bib").read_text(), ".bib entry landed")
r = run(str(sb), f"virtual:todos:{todo_id}", "--kind=citation", "--citekey", "lessig2006",
        "--unanchored", "--accept-task-kind", "todo")
check(r.returncode == 0 and json.loads(r.stdout).get("noop") is True, "virtual re-run returns noop")

# ============================================================ refusals
print("\n=== refusals ===")
sb, tmp = sandbox()
cit = next(r["id"] for r in load(sb, "ai-requests.json")["requests"] if r["kind"] == "citation")
bad = tmp / "bad.bib"
bad.write_text(ENTRY.replace("lessig2006", "other2001"))
r = run(str(sb), cit, "--kind=citation", "--citekey", "lessig2006", "--unanchored", "--bib-entry", f"@{bad}")
check(r.returncode != 0, "a rider for an uncited key is refused")
r = run(str(sb), cit, "--kind=citation", "--citekey", "lessig2006", "--unanchored")
check(r.returncode != 0, "a missing key with no rider is refused")
r = run(str(sb), "--kind=note", "--body", "x", "--unanchored")
check(r.returncode != 0, "--unanchored is citation-only")
r = run(str(sb), cit, "--kind=citation", "--citekey", "lessig2006", "--unanchored",
        "--anchor", "6602", "--bib-entry", f"@{tmp / 'bad.bib'}")
check(r.returncode != 0, "--unanchored with --anchor is refused")
existing = next(iter(__import__("bib_resolve").all_citekeys((sb / "references.bib").read_text())))
dup = tmp / "dup.bib"
dup.write_text(f"@misc{{{existing},\n  title = {{dup}},\n}}")
r = run(str(sb), cit, "--kind=citation", "--citekey", existing, "--unanchored", "--bib-entry", f"@{dup}")
check(r.returncode != 0 and "already in" in r.stderr, "a rider for a key the .bib holds is refused")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
