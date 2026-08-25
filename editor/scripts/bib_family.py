#!/usr/bin/env python3
r"""**Which bibliography family does this document use?** — the editor silo's
ONE answer, and the Python twin of `src/lib/bib-family.ts`.

natbib and biblatex are mutually exclusive TeX packages with overlapping but
non-identical cite vocabularies: `\citet` is natbib-only, `\textcite` is
biblatex-only, and each is UNDEFINED under the other package. So a cite command
composed for the wrong family does not render oddly — the paper stops
compiling ("Undefined control sequence"), and Virgil does not heal it
(`reconcileBibFamily` deliberately injects nothing when the preamble hard-loads
the other family, because co-loading both is itself fatal; it raises a
save-time conflict warning instead).

Task 344 settled this question for the app and reached NONE of this silo. Four
sites then answered it privately and disagreed with each other and with the
SSOT — an unqualified "prefer `\citet`" in the shared allowlist doctrine, a
re-derived `\usepackage{biblatex}` needle in `find-citation` that misses 4 of 6
real biblatex spellings (options, `\RequirePackage`, a wrapper package, a
comma-list) and fails toward `\citet` on every miss, no rule at all in
`draft-footnote`, and a literal `"citet"` default in `create_card.py` that
splices straight into the user's `.tex`. This module is that answer, once.

THE LADDER — the app's, in the app's order (`useCitations`' resolved
`bibPackage`, which is `stored ?? detectBibFamily(tex)`):

  1. **the STORED per-doc choice** (`virgil/citations.json` → `bibPackage`),
     narrowed exactly as `asBibFamily` narrows it. This is the AUTHORITY: it is
     present only when the user has chosen a family in the Citations panel, and
     when present nothing below it is consulted. A detector that cannot report
     "I found nothing" is a SEED, never an authority (task 344).
  2. the LIVE preamble's `\usepackage` / `\RequirePackage` load.
  3. the LIVE command usage over the whole source (natbib-only bucket first —
     baseline precedence, matching `detectCommandBibFamily`).
  4. `DEFAULT_BIB_FAMILY` — natbib, the family Virgil's own baseline preamble
     ships.

Rungs 2 and 3 believe only LIVE bytes: the source is projected through
`project_structural_latex` first, so a commented-out `% \usepackage{biblatex}`
— the single most ordinary thing in an academic preamble — is inert here
exactly as it is in the app. The skill needle this replaces scanned raw source
and read that comment as a live load.

NO WRITES. This module only reads, and it never persists what it detected —
same reason the app doesn't: a caller cannot distinguish "detected natbib" from
"found nothing", so writing it back would stomp a choice the user has not made.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import (  # noqa: E402
    BEGIN_DOCUMENT_RE,
    find_tex_file,
    project_structural_latex,
    read_json,
    resolve_doc,
    sidecar,
)
from cite_commands import (  # noqa: E402
    BIBLATEX_ONLY,
    NATBIB_ONLY,
    bucket_pattern,
    normalize_cite_name,
)

#: The family assumed when NOTHING pins one — Virgil's baseline, and the family
#: `VIRGIL_BASELINE_PACKAGES` ships in every Virgil-authored preamble. Spelled
#: once here for the same reason `DEFAULT_BIB_FAMILY` is spelled once in the app.
DEFAULT_BIB_FAMILY = "natbib"

FAMILIES = ("natbib", "biblatex")

#: The cite command a NEW citation takes in each family, by VOICE. The family is
#: not the composer's to choose — the voice is. Textual: "Smith (2008) argues…".
#: Parenthetical: "…as has been argued (Smith 2008)."
TEXTUAL_CITE_COMMAND = {"natbib": "citet", "biblatex": "textcite"}
PARENTHETICAL_CITE_COMMAND = {"natbib": "citep", "biblatex": "parencite"}


def _family_load_re(name: str) -> re.Pattern[str]:
    r"""A preamble load of package family `name` via `\usepackage` or
    `\RequirePackage`, tolerating an option group, a comma-separated package
    list, and a wrapper package (`-` is a word boundary, so `biblatex-chicago`
    satisfies `biblatex`). Byte-for-byte the app's `familyLoadRe`."""
    return re.compile(
        r"\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b" + name + r"\b[^}]*\}"
    )


_NATBIB_LOAD_RE = _family_load_re("natbib")
_BIBLATEX_LOAD_RE = _family_load_re("biblatex")
_NATBIB_ONLY_CMD_RE = bucket_pattern(NATBIB_ONLY)
_BIBLATEX_ONLY_CMD_RE = bucket_pattern(BIBLATEX_ONLY)


def as_bib_family(value) -> str | None:
    """Narrow an arbitrary stored value to a family, or `None` when it is
    neither — the sidecar types `bibPackage` as a free-form string. Mirrors
    `asBibFamily`."""
    return value if value in FAMILIES else None


