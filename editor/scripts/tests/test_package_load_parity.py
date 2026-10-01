#!/usr/bin/env python3
r"""DOES THIS PREAMBLE LOAD PACKAGE X? — the editor half of the task-882 parity
contract.

Task 781 made the app's `preambleListLoadsPackage` the one load reader (spaced
and line-broken `\usepackage [opts] {list}` spellings, whole comma-list
entries, wrapper prefixes). `bib_family.py` kept a pre-781 regex that allowed
no whitespace, so `\usepackage [style=apa]{biblatex}` read as NO family and
find-citation / draft-footnote spliced natbib `\citet` into a biblatex paper.
`bib_family.preamble_list_loads_package` is now a port; both readers answer the
shared corpus `src/lib/__tests__/fixtures/package-load-corpus.json` (the app
reader is `src/lib/__tests__/package-load-reader.test.ts`).

Run from anywhere:  python3 editor/scripts/tests/test_package_load_parity.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
CORPUS = ROOT / "src/lib/__tests__/fixtures/package-load-corpus.json"
sys.path.insert(0, str(SCRIPTS))

import bib_family as BF  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


print("Shared corpus — preamble_list_loads_package ≡ preambleListLoadsPackage")
cases = json.loads(CORPUS.read_text())["cases"]
check(len(cases) >= 15, f"corpus is non-trivial ({len(cases)} cases)")
for c in cases:
    got = BF.preamble_list_loads_package(c["preamble"], c["package"])
    check(got is c["expect"], f"{c['name']}: loads {c['package']} → {c['expect']}")

print("The family rung asks the same reader")
for pre, fam in [
    ("\\usepackage [style=apa]{biblatex}", "biblatex"),
    ("\\usepackage[style=apa,\n backend=biber]\n{biblatex}", "biblatex"),
    ("\\usepackage {natbib}", "natbib"),
    ("\\usepackage{natbib}\n\\usepackage {biblatex}", "biblatex"),
    ("\\usepackage{foo.biblatex}", None),
]:
    check(BF.detect_preamble_bib_family(pre) == fam, f"{pre!r} → {fam}")

# End to end: a spaced biblatex load with only a shared cite in the body must
# not fall through to the natbib default.
tex = ("\\documentclass{article}\n\\usepackage [style=apa]\n  {biblatex}\n"
       "\\begin{document}\nSee \\cite{k}.\n\\end{document}\n")
check(BF.detect_bib_family(tex) == "biblatex", "detect_bib_family: spaced load → biblatex")

print("Census — no hand-written load regex left in bib_family.py")
src = (SCRIPTS / "bib_family.py").read_text()
check("_family_load_re" not in src, "the pre-781 `_family_load_re` is gone")
check(src.count("usepackage|RequirePackage") == 1, "exactly one load pattern")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
