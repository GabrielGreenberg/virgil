"""Convert OCR-mangled formal-semantics math to canonical TeX.

Formal-semantics papers (Davidson 2015, Schlenker family, Lascarides,
Heim-Kratzer) use Greek symbols, typed lambda calculus, set-builder
brackets, and interpretation function delimiters. When pymupdf
extracts these PDFs, the Greek and special glyphs are returned as
Latin equivalents because the source font stored them at non-Unicode
code points:

    | source | OCR'd as | TeX target          |
    |--------|----------|---------------------|
    | λ      | k        | \\lambda             |
    | ∃      | A        | \\exists             |
    | ∧      | ^        | \\wedge              |
    | ⟦ ⟧    | [[ ]]    | [\\!\\![ … ]\\!\\!]    |

This script applies the canonical mapping. Three classes of edits:

1. **Lambda chains** — `kdke` / `kxky` are runs of `k<lowercase>`
   that should become `\\lambda d\\, \\lambda e`. A regex finds these
   and emits proper TeX.
2. **Interpretation brackets** — `[[X]]` becomes
   `[\\!\\![X]\\!\\!]` (a portable rendering without requiring
   `stmaryrd`).
3. **Predicate-name wrapping** — function names in predicates (e.g.
   `demonstration(d, e)`) typeset as multi-letter variables in math
   mode unless wrapped in `\\text{}`. The `--predicates` flag accepts
   a comma-separated whitelist of names to wrap.

Idempotent: skips spans already wrapped or using the canonical TeX
commands.

(davidson-formalism-conversion memo.)

Usage:
    python3 mathify_formal_semantics.py <main.tex>
        [--predicates demonstration,agent,theme,...]
        [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


GREEK_MAP: list[tuple[re.Pattern, str]] = [
    # Existential quantifier `A` standing alone before a variable.
    (re.compile(r"(?<![A-Za-z])A(?=\s*[a-z]\b)"), r"\\exists"),
    # Wedge `^` between letter and letter (logical AND).
    (re.compile(r"(?<=[a-z\)])\s*\^\s*(?=[a-z])"), r" \\wedge "),
    # Negation `~` before letter (sometimes ¬).
    (re.compile(r"(?<![\w\\])~(?=[A-Za-z])"), r"\\neg "),
]

# Lambda-chain detector: a run of 2+ `k<lowercase>` token pairs that
# all live in math context (inside `$...$`).
LAMBDA_CHAIN_RE = re.compile(r"\bk([a-z])(k[a-z]){0,4}\b")
LAMBDA_SINGLE_RE = re.compile(r"\bk([a-z])\b")
# Interpretation brackets `[[X]]` (Heim-Kratzer).
HK_BRACKET_RE = re.compile(r"\[\[([^\[\]]+)\]\]")
# Subscript: `e1` / `d2` in math context → `e_1` / `d_2`.
SUBSCRIPT_RE = re.compile(r"\b([a-z])([0-9])\b")


def _mathify_in_math(span: str, predicates: list[str]) -> str:
    """Apply the mapping inside a single math-mode span."""
    out = span
    # Lambda chains: replace each `k<l>` with `\\lambda <l>\\,`.
    def chain_replace(m: re.Match) -> str:
        whole = m.group(0)
        letters = re.findall(r"k([a-z])", whole)
        return "".join(f"\\lambda {l}\\, " for l in letters).rstrip(", ")
    out = LAMBDA_CHAIN_RE.sub(chain_replace, out)
    # Subscript: e1 → e_1.
    out = SUBSCRIPT_RE.sub(r"\1_\2", out)
    # Greek substitutions.
    for pat, repl in GREEK_MAP:
        out = pat.sub(repl, out)
    # Predicate wrapping.
    for pred in predicates:
        pat = re.compile(rf"\b{re.escape(pred)}\b(?!\}})")
        out = pat.sub(rf"\\text{{{pred}}}", out)
    return out


def mathify(text: str, predicates: list[str]) -> tuple[str, dict]:
    """Returns (new_text, stats)."""
    # First, convert `[[X]]` to `[\\!\\![X]\\!\\!]` (Heim-Kratzer brackets).
    def hk_replace(m: re.Match) -> str:
        inner = m.group(1)
        return f"[\\!\\![{inner}]\\!\\!]"

    new_text, n_hk = HK_BRACKET_RE.subn(hk_replace, text)

    # Then apply per-math-span transformations. Find every `$...$` span
    # and apply the mathify routine to its contents.
    def span_replace(m: re.Match) -> str:
        body = m.group(1)
        return f"${_mathify_in_math(body, predicates)}$"

    new_text, n_spans = re.subn(
        r"\$([^$\n]+)\$",
        span_replace,
        new_text,
    )

    return new_text, {
        "heim_kratzer_replacements": n_hk,
        "math_spans_processed": n_spans,
    }


DEFAULT_PREDICATES = [
    "demonstration", "agent", "theme", "eating", "saying", "human",
    "locating", "flatobject", "moving", "chunky", "exp", "similar",
    "move", "see", "say", "know", "believe", "want",
]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert OCR-mangled formal-semantics math to TeX.",
    )
    parser.add_argument("tex")
    parser.add_argument(
        "--predicates",
        default=",".join(DEFAULT_PREDICATES),
        help="Comma-separated predicate names to wrap in \\text{}.",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    predicates = [
        s.strip() for s in args.predicates.split(",") if s.strip()
    ]
    new_text, stats = mathify(text, predicates)
    if new_text == text:
        print(f"No formal-semantics mathify edits in {p}.")
        return 0
    if not args.dry_run:
        p.write_text(new_text, encoding="utf-8")
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Mathified {stats['math_spans_processed']} math spans, "
        f"{stats['heim_kratzer_replacements']} `[[X]]` brackets{suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
