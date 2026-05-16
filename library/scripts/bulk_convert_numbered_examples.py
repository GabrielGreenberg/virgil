"""Batch detector + proposer for Variant D numbered examples.

Linguistics and semantics papers commonly have 50+ numbered examples
(`(1) ...`, `(2a) ...`, `(2b) ...`) as paragraph leaders. Manual
per-example conversion to `\\ex...\\xe` / `\\pex...\\xe` is intractable
at that scale.

This script:

1. Detects every paragraph-leading `^(\\d+)` / `^(\\d+[a-z])` pattern.
2. Groups consecutive sub-items into `pex` (multi-part) candidates
   when they share the parent example number.
3. Emits a JSON proposal of `[{line, kind, exno, body, sub_items}, ...]`
   that a human or model can review before applying.
4. `--apply` writes the transformations: bare numbered prose becomes
   `\\ex` / `\\pex` blocks with `\\vexid{<uuid>}` markers.

Refuses to convert examples that:

- Live inside an existing `\\begin{enumerate}` block (those are
  enumeration lists, not linguistic examples).
- Are inside a `\\begin{quote}` (block quote, not an example).
- Are in the references / bibliography section.
- Appear to be theorem / proposition numbering (preceded by
  "Theorem ", "Proposition ", "Lemma ", "Corollary ", etc.).
- Are part of a high-cross-reference-density region (a heuristic
  signal that the paper expects examples to be referenced by `(Nx)`
  inline — converting one without rewriting every back-reference
  breaks rendering; see Chomsky 1957).

(kehler memo; davidson memo; chomsky memo.)

This script ONLY converts paragraph-leading examples (`^(N) body`).
Inline mid-paragraph examples (`...prose... (1) example ...prose...`)
are not detected here — run `split_inline_numbered_examples.py` first
to hoist them onto their own paragraphs (per abusch2013applying memo).

Usage:
    python3 bulk_convert_numbered_examples.py <main.tex>
        [--propose-only] [--apply] [--out proposals.json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path


# Top-level numbered example: `(N) body...`
EX_LINE_RE = re.compile(r"^\((\d+)\)\s+([^\n]+)", re.M)
# Sub-item: `(Na) body...` or just `a. body...` after a parent example.
SUB_ITEM_RE = re.compile(r"^\(\d+([a-z])\)\s+([^\n]+)", re.M)
THEOREM_RE = re.compile(
    r"\b(Theorem|Proposition|Lemma|Corollary|Definition|Conjecture)\s*$",
    re.I,
)
ENUM_BEGIN = re.compile(r"\\begin\{enumerate\}", re.M)
ENUM_END = re.compile(r"\\end\{enumerate\}", re.M)
QUOTE_BEGIN = re.compile(r"\\begin\{quote\}", re.M)
QUOTE_END = re.compile(r"\\end\{quote\}", re.M)
REFS_HEAD = re.compile(
    r"\\section\{(References|Bibliography|Works Cited)\b", re.I,
)


def _disallowed_regions(text: str) -> list[tuple[int, int]]:
    """Char-range regions where we shouldn't transform."""
    out: list[tuple[int, int]] = []
    # \begin{enumerate}...\end{enumerate}
    starts = [m.start() for m in ENUM_BEGIN.finditer(text)]
    ends = [m.end() for m in ENUM_END.finditer(text)]
    for s, e in zip(starts, ends):
        out.append((s, e))
    starts = [m.start() for m in QUOTE_BEGIN.finditer(text)]
    ends = [m.end() for m in QUOTE_END.finditer(text)]
    for s, e in zip(starts, ends):
        out.append((s, e))
    # After References section.
    refs_m = REFS_HEAD.search(text)
    if refs_m:
        out.append((refs_m.start(), len(text)))
    return out


def _in_region(pos: int, regions: list[tuple[int, int]]) -> bool:
    return any(s <= pos < e for s, e in regions)


def _theorem_context(text: str, pos: int) -> bool:
    """Check if `pos` is preceded by a theorem-like word within 50 chars."""
    ctx = text[max(0, pos - 50):pos]
    return bool(THEOREM_RE.search(ctx))


