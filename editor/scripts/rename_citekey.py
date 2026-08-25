#!/usr/bin/env python3
r"""Pure citekey-rename rewriters, shared with the apply_response contract.

Two side-effect-free transforms that rewrite a citekey across a paper's editable
surfaces:

  * `rewrite_tex(text, old, new)`            — every `\cite*{...}` command, in
                                               BOTH families (see the note below)
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

VOCABULARY (task 464). These rewriters used to carry a hand-typed
`NATBIB_COMMANDS` list naming no biblatex command at all — so on a biblatex
paper `renameCitekey` rewrote nothing while the SAME atomic op swapped the
`.bib` entry out from under it. Measured on the pre-464 list: of
`\textcite{k} \parencite[p.~4]{k} \autocites{k}{other} \citet{k}`, exactly ONE
was rewritten and three were left pointing at a key that no longer exists — a
silent dangling-citation, on `answer-bib-review --library-sync`'s shipping path.
The vocabulary now comes from `cite_commands.py`, the silo's ported twin of
`src/lib/cite-commands.ts`, so the rename reaches every command the app can
represent and a registry addition on either side is a CI failure rather than a
drift.
"""

from __future__ import annotations

import re

from cite_commands import CITE_ARG_GROUP_RE, CITE_COMMAND_RE, cite_match_parts


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


def _rewrite_arg_run(arg_run: str, old: str, new: str) -> tuple[str, bool]:
    r"""Rewrite every key group inside a matched command's WHOLE argument run.

    A singular command's run is one `[pre][post]{keys}` group; a biblatex
    multi-cite (`\autocites{a}[p.~4]{b}`) carries several, and every one of them
    is a key group. Rewriting only the first — which is what a singular-shaped
    pattern does — is a SILENT PARTIAL: the op reports a change and leaves the
    later keys pointing at the retired citekey.
    """
    changed = False

    def _one(m: re.Match[str]) -> str:
        nonlocal changed
        brackets, keys_blob = m.group(1), m.group(2)
        rewritten, hit = _rewrite_keys(keys_blob, old, new)
        if not hit:
            return m.group(0)
        changed = True
        return f"{brackets}{{{rewritten}}}"

    return CITE_ARG_GROUP_RE.sub(_one, arg_run), changed


def rewrite_tex(text: str, old: str, new: str) -> tuple[str, int]:
    r"""Rewrite every `\cite*{...,<old>,...}` in `text` to use `<new>`.

    Returns (new_text, n_commands_changed). A command is counted once
    even if it has multiple keys in the list.
    """
    n = 0

    def _sub(m: re.Match[str]) -> str:
        nonlocal n
        cmd, star, arg_run = cite_match_parts(m)
        rewritten, changed = _rewrite_arg_run(arg_run, old, new)
        if changed:
            n += 1
            return f"\\{cmd}{star}{rewritten}"
        return m.group(0)

    return CITE_COMMAND_RE.sub(_sub, text), n


def rewrite_citations_json(data: dict, old: str, new: str) -> tuple[dict, int]:
    """Rewrite citation cards. Returns (new_data, n_cards_changed)."""
    items = data.get("citations") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return data, 0
    n = 0
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
            rewritten = CITE_COMMAND_RE.sub(
                lambda m: _sub_command(m, old, new), cmd
            )
            if rewritten != cmd:
                card["command"] = rewritten
                changed_here = True
        if changed_here:
            n += 1
    return data, n


def _sub_command(m: re.Match[str], old: str, new: str) -> str:
    cmd, star, arg_run = cite_match_parts(m)
    rewritten, changed = _rewrite_arg_run(arg_run, old, new)
    if not changed:
        return m.group(0)
    return f"\\{cmd}{star}{rewritten}"
