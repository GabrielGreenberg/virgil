#!/usr/bin/env python3
r"""WHERE DOES A BIB ENTRY END? — the editor half of the task-614 parity
contract, plus the splice + preservation legs that make it matter.

`bib_resolve.find_entry_span` used to toggle "in string" on every `"`, so a
German `{Untersuchungen "uber …}` ran the span through the entries after it:
an `answer-bib-review --library-sync` swap DELETED them and `set-fields` wrote
into the wrong entry. The editor scanner is now a port of the library's
`_bib_parse.locate_entry_for_splice`; both answer the shared corpus
`src/lib/__tests__/fixtures/bib-entry-span-corpus.json` (the library reader is
`library/scripts/tests/test_bib_entry_span_parity.py`).

The last legs drive the REAL `apply_response.py`: `_bib_apply` measures every
bibEdit and refuses one that would drop another entry.

Run from anywhere:  python3 editor/scripts/tests/test_bib_entry_span_parity.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
APPLY = str(SCRIPTS / "apply_response.py")
CORPUS = ROOT / "src/lib/__tests__/fixtures/bib-entry-span-corpus.json"
sys.path.insert(0, str(SCRIPTS))

import bib_resolve as BR  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def answer(bib, key):
    """The corpus vocabulary: entry text | None | "refuse"."""
    try:
        span = BR.find_entry_span(bib, key)
    except SystemExit:
        return "refuse"
    return None if span is None else bib[span[0]:span[1]]


def dies(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


CASES = json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]
print("parity corpus")
for case in CASES:
    got = answer(case["bib"], case["key"])
    check(got == case["expect"], f"{case['name']} → {case['expect']!r:.40}" + ("" if got == case["expect"] else f" (got {got!r:.60})"))

FOUR = next(c for c in CASES if c["name"] == "umlaut-quote-in-braces/zermelo1908")["bib"]
QUOTED = next(c for c in CASES if c["name"] == "quoted-value-with-braces")["bib"]
KEYS = ["zermelo1908", "smith2020", "hausdorff1914", "jones2001"]

print("splicers on the four-entry fixture")
swapped = BR.replace_entry(FOUR, "zermelo1908", "@book{zermelo1908,\n  title = {New},\n}")
check(all(f"{{{k}," in swapped for k in KEYS), "replace_entry keeps every neighbour")
check(swapped.endswith(FOUR[FOUR.index("\n\n@article{smith2020"):]), "replace_entry leaves the tail byte-identical")
noted = BR.set_fields(FOUR, "zermelo1908", {"note": "N"})
z = BR.find_entry_block(noted, "zermelo1908")[0]
h = BR.find_entry_block(noted, "hausdorff1914")[0]
check("note = {N}" in z and "note" not in h, "set_fields writes into zermelo1908, not hausdorff1914")
check(BR.parse_fields(z)["title"] == 'Untersuchungen "uber die Grundlagen der Mengenlehre', "parse_fields reads the braced umlaut title whole")

print("quoted values")
qf = BR.parse_fields(BR.find_entry_block(QUOTED, "quoted")[0])
check(qf == {"title": "A {B} C", "note": 'x {"} y'}, f"parse_fields ends a quoted value at depth-0 \" ({qf})")
qn = BR.set_fields(QUOTED, "quoted", {"note": "N"})
check('title = "A {B} C",\n  note = {N},\n}' in qn, "set_fields replaces a quoted value holding a braced quote exactly")

print("preservation measure")
check(not dies(lambda: BR.assert_entries_preserved(FOUR, swapped, replaced="zermelo1908")), "a clean replace passes")
lost = FOUR[:FOUR.index("@article{smith2020")] + FOUR[FOUR.index("@article{jones2001"):]
check(dies(lambda: BR.assert_entries_preserved(FOUR, lost, replaced="zermelo1908")), "a replace that drops neighbours dies")
renamed = BR.replace_entry(FOUR, "smith2020", "@article{smith2020a,\n  title = {P},\n}")
check(not dies(lambda: BR.assert_entries_preserved(FOUR, renamed, replaced="smith2020")), "a replace that re-keys the target passes")
check(dies(lambda: BR.assert_entries_preserved(FOUR, renamed)), "the same re-key without `replaced` dies (set-fields must keep its key)")


def sandbox(bib):
    d = Path(tempfile.mkdtemp(prefix="t614-")) / "paper"
    shutil.copytree(SAMPLE, d)
    (d / "references.bib").write_text(bib, encoding="utf-8")
    return d


def apply(doc, bib_edit):
    # A bib-review answer on the sample's grafton1997 row carries the bibEdit
    # (the answer-bib-review path — the one that swaps library entries in).
    op = {"requestId": "grafton1997", "bibReviewType": "fields",
          "bibEdit": bib_edit, "summary": "t614"}
    return subprocess.run([sys.executable, APPLY, str(doc), "complete-only", json.dumps(op),
                           "--result", "auto-applied"],
                          capture_output=True, text=True, env=dict(os.environ))


print("apply_response end to end")
doc = sandbox(FOUR)
try:
    r = apply(doc, {"mode": "replace", "citekey": "zermelo1908",
                                         "entry": "@book{zermelo1908,\n  title = {Swapped},\n}"})
    after = (doc / "references.bib").read_text(encoding="utf-8")
    check(r.returncode == 0, f"library-sync replace lands (rc={r.returncode} {r.stderr.strip()[:120]})")
    check(all(f"{{{k}," in after for k in KEYS) and "{Swapped}" in after, "every neighbour survives the swap")
    r = apply(doc, {"mode": "set-fields", "citekey": "hausdorff1914", "fields": {"note": "H"}})
    after2 = (doc / "references.bib").read_text(encoding="utf-8")
    check(r.returncode == 0 and "note = {H}" in BR.find_entry_block(after2, "hausdorff1914")[0], "set-fields lands on hausdorff1914")
    broken = "@article{bad,\n  title = {Open,\n}\n\n" + FOUR
    (doc / "references.bib").write_text(broken, encoding="utf-8")
    r = apply(doc, {"mode": "replace", "citekey": "bad", "entry": "@article{bad,\n  title = {Fixed},\n}"})
    check(r.returncode != 0 and (doc / "references.bib").read_text(encoding="utf-8") == broken,
          "a replace on an unbalanced entry refuses and writes nothing")
finally:
    shutil.rmtree(doc.parent, ignore_errors=True)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