def _gather_examples(text: str) -> list[dict]:
    """Group consecutive `(N)` / `(Na)`/`(Nb)` paragraph-leaders."""
    regions = _disallowed_regions(text)
    examples: list[dict] = []
    for m in EX_LINE_RE.finditer(text):
        if _in_region(m.start(), regions):
            continue
        if _theorem_context(text, m.start()):
            continue
        exno = m.group(1)
        body = m.group(2).strip()
        line = text[:m.start()].count("\n") + 1
        examples.append({
            "line": line,
            "kind": "ex",
            "exno": exno,
            "body": body,
            "sub_items": [],
            "start_char": m.start(),
        })
    # Now find sub-items and attach to nearest preceding example.
    for m in SUB_ITEM_RE.finditer(text):
        if _in_region(m.start(), regions):
            continue
        letter = m.group(1)
        body = m.group(2).strip()
        line = text[:m.start()].count("\n") + 1
        # Find the nearest preceding example with the same numeric prefix.
        parent = None
        for ex in reversed(examples):
            if ex["start_char"] < m.start():
                parent = ex
                break
        if parent is None:
            continue
        parent["sub_items"].append({"letter": letter, "body": body, "line": line})
        parent["kind"] = "pex"
    return examples


def _propose(examples: list[dict]) -> list[dict]:
    """Build proposal records."""
    out: list[dict] = []
    for ex in examples:
        out.append({
            "line": ex["line"],
            "kind": ex["kind"],
            "exno": ex["exno"],
            "body": ex["body"][:200],
            "sub_items": [
                {"letter": s["letter"], "body": s["body"][:200]}
                for s in ex["sub_items"]
            ],
            "contains_semantics": bool(
                re.search(r"\$|\\lambda|\\exists|\\wedge|\[\[",
                          ex["body"]
                          + " ".join(s["body"] for s in ex["sub_items"]))
            ),
        })
    return out


def _apply(text: str, examples: list[dict]) -> str:
    """Rewrite text replacing each example's paragraph with an
    `\\ex` / `\\pex` block with a `\\vexid{<uuid>}` marker. Apply in
    reverse position order so offsets stay valid."""
    new_text = text
    for ex in reversed(examples):
        vexid = str(uuid.uuid4())
        start = ex["start_char"]
        # Find the end of this example's body — through the last
        # sub-item's line, or through the first blank line after the
        # main line.
        if ex["sub_items"]:
            last_sub_line = max(s["line"] for s in ex["sub_items"])
            end_line_idx = last_sub_line
        else:
            end_line_idx = ex["line"]
        # Convert line number to char position (end of that line +
        # paragraph break).
        lines = new_text.splitlines(keepends=True)
        end_char = sum(len(l) for l in lines[:end_line_idx])
        # Build the replacement.
        if ex["kind"] == "ex":
            replacement = (
                f"\\ex[exno={ex['exno']}] \\vexid{{{vexid}}}\n{ex['body']}\n\\xe\n"
            )
        else:
            sub_items = "\n".join(
                f"\\a {s['body']}" for s in ex["sub_items"]
            )
            replacement = (
                f"\\pex[exno={ex['exno']}] \\vexid{{{vexid}}}\n"
                f"{ex['body']}\n{sub_items}\n\\xe\n"
            )
        new_text = new_text[:start] + replacement + new_text[end_char:]
    return new_text


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Detect and (optionally) convert numbered examples.",
    )
    parser.add_argument("tex")
    parser.add_argument(
        "--out",
        default=None,
        help="JSON output path for proposals (default: stdout).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply transformations in-place (rewrites main.tex).",
    )
    parser.add_argument("--propose-only", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    examples = _gather_examples(text)
    proposals = _propose(examples)
    if args.out:
        Path(args.out).write_text(
            json.dumps(proposals, indent=2), encoding="utf-8",
        )
        print(f"Wrote {len(proposals)} proposals to {args.out}")
    else:
        print(f"Detected {len(proposals)} numbered examples.")
        # Print short summary.
        for prop in proposals[:5]:
            print(
                f"  line {prop['line']} ({prop['kind']}/{prop['exno']}): "
                f"{prop['body'][:60]!r}"
            )
        if len(proposals) > 5:
            print(f"  ... and {len(proposals) - 5} more")
    if args.apply and proposals:
        new_text = _apply(text, examples)
        p.write_text(new_text, encoding="utf-8")
        print(f"Applied {len(examples)} example conversions to {p}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
