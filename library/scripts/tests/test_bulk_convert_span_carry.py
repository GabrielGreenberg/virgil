"""`--apply` re-emits every character of the span it replaces (task 1290).

A `pex` record used to replace everything from the parent's line through
its last sub-item's line with only the single-line bodies the regexes
captured — so a continuation line, a `\\pgmark{N}` page anchor, intervening
prose, or a mechanically skipped sub-item between them was silently
deleted from main.tex. An `ex` body's continuation was moved out of the
example (left after `\\xe`). Now each candidate carries its exact span and
the block is re-emitted from it: item heads become the body / `\\a …`,
every other line is carried into the preceding item, and a measured
invariant (span characters == block characters, modulo whitespace and the
labels) refuses any record that would lose one.

Run: python3 library/scripts/tests/test_bulk_convert_span_carry.py
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import bulk_convert_numbered_examples as bc  # noqa: E402

_SCRIPT = _SCRIPTS / "bulk_convert_numbered_examples.py"


def _convert(text: str) -> str:
    return bc._apply(text, bc._gather_examples(text))


def _block(out: str) -> str:
    """The text of the (single) converted block, opener through `\\xe`."""
    m = re.search(r"\\p?ex\[exno=\d+\]\n(.*?)\n\\xe\n", out, re.S)
    assert m, out
    return m.group(1)


def _run(tex: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(_SCRIPT), str(tex), *args],
        capture_output=True, text=True,
    )


def test_pex_carries_continuation_and_pgmark_inside_the_block():
    text = "(2) A\ncontinues.\n\\pgmark{4}\n(2a) x\n(2b) y\n"
    out = _convert(text)
    assert _block(out) == "A\ncontinues.\n\\pgmark{4}\n\\a x\n\\a y", out
    assert out.count("continues.") == 1 and out.count("\\pgmark{4}") == 1


def test_pex_carries_a_skipped_sub_item_and_prose_between_kept_ones():
    # (2b) carries converted-region markup, so it is never itself converted
    # — but it lies between (2a) and (2c), and must not be deleted.
    text = (
        "(2) Pairs:\n\n(2a) x\n\n(2b) see \\pgmark{9} here\n\n"
        "Some prose between.\n\n(2c) z\n\nAfter.\n"
    )
    (ex,) = bc._gather_examples(text)
    assert [s["letter"] for s in ex["sub_items"]] == ["a", "c"]
    out = _convert(text)
    block = _block(out)
    assert "(2b) see \\pgmark{9} here" in block, block
    assert "Some prose between." in block
    assert block.endswith("\\a z")
    assert out.endswith("\\xe\n\nAfter.\n")


def test_ex_continuation_stays_inside_the_example():
    text = "(1) The sentence\ncontinues here.\n\nNext paragraph.\n"
    out = _convert(text)
    assert _block(out) == "The sentence\ncontinues here."
    assert out.endswith("\\xe\n\nNext paragraph.\n")


def test_span_stops_at_structure_and_never_swallows_a_converted_block():
    text = (
        "(3) Head\n\\section{Next}\n(3a) stray\n"
    )
    (ex,) = bc._gather_examples(text)
    assert ex["kind"] == "ex" and ex["sub_items"] == []
    out = _convert(text)
    assert "\\section{Next}\n(3a) stray\n" in out
    nested = "(4) Head\n\\ex[exno=9] old \\xe\n(4a) part\n"
    (ex,) = bc._gather_examples(nested)
    assert ex["sub_items"] == []
    assert _convert(nested).count("\\xe") == 2


def test_no_non_whitespace_character_is_lost():
    text = (
        "\\documentclass{article}\n\\begin{document}\n\n"
        "(1) First\nline two.\n\n"
        "(2) A\n\\pgmark{4}\nmore.\n(2a) x\ncont x.\n\n(2b) y\n\n"
        "Tail prose.\n\n\\end{document}\n"
    )
    out = _convert(text)
    strip = lambda s: re.sub(  # noqa: E731
        r"\s+|\\vexid\{[^}]*\}|\\providecommand\{\\vexid\}\[1\]\{\}"
        r"|\\p?ex\[exno=\d+\]|\\xe|\\a |\(\d+[a-z]?\)", "", s,
    )
    assert strip(out) == strip(text), (strip(out), strip(text))


def test_measured_invariant_refuses_an_unrepresented_record():
    text = "(2) A\n(2a) x\n"
    (ex,) = bc._gather_examples(text)
    ex["end_char"] = len(text) + 5  # a span the block cannot re-emit
    try:
        bc._apply(text, [ex])
    except bc.UnrepresentedContent:
        pass
    else:
        raise AssertionError("an unrepresented span must refuse")


def test_measured_invariant_catches_a_dropped_line():
    # The invariant measures the EMITTED block, not the slicing: if the
    # line emitter ever lost a character, the record refuses.
    text = "(2) A\ncontinues.\n(2a) x\n"
    examples = bc._gather_examples(text)
    real = bc._content_lines
    bc._content_lines = lambda chunk: real(chunk)[:1]
    try:
        bc._apply(text, examples)
    except bc.UnrepresentedContent:
        pass
    else:
        raise AssertionError("a dropped line must refuse the apply")
    finally:
        bc._content_lines = real


def test_out_naming_the_proposals_file_refuses_and_leaves_it_untouched():
    text = "(2) Mary sang.\n\n(3) the claim.\n"
    with tempfile.TemporaryDirectory() as d:
        tex = Path(d) / "main.tex"
        tex.write_text(text, encoding="utf-8")
        reviewed = Path(d) / "r.json"
        assert _run(tex, "--out", str(reviewed)).returncode == 0
        kept = [p for p in json.loads(reviewed.read_text()) if not p["suspect"]]
        reviewed.write_text(json.dumps(kept), encoding="utf-8")
        before = reviewed.read_text()
        r = _run(tex, "--apply", "--proposals", str(reviewed), "--out", str(reviewed))
        assert r.returncode == 2 and "overwritten" in r.stderr, r.stderr
        assert reviewed.read_text() == before
        assert tex.read_text(encoding="utf-8") == text


def test_malformed_proposals_file_is_a_refusal_not_a_traceback():
    text = "(2) Mary sang.\n"
    with tempfile.TemporaryDirectory() as d:
        tex = Path(d) / "main.tex"
        tex.write_text(text, encoding="utf-8")
        bad = Path(d) / "bad.json"
        for payload in ({"start_char": 0}, ["x"], [{"sub_items": "a"}]):
            bad.write_text(json.dumps(payload), encoding="utf-8")
            r = _run(tex, "--apply", "--proposals", str(bad))
            assert r.returncode == 2, (payload, r.stderr)
            assert "Traceback" not in r.stderr
            assert tex.read_text(encoding="utf-8") == text


def test_reviewed_record_is_stale_when_its_carried_text_changes():
    text = "(2) A\ncontinues.\n(2a) x\n"
    rec = bc._propose(bc._gather_examples(text))
    assert rec[0]["carried"] == ["continues."]
    edited = "(2) A\nchanged.\n(2a) x\n"
    try:
        bc._select_reviewed(bc._gather_examples(edited), rec)
    except bc.StaleProposal:
        pass
    else:
        raise AssertionError("an edit inside the span must make the record stale")


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
