#!/usr/bin/env python3
r"""Task 613 — every texEdit mode that places words "in the anchored paragraph"
searches ONLY that paragraph's live text.

`after-selected` used to `text.find(selectedText)` over the whole .tex, so a
footnote for a selection landed at the first match anywhere — the title, a
`% comment`, an earlier paragraph — while the card still claimed the anchored
paragraph. `end-of-paragraph` backed over whitespace only, so a paragraph ending
in `% comment %!v:xxxx` got its atom inside the comment (task 347 caveat). The
example block borrowed `after-selected` with the marker as its "selection"; it
now has its own `after-paragraph` mode.

Unit legs call `_tex_splice` on a temp paper; the in-situ leg runs the real
`create_card.py --kind=example` CLI against a copy of the frozen sample.

Run from anywhere:  python3 editor/scripts/tests/test_anchored_paragraph_scope.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
sys.path.insert(0, str(SCRIPTS))

import apply_response as AR  # noqa: E402

PASS, FAIL = 0, 0
def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")

TEX = r"""\documentclass{article}
\title{On the argument itself}
\begin{document}
\maketitle

We first state the argument plainly. %!v:aa01

% an aside about the argument that should never get a footnote
Here, finally, the argument is defended. %!v:aa02

Closing words. % TODO cite something %!v:aa03

\end{document}
"""

def paper(tex=TEX):
    d = Path(tempfile.mkdtemp(prefix="t613-")) / "paper"
    d.mkdir()
    (d / "paper.tex").write_text(tex, encoding="utf-8")
    return d

def splice(te, tex=TEX):
    _, out = AR._tex_splice(paper(tex), te)
    return out

INS = r"\vfid{f1}\footnote{N}"

print("\n=== after-selected: lands in the anchored paragraph only ===")
out = splice({"anchorUuid": "aa02", "mode": "after-selected",
              "selectedText": "the argument", "insert": INS})
check(r"Here, finally, the argument" + INS + " is defended." in out,
      "insert follows the phrase inside paragraph aa02")
check(out.count(INS) == 1, "exactly one insert")
check(r"\title{On the argument itself}" in out, "title untouched")
check("We first state the argument plainly." in out, "earlier paragraph untouched")
check("aside about the argument that" in out, "comment untouched")

print("\n=== after-selected: phrase only in a comment of the paragraph → end-of-paragraph ===")
out = splice({"anchorUuid": "aa02", "mode": "after-selected",
              "selectedText": "an aside", "insert": INS})
check("% an aside about" in out and "defended." + INS + " %!v:aa02" in out,
      "falls back to after the paragraph's last live token")

print("\n=== after-selected: phrase only in an EARLIER paragraph → end-of-paragraph ===")
out = splice({"anchorUuid": "aa02", "mode": "after-selected",
              "selectedText": "state the", "insert": INS})
check("defended." + INS + " %!v:aa02" in out and "We first state the argument" in out,
      "never reaches back into paragraph aa01")

print("\n=== first paragraph never reaches back into the preamble ===")
out = splice({"anchorUuid": "aa01", "mode": "after-selected",
              "selectedText": "argument", "insert": INS})
check(r"\title{On the argument itself}" in out and "the argument" + INS + " plainly." in out,
      "title-level match ignored for the first body paragraph")

print("\n=== end-of-paragraph: trailing comment keeps the atom out of it ===")
out = splice({"anchorUuid": "aa03", "insert": INS})
check("Closing words." + INS + " % TODO cite something %!v:aa03" in out,
      "atom lands after the live text, before the comment")
out = splice({"anchorUuid": "aa01", "insert": INS})
check("plainly." + INS + " %!v:aa01" in out, "plain paragraph unchanged in shape")

print("\n=== anchorUuid is required for after-selected ===")
try:
    splice({"mode": "after-selected", "selectedText": "the argument", "insert": INS})
    check(False, "missing anchorUuid dies")
except SystemExit:
    check(True, "missing anchorUuid dies")

print("\n=== after-paragraph: block lands just past the marker ===")
out = splice({"anchorUuid": "aa01", "mode": "after-paragraph", "insert": "\n\nBLOCK"})
check("plainly. %!v:aa01\n\nBLOCK\n" in out, "block follows the marker token")

print("\n=== replace-span shares the scope (and skips a comment-only hit) ===")
out = AR._replace_span_in_tex(TEX, {"anchorUuid": "aa02", "match": "the argument",
                                    "replacement": "THE CLAIM"})
check("Here, finally, THE CLAIM is defended." in out and "aside about the argument" in out
      and r"\title{On the argument itself}" in out, "only the anchored live span replaced")
try:
    AR._replace_span_in_tex(TEX, {"anchorUuid": "aa02", "match": "an aside",
                                  "replacement": "X"})
    check(False, "comment-only match is a stale miss")
except SystemExit:
    check(True, "comment-only match is a stale miss")
out = AR._replace_span_in_tex(TEX, {"anchorUuid": "aa03",
                                    "match": "words. % TODO", "replacement": "words."})
check("Closing words. cite something" in out, "a span straddling a comment still matches")

print("\n=== in situ: create_card --kind=example lands after the paragraph ===")
d = Path(tempfile.mkdtemp(prefix="t613s-")) / "paper"
shutil.copytree(SAMPLE, d)
r = subprocess.run([sys.executable, str(SCRIPTS / "create_card.py"), str(d),
                    "--kind=example", "--body", "An example sentence.", "--anchor", "3301"],
                   capture_output=True, text=True)
check(r.returncode == 0, f"create_card exit 0 (stderr: {r.stderr.strip()[:200]})")
tex = next(d.glob("*.tex")).read_text(encoding="utf-8")
check("not enforced. %!v:3301\n\n\\vexid{" in tex and "\nAn example sentence.\n\\xe" in tex,
      "example block follows paragraph 3301's marker")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
