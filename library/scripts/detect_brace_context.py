"""Helper: identify open LaTeX brace-arguments at a given position.

When a tool wants to insert content at a position in `main.tex` (e.g.
`\\footnote{...}` reattachment), it needs to know whether the
insertion would land inside another command's brace argument. Doing
so would corrupt the LaTeX parse (e.g., `\\cite{foo\\footnote{bar}baz}`
nests a footnote inside a citation key).

This module exposes:

- `position_in_protected_arg(text, pos, protected=...)` — True iff
  `pos` lies inside a brace argument of any command in `protected`.
- `enclosing_command_arg(text, pos)` — return the innermost open
  `(command_name, open_brace_pos)` at `pos`, or None.

It can also be invoked as a CLI to scan a file for every position
where an insertion would be unsafe:

    python3 detect_brace_context.py <main.tex> [--commands cite,section,...]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path


DEFAULT_PROTECTED = frozenset({
    "cite", "citet", "citep", "citealp", "citealt", "citeauthor",
    "citeyear", "citeyearpar", "section", "subsection", "subsubsection",
    "title", "author", "textbf", "textit", "emph", "ref", "label",
    "pgmark",
})


def _enclosing_at(text: str, pos: int) -> tuple[str | None, int] | None:
    """Walk backward from `pos` to find the innermost unclosed
    `\\<cmd>{`. Returns (cmd_name, open_brace_pos) or None.
    Escaped braces (`\\{`, `\\}`) are skipped."""
    depth = 0
    i = pos - 1
    while i >= 0:
        c = text[i]
        # Skip backslash-escaped chars (look back at index i-1).
        if c in "{}" and i > 0 and text[i - 1] == "\\":
            i -= 2
            continue
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                # Found an unclosed `{`. Identify the command before it.
                j = i - 1
                # Skip an `[opt]` argument that may sit between the
                # command name and the `{`.
                if j >= 0 and text[j] == "]":
                    k = j - 1
                    while k >= 0 and text[k] != "[":
                        k -= 1
                    if k >= 0:
                        j = k - 1
                end = j + 1
                while j >= 0 and (text[j].isalpha() or text[j] == "*"):
                    j -= 1
                if j >= 0 and text[j] == "\\":
                    cmd = text[j + 1:end].rstrip("*")
                    return cmd, i
                # Anonymous brace group; keep looking outward.
                depth = 0
            else:
                depth -= 1
        i -= 1
    return None


def enclosing_command_arg(text: str, pos: int) -> tuple[str | None, int] | None:
    """Return the innermost (cmd_name, open_brace_pos) enclosing
    `pos`, or None if `pos` is at body scope."""
    return _enclosing_at(text, pos)


def position_in_protected_arg(
    text: str, pos: int,
    protected: frozenset[str] = DEFAULT_PROTECTED,
) -> bool:
    """Return True iff `pos` is inside a brace argument of any
    command in `protected`. Walks outward through nested brace
    groups; any protected command encountered at any depth blocks."""
    depth = 0
    i = pos - 1
    while i >= 0:
        c = text[i]
        if c in "{}" and i > 0 and text[i - 1] == "\\":
            i -= 2
            continue
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                j = i - 1
                if j >= 0 and text[j] == "]":
                    k = j - 1
                    while k >= 0 and text[k] != "[":
                        k -= 1
                    if k >= 0:
                        j = k - 1
                end = j + 1
                while j >= 0 and (text[j].isalpha() or text[j] == "*"):
                    j -= 1
                if j >= 0 and text[j] == "\\":
                    cmd = text[j + 1:end].rstrip("*")
                    if cmd in protected:
                        return True
                # Continue outward (this brace's command isn't protected
                # — it might still be inside one).
                depth = 0
            else:
                depth -= 1
        i -= 1
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Scan main.tex for brace-context-sensitive positions.",
    )
    parser.add_argument("tex")
    parser.add_argument(
        "--commands",
        default=",".join(sorted(DEFAULT_PROTECTED)),
        help="Comma-separated command names to treat as protected.",
    )
    args = parser.parse_args()
    text = Path(args.tex).read_text(encoding="utf-8")
    protected = frozenset(args.commands.split(","))
    # Sample report: every paragraph-break position, is it safe?
    safe = unsafe = 0
    for m in __import__("re").finditer(r"\n\s*\n", text):
        pos = m.end()
        if position_in_protected_arg(text, pos, protected):
            unsafe += 1
        else:
            safe += 1
    print(
        f"Paragraph breaks: {safe} body-scope, {unsafe} inside protected "
        f"brace arg ({', '.join(sorted(protected))})."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
