"""WHERE DOES A BIB ENTRY END? — the library half of the task-614 parity
contract.

`_bib_parse.find_entry_span` (the reader the editor skills use to lift a
master.bib entry for a library-sync swap) and the editor's
`bib_resolve.find_entry_span` answer the same question in two silos that can't
share code. Both read `src/lib/__tests__/fixtures/bib-entry-span-corpus.json`;
the editor reader is `editor/scripts/tests/test_bib_entry_span_parity.py`.

The old library scan here was a private brace-matcher that ran to END OF FILE
on an unbalanced entry (master.bib has one), so a skill lifting "the entry"
could lift the rest of the bibliography. It now rides
`locate_entry_for_splice`, the same locator `upsert_entry_text` splices by.

Run: python3 library/scripts/tests/test_bib_entry_span_parity.py
"""
import json
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

from _bib_parse import BibSpliceRefused, find_entry_span  # noqa: E402

CORPUS = _SCRIPTS.parents[1] / "src/lib/__tests__/fixtures/bib-entry-span-corpus.json"


def _answer(bib: str, key: str):
    try:
        span = find_entry_span(bib, key)
    except BibSpliceRefused:
        return "refuse"
    return None if span is None else bib[span[0]:span[1]]


def test_corpus_parity():
    cases = json.loads(CORPUS.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 10
    wrong = [
        (c["name"], c["expect"], _answer(c["bib"], c["key"]))
        for c in cases
        if _answer(c["bib"], c["key"]) != c["expect"]
    ]
    assert not wrong, wrong


def test_state_comment_start_still_reported():
    bib = "@misc{a,\n  title = {A},\n}\n% bib.state = verified\n@misc{b,\n  title = {B},\n}\n"
    start, end, state = find_entry_span(bib, "b")
    assert bib[start:end] == "@misc{b,\n  title = {B},\n}"
    assert bib[state:].startswith("% bib.state")


if __name__ == "__main__":
    fails = 0
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for name, fn in tests:
        try:
            fn()
            print(f"  PASS  {name}")
        except Exception as e:  # noqa: BLE001
            fails += 1
            print(f"  FAIL  {name}: {e}")
    print(f"\n{len(tests) - fails}/{len(tests)} passed")
    raise SystemExit(1 if fails else 0)
