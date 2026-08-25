#!/usr/bin/env python3
r"""The editor silo's cite-command VOCABULARY — the Python twin of
`src/lib/cite-commands.ts`.

Two questions get asked about a `\cite`-family command in this silo, and until
task 464 each site answered them privately:

  * *which commands exist?* — `rename_citekey.py` carried a hand-typed
    `NATBIB_COMMANDS` list naming NO biblatex command at all, so a citekey
    rename on a biblatex paper rewrote nothing while the same atomic op swapped
    the `.bib` entry out from under it (measured: 1 of 4 cites rewritten,
    3 left dangling).
  * *which family does a command PIN?* — see `bib_family.py`, which classifies
    against these buckets exactly as `bib-family.ts` classifies against the TS
    ones.

The split mirrors the app's: the vocabulary is one module (a consumer may want
the names without the family question), the family policy is another. Both are
PORTS, not restatements — `editor/skills/__tests__/bib-family-authority.test.ts`
reads `src/lib/cite-commands.ts` and asserts every bucket here equals its TS
twin, so a registry addition on either side fails CI rather than drifting.

NO I/O, no argparse: this is a leaf both `bib_family.py` and `rename_citekey.py`
import.
"""

from __future__ import annotations

import re

# Canonical (lowercase) base names that accept the multi-cite
# `\cmds[pre1][post1]{key1}[pre2][post2]{key2}…` syntax (biblatex plural forms).
MULTI_CITE_NAMES: frozenset[str] = frozenset(
    {"cites", "textcites", "parencites", "autocites", "footcites", "smartcites"}
)

# Every canonical lowercase command name the app understands, in the TS
# registry's order. Longest-first alternation is built below, not stored here.
KNOWN_CITE_COMMANDS: tuple[str, ...] = (
    # natbib
    "cite",
    "citet",
    "citep",
    "citealt",
    "citealp",
    "citeauthor",
    "citeyear",
    "citeyearpar",
    "citetext",
    "citenum",
    # biblatex
    "textcite",
    "parencite",
    "autocite",
    "footcite",
    "smartcite",
    "fullcite",
    "footfullcite",
    "citetitle",
    "citedate",
    "citeurl",
    "nocite",
    # biblatex multi-cite forms
    "cites",
    "textcites",
    "parencites",
    "autocites",
    "footcites",
    "smartcites",
)

#: Commands only natbib defines — their presence PINS natbib.
NATBIB_ONLY: frozenset[str] = frozenset(
    {"citet", "citep", "citealt", "citealp", "citeyearpar", "citetext", "citenum"}
)

#: Commands BOTH families define — they pin neither on their own.
SHARED: frozenset[str] = frozenset({"cite", "nocite", "citeauthor", "citeyear"})

#: The subset of SHARED the LaTeX kernel itself defines — truly package-neutral.
KERNEL_NEUTRAL: frozenset[str] = frozenset({"cite", "nocite"})

#: Commands only biblatex defines — DERIVED as the registry remainder, exactly
#: as the TS side derives it, so a new registry entry defaults to the biblatex
#: bucket (natbib's command set is closed).
BIBLATEX_ONLY: frozenset[str] = frozenset(
    c for c in KNOWN_CITE_COMMANDS if c not in NATBIB_ONLY and c not in SHARED
)


def _capitalized(name: str) -> str:
    return name[0].upper() + name[1:]


def _alternation(names) -> str:
    """Longest-first alternation over `names` plus their sentence-start
    capitalized forms — the convention `cite-commands.ts` states, so
    `footfullcite` is preferred over `footcite` and `citeyearpar` over
    `citeyear`."""
    all_names: list[str] = []
    for n in names:
        all_names.append(n)
        all_names.append(_capitalized(n))
    all_names.sort(key=lambda s: (-len(s), s))
    return "|".join(re.escape(n) for n in all_names)


def bucket_pattern(names) -> re.Pattern[str]:
    r"""`\<name>` not followed by another letter — the boundary-guarded bucket
    probe `bucketRe` builds on the TS side (used for the command-usage family
    fallback)."""
    return re.compile(r"\\(?:" + _alternation(names) + r")(?![a-zA-Z])")


# A cite command, its optional star, and its WHOLE argument run.
#
# TWO alternatives, because the two shapes take DIFFERENT arities and saying so
# is what keeps the pattern from over-reaching:
#
#   * a MULTI-cite plural form (`\autocites{a}[p.~4]{b}`) takes the
#     `[pre][post]{keys}` group REPEATED — writing the singular form only, which
#     is what `rename_citekey.py` did, silently rewrites the FIRST key group and
#     leaves the rest pointing at a retired citekey;
#   * a SINGULAR command takes exactly ONE such group — so `\citet{a}{Title}`
#     cannot have its second, unrelated brace group swallowed as a key list.
#
# The multi alternative is listed first so `\cites{a}{b}` cannot be read as the
# singular `\cite` (whose run would then have to start at `s` and fails anyway —
# the argument run IS the name boundary, which is also why no trailing
# `(?![a-zA-Z])` guard is needed: `\citeauthorX{k}` matches nothing).
#
# Read the three parts through `cite_match_parts` rather than by group number.
_ARG_GROUP = r"(?:\[[^\]]*\]){0,2}\{[^{}]*\}"
_SINGULAR_NAMES = [c for c in KNOWN_CITE_COMMANDS if c not in MULTI_CITE_NAMES]

CITE_COMMAND_RE: re.Pattern[str] = re.compile(
    r"\\(?:"
    r"(?P<mname>" + _alternation(MULTI_CITE_NAMES) + r")(?P<mstar>\*?)"
    r"(?P<mrun>(?:" + _ARG_GROUP + r")+)"
    r"|"
    r"(?P<sname>" + _alternation(_SINGULAR_NAMES) + r")(?P<sstar>\*?)"
    r"(?P<srun>" + _ARG_GROUP + r")"
    r")"
)

#: One `[pre][post]{keys}` group inside a matched argument run.
CITE_ARG_GROUP_RE: re.Pattern[str] = re.compile(r"((?:\[[^\]]*\]){0,2})\{([^{}]*)\}")


def cite_match_parts(m: re.Match[str]) -> tuple[str, str, str]:
    """`(name, star, arg_run)` from a `CITE_COMMAND_RE` match, whichever
    alternative fired. Read the parts through this, never by group number."""
    if m.group("mname"):
        return m.group("mname"), m.group("mstar"), m.group("mrun")
    return m.group("sname"), m.group("sstar"), m.group("srun")


def normalize_cite_name(command: str) -> str | None:
    r"""`\Citep[see][]{k}` → `citep`. Strips the backslash, the arguments, a
    trailing `*`, and a sentence-start capital. `None` when the input carries no
    leading command token. Mirrors `normalizeCiteName` in bib-family.ts."""
    m = re.match(r"\\?([A-Za-z]+)", command.strip())
    if not m:
        return None
    name = m.group(1)
    return name[0].lower() + name[1:]
