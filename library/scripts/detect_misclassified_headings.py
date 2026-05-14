"""Report `\\subsection{}` / `\\subsubsection{}` calls whose argument
looks like body prose, not a heading.

Differs from `detect_garbage_headings.py` (which targets diagram /
formal-symbol noise): this one targets *prose-shaped* mis-classified
headings — short sentences, italic phrases, ellipsed fragments,
quoted speech — that the extractor promoted because the source PDF
used a slightly-larger font for a body sentence (a numbered example
introduction, a pull-quote, etc.).

Detection rules:

- Argument contains interior comma + lowercase word (`X, however,`).
- Argument starts with `\\textit{` or `\\emph{` or `"`/`"` and ends
  with a colon, period, or quote (looks like a pulled body sentence).
- Argument ends with `…` / `...` (an ellipsis is a body-prose
  signature, not a heading).
- Argument contains "however", "indeed", "therefore", "moreover",
  "furthermore", "thus", "hence" — transitional phrases unique to
  body prose.

Generates a per-line candidate list for review.

(kunene memo.)

Usage:
    python3 detect_misclassified_headings.py <main.tex> [--json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


HEADING_RE = re.compile(
    r"\\(subsection|subsubsection|section)\{([^}]+)\}"
)
TRANSITIONAL = re.compile(
    r"\b(however|indeed|therefore|moreover|furthermore|thus|hence|"
    r"consequently|accordingly|nevertheless|nonetheless)\b",
    re.I,
)


def _looks_like_body_prose(arg: str) -> tuple[bool, str]:
    s = arg.strip()
    if not s:
        return False, ""
    # Ellipsis is a body-prose signature.
    if "…" in s or "..." in s:
        return True, "ends with ellipsis"
    # Interior comma followed by lowercase.
    if re.search(r",\s+[a-z]", s):
        return True, "interior comma + lowercase"
    # Pulled body sentence (starts with italic / quote + ends with colon/period/quote).
    if (
        s.startswith(("\\textit{", "\\emph{", '"', "“", "'", "‘"))
        and s.rstrip().endswith((":", ".", '"', "”", "'", "’"))
    ):
        return True, "italic/quoted pulled sentence"
    # Transitional phrase.
    if TRANSITIONAL.search(s):
        return True, "transitional phrase"
    # Multiple full sentences (interior `\.\s+[A-Z]`).
    if re.search(r"\.\s+[A-Z]", s):
        return True, "multiple sentences"
    return False, ""


def scan(text: str) -> list[dict]:
    findings: list[dict] = []
    for m in HEADING_RE.finditer(text):
        kind = m.group(1)
        arg = m.group(2)
        is_prose, reason = _looks_like_body_prose(arg)
        if not is_prose:
            continue
        line = text[:m.start()].count("\n") + 1
        findings.append({
            "kind": kind,
            "line": line,
            "arg": arg[:120] + ("..." if len(arg) > 120 else ""),
            "reason": reason,
        })
    return findings


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Flag prose-shaped misclassified headings.",
    )
    parser.add_argument("tex")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    p = Path(args.tex)
    if not p.exists():
        print(f"not found: {p}", file=sys.stderr)
        return 1
    text = p.read_text(encoding="utf-8")
    findings = scan(text)
    if args.json:
        print(json.dumps(findings, indent=2))
        return 0
    if not findings:
        print("No prose-shaped misclassified headings detected.")
        return 0
    print(f"{len(findings)} misclassified heading candidate(s):")
    for f in findings[:30]:
        print(f"  line {f['line']} (\\{f['kind']}, {f['reason']}): {f['arg']!r}")
    if len(findings) > 30:
        print(f"  ... and {len(findings) - 30} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
