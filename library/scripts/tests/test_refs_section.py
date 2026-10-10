"""Task 1038 — ONE door answers "where is the References section?".

Fourteen library scripts each carried their own References-heading regex,
and they disagreed. `rewrite_citations.py` knew only the literal
`\\section{References}`, so on a `\\section{Bibliography}` /
`\\section{Works Cited}` / `\\section*{References}` paper — which
format/itemize/populate all accepted one step earlier — it treated the
whole file as body and rewrote the bibliography list into `\\cite{}` chips.

Three contracts:

  1. the door (`_refs_section`) over the heading variants;
  2. `rewrite_citations` leaves the list byte-identical under every variant
     while still rewriting body citations;
  3. a CENSUS: no `library/scripts/*.py` other than the door spells the
     heading vocabulary in code (docstrings are prose and exempt).

Run: python3 library/scripts/tests/test_refs_section.py
"""

from __future__ import annotations

import ast
import re
import subprocess
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_SCRIPTS))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from _refs_section import (  # noqa: E402
    body_end,
    is_heading_line,
    name_alternation,
    references_span,
    references_spans,
)


BODY = "\\section{Intro}\nAs Smith 2001 argued, things hold.\n\n"
# The list entry carries a bare `Smith 2001` mention — exactly what the
# pre-door rewriter turned into `\\citealt{}` under a non-literal heading.
ITEM = ("\\begin{itemize}\n\\item \\textbf{Smith, J. 2001.} A Book. "
        "Reviewed in Smith 2001 again.\n\\end{itemize}\n")

HEADING_VARIANTS = [
    "\\section{References}",
    "\\section{Bibliography}",
    "\\section{Works Cited}",
    "\\section*{References}",
    "\\section*{Bibliography}",
    "\\subsection*{References}",
    "\\chapter{Bibliography}",
    "\\section{REFERENCES}",
    "\\section{Works  Cited}",
    "\\section{References Cited}",
    "\\section[Refs]{References}",
]


# --- 1. the door -----------------------------------------------------------


def test_every_heading_variant_is_found():
    for head in HEADING_VARIANTS:
        text = BODY + head + "\n" + ITEM
        span = references_span(text)
        assert span is not None, head
        assert span.head_start == len(BODY), head
        assert text[span.body_start:].startswith("\n\\begin{itemize}"), head
        assert span.end == len(text), head
        assert body_end(text) == len(BODY), head


def test_not_references():
    for head in ("\\section{Referencing practice}", "\\section{Notes}",
                 "\\section{Index}", "\\subsubsection{References}",
                 "\\section{On Bibliographies}"):
        text = BODY + head + "\n" + ITEM
        assert references_span(text) is None, head
        assert body_end(text) == len(text), head


def test_commented_heading_is_not_a_heading():
    text = BODY + "% \\section{References}\n" + ITEM
    assert references_span(text) is None
    # An escaped percent does not comment the line out.
    text = BODY + "50\\% \\section{References}\n" + ITEM
    assert references_span(text) is not None


def test_span_ends_at_next_same_or_higher_heading():
    text = (BODY + "\\section{References}\n" + ITEM
            + "\\subsection{Primary sources}\nmore\n"
            + "\\section*{Appendix}\nappendix\n")
    span = references_span(text)
    assert text[span.end:].startswith("\\section*{Appendix}")
    assert "Primary sources" in text[span.body_start:span.end]
    # A subsection-level References ends at the next subsection.
    text = ("\\section{Ch 1}\nx\n\\subsection*{References}\n" + ITEM
            + "\\subsection{Next}\ny\n")
    span = references_span(text)
    assert text[span.end:].startswith("\\subsection{Next}")


def test_back_matter_opt_in_takes_exact_titles_only():
    text = BODY + "\\section{Notes}\n1. a note\n"
    assert references_span(text) is None
    assert body_end(text, back_matter=True) == len(BODY)
    text = BODY + "\\section{Notes on Method}\nx\n"
    assert body_end(text, back_matter=True) == len(text)
    assert is_heading_line("  \\section*{Endnotes}", back_matter=True)
    assert not is_heading_line("\\section{Endnotes}")
    assert is_heading_line("\\section{Bibliography}")


