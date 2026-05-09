"""Lightweight BibTeX parser shared across the Library Python pipeline.

Single source of truth for parsing master.bib, references.bib, and any
incoming `.bib` file dropped into `unsorted/`. Promoted out of
`index_paper.py` so triage_batch / triage_apply / index_paper all read
the same way.

This is intentionally minimal — citation-js-grade parsing lives in the
JS side (`library/lib/bib-parser.ts`); here we just need enough to
recover {citekey, type, fields, raw} blocks from a well-formed file.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional


def parse_fields(body: str) -> dict[str, str]:
    """Parse a comma-separated field block (the body of a bib entry, minus citekey)."""
    out: dict[str, str] = {}
    i = 0
    while i < len(body):
        while i < len(body) and body[i] in " \t\n\r,":
            i += 1
        if i >= len(body):
            break
        eq = body.find("=", i)
        if eq == -1:
            break
        name = body[i:eq].strip().lower()
        i = eq + 1
        while i < len(body) and body[i] in " \t\n\r":
            i += 1
        if i >= len(body):
            break
        if body[i] == "{":
            depth = 1
            j = i + 1
            while j < len(body) and depth > 0:
                if body[j] == "{":
                    depth += 1
                elif body[j] == "}":
                    depth -= 1
                j += 1
            out[name] = body[i + 1:j - 1].strip()
            i = j
        elif body[i] == '"':
            j = body.find('"', i + 1)
            if j == -1:
                break
            out[name] = body[i + 1:j].strip()
            i = j + 1
        else:
            j = i
            while j < len(body) and body[j] not in ",\n":
                j += 1
            out[name] = body[i:j].strip()
            i = j
    return out


def parse_bib_text(text: str) -> list[dict]:
    """Parse a .bib string. Returns a list of {citekey, type, fields, raw}.

    Order is preserved (file order). Skips blocks that don't open with `@`.
    """
    entries: list[dict] = []
    i = 0
    while i < len(text):
        if text[i] != "@":
            i += 1
            continue
        type_end = text.find("{", i)
        if type_end == -1:
            break
        entry_type = text[i + 1:type_end].strip().lower()
        # @comment / @preamble / @string aren't real entries.
        if entry_type in ("comment", "preamble", "string"):
            # Skip past the matching closing brace.
            depth = 1
            j = type_end + 1
            while j < len(text) and depth > 0:
                if text[j] == "{":
                    depth += 1
                elif text[j] == "}":
                    depth -= 1
                j += 1
            i = j
            continue
        key_end = text.find(",", type_end)
        if key_end == -1:
            break
        citekey = text[type_end + 1:key_end].strip()
        depth = 1
        j = type_end + 1
        while j < len(text) and depth > 0:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        raw = text[i:j]
        body = text[key_end + 1:j - 1]
        fields = parse_fields(body)
        entries.append({
            "citekey": citekey,
            "type": entry_type,
            "fields": fields,
            "raw": raw,
        })
        i = j
    return entries


def read_bib_file(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return parse_bib_text(path.read_text())


def read_master_bib(path: Path) -> dict[str, dict]:
    """Return {citekey: {type, fields, raw}} for master.bib (or any .bib)."""
    out: dict[str, dict] = {}
    for e in read_bib_file(path):
        out[e["citekey"]] = {"type": e["type"], "fields": e["fields"], "raw": e["raw"]}
    return out


def emit_bib_entry(citekey: str, entry_type: str, fields: dict[str, str]) -> str:
    """Emit a `@type{citekey, …}` block. Mirrors the format used by triage_apply."""
    field_lines = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields.items() if v)
    if field_lines:
        return f"@{entry_type}{{{citekey},\n{field_lines}\n}}\n"
    return f"@{entry_type}{{{citekey}\n}}\n"


# Regex used by triage_apply to find an existing entry block in master.bib.
# Lifted out so callers don't all reinvent it.
def find_entry_span(text: str, citekey: str) -> Optional[tuple[int, int, Optional[int]]]:
    """Return (entry_start, entry_end, prev_state_line_start_or_None) or None.

    If the entry has a leading `% bib.state = …` comment line, the third
    field is the start of that comment line (so callers can include it
    in a deletion span).
    """
    pattern = re.compile(r"@\w+\s*\{\s*" + re.escape(citekey) + r"\s*,")
    m = pattern.search(text)
    if not m:
        return None
    entry_start = m.start()
    brace_pos = text.index("{", m.start())
    depth = 1
    j = brace_pos + 1
    while j < len(text) and depth > 0:
        if text[j] == "{":
            depth += 1
        elif text[j] == "}":
            depth -= 1
        j += 1
    entry_end = j

    at_line_start = text.rfind("\n", 0, entry_start)
    at_line_start = at_line_start + 1 if at_line_start != -1 else 0
    prev_line_start = text.rfind("\n", 0, max(0, at_line_start - 1))
    prev_line_start = prev_line_start + 1 if prev_line_start != -1 else 0
    prev_line = text[prev_line_start:at_line_start].strip()
    state_start = prev_line_start if prev_line.startswith("% bib.state") else None
    return (entry_start, entry_end, state_start)
