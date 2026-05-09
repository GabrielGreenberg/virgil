#!/usr/bin/env python3
"""Print the .tex paragraph anchored at `%!v:<uuid>` plus N neighbors.

Editor-side AI-request skills need to read the source text around a
paragraph UUID to draft footnotes, citations, or replies. This script
ports the regex from `src/lib/latex-paragraph-map.ts:21` into Python so
skills can shell out instead of re-deriving the lookup logic.

Usage:
  python3 get_para_context.py <docPath> <uuid> [--neighbors=N]

Emits a JSON object on stdout:
  { "uuid": "f1c5",
    "tex": "<doc-relative path to the .tex>",
    "lineRange": [<start>, <end>],   # 1-based, inclusive
    "paragraph": "<text of the anchored paragraph>",
    "neighbors": [
      { "uuid": "...", "lineRange": [...], "paragraph": "..." }, ...
    ]
  }
"""

from __future__ import annotations

import argparse
import json
import sys

from _common import (
    NODE_UUID_REGEX,
    die,
    find_paragraph_uuids,
    find_tex_file,
    resolve_doc,
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="get_para_context.py")
    p.add_argument("doc")
    p.add_argument("uuid")
    p.add_argument("--neighbors", type=int, default=1)
    return p.parse_args(argv[1:])


def split_paragraphs(text: str) -> list[dict]:
    """Group the .tex source into paragraph slabs delimited by blank lines.

    Returns a list of {"uuid"?, "lineRange": [start, end], "text": ...}
    where line numbers are 1-based and `text` includes everything from
    `start` to `end`. A slab without a `%!v:xxxx` marker has uuid=None.
    """
    lines = text.splitlines()
    slabs: list[dict] = []
    cur_start: int | None = None
    cur_lines: list[str] = []

    def flush(end_line: int) -> None:
        nonlocal cur_start, cur_lines
        if cur_start is None:
            return
        body = "\n".join(cur_lines)
        m = NODE_UUID_REGEX.search(body)
        slabs.append(
            {
                "uuid": m.group(1) if m else None,
                "lineRange": [cur_start, end_line],
                "text": body,
            }
        )
        cur_start = None
        cur_lines = []

    for i, line in enumerate(lines, start=1):
        if line.strip() == "":
            flush(i - 1)
        else:
            if cur_start is None:
                cur_start = i
            cur_lines.append(line)
    flush(len(lines))

    return slabs


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    doc = resolve_doc(args.doc)
    tex = find_tex_file(doc)
    text = tex.read_text(encoding="utf-8", errors="replace")

    slabs = split_paragraphs(text)
    target_idx = next(
        (i for i, s in enumerate(slabs) if s["uuid"] == args.uuid), -1
    )
    if target_idx < 0:
        # Fall back to a regex search with a tighter window — surfaces
        # when the slab boundary heuristic mis-grouped lines.
        anchors = [a for a in find_paragraph_uuids(text) if a["uuid"] == args.uuid]
        if not anchors:
            die(f"paragraph uuid not found in {tex}: {args.uuid}", code=3)
        line = anchors[0]["line"]
        # Synthesize a single-line slab as a last resort.
        slabs = [
            {
                "uuid": args.uuid,
                "lineRange": [line, line],
                "text": text.splitlines()[line - 1],
            }
        ]
        target_idx = 0

    target = slabs[target_idx]

    # Neighbors with UUIDs only (skip preamble and blank slabs).
    n = max(0, args.neighbors)
    neighbors: list[dict] = []
    if n > 0:
        prev_slabs = [s for s in slabs[:target_idx] if s["uuid"]][-n:]
        next_slabs = [s for s in slabs[target_idx + 1 :] if s["uuid"]][:n]
        neighbors = [
            {
                "uuid": s["uuid"],
                "lineRange": s["lineRange"],
                "paragraph": s["text"],
            }
            for s in prev_slabs + next_slabs
        ]

    out = {
        "uuid": target["uuid"],
        "tex": str(tex.relative_to(doc)),
        "lineRange": target["lineRange"],
        "paragraph": target["text"],
        "neighbors": neighbors,
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
