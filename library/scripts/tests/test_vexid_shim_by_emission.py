"""The pass that MINTS `\\vexid` guarantees its no-op declaration (task 801).

`bulk_convert_numbered_examples.py --apply` writes `\\vexid{<uuid>}` markers.
Under stock LaTeX an undeclared `\\vexid` is an `Undefined control sequence`,
and nothing in the library pipeline declared it (the extractor's preamble
carries only `\\pgmark`). So `_apply` now ensures
`\\providecommand{\\vexid}[1]{}` before `\\begin{document}` — once.

Run: python3 library/scripts/tests/test_vexid_shim_by_emission.py
"""
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import bulk_convert_numbered_examples as bc  # noqa: E402
import tex_emit  # noqa: E402

_PAPER = (
    "\n".join(tex_emit.preamble_lines("T"))
    + "\\begin{document}\n\n"
    + "Some prose.\n\n(1) John left.\n\nMore prose.\n\n\\end{document}\n"
)


def test_apply_declares_vexid_when_it_mints_one():
    examples = bc._gather_examples(_PAPER)
    assert examples, "fixture should yield one numbered example"
    out = bc._apply(_PAPER, examples)
    assert "\\vexid{" in out
    assert out.count(bc.VEXID_SHIM) == 1
    assert out.index(bc.VEXID_SHIM) < out.index("\\begin{document}")


def test_shim_is_idempotent_and_respects_existing_declarations():
    once = bc.ensure_vexid_shim(_PAPER)
    assert bc.ensure_vexid_shim(once) == once
    declared = _PAPER.replace(
        "\\begin{document}", "\\newcommand{\\vexid}[1]{}\n\\begin{document}", 1
    )
    assert bc.ensure_vexid_shim(declared) == declared


def test_no_examples_no_shim():
    assert bc._apply(_PAPER, []) == _PAPER


def test_fragment_without_begin_document_is_untouched():
    frag = "(1) John left.\n"
    assert bc.ensure_vexid_shim(frag) == frag


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
