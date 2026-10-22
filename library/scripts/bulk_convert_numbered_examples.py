"""Batch detector + proposer for Variant D numbered examples.

Linguistics and semantics papers commonly have 50+ numbered examples
(`(1) ...`, `(2a) ...`, `(2b) ...`) as paragraph leaders. Manual
per-example conversion to `\\ex...\\xe` / `\\pex...\\xe` is intractable
at that scale.

This script:

1. Detects every paragraph-leading `^(\\d+)` / `^(\\d+[a-z])` pattern.
2. Groups consecutive sub-items into `pex` (multi-part) candidates
   when they share the parent example number.
3. Emits a JSON proposal of
   `[{line, start_char, kind, exno, body, sub_items, suspect}, ...]`
   that a human or model reviews before applying. `suspect` names a
   JUDGMENT concern (a lowercase start reads as broken-prose
   continuation; `c. ...` reads as an orphan sub-letter) — the reviewer
   decides, the script only says so.
4. `--apply --proposals <reviewed.json>` converts EXACTLY the records
   left in the reviewed file (deleting a record is how a reviewer
   rejects it). Each record is re-validated against the current text;
   a stale one refuses the whole apply rather than being guessed at
   (task 1227). Bare `--apply` converts every candidate only when none
   is suspect, and refuses otherwise. Bare numbered prose becomes
   `\\ex` / `\\pex` blocks with `\\vexid{<uuid>}` markers.

Refuses to convert examples that:

- Live inside an existing `\\begin{enumerate}` block (those are
  enumeration lists, not linguistic examples).
- Are inside a `\\begin{quote}` (block quote, not an example).
- Are inside an already-converted `\\ex...\\xe` / `\\pex...\\xe` block,
  or carry converted-region markup in their body (`\\pgmark{`,
  `\\vexid{`, `\\xe`, `\\ex[`, `\\pex[`) — a re-run over a partially
  converted paper would otherwise nest an `\\ex` inside a new one
  (task 1227). These are MECHANICAL rejections: never proposed, never
  applied, whatever a proposals file says.
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
        [--propose-only] [--out proposals.json]
        [--apply [--proposals reviewed.json]]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import uuid
from pathlib import Path
from _refs_section import body_end

from _tools import _atomic_write_text


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
# An already-converted expex block: `\ex` / `\pex` opener through the
# next `\xe` (expex closes a `\pex` with ONE `\xe`; its parts are `\a`).
EXPEX_OPEN = re.compile(r"\\p?ex(?![A-Za-z])")
EXPEX_CLOSE = re.compile(r"\\xe(?![A-Za-z])")
# Body markup that means the candidate overlaps converted/anchored content.
CONVERTED_MARKUP_RE = re.compile(r"\\pgmark\{|\\vexid\{|\\xe(?![A-Za-z])|\\p?ex\[")
ORPHAN_SUB_LETTER_RE = re.compile(r"^[a-z]\.\s")


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
    # Already-converted \ex...\xe / \pex...\xe blocks.
    for m in EXPEX_OPEN.finditer(text):
        close = EXPEX_CLOSE.search(text, m.end())
        out.append((m.start(), close.end() if close else len(text)))
    # After References section.
    refs_at = body_end(text)
    if refs_at < len(text):
        out.append((refs_at, len(text)))
    return out


def _in_region(pos: int, regions: list[tuple[int, int]]) -> bool:
    return any(s <= pos < e for s, e in regions)


def _theorem_context(text: str, pos: int) -> bool:
    """Check if `pos` is preceded by a theorem-like word within 50 chars."""
    ctx = text[max(0, pos - 50):pos]
    return bool(THEOREM_RE.search(ctx))


def _suspect_reason(body: str) -> str | None:
    """A judgment concern the reviewer must rule on (not a rejection)."""
    if ORPHAN_SUB_LETTER_RE.match(body):
        return "orphan sub-letter (its parent (N) block is elsewhere)"
    if body[:1].islower():
        return "lowercase start (reads as broken-prose continuation)"
    return None


def _gather_examples(text: str) -> list[dict]:
    """Group consecutive `(N)` / `(Na)`/`(Nb)` paragraph-leaders.

    Mechanical rejections (disallowed region, theorem numbering, converted
    markup in the body) are dropped here — no caller can ever apply them."""
    regions = _disallowed_regions(text)
    examples: list[dict] = []
    for m in EX_LINE_RE.finditer(text):
        if _in_region(m.start(), regions):
            continue
        if _theorem_context(text, m.start()):
            continue
        exno = m.group(1)
        body = m.group(2).strip()
        if CONVERTED_MARKUP_RE.search(body):
            continue
        line = text[:m.start()].count("\n") + 1
        examples.append({
            "line": line,
            "kind": "ex",
            "exno": exno,
            "body": body,
            "sub_items": [],
            "start_char": m.start(),
            "suspect": _suspect_reason(body),
        })
    # Now find sub-items and attach to nearest preceding example.
    for m in SUB_ITEM_RE.finditer(text):
        if _in_region(m.start(), regions):
            continue
        letter = m.group(1)
        body = m.group(2).strip()
        if CONVERTED_MARKUP_RE.search(body):
            continue
        line = text[:m.start()].count("\n") + 1
        number = re.match(r"\((\d+)", m.group(0)).group(1)
        # The nearest preceding example — and only if it carries the SAME
        # number. `(7b)` after `(3)` is an orphan, not a part of (3).
        parent = None
        for ex in reversed(examples):
            if ex["start_char"] < m.start():
                parent = ex
                break
        if parent is None or parent["exno"] != number:
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
            "start_char": ex["start_char"],
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
            "suspect": ex["suspect"],
        })
    return out


class StaleProposal(ValueError):
    """A reviewed record no longer matches a current candidate."""


def _select_reviewed(examples: list[dict], reviewed: list[dict]) -> list[dict]:
    """The candidates the reviewed proposals file names — and only those.

    A record matches the current candidate at its `start_char` when exno,
    kind, body and sub-item letters all still agree. Anything else (text
    edited since `--out`, a mechanically rejected candidate, a hand-made
    record) is STALE: the whole apply is refused, never guessed at."""
    by_start = {ex["start_char"]: ex for ex in examples}
    current = {ex["start_char"]: rec for ex, rec in zip(examples, _propose(examples))}
    chosen: dict[int, dict] = {}
    stale: list[str] = []
    for rec in reviewed:
        start = rec.get("start_char")
        mine = current.get(start)
        same = mine is not None and all(
            rec.get(k) == mine[k] for k in ("exno", "kind", "body")
        ) and [s.get("letter") for s in rec.get("sub_items", [])] == [
            s["letter"] for s in mine["sub_items"]
        ]
        if not same:
            stale.append(f"line {rec.get('line')} ({rec.get('exno')})")
            continue
        chosen[start] = by_start[start]
    if stale:
        raise StaleProposal(
            "proposals no longer match the current text (re-run --out and "
            "review again): " + ", ".join(stale)
        )
    return [chosen[s] for s in sorted(chosen)]


# The no-op declaration that keeps a `\vexid`-bearing .tex compilable under
# stock LaTeX. The pass that MINTS the first `\vexid` owns guaranteeing it
# (task 801 — the preamble-requirements-by-emission pattern; the Virgil app's
# own save path injects the same line via `latex-requirements.ts` shimReq).
VEXID_SHIM = "\\providecommand{\\vexid}[1]{}"
_VEXID_DEFINED_RE = re.compile(r"\\(?:provide|new|renew)command\{\\vexid\}")
_BEGIN_DOCUMENT_RE = re.compile(r"^[ \t]*\\begin\{document\}", re.M)


def ensure_vexid_shim(text: str) -> str:
    """Declare `\\vexid` in the preamble unless something already does.
    Inserted on its own line just before `\\begin{document}`; a fragment
    with no `\\begin{document}` is returned unchanged (nothing to own)."""
    if _VEXID_DEFINED_RE.search(text):
        return text
    m = _BEGIN_DOCUMENT_RE.search(text)
    if not m:
        return text
    return text[: m.start()] + VEXID_SHIM + "\n" + text[m.start():]


def _apply(text: str, examples: list[dict]) -> str:
    """Rewrite text replacing each example's paragraph with an
    `\\ex` / `\\pex` block with a `\\vexid{<uuid>}` marker. Apply in
    reverse position order so offsets stay valid.

    The marker goes IMMEDIATELY BEFORE `\\ex` / `\\pex`, byte-for-byte the
    shape the app's serializer emits (`\\vexid{id}\\ex[...]`): the parser
    stashes a PRECEDING `\\vexid` and hands it to the next `\\ex`, so a
    marker written after the opener is silently discarded and the editor
    mints a fresh id on every open (task 1030). Pinned against `parseLatex`
    by library/lib/__tests__/bulk-convert-vexid-roundtrip.test.ts."""
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
                f"\\vexid{{{vexid}}}\\ex[exno={ex['exno']}]\n{ex['body']}\n\\xe\n"
            )
        else:
            sub_items = "\n".join(
                f"\\a {s['body']}" for s in ex["sub_items"]
            )
            replacement = (
                f"\\vexid{{{vexid}}}\\pex[exno={ex['exno']}]\n"
                f"{ex['body']}\n{sub_items}\n\\xe\n"
            )
        new_text = new_text[:start] + replacement + new_text[end_char:]
    return ensure_vexid_shim(new_text) if examples else new_text


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
    parser.add_argument(
        "--proposals",
        default=None,
        help="With --apply: the REVIEWED proposals JSON (from --out, with "
        "rejected records deleted). Only these records are converted.",
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
    if args.proposals and not args.apply:
        print("--proposals is only meaningful with --apply", file=sys.stderr)
        return 2
    if not args.apply:
        return 0
    if args.proposals:
        try:
            reviewed = json.loads(Path(args.proposals).read_text(encoding="utf-8"))
            selected = _select_reviewed(examples, reviewed)
        except (OSError, ValueError) as e:
            print(f"refusing --apply: {e}", file=sys.stderr)
            return 2
    else:
        suspects = [prop for prop in proposals if prop["suspect"]]
        if suspects:
            print(
                f"refusing --apply: {len(suspects)} proposal(s) are suspect "
                "(e.g. line {line}: {why}). Review with --out and pass the "
                "reviewed file via --proposals.".format(
                    line=suspects[0]["line"], why=suspects[0]["suspect"],
                ),
                file=sys.stderr,
            )
            return 2
        selected = examples
    if selected:
        new_text = _apply(text, selected)
        _atomic_write_text(p, new_text)
    print(f"Applied {len(selected)} example conversions to {p}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
