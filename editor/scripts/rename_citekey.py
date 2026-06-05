#!/usr/bin/env python3
r"""Pure citekey-rename rewriters, shared with the apply_response contract.

Two side-effect-free transforms that rewrite a citekey across a paper's editable
surfaces:

  * `rewrite_tex(text, old, new)`            — every natbib `\cite*{...}` command
  * `rewrite_citations_json(data, old, new)` — `citations.json` cards (the `keys`
                                               arrays + the `command` text)

These carry NO I/O. The single sanctioned writer is `apply_response.py`'s
`renameCitekey` capability (op-json `{ "renameCitekey": { "oldKey", "newKey" } }`),
which imports these rewriters and folds their output into ONE atomic, pen-protected
commit — alongside the `references.bib` swap, so a library-sync of an entry (new
bib body + every `\cite*{}` retargeted + every citation card retargeted) lands
all-or-nothing. A crash can't leave the bib swapped but the cites dangling, or
vice-versa.

This module USED to carry its own standalone `os.replace` write path
(`rename_in_doc` + private atomic writers) that rewrote `document.tex` and
`virgil/citations.json` directly — outside the editing pen and not atomic with the
`references.bib` swap. That was the last skill hand-edit of a paper file outside
the contract; it was retired (chip 16) once `answer-bib-review --library-sync`
moved its paper-side writes onto the `renameCitekey` op. The rewriters stayed
(shared, pure); the private write path is gone, so the contract is now the only
writer. (`_common.atomic_write` — the contract's atomic N-file primitive — was
itself generalized from this module's original single-file `os.replace` writer.)

Idempotent by construction: if `<old>` doesn't appear, the rewriters return the
input unchanged with a 0 count, so the contract treats an absent key as a no-op.
"""

from __future__ import annotations

import re


# Every natbib citation command we expect to encounter, lowercase and
# capitalized variants. The body is `\<cmd>[...]?[...]?{<csv-of-keys>}`.
NATBIB_COMMANDS = [
    "cite",
    "citet",
    "citep",
    "citealt",
    "citealp",
    "citeauthor",
    "citeyear",
    "citeyearpar",
    "citenum",
    "Citet",
    "Citep",
    "Citealt",
    "Citealp",
    "Citeauthor",
]


def _cite_pattern() -> re.Pattern[str]:
    cmd_alt = "|".join(re.escape(c) for c in NATBIB_COMMANDS)
    # \<cmd>  (optional [..])(optional [..])  {<keys>}
    return re.compile(
        r"\\(" + cmd_alt + r")"           # 1: command
        r"((?:\[[^\]]*\]){0,2})"          # 2: optional bracket args
        r"\{([^{}]*)\}"                    # 3: keys (no nested braces)
    )


def _rewrite_keys(keys_blob: str, old: str, new: str) -> tuple[str, bool]:
    r"""Replace `old` with `new` inside a CSV `\citet{a, b, c}` key list.

    Returns (new_blob, changed).
    """
    parts = [k.strip() for k in keys_blob.split(",")]
    changed = False
    out: list[str] = []
    for p in parts:
        if p == old:
            out.append(new)
            changed = True
        else:
            out.append(p)
    # Preserve user's spacing style: rejoin with ", " (matches `citations.json`
    # rendering and is the conventional way natbib examples are written).
    return ", ".join(out), changed


def rewrite_tex(text: str, old: str, new: str) -> tuple[str, int]:
    r"""Rewrite every `\cite*{...,<old>,...}` in `text` to use `<new>`.

    Returns (new_text, n_commands_changed). A command is counted once
    even if it has multiple keys in the list.
    """
    pat = _cite_pattern()
    n = 0

    def _sub(m: re.Match[str]) -> str:
        nonlocal n
        cmd, brackets, keys_blob = m.group(1), m.group(2), m.group(3)
        rewritten, changed = _rewrite_keys(keys_blob, old, new)
        if changed:
            n += 1
            return f"\\{cmd}{brackets}{{{rewritten}}}"
        return m.group(0)

    return pat.sub(_sub, text), n


def rewrite_citations_json(data: dict, old: str, new: str) -> tuple[dict, int]:
    """Rewrite citation cards. Returns (new_data, n_cards_changed)."""
    items = data.get("citations") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return data, 0
    n = 0
    cmd_pat = _cite_pattern()
    for card in items:
        if not isinstance(card, dict):
            continue
        changed_here = False
        keys = card.get("keys")
        if isinstance(keys, list):
            new_keys = [new if k == old else k for k in keys]
            if new_keys != keys:
                card["keys"] = new_keys
                changed_here = True
        cmd = card.get("command")
        if isinstance(cmd, str):
            rewritten = cmd_pat.sub(
                lambda m: _sub_command(m, old, new), cmd
            )
            if rewritten != cmd:
                card["command"] = rewritten
                changed_here = True
        if changed_here:
            n += 1
    return data, n


def _sub_command(m: re.Match[str], old: str, new: str) -> str:
    cmd, brackets, keys_blob = m.group(1), m.group(2), m.group(3)
    rewritten, changed = _rewrite_keys(keys_blob, old, new)
    if not changed:
        return m.group(0)
    return f"\\{cmd}{brackets}{{{rewritten}}}"
