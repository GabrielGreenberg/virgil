#!/usr/bin/env python3
r"""Rename a citekey across a paper's .tex body and citation sidecar.

The bib entry body itself (in `references.bib`) is handled by the
library-sync mode of `/editor/answer-bib-review` — this helper only
touches:

  * `<docPath>/<doc>.tex`       — every natbib `\cite*{...}` command
  * `<docPath>/virgil/citations.json`  — `keys` arrays + `command` text

Atomic: writes to a temp sibling and `os.replace`s into place so
partial failures never leave a half-rewritten file.

Idempotent: if `<old>` no longer appears in the document, exits 0 with
zero changes reported.

CLI:

  python3 rename_citekey.py <docPath> <oldKey> <newKey>
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _common import die, find_tex_file, resolve_doc, sidecar  # noqa: E402


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


def _atomic_write_text(path: Path, content: str) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def _atomic_write_json(path: Path, data: object) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(tmp, path)


def rename_in_doc(doc: Path, old: str, new: str) -> dict:
    """Apply the rename across the document. Returns a summary dict."""
    if old == new:
        return {
            "tex_commands_changed": 0,
            "citation_cards_changed": 0,
            "noop": True,
        }

    summary: dict = {
        "tex_commands_changed": 0,
        "citation_cards_changed": 0,
        "noop": False,
    }

    # 1) document .tex
    tex_path = find_tex_file(doc)
    tex_text = tex_path.read_text(encoding="utf-8")
    new_tex, n_tex = rewrite_tex(tex_text, old, new)
    if n_tex:
        _atomic_write_text(tex_path, new_tex)
    summary["tex_commands_changed"] = n_tex
    summary["tex_file"] = str(tex_path)

    # 2) virgil/citations.json (optional sidecar — may not exist)
    cites = sidecar(doc, "citations.json")
    if cites.exists():
        try:
            data = json.loads(cites.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            die(f"invalid JSON in {cites}: {e}")
        data, n_cards = rewrite_citations_json(data, old, new)
        if n_cards:
            _atomic_write_json(cites, data)
        summary["citation_cards_changed"] = n_cards
        summary["citations_file"] = str(cites)

    return summary


def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("docPath")
    ap.add_argument("oldKey")
    ap.add_argument("newKey")
    args = ap.parse_args(argv)

    doc = resolve_doc(args.docPath)
    summary = rename_in_doc(doc, args.oldKey, args.newKey)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
