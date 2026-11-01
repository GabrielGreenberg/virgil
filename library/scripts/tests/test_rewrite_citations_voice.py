"""Task 1405 — the rewriter's citation VOICE follows the surface it replaces.

natbib (Virgil's baseline family, and what a library main.tex gets) renders
bare `\\cite` TEXTUALLY — "Smith (2008)". The rewriter once turned
`(Smith 2008)` into `\\cite{…}`, so every parenthetical citation in a
deep-indexed paper lost its parentheses. This suite pins:

  * each surface → its voice command (parenthetical / textual / bare), and that
    no rewrite path emits bare `\\cite`;
  * a lone `(` shared with a locator or a second citation is NOT consumed (it
    once was, orphaning the `)`);
  * doctrine ↔ executor agreement: `VOICE_COMMANDS` matches the natbib column
    of _latex-allowlist.md's voice table, and no library skill calls bare
    `\\cite` the parenthetical voice.

Run: python3 -m pytest library/scripts/tests/test_rewrite_citations_voice.py -v
"""
import re
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))

import rewrite_citations as rc  # noqa: E402

_SKILLS = _SCRIPTS.parent / "skills"

_BIBMAP = {
    (("smith",), "2008"): "smith2008",
    (("jones",), "2010"): "jones2010",
    (("quine",), "1945"): "quine1945",
    (("quine",), "1963"): "quine1963",
}


def _rw(body: str) -> str:
    out, _n, _u = rc.rewrite_citations(body, _BIBMAP)
    return out


def test_parenthesized_source_is_citep_and_consumes_the_parens():
    out = _rw("As argued (Smith 2008).\n")
    assert out == "As argued \\citep{smith2008}.\n"


def test_textual_source_is_citet():
    out, _n, _u = rc.rewrite_author_year_paren("Smith (2008) argues.\n", _BIBMAP)
    assert out == "\\citet{smith2008} argues.\n"


def test_bare_prose_and_footnote_stay_citealt():
    assert _rw("as Smith 2008 shows.\n") == "as \\citealt{smith2008} shows.\n"
    assert (
        _rw("Text.\\footnote{See Smith 2008.}\n")
        == "Text.\\footnote{See \\citealt{smith2008}.}\n"
    )


def test_shared_parens_are_kept_and_balanced():
    out = _rw("as argued (Smith 2008, p. 5).\n")
    assert out == "as argued (\\citealt{smith2008}, p. 5).\n"
    out = _rw("as argued (Smith 2008; Jones 2010).\n")
    assert out == "as argued (\\citealt{smith2008}; \\citealt{jones2010}).\n"
    assert rc.check_paren_balance(out) == []


def test_multi_year_fold_is_parenthetical():
    out, n = rc.rewrite_multi_year_same_author("as (Quine 1945, 1963) says\n", _BIBMAP)
    assert n == 1
    assert out == "as \\citep{quine1945, quine1963} says\n"


def test_bracket_sources_are_parenthetical():
    out, _ = rc.rewrite_bracket_numeric("cites [1, 2].\n", {"1": "a2001", "2": "b2002"})
    assert out == "cites \\citep{a2001,b2002}.\n"
    out, _ = rc.rewrite_bracket_keys("cites [GG01].\n", {"GG01": "gg2001"})
    assert out == "cites \\citep{gg2001}.\n"


def test_no_rewrite_emits_bare_cite():
    """Every emission goes through `_cite`; no literal bare `\\cite{` survives
    in the script's code (comments and docstrings aside)."""
    src = (_SCRIPTS / "rewrite_citations.py").read_text(encoding="utf-8")
    code = re.sub(r'"""[\s\S]*?"""', "", src)
    code = "\n".join(l.split("#", 1)[0] for l in code.splitlines())
    # `\\cite{` / `\\cite[p.~…]` — not the read-side `\\cite[a-z]*` regexes.
    assert not re.search(r"\\\\cite(\{|\[[^a-z])", code), "bare \\cite emitted outside _cite"
    assert "cite" not in rc.VOICE_COMMANDS.values()


def test_voice_table_matches_the_allowlist():
    text = (_SKILLS / "_latex-allowlist.md").read_text(encoding="utf-8")
    for voice in ("textual", "parenthetical"):
        row = re.search(rf"^\| {voice} —[^|]*\| `\\(\w+)\{{", text, re.M)
        assert row, f"no {voice} row in _latex-allowlist.md's voice table"
        assert rc.VOICE_COMMANDS[voice] == row.group(1)


def test_no_skill_calls_bare_cite_parenthetical():
    bad = re.compile(r"`\\cite(?:\{[^`]*\}|\[[^`]*)?`[^\n]{0,20}parenthetical", re.I)
    hits = []
    for md in sorted(_SKILLS.glob("*.md")):
        for i, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
            if bad.search(line):
                hits.append(f"{md.name}:{i}: {line.strip()}")
    assert not hits, "bare \\cite named parenthetical:\n" + "\n".join(hits)


if __name__ == "__main__":
    from _standalone import main

    sys.exit(main(globals()))
