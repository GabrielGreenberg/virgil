#!/usr/bin/env python3
"""WHAT ARE THIS ENTRY'S FIELDS? — the editor half of the task-1628 contract.

`bib_resolve.parse_fields` (the `"fields"` the bib_resolve CLI prints, which
answer-bib-review / sync-bib-to-library compare against the library's reading
of master.bib) and its splice door `_value_span` both delegate to the library's
`_bib_parse` grammar. This reader answers the same
`src/lib/__tests__/fixtures/bib-field-parse-corpus.json` as
`library/scripts/tests/test_bib_field_parse_parity.py`, so the two sides of a
verify cannot read the same bytes two ways.

Run from anywhere:  python3 editor/scripts/tests/test_bib_field_parse_parity.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
CORPUS = ROOT / "src/lib/__tests__/fixtures/bib-field-parse-corpus.json"
sys.path.insert(0, str(SCRIPTS))

import bib_resolve as BR  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}")


cases = json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]
check(len(cases) >= 10, "the corpus holds a real population")
for c in cases:
    got = BR.parse_fields(c["entry"])
    check(got == c["expect"], f"{c['name']}: {got!r}")

# The splice door reads the same grammar: set-fields on a `#`-concatenated
# value replaces the WHOLE value, leaving no dangling `# "Two"` tail.
bib = '@book{a,\n  title = "Part " # "Two",\n  year = 2020\n}\n'
out = BR.set_fields(bib, "a", {"title": "Part Three"})
check(BR.parse_fields(BR.find_entry_block(out, "a")[0]) == {"title": "Part Three", "year": "2020"},
      f"set_fields replaces every # part ({out!r})")
check("#" not in out, "no dangling concatenation tail")

# A comma-less bare value ends where the reader says it does.
bib2 = "@misc{b,\n  year = 2020\n  month = jan\n}\n"
out2 = BR.set_fields(bib2, "b", {"year": "2021"})
check(BR.parse_fields(BR.find_entry_block(out2, "b")[0]) == {"year": "2021", "month": "jan"},
      f"set_fields on a comma-less bare value keeps the next field ({out2!r})")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
