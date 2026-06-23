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


# Entry starts are line-anchored in a .bib file (`@type{key,` at column 0).
# We delimit entries by THIS marker rather than by global brace-matching,
# because a single brace-unbalanced entry makes brace-matching overrun and
# swallow the rest of the file as one "entry," silently dropping everything
# after it. The real ~34k-entry master.bib has exactly such an entry — the old
# global scanner dropped ~82% of the bibliography on it, so a
# `citekey in read_master_bib(...)` membership check then wrongly reported real
# entries as missing. Line-anchored splitting caps each entry's brace-matching
# at the next opener, containing any malformation to its own entry.
# `@string`/`@comment`/`@preamble` lack the `{key,` form, so the regex naturally
# excludes them (matching the old explicit skip). This pattern is ported from
# `_tools.read_master_bib` (`_tools._BIB_ENTRY_START_RE`); keep the two in sync.
_BIB_ENTRY_START_RE = re.compile(r"(?m)^@(\w+)[ \t]*\{[ \t]*([^,\s]+)[ \t]*,")


def parse_bib_text(text: str) -> list[dict]:
    """Parse a .bib string. Returns a list of {citekey, type, fields, raw}.

    Order is preserved (file order). Entries are delimited by their
    line-anchored `@type{key,` openers (`_BIB_ENTRY_START_RE`), and brace-
    matching for each entry's raw/body is CAPPED at the next opener — so a
    single brace-unbalanced entry overruns to (at most) the next entry boundary
    instead of swallowing the rest of the file. `@string`/`@comment`/
    `@preamble` lack the `{key,` form and are naturally skipped.
    """
    entries: list[dict] = []
    starts = list(_BIB_ENTRY_START_RE.finditer(text))
    for idx, m in enumerate(starts):
        entry_type = m.group(1).lower()
        citekey = m.group(2).strip()
        seg_end = starts[idx + 1].start() if idx + 1 < len(starts) else len(text)
        brace = text.find("{", m.start())
        depth = 1
        j = brace + 1
        while j < seg_end and depth > 0:
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        raw = text[m.start():j]
        body_start = text.find(",", brace) + 1
        body = text[body_start:(j - 1) if depth == 0 else seg_end]
        fields = parse_fields(body)
        if citekey:
            entries.append({
                "citekey": citekey,
                "type": entry_type,
                "fields": fields,
                "raw": raw,
            })
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
