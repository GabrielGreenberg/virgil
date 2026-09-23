#!/usr/bin/env python3
r"""The Python half of the T6/C12 title-provenance contract.

`titleAuto` records WHETHER a card's title was machine-supplied, so the app's
load sites do not have to GUESS from the title's shape. The `^<Label> <digits>$`
heuristic (`isAutoTitle`, src/panels/panel-registry.ts) is DEMOTED — provably
ambiguous — and reachable only as a one-time legacy fallback for records written
before the bit existed. That demotion holds only while every CURRENT writer
stamps the bit, and the app is not the only writer: this silo writes the same
sidecars. A bit-less record we emit is classified by the demoted heuristic, and
because the loaders run with `persistMigrationOnLoad` the guess is written back
to disk — on a todo the resolved field is the BODY, so an agent todo reading
"Task 2" was EMPTIED on the next open, permanently.

So: every card this silo writes for an auto-titling kind carries an explicit
`titleAuto`, stamped through the one rule (`_common.title_fields`) over the
registry-derived manifest `card_titles.json`. This suite pins that three ways —
the manifest is loadable and agrees with the helper, every builder routes
through the helper (source census, so a NEW builder joins by existing), and the
records the real CLIs actually land carry the right bit.

Its TS sibling `src/cards/__tests__/card-title-provenance-manifest.test.ts` pins
the manifest against `CARD_REGISTRY`; together they close the contract.

Run from anywhere:  python3 editor/scripts/tests/test_card_title_provenance.py
"""
import inspect
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# repo root = tests/ → scripts/ → editor/ → <root>
ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
CREATE = str(SCRIPTS / "create_card.py")
APPLY = str(SCRIPTS / "apply_response.py")

sys.path.insert(0, str(SCRIPTS))
import _common  # noqa: E402
import apply_response as AR  # noqa: E402
import create_card as CC  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="titleauto-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True,
                          env=dict(os.environ))


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def out_of(r):
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}


def by_id(doc, name, key, cid):
    st = load(doc, name) or {}
    return next((c for c in st.get(key, []) if c.get("id") == cid), None)


# ───────────────────────────────── the manifest + the one rule ────────────
print("\n=== card_titles.json is the SSOT `title_fields` reads ===")
MANIFEST = json.loads((SCRIPTS / "card_titles.json").read_text(encoding="utf-8"))
check(MANIFEST["titleField"] == _common.TITLE_FIELD_BY_KIND,
      "TITLE_FIELD_BY_KIND is the manifest's titleField map (not a second copy)")
check(set(MANIFEST["titleField"]) & set(MANIFEST["exempt"]) == set(),
      "no kind is both field-bearing and exempt")
check(_common.title_fields("note", "") == {"title": "", "titleAuto": True},
      "blank title → machine default (titleAuto: True), matching the app's FORK-1")
check(_common.title_fields("note", "Note 7") == {"title": "Note 7", "titleAuto": False},
      "a supplied title is user/agent-owned (False) EVEN in the heuristic's shape")
check(_common.title_fields("todo", "Task 2") == {"text": "Task 2", "titleAuto": False},
      "a todo's bit governs its BODY field `text`, not a `title`")
check(_common.title_fields("archive", "x", auto=True)["titleAuto"] is True,
      "`auto=` overrides the derivation for a value this silo generated")
bad = run("-c",
          f"import sys; sys.path.insert(0, {str(SCRIPTS)!r});"
          " import _common; _common.title_fields('citation', 'x')")
check(bad.returncode != 0,
      "a kind with no declared title field is REFUSED, not silently stamped")


# ───────────────────────────────── source census over the writers ────────
print("\n=== every card writer for an auto-titling kind routes through title_fields ===")
# Derived from the dispatch map, so a NEW builder is censused by existing.
for kind, fn in sorted(CC.CARDED_BUILDERS.items()):
    src = inspect.getsource(fn)
    if kind in _common.TITLE_FIELD_BY_KIND:
        check("title_fields(" in src,
              f"create_card.{fn.__name__} ({kind}) stamps the bit through title_fields")
    else:
        check("titleAuto" not in src,
              f"create_card.{fn.__name__} ({kind}) does not auto-title → no bit")
