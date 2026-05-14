"""Flag `\\section{}` / `\\subsection{}` / `\\subsubsection{}` calls
whose argument looks like extraction garbage (figure axis labels,
formal-logic diagram tokens, payoff-matrix shorthand, single
characters, math-symbol-heavy strings).

This is a *detection* tool — it reports candidates without modifying
the file. Use it before running `strip_ocr_headings.py` (which is
the auto-cleanup pass) to verify the candidate set is correct, or
in audit-only mode when the user wants to triage manually.

Detection rules:

- **Single-char arg** — `\\section{X}`, `\\section{0}`, etc.
- **High non-letter ratio** — ≥ 50% non-letter characters (digits,
  math operators, punctuation).
- **Math symbol-heavy** — contains `⊆`/`∃`/`∧`/`∨`/`≡`/`≅`/`≠`/`≤`/`≥`
  or LaTeX command tokens.
- **Diagram-token match** — argument contains tokens from a default
  diagram-token set (`R1 R2 C1 C2 meet`, `B c c`, `0 D`, `AliA is8`,
  etc.) commonly produced by extraction of figures.
- **Multi-clause body prose** — contains interior sentence punctuation
  (`,\\s+\\w`, `\\.\\s+[A-Z]`, `;\\s+\\w`).

Used by `/library/di-clean-prose` for genre `diagram-heavy-book`
(Venn-diagram logic books, payoff-matrix philosophy books). Generates
the candidate set for downstream cleanup.

(shin, zeki, lewis memos.)

Usage:
    python3 detect_garbage_headings.py <main.tex>
        [--diagram-tokens R1,R2,C1,C2,meet,...] [--json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


HEADING_RE = re.compile(
    r"\\(section|subsection|subsubsection)\{([^}]+)\}"
)
MATH_SYMBOLS = "⊆⊇⊂⊃∃∀∧∨¬≡≅≠≤≥∈∉⇒⇐⇔→←↔∪∩"
DEFAULT_DIAGRAM_TOKENS = {
    "R1", "R2", "C1", "C2", "meet", "B c c", "0 D", "AliA",
    "I expect that", "if and only if", "Fa(o)", "Fe(s)",
    "axiom", "lemma", "proof", "step",
}


def _heading_quality(arg: str, diagram_tokens: set[str]) -> dict:
    """Return diagnostic dict for an argument."""
    out = {"len": len(arg)}
    if not arg:
        out["empty"] = True
        return out
    if len(arg) == 1:
        out["single_char"] = True
        return out
    letters = sum(1 for c in arg if c.isalpha())
    out["letter_ratio"] = letters / max(1, len(arg))
    out["math_symbols"] = sum(1 for c in arg if c in MATH_SYMBOLS)
    if re.search(r"[,;]\s+\w", arg) or re.search(r"\.\s+[A-Z]", arg):
        out["multi_clause"] = True
    if any(tok.lower() in arg.lower() for tok in diagram_tokens):
        out["diagram_token_hit"] = True
    if arg[0].islower():
        out["starts_lowercase"] = True
    # All-digits or pure punctuation arg.
    if not re.search(r"[A-Za-z]", arg):
        out["non_alphabetic"] = True
    return out


def _is_garbage(quality: dict) -> bool:
    if quality.get("empty") or quality.get("single_char"):
        return True
    if quality.get("non_alphabetic"):
        return True
    if quality.get("starts_lowercase"):
        return True
    if quality.get("multi_clause"):
        return True
    if quality.get("diagram_token_hit"):
        return True
    if quality.get("math_symbols", 0) >= 2:
        return True
    if quality.get("letter_ratio", 1) < 0.5:
        return True
    if quality.get("len", 0) > 80:
        return True
    return False


def scan(text: str, diagram_tokens: set[str]) -> list[dict]:
    findings: list[dict] = []
    for m in HEADING_RE.finditer(text):
        kind = m.group(1)
        arg = m.group(2)
        quality = _heading_quality(arg, diagram_tokens)
        if _is_garbage(quality):
            line = text[:m.start()].count("\n") + 1
            findings.append({
                "kind": kind,
                "line": line,
                "arg": arg[:80] + ("..." if len(arg) > 80 else ""),
                "quality": quality,
            })
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flag garbage headings (figure-caption / diagram-token).",
    )
    parser.add_argument("tex")
    parser.add_argument(
        "--diagram-tokens",
        default="",
        help="Comma-separated additional tokens to flag.",
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    diagram_tokens = set(DEFAULT_DIAGRAM_TOKENS)
    if args.diagram_tokens:
        diagram_tokens.update(
            t.strip() for t in args.diagram_tokens.split(",") if t.strip()
        )
    findings = scan(text, diagram_tokens)
    if args.json:
        print(json.dumps(findings, indent=2))
        return 0
    if not findings:
        print(f"No garbage headings in {p}.")
        return 0
    print(f"{len(findings)} garbage heading candidates in {p}:")
    for f in findings[:30]:
        print(f"  line {f['line']} (\\{f['kind']}): {f['arg']!r}")
    if len(findings) > 30:
        print(f"  ... and {len(findings) - 30} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
