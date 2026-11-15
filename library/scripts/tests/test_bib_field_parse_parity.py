"""WHAT ARE THIS ENTRY'S FIELDS? — the library half of the task-1628 contract.

`_bib_parse.parse_fields` is the ONE Python field grammar; the editor's
`bib_resolve.parse_fields` delegates to it, and both answer
`src/lib/__tests__/fixtures/bib-field-parse-corpus.json` (the editor reader is
`editor/scripts/tests/test_bib_field_parse_parity.py`).

Run: python3 library/scripts/tests/test_bib_field_parse_parity.py
"""
import json
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

from _bib_parse import emit_bib_entry, normalize_field_value, parse_bib_text, value_end  # noqa: E402

CORPUS = _SCRIPTS.parents[1] / "src/lib/__tests__/fixtures/bib-field-parse-corpus.json"


def test_corpus():
    cases = json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 10
    wrong = []
    for c in cases:
        entries = parse_bib_text(c["entry"])
        got = entries[0]["fields"] if len(entries) == 1 else entries
        if got != c["expect"]:
            wrong.append((c["name"], c["expect"], got))
    assert not wrong, wrong


def test_value_end_covers_every_hash_part():
    text = 'title = "Part " # "Two",\n year = 2020'
    start = text.index("=") + 1
    assert text[value_end(text, start):].startswith(",\n year")


def test_concatenated_title_survives_round_trip():
    src = '@book{a,\n  title = "Part " # "Two",\n  year = 2020\n}'
    fields = parse_bib_text(src)[0]["fields"]
    again = parse_bib_text(emit_bib_entry("a", "book", fields))[0]["fields"]
    assert again == fields == {"title": "Part Two", "year": "2020"}


def test_normalize_is_the_compare_reading():
    assert normalize_field_value("A\n   long   title") == "A long title"


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
