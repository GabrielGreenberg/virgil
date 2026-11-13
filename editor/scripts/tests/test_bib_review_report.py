#!/usr/bin/env python3
r"""sync-bib-to-library's review reaches the app (task 1595).

The skill used to hand-write `<docPath>/virgil/notes/sync-bib-review-<ISO>.md`
— a file nothing in the app reads — for its ambiguous / still-missing rows, the
one part of the run that needs the user. It now files a REPORT card through
`create_card.py --kind=report`, anchored at the block that prints the
bibliography, whose uuid `bib_resolve.py <docPath> --bibliography-anchor`
answers. This pins both halves of that door:

1. `bibliography_anchor` — the uuid of the `\bibliography{…}` /
   `\printbibliography` block (last wins; a commented-out command never
   counts; a block with no `%!v:` yet answers None);
2. end to end on a copy of samples/annotation-history: the CLI answers the
   sample's bibliography uuid, and `create_card.py --kind=report` accepts it,
   landing a report the app's Reports panel renders.

Run from anywhere:  python3 editor/scripts/tests/test_bib_review_report.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
sys.path.insert(0, str(SCRIPTS))

import bib_resolve as BR  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True,
                          env=dict(os.environ))


print("\n=== bibliography_anchor ===")
check(BR.bibliography_anchor("Text. %!v:1111\n\n\\bibliography{references} %!v:6700\n") == "6700",
      "natbib \\bibliography{…} block answers its trailing uuid")
check(BR.bibliography_anchor("\\printbibliography\n%!v:abcd\n") == "abcd",
      "biblatex \\printbibliography answers the uuid on its slab's next line")
check(BR.bibliography_anchor("% \\bibliography{old} %!v:0001\nText. %!v:0002\n") is None,
      "a commented-out command never counts")
check(BR.bibliography_anchor("\\bibliography{refs}\n\nNext. %!v:0003\n") is None,
      "a block with no uuid in its own slab answers None (never the next paragraph's)")
check(BR.bibliography_anchor("\\bibliographystyle{plainnat} %!v:0004\n") is None,
      "\\bibliographystyle is not the bibliography")
check(BR.bibliography_anchor("\\bibliography{a} %!v:0005\n\n\\bibliography{b} %!v:0006\n") == "0006",
      "the LAST printing command wins")
check(BR.bibliography_anchor("No bibliography here. %!v:0007\n") is None,
      "a paper with no bibliography answers None")

print("\n=== CLI + create_card --kind=report at the bibliography (sample copy) ===")
sb = Path(tempfile.mkdtemp(prefix="bibrev-")) / "paper"
shutil.copytree(SAMPLE, sb)
try:
    r = run(str(SCRIPTS / "bib_resolve.py"), str(sb), "--bibliography-anchor")
    check(r.returncode == 0, f"--bibliography-anchor exits 0 (stderr={r.stderr.strip()[:120]})")
    got = json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}
    check(got.get("anchor") == "6700" and got.get("tex") == "document.tex",
          f"answers the sample's bibliography block (got {got})")

    before = len(json.loads((sb / "virgil/reports.json").read_text())["cards"])
    r = run(str(SCRIPTS / "create_card.py"), str(sb), "--kind=report",
            "--title", "Bibliography sync: 1 entry needs a decision",
            "--body", "smith2020 — two library candidates: smith2020a, smith2020b.",
            "--anchor", got.get("anchor") or "")
    check(r.returncode == 0, f"create_card --kind=report exits 0 (stderr={r.stderr.strip()[:160]})")
    out = json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}
    cards = json.loads((sb / "virgil/reports.json").read_text())["cards"]
    check(len(cards) == before + 1, "one report appended to reports.json")
    card = next((c for c in cards if c["id"] == out.get("cardId")), {})
    check(card.get("kind") == "report" and card.get("author") == "ai", "on-disk kind=report, author=ai")
    check((card.get("links") or [{}])[0].get("anchor", {}).get("textObjectIds") == ["6700"],
          "report anchored to the bibliography block")
    check(not (sb / "virgil" / "notes").exists(), "no virgil/notes/ directory is created")
finally:
    shutil.rmtree(sb.parent, ignore_errors=True)

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
