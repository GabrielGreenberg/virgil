#!/usr/bin/env python3
r"""Print the .tex paragraph anchored at `%!v:<uuid>` plus N neighbors.

Editor-side AI-request skills need to read the source text around a
paragraph UUID to draft footnotes, citations, or replies. The paragraph's
bytes come from `_common.paragraph_spans` — the SAME resolver the writer
(`apply_response._anchored_paragraph`) scopes its edits through (task 883):
previous `%!v:` marker → this marker, so a heading's `\section{}` line, a
title block or a list item is never cut off by a blank-line heuristic.
Neighbours are the previous/next anchored blocks in document order — a raw
`%!vtex:` texBlock included, and resolvable by its own uuid.

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
    die,
    find_tex_file,
    paragraph_spans,
    resolve_doc,
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="get_para_context.py")
    p.add_argument("doc")
    p.add_argument("uuid")
    p.add_argument("--neighbors", type=int, default=1)
    return p.parse_args(argv[1:])


def _line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def render_span(text: str, span: dict) -> dict:
    """A `paragraph_spans` entry as the CLI's `{uuid, lineRange, paragraph}`:
    the region with its leading blank space trimmed, marker included. `kind` is
    "paragraph" (a `%!v:` block) or "texBlock" (a raw `%!vtex:` block)."""
    start = span["start"]
    while start < span["marker_start"] and text[start].isspace():
        start += 1
    end = span["marker_end"]
    return {
        "uuid": span["uuid"],
        "kind": span["kind"],
        "lineRange": [_line_of(text, start), _line_of(text, end)],
        "paragraph": text[start:end],
    }


def para_context(text: str, uuid: str, neighbors: int = 1) -> dict | None:
    """The anchored paragraph + up to `neighbors` paragraphs either side, or
    None when the marker is absent."""
    spans = paragraph_spans(text)
    idx = next((i for i, s in enumerate(spans) if s["uuid"] == uuid), -1)
    if idx < 0:
        return None
    n = max(0, neighbors)
    around = spans[max(0, idx - n) : idx] + spans[idx + 1 : idx + 1 + n] if n else []
    return {
        **render_span(text, spans[idx]),
        "neighbors": [render_span(text, s) for s in around],
    }


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    doc = resolve_doc(args.doc)
    tex = find_tex_file(doc)
    text = tex.read_text(encoding="utf-8", errors="replace")

    ctx = para_context(text, args.uuid, args.neighbors)
    if ctx is None:
        die(f"paragraph uuid not found in {tex}: {args.uuid}", code=3)
    out = {
        "uuid": ctx["uuid"],
        "kind": ctx["kind"],
        "tex": str(tex.relative_to(doc)),
        "lineRange": ctx["lineRange"],
        "paragraph": ctx["paragraph"],
        "neighbors": ctx["neighbors"],
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