def classify_cite_family(command: str) -> str | None:
    r"""Which family does this single cite command PIN, if any? `None` for a
    shared or kernel-neutral cite (`\cite`, `\citeauthor`), which pins neither.
    Accepts a bare name or a full command string."""
    name = normalize_cite_name(command)
    if not name:
        return None
    if name in NATBIB_ONLY:
        return "natbib"
    if name in BIBLATEX_ONLY:
        return "biblatex"
    return None


def live_preamble(tex: str) -> str:
    r"""The projected prefix up to the LIVE `\begin{document}`, or the whole
    projection when there is none.

    Fails OPEN like the app's `preambleSliceOfProjected`, and deliberately NOT
    like `_common.split_regions`, which answers ALL-BODY for a source with no
    marker. That direction is right for a preservation gate (it puts every word
    under comparison) and wrong here: a fragment or a `\input`-ed preamble-only
    file carrying `\usepackage{biblatex}` would report no preamble at all and
    fall through to the default, which is the family it is not.
    """
    live = project_structural_latex(tex)
    m = BEGIN_DOCUMENT_RE.search(live)
    return live[: m.start()] if m else live


def detect_preamble_bib_family(live_preamble_text: str) -> str | None:
    """Which family does this (already-projected) preamble hard-load? biblatex
    wins a pathological both-present, as on the app side."""
    if _BIBLATEX_LOAD_RE.search(live_preamble_text):
        return "biblatex"
    if _NATBIB_LOAD_RE.search(live_preamble_text):
        return "natbib"
    return None


def detect_command_bib_family(live_source: str) -> str | None:
    """Which family does the CITE-COMMAND USAGE pin? natbib-only wins (baseline
    precedence, matching `detectCommandBibFamily`); else biblatex-only; else
    `None`. Asked of the WHOLE live source, deliberately: it is a fallback for
    documents that pin no package, a `\\citep` inside a preamble `\\newcommand`
    is real usage, and narrowing a fallback can only lose detections."""
    if _NATBIB_ONLY_CMD_RE.search(live_source):
        return "natbib"
    if _BIBLATEX_ONLY_CMD_RE.search(live_source):
        return "biblatex"
    return None


def detect_bib_family(tex: str) -> str:
    """Rungs 2-4 over a `.tex` source. Never `None` — with nothing pinning a
    family the answer is `DEFAULT_BIB_FAMILY`, which is exactly why the result
    is a SEED and must never be written back."""
    live = project_structural_latex(tex)
    loaded = detect_preamble_bib_family(live_preamble(tex))
    if loaded:
        return loaded
    by_command = detect_command_bib_family(live)
    if by_command:
        return by_command
    return DEFAULT_BIB_FAMILY


def stored_bib_family(doc: Path) -> str | None:
    """Rung 1 alone — the authoritative per-doc choice off `citations.json`, or
    `None` when the user has never set one."""
    data = read_json(sidecar(doc, "citations.json"), {})
    if not isinstance(data, dict):
        return None
    return as_bib_family(data.get("bibPackage"))


def resolve_bib_family(doc: Path) -> str:
    """The whole ladder. THE door — every cite-emitting path in this silo asks
    it, and nothing re-derives it."""
    stored = stored_bib_family(doc)
    if stored:
        return stored
    # A paper folder with no readable .tex still has a family question and an
    # honest answer: the baseline. Asked QUIETLY rather than through
    # `find_tex_file`, whose miss path is `die()` — an "error: no .tex file
    # found" on stderr from a run that then succeeds is a misleading line, and
    # refusing outright would hand every composer its private fallback back.
    if not any(f.suffix == ".tex" for f in doc.iterdir()):
        return DEFAULT_BIB_FAMILY
    try:
        tex = find_tex_file(doc).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return DEFAULT_BIB_FAMILY
    return detect_bib_family(tex)


def cite_command_for(family: str, voice: str = "textual") -> str:
    """The cite command for a VOICE within a family — `citet`/`textcite` for
    textual, `citep`/`parencite` for parenthetical. Bare (no backslash), the
    shape `create_card.py --cite-command` takes."""
    table = TEXTUAL_CITE_COMMAND if voice == "textual" else PARENTHETICAL_CITE_COMMAND
    return table[family if family in FAMILIES else DEFAULT_BIB_FAMILY]


def main() -> None:
    p = argparse.ArgumentParser(
        description="Which bib family does this Virgil paper use? "
        "(stored bibPackage > live preamble load > live cite usage > natbib)"
    )
    p.add_argument("docPath")
    p.add_argument(
        "--voice",
        choices=("textual", "parenthetical"),
        default="textual",
        help="which VOICE to report a cite command for (default textual)",
    )
    a = p.parse_args()
    doc = resolve_doc(a.docPath)
    stored = stored_bib_family(doc)
    family = resolve_bib_family(doc)
    print(
        json.dumps(
            {
                "family": family,
                "source": "stored" if stored else "detected",
                "citeCommand": cite_command_for(family, a.voice),
                "textual": cite_command_for(family, "textual"),
                "parenthetical": cite_command_for(family, "parenthetical"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
