"""Task 1228 — rewrite_citations.py's style vocabulary has ONE owner.

`STYLES` (name → matched inline shape) is the script's table; the CLI's
accepted values, its usage line and `--list-styles` read it. This suite binds
clean-bibliography.md to it:

  * the skill's `<!-- styles:begin/end -->` block is `--list-styles` verbatim,
    so a renamed / added style or a re-described shape fails here (the skill
    once said `--style=apa` matched `Author (Year)`, the author-year-paren
    shape, while the code's apa requires a comma);
  * every `--style=<x>` named in Step 3g (the inline-citation step — Step 3e's
    `--style=` belongs to format_references_section.py, a separate script) is
    a key of `STYLES`;
  * an unknown `--style=` is refused (exit 2), not silently run as chicago.

Run: python3 -m pytest library/scripts/tests/test_rewrite_citations_styles.py -v
"""
import re
import subprocess
import sys
import tempfile
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import rewrite_citations as rc  # noqa: E402

_SKILL = _SCRIPTS.parent / "skills" / "clean-bibliography.md"
_SCRIPT = _SCRIPTS / "rewrite_citations.py"


def _skill() -> str:
    return _SKILL.read_text(encoding="utf-8")


def _step_3g(text: str) -> str:
    start = text.index("## Step 3g")
    nxt = re.search(r"^## ", text[start + 3:], re.M)
    return text[start:start + 3 + nxt.start()] if nxt else text[start:]


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(_SCRIPT), *args],
        capture_output=True, text=True, encoding="utf-8",
    )


def test_skill_style_block_is_list_styles_verbatim():
    m = re.search(
        r"<!-- styles:begin -->\n(.*?)\n<!-- styles:end -->", _skill(), re.S,
    )
    assert m, "clean-bibliography.md lost its <!-- styles:begin/end --> block"
    bullets = [
        re.fullmatch(r"- `(.*)`", line).group(1)
        for line in m.group(1).splitlines()
    ]
    assert bullets == rc.style_lines()
    out = _run("--list-styles")
    assert out.returncode == 0
    assert out.stdout.splitlines() == rc.style_lines()


def test_step_3g_names_only_known_styles():
    named = set(re.findall(r"--style=([a-z][a-z-]*)", _step_3g(_skill())))
    assert named, "Step 3g names no --style= at all — the scope regex broke"
    assert named <= set(rc.STYLES), sorted(named - set(rc.STYLES))


def test_apa_matches_comma_shape_only():
    bib = {(("lewis",), "1979"): "lewis1979"}
    _, n_comma, _ = rc.rewrite_citations(
        "As argued (Lewis, 1979).\n", bib, style="apa")
    _, n_paren, _ = rc.rewrite_citations(
        "As Lewis (1979) argued.\n", bib, style="apa")
    assert (n_comma, n_paren) == (1, 0)


def test_unknown_style_is_refused():
    with tempfile.TemporaryDirectory() as d:
        tex = Path(d) / "main.tex"
        bib = Path(d) / "references.bib"
        tex.write_text("As argued (Lewis 1979).\n", encoding="utf-8")
        bib.write_text(
            "@book{lewis1979, author = {Lewis, David}, year = {1979}}\n",
            encoding="utf-8",
        )
        before = tex.read_bytes()
        out = _run(str(tex), str(bib), "--style=harvard")
        assert out.returncode == 2
        assert "unknown --style='harvard'" in out.stderr
        assert tex.read_bytes() == before


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
