#!/usr/bin/env python3
r"""A library citekey rename, as it reaches ONE paper folder (task 620).

A library rename (`repair_etal_citekeys` rename/merge, `fuzzy_citekey_disambiguate`)
retargets a citekey that other papers CITE. Before task 620 each of those writers
rewrote only `\cite{old}` in `main.tex`, with a private `\b`-delimited regex:

  * `\b` breaks at `-` and `:`, so renaming `smith2020foo` also rewrote
    `\citet{smith2020foo-2}` and `\cite{van-smith2020foo}`;
  * one optional argument only, so `\citep[see][p.~4]{smith2020foo}` stayed stale;
  * the paper's `references.bib` kept `@x{old,` — a dangling cite, which a later
    merge-bibs could resurrect in master.bib;
  * the paper's citekey-keyed sidecars (the annotation, a pending bib review, the
    citation cards) stayed under `old`, where the panels no longer look.

The editor silo already answers all three questions, tested:
`editor/scripts/rename_citekey.py` (`rewrite_tex` — the app's cite vocabulary,
keys split the TeX way) and `editor/scripts/citekey_sidecars.py` (the task-615
manifest `citekey_keyed_sidecars.json` + one re-keyer per rule). This module
IMPORTS them rather than porting them — a second copy is a second thing to drift.
The editor silo lands in a sibling directory under both layouts (the same seam
`bib_auth._import_library_path_resolver` crosses):

    repo:    library/scripts/_citekey_rename.py  →  ../../editor/scripts/
    synced:  .virgil/scripts/library/…           →  ../editor/

When the editor silo is NOT reachable this module raises instead of degrading: a
rename that silently skips a surface is the bug it exists to close.

The `references.bib` half goes through `_bib_parse.rename_entry_text` (the
per-paper door: LAST line-anchored entry, refuses an untrustworthy extent, and a
merge onto a key the file already has REMOVES the old entry instead of minting a
duplicate).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from _bib_parse import rename_entry_text

_HERE = Path(__file__).resolve().parent
_EDITOR_DIRS = (_HERE.parent.parent / "editor" / "scripts", _HERE.parent / "editor")


def _editor_modules():
    """`(rename_citekey, citekey_sidecars)` from the editor silo, or raise."""
    for d in _EDITOR_DIRS:
        if (d / "rename_citekey.py").exists() and (d / "citekey_sidecars.py").exists():
            if str(d) not in sys.path:
                # Appended, not prepended: the editor modules import siblings
                # (`cite_commands`) by bare name, and a library module must
                # never be shadowed by an editor one.
                sys.path.append(str(d))
            import citekey_sidecars  # noqa: PLC0415
            import rename_citekey  # noqa: PLC0415
            return rename_citekey, citekey_sidecars
    raise RuntimeError(
        "citekey rename needs the editor skill scripts (rename_citekey.py, "
        f"citekey_sidecars.py) and found them in none of: "
        f"{', '.join(str(d) for d in _EDITOR_DIRS)} — refusing a partial rename"
    )


def rewrite_cite_keys(tex: str, old: str, new: str) -> tuple[str, int]:
    r"""Every `\cite*{…}` naming `old` rewritten to `new`. Returns (tex, n_commands).

    THE library's cite-key rewriter — the editor's `rewrite_tex`: a key is
    delimited by `{`, `,`, `}`, whitespace and `%`-comments, and every optional
    argument / multi-cite group is walked."""
    rc, _ = _editor_modules()
    return rc.rewrite_tex(tex, old, new)


def rewrite_cite_keys_many(tex: str, renames: dict[str, str]) -> tuple[str, int]:
    """Apply several renames AT ONCE (no chaining: `a→b, b→c` sends `a` to `b`).

    Each old key is first parked on a placeholder no citekey can spell (it is
    wrapped in NUL characters), then every placeholder is swapped for its
    target."""
    n = 0
    parked: dict[str, str] = {}
    for i, old in enumerate(renames):
        token = f"\x00virgil-rename-{i}\x00"
        tex, k = rewrite_cite_keys(tex, old, token)
        n += k
        parked[token] = renames[old]
    for token, new in parked.items():
        tex = tex.replace(token, new)
    return tex, n


def _atomic_write(path: Path, text: str) -> None:
    from _tools import _atomic_write_text  # noqa: PLC0415 — lazy, avoids a cycle
    _atomic_write_text(path, text)


def rekey_paper_sidecars(paper_dir: Path, old: str, new: str) -> dict[str, int]:
    """Re-key every task-615 citekey-keyed sidecar under `<paper>/virgil/`.

    Returns `{filename: n_changed}` for the files that changed. A missing or
    unreadable file is skipped (nothing to re-key); nothing is written unless a
    re-keyer changed something. Serialization matches the editor's
    `_common.json_dumps` (2-space indent, non-ASCII kept, trailing newline)."""
    _, cs = _editor_modules()
    out: dict[str, int] = {}
    for name, rule in cs.rekey_plan():
        path = paper_dir / "virgil" / name
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        k = cs.REKEYERS[rule](data, old, new)
        if k:
            _atomic_write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")
            out[name] = k
    return out


def rename_citekey_in_paper(paper_dir: Path, old: str, new: str) -> list[str]:
    """Carry `old → new` through ONE paper folder: its `main.tex` cites, its
    `references.bib` entry key, and its citekey-keyed sidecars.

    Returns the step labels for what changed (`cite:main.tex:N`,
    `references_bib:renamed`, `sidecar:<file>:N`). `references.bib` raises
    `BibSpliceRefused` (file untouched) on an entry it cannot delimit; the
    other surfaces of THIS paper are then left untouched too — the refusal is
    checked before anything is written."""
    steps: list[str] = []
    refs = paper_dir / "references.bib"
    bib_new = None
    if refs.is_file():
        bib_text = refs.read_text(encoding="utf-8")
        if old in bib_text or _nfd(old) in bib_text:
            candidate, changed = rename_entry_text(bib_text, old, new)
            if changed:
                bib_new = candidate
    tex_path = paper_dir / "main.tex"
    tex_new, n_tex = None, 0
    if tex_path.is_file():
        tex = tex_path.read_text(encoding="utf-8")
        if old in tex:
            tex_new, n_tex = rewrite_cite_keys(tex, old, new)
    if bib_new is not None:
        _atomic_write(refs, bib_new)
        steps.append("references_bib:renamed")
    if n_tex:
        _atomic_write(tex_path, tex_new)
        steps.append(f"cite:main.tex:{n_tex}")
    for name, k in rekey_paper_sidecars(paper_dir, old, new).items():
        steps.append(f"sidecar:{name}:{k}")
    return steps


def _nfd(s: str) -> str:
    import unicodedata
    return unicodedata.normalize("NFD", s)
