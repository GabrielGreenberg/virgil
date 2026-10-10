"""The References section's pre-image: what an itemizer replaced (task 1039).

`format_references_section.py` and `itemize_jammed_references.py` both
rewrite the raw References body of `main.tex` into an `itemize`, and both
refuse to touch a section that is already itemized. Before this door, that
refusal made the clean-bibliography ladder one-shot: a first write with the
wrong style left mis-split items behind, every retry with a better
`--style` was skipped as "already shaped", and the raw text the retry
needed was gone.

So every itemizer write goes through `write_itemized_section`, which first
stashes the body it is replacing; `restore_section` puts it back so a
retry starts from the original. Because both itemizers write only over a
NOT-yet-itemized body, the stash always holds the last raw pre-image —
a later write simply overwrites it with the (identical, once restored)
raw text.

The stash lives in the paper's own sidecar folder
(`<paper>/virgil/pre-images/references.tex`), so it moves with the paper
on a citekey rename and is never read as LaTeX by anything else.
"""

from __future__ import annotations

import os
from pathlib import Path

from _refs_section import references_span
from _tools import unlink_tolerant


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def preimage_path(paper_dir: Path) -> Path:
    return paper_dir / "virgil" / "pre-images" / "references.tex"


def has_preimage(paper_dir: Path) -> bool:
    return preimage_path(paper_dir).exists()


def write_itemized_section(
    paper_dir: Path, text: str, body_start: int, body_end: int, new_body: str,
) -> None:
    """Replace `text[body_start:body_end]` with `new_body` in main.tex,
    stashing the replaced body first so `restore_section` can undo it."""
    _atomic_write_text(preimage_path(paper_dir), text[body_start:body_end])
    _atomic_write_text(
        paper_dir / "main.tex", text[:body_start] + new_body + text[body_end:],
    )


def restore_section(paper_dir: Path) -> dict:
    """Put the stashed raw References body back into main.tex.

    Returns `{"restored": True}` or `{"error": …}`. The stash is removed
    after a successful restore; the next itemizer write re-stashes."""
    stash = preimage_path(paper_dir)
    tex_path = paper_dir / "main.tex"
    if not stash.exists():
        return {"error": f"no References pre-image at {stash}"}
    if not tex_path.exists():
        return {"error": "main.tex not found"}
    text = tex_path.read_text(encoding="utf-8")
    span = references_span(text)
    if not span:
        return {"error": "no References section found"}
    raw = stash.read_text(encoding="utf-8")
    _atomic_write_text(
        tex_path, text[:span.body_start] + raw + text[span.end:],
    )
    unlink_tolerant(stash, what="References pre-image")
    return {"restored": True}