def test_edited_volume_has_one_span_per_chapter():
    text = ("\\chapter{A}\nx\n\\section*{References}\n" + ITEM
            + "\\chapter{B}\ny\n\\section*{References}\n" + ITEM)
    spans = references_spans(text)
    assert len(spans) == 2
    assert text[spans[0].end:].startswith("\\chapter{B}")


def test_name_alternation_upper_keeps_whitespace_class():
    alt = name_alternation(upper=True)
    assert re.fullmatch(alt, "WORKS CITED")
    assert not re.fullmatch(alt, "Works Cited")


# --- 2. rewrite_citations leaves the list alone ----------------------------


BIB = "@book{smith2001book,\n  author = {Smith, John},\n  title = {A Book},\n  year = {2001},\n}\n"


def test_rewrite_citations_never_touches_the_list(tmp_path):
    for head in HEADING_VARIANTS:
        tail = head + "\n" + ITEM
        tex = tmp_path / "main.tex"
        bib = tmp_path / "references.bib"
        tex.write_text(BODY + tail, encoding="utf-8")
        bib.write_text(BIB, encoding="utf-8")
        subprocess.run(
            [sys.executable, str(_SCRIPTS / "rewrite_citations.py"),
             str(tex), str(bib)],
            check=True, capture_output=True, text=True,
        )
        out = tex.read_text(encoding="utf-8")
        assert out.endswith(tail), (head, out)
        body = out[: -len(tail)]
        assert "smith2001book" in body, (head, body)


def test_bracket_numeric_reads_the_list_under_any_heading(tmp_path):
    import rewrite_citations as rc

    tail = ("\\section*{Bibliography}\n\\begin{enumerate}\n"
            "\\item[{[1]}] J. Smith. A Book. 2001.\n\\end{enumerate}\n")
    text = "Body cites [1].\n\n" + tail
    span = references_span(text)
    assert span is not None
    # The rewriter's own body/tail split keeps the list out of the scan.
    new, _count = rc.rewrite_bracket_numeric(text, {"1": "smith2001"})
    assert new.endswith(tail)
    assert "\\cite{smith2001}" in new


# --- 3. census --------------------------------------------------------------

_HEADING_LITERAL_RE = re.compile(
    r"(?i)section\*?\\?\{\s*(references|bibliography|works)")
_ALTERNATION_RE = re.compile(
    r"(?i)(references|bibliography|works\s*cited)\s*\|"
    r"|\|\s*(references|bibliography|works)")


def _is_locator_literal(s: str) -> bool:
    return bool(_HEADING_LITERAL_RE.search(s) or _ALTERNATION_RE.search(s))


def _docstring_nodes(tree: ast.AST) -> set[int]:
    ids: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef,
                             ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", [])
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                ids.add(id(body[0].value))
    return ids


def test_census_no_script_spells_the_heading_vocabulary():
    """A string constant in code that names a References heading — a
    `\\section{References}` literal, or an alternation over the names — is
    a second locator. Route it through `_refs_section` instead."""
    offenders: list[str] = []
    for path in sorted(_SCRIPTS.glob("*.py")):
        if path.name == "_refs_section.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
        docs = _docstring_nodes(tree)
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
                continue
            if id(node) in docs:
                continue
            s = node.value
            if _is_locator_literal(s):
                offenders.append(f"{path.name}:{node.lineno}: {s[:70]!r}")
    assert not offenders, (
        "References-heading vocabulary spelled outside _refs_section.py "
        "(ask references_span / body_end / is_heading_line / "
        "name_alternation instead):\n  " + "\n  ".join(offenders)
    )


def test_census_catches_a_planted_locator(tmp_path):
    # The census must not be vacuous: the retired shapes trip its matcher.
    for planted in (r'text.find(r"\section{References}")',
                    r're.compile(r"\\section\{(References|Bibliography)\}")'):
        tree = ast.parse(planted)
        hits = [n for n in ast.walk(tree)
                if isinstance(n, ast.Constant) and isinstance(n.value, str)
                and _is_locator_literal(n.value)]
        assert hits, planted


if __name__ == "__main__":
    from _standalone import run_standalone

    raise SystemExit(run_standalone(dict(globals())))