# The two writers outside the dispatch map.
check("title_fields(" in inspect.getsource(CC._comment_note_card),
      "create_card._comment_note_card (the L2 sibling note) stamps the bit")
check("title_fields(" in inspect.getsource(AR._archive_title),
      "apply_response._archive_title (the archive snippet) stamps the bit")


# ───────────────────────────────── what the real CLIs land ───────────────
print("\n=== the records the real writers land carry the bit ===")
sb = sandbox()

# 1. A todo whose body is exactly the heuristic's shape. THE severity driver:
#    bit-less, this body was erased on the next open and the loss persisted.
r = run(CREATE, str(sb), "--kind=todo", "--body", "Task 2", "--anchor", "4402",
        "--safety-level", "1")
check(r.returncode == 0, f"create todo exited 0 (stderr={r.stderr.strip()[:120]})")
todo = by_id(sb, "todos.json", "items", out_of(r).get("cardId")) or {}
check(todo.get("text") == "Task 2", 'the todo body is "Task 2" on disk')
check(todo.get("titleAuto") is False,
      "the todo is stamped user/agent-owned → resolveLoadedTitle keeps the body")

# 2. A report titled in the heuristic's shape.
r = run(CREATE, str(sb), "--kind=report", "--body", "Body.", "--title", "Report 3",
        "--anchor", "4402", "--safety-level", "1")
check(r.returncode == 0, f"create report exited 0 (stderr={r.stderr.strip()[:120]})")
rep = by_id(sb, "reports.json", "cards", out_of(r).get("cardId")) or {}
check(rep.get("title") == "Report 3" and rep.get("titleAuto") is False,
      'a report titled "Report 3" survives — title kept, bit False')

# 3. The common agent case: no --title at all → blank + machine default, the
#    SAME provenance the app stamps (useReports.addReport FORK-1).
r = run(CREATE, str(sb), "--kind=report", "--body", "Untitled body.",
        "--anchor", "4402", "--safety-level", "1")
rep2 = by_id(sb, "reports.json", "cards", out_of(r).get("cardId")) or {}
check(rep2.get("title") == "" and rep2.get("titleAuto") is True,
      "an untitled agent report is stamped machine-default, like an app-created one")

# 4. A note + its Level-2 sibling comment note (safety level 2 mints one).
r = run(CREATE, str(sb), "--kind=note", "--body", "A note body.", "--anchor", "4402",
        "--safety-level", "2")
check(r.returncode == 0, f"create note (L2) exited 0 (stderr={r.stderr.strip()[:120]})")
notes = load(sb, "notes.json")["cards"]
nid = out_of(r).get("cardId")
note = next((c for c in notes if c.get("id") == nid), {})
check(note.get("title") == "" and note.get("titleAuto") is True,
      "an untitled agent note is stamped machine-default")
sibling = next((c for c in notes
                if str(c.get("title", "")).startswith("Virgil added a")), None)
check(sibling is not None, "the L2 sibling comment note landed")
check(sibling is not None and sibling.get("titleAuto") is False,
      "the sibling's composed title is KEEP-always (False) — the loader must not drop it")

# 5. Archiving a card: the snippet's derived title is content → keep it.
r = run(APPLY, str(sb), "archive", json.dumps({"cardId": nid}))
check(r.returncode == 0, f"archive exited 0 (stderr={r.stderr.strip()[:120]})")
snip = by_id(sb, "archive.json", "snippets", nid) or {}
check("titleAuto" in snip, "the archive snippet carries an explicit bit")
check(snip.get("titleAuto") is True and snip.get("title") == "",
      "a card with nothing to derive from archives as a blank machine default")

r = run(CREATE, str(sb), "--kind=note", "--body", "Another body.", "--title",
        "A real note title", "--anchor", "4402", "--safety-level", "1")
nid2 = out_of(r).get("cardId")
r = run(APPLY, str(sb), "archive", json.dumps({"cardId": nid2}))
snip2 = by_id(sb, "archive.json", "snippets", nid2) or {}
check(snip2.get("title") == "A real note title" and snip2.get("titleAuto") is False,
      "a title DERIVED from the card's own words is kept, stamped user/agent-owned")

shutil.rmtree(sb.parent, ignore_errors=True)

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
