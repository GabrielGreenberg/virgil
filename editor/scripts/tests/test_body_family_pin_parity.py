#!/usr/bin/env python3
r"""WHICH BIB FAMILY DOES THE BODY PIN? — the editor half of the task-1371
parity contract.

The app's ONE rule is `bodyPinnedFamily` + `foldFamilies` (src/lib/bib-family.ts).
Before task 1371 `detect_command_bib_family` here mirrored the app's family
reader, which did not count `\printbibliography` while the requirements pass
did — so a `\cite` + `\printbibliography` paper read as natbib to the skills
while save injected biblatex. `body_pinned_family` is now a port; both readers
answer the shared corpus `src/lib/__tests__/fixtures/body-family-pin-corpus.json`
(the app reader is `src/lib/__tests__/body-family-pin.test.ts`).

Run from anywhere:  python3 editor/scripts/tests/test_body_family_pin_parity.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
CORPUS = ROOT / "src/lib/__tests__/fixtures/body-family-pin-corpus.json"
sys.path.insert(0, str(SCRIPTS))

import bib_family as BF  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def wrap(body):
    return "\\documentclass{article}\n\\begin{document}\n" + body + "\n\\end{document}\n"


print("Shared corpus — body_pinned_family ≡ bodyPinnedFamily")
cases = json.loads(CORPUS.read_text())["cases"]
check(len(cases) >= 10, f"corpus is non-trivial ({len(cases)} cases)")
for c in cases:
    check(BF.body_pinned_family(c["body"]) == c["family"], f"{c['name']}: pins {c['family']}")
    check(BF.detect_bib_family(wrap(c["body"])) == c["seed"], f"{c['name']}: seed {c['seed']}")

print("The tie rule — fold_families ≡ foldFamilies")
D = BF.DEFAULT_BIB_FAMILY
for a, b, want in [
    (None, None, None),
    (None, "biblatex", "biblatex"),
    ("biblatex", None, "biblatex"),
    ("biblatex", "biblatex", "biblatex"),
    ("natbib", "biblatex", D),
    ("biblatex", "natbib", D),
]:
    check(BF.fold_families(a, b) == want, f"fold({a}, {b}) → {want}")

print("Census — the pre-1371 reader is gone")
src = (SCRIPTS / "bib_family.py").read_text()
check("def detect_command_bib_family" not in src, "`detect_command_bib_family` is gone")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
