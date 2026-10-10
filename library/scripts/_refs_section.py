"""The ONE answer to "where is the References section?" (task 1038).

Fourteen library scripts used to carry their own regex for the
bibliography heading, and they disagreed: `format_references_section.py`
accepted References / Bibliography / Works Cited (unstarred `\\section`
only), `populate_references_bib_from_itemize.py` also took starred forms
and `\\subsection`, and `rewrite_citations.py` knew only the literal
`\\section{References}`. On a paper headed `\\section{Bibliography}` the
earlier clean-bibliography steps found and itemized the list, and then
the citation pass, finding no "References", treated the whole file as
body and rewrote the bibliography entries themselves into `\\cite{}`
chips.

This module owns the vocabulary and the boundary rule; every script asks
it. `tests/test_refs_section.py` carries a census that fails on any
`library/scripts/*.py` spelling the heading vocabulary itself.

Vocabulary
----------
* **References names** — References, Bibliography, Works Cited (also
  "Works Cited" with any whitespace). A title that BEGINS with one of
  these as a whole word counts ("References Cited", "Bibliography of
  Primary Sources"), case-insensitively (OCR'd papers often head the
  list REFERENCES).
* **Back-matter names** (opt in with ``back_matter=True``) — the
  references names plus Notes, Endnotes, Index. These are ambiguous as
  prefixes ("Notes on Method", "Index Theory"), so they must be the
  WHOLE title.

Heading shape
-------------
``\\part`` / ``\\chapter`` / ``\\section`` / ``\\subsection``, starred or
not, with an optional ``[short title]``. A heading on a commented-out
line (an unescaped ``%`` earlier on the same line) is not a heading.

Boundary
--------
A section runs from its heading to the next heading of the SAME OR
HIGHER level (a ``\\subsection{Primary sources}`` inside
``\\section{References}`` stays inside it), or to the end of the text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

REFS_NAMES: tuple[str, ...] = ("References", "Bibliography", "Works Cited")
_BACK_MATTER_ONLY: tuple[str, ...] = ("Notes", "Endnotes", "Index")
BACK_MATTER_NAMES: tuple[str, ...] = REFS_NAMES + _BACK_MATTER_ONLY

# Lower rank = higher level.
_LEVEL_RANK = {"part": 0, "chapter": 1, "section": 2, "subsection": 3}


def _name_pattern(name: str) -> str:
    return r"\s+".join(re.escape(w) for w in name.split())


def name_alternation(
    names: tuple[str, ...] = REFS_NAMES, *, upper: bool = False,
) -> str:
    """A regex alternation (no group) over `names`, whitespace-tolerant;
    `upper=True` spells the names in capitals (for case-SENSITIVE
    patterns such as all-caps running headers).

    For callers that need the vocabulary inside a different pattern (e.g.
    the running-header stripper in `format_references_section.py`) rather
    than a heading locator.
    """
    return "|".join(_name_pattern(n.upper() if upper else n) for n in names)


_ANY_HEADING_RE = re.compile(
    r"\\(part|chapter|section|subsection)\*?\s*(?:\[[^\]\n]*\])?\s*\{"
)

_REFS_TITLE_RE = re.compile(
    r"\{\s*(" + name_alternation(REFS_NAMES) + r")\b[^{}\n]{0,60}\}",
    re.I,
)
_BACK_ONLY_TITLE_RE = re.compile(
    r"\{\s*(" + name_alternation(_BACK_MATTER_ONLY) + r")\s*[.:]?\s*\}",
    re.I,
)


@dataclass(frozen=True)
class HeadingSpan:
    """One References (or back-matter) section.

    head_start — offset of the heading's backslash.
    body_start — offset just past the heading's closing brace.
    end        — offset of the next same-or-higher-level heading, or len(text).
    level      — "part" | "chapter" | "section" | "subsection".
    name       — the matched name as written ("Bibliography", "REFERENCES").
    """

    head_start: int
    body_start: int
    end: int
    level: str
    name: str


def _commented(text: str, pos: int) -> bool:
    line_start = text.rfind("\n", 0, pos) + 1
    i = line_start
    while i < pos:
        c = text[i]
        if c == "\\":
            i += 2
            continue
        if c == "%":
            return True
        i += 1
    return False


def _headings(text: str):
    """Yield (start, brace_pos, level) for every live heading command."""
    for m in _ANY_HEADING_RE.finditer(text):
        if _commented(text, m.start()):
            continue
        yield m.start(), m.end() - 1, m.group(1)


def _title_match(text: str, brace_pos: int, back_matter: bool):
    m = _REFS_TITLE_RE.match(text, brace_pos)
    if m:
        return m
    if back_matter:
        return _BACK_ONLY_TITLE_RE.match(text, brace_pos)
    return None


def references_spans(text: str, *, back_matter: bool = False) -> list[HeadingSpan]:
    """Every References section in document order (edited volumes carry
    one per chapter). A matching heading nested inside an earlier span is
    part of that span, not a new one."""
    heads = list(_headings(text))
    spans: list[HeadingSpan] = []
    for i, (start, brace, level) in enumerate(heads):
        if spans and start < spans[-1].end:
            continue
        tm = _title_match(text, brace, back_matter)
        if not tm:
            continue
        rank = _LEVEL_RANK[level]
        end = len(text)
        for nstart, _nbrace, nlevel in heads[i + 1:]:
            if _LEVEL_RANK[nlevel] <= rank:
                end = nstart
                break
        spans.append(HeadingSpan(start, tm.end(), end, level, tm.group(1)))
    return spans


def references_span(text: str, *, back_matter: bool = False) -> HeadingSpan | None:
    """The FIRST References section, or None."""
    spans = references_spans(text, back_matter=back_matter)
    return spans[0] if spans else None


def body_end(text: str, *, back_matter: bool = False) -> int:
    """Where the body ends: the first References heading, else len(text).

    The conservative cut for passes that must never touch the list — the
    whole tail from the heading on is treated as not-body, even if an
    appendix follows.
    """
    span = references_span(text, back_matter=back_matter)
    return span.head_start if span else len(text)


def is_heading_line(line: str, *, back_matter: bool = False) -> bool:
    """True when `line` (leading whitespace allowed) opens a References
    (or, with back_matter, a back-matter) section — for line-by-line
    scanners."""
    stripped = line.lstrip()
    m = _ANY_HEADING_RE.match(stripped)
    return bool(m) and _title_match(stripped, m.end() - 1, back_matter) is not None
