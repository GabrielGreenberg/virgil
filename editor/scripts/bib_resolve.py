#!/usr/bin/env python3
"""Resolve a bib key in the doc's references.bib + paired annotation.

Editor-side bib-review skills need to surface the existing entry text
(unparsed, since BibTeX preserves user intent) plus any annotation note
the user has attached in `virgil/annotations.json`. This script avoids
shipping a full BibTeX parser by pulling the verbatim entry block via a
brace-matching scan, which is enough for pretty-printing and surgical
field updates.

Usage:  python3 bib_resolve.py <docPath> <bibKey>

Emits:
  { "bibKey": "...",
    "bib":    "<doc-relative path>",
    "entry":  "@article{key, ... }",  // verbatim entry block, or null
    "fields": { "title": "...", "author": "..." },
    "annotation": "<user note text or null>"
  }

For deeper Crossref/OpenAlex lookups, skills should call
`library/scripts/bib_auth.py` directly — that module already handles the
authentication-tier search and field-confidence reporting.
"""

from __future__ import annotations

import json
import re
import sys

from _common import die, find_bib_file, read_json, resolve_doc, sidecar


ENTRY_HEAD = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", re.MULTILINE)
# Match `name = ` after a comma. We prepend a virtual comma to the entry
# body before parsing so every field — including the first one — sits
# behind a comma boundary, which sidesteps line-start anchoring problems.
FIELD_LINE = re.compile(r",\s*([a-zA-Z][\w\-]*)\s*=\s*")


def find_entry_block(text: str, key: str) -> tuple[str | None, str | None]:
    """Return (entry_text, entry_type) for `key`, or (None, None)."""
    for m in ENTRY_HEAD.finditer(text):
        etype, ekey = m.group(1), m.group(2)
        if ekey != key:
            continue
        # Brace-match from the opening `{` to find the entry's closing `}`.
        start = m.start()
        i = text.find("{", start)
        if i < 0:
            continue
        depth = 0
        end = -1
        in_string = False
        for j in range(i, len(text)):
            ch = text[j]
            if ch == '"' and (j == 0 or text[j - 1] != "\\"):
                in_string = not in_string
                continue
            if in_string:
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        if end > start:
            return text[start:end], etype
    return None, None


def parse_fields(entry: str) -> dict:
    """Extract field=value pairs from an entry body. Tolerant of
    quoted-string and braced-string forms."""
    fields: dict[str, str] = {}
    body = entry
    # Drop the @type{key, header.
    head = ENTRY_HEAD.search(body)
    if head:
        body = body[head.end() :]
    # Drop the trailing }.
    if body.endswith("}"):
        body = body[:-1]
    # Prepend a virtual comma so the very first field sits behind a comma
    # boundary, matching the rest. Offsets shift by 1 — accounted for below.
    body = "," + body
    # Walk fields.
    pos = 0
    while pos < len(body):
        m = FIELD_LINE.search(body, pos)
        if not m:
            break
        name = m.group(1).lower()
        value_start = m.end()
        # Detect value: braced, quoted, or bare-up-to-comma.
        # Skip whitespace.
        while value_start < len(body) and body[value_start] in " \t":
            value_start += 1
        if value_start >= len(body):
            break
        ch = body[value_start]
        if ch == "{":
            depth = 0
            i = value_start
            for j in range(value_start, len(body)):
                if body[j] == "{":
                    depth += 1
                elif body[j] == "}":
                    depth -= 1
                    if depth == 0:
                        i = j + 1
                        break
            value = body[value_start + 1 : i - 1]
            pos = i
        elif ch == '"':
            j = value_start + 1
            while j < len(body) and (body[j] != '"' or body[j - 1] == "\\"):
                j += 1
            value = body[value_start + 1 : j]
            pos = j + 1
        else:
            j = value_start
            while j < len(body) and body[j] != ",":
                j += 1
            value = body[value_start:j].strip()
            pos = j
        # NOTE: do not skip the trailing comma — FIELD_LINE matches a
        # comma boundary to find the next field, so leaving pos at the
        # comma (or trailing space before one) is required.
        fields[name] = " ".join(value.split())
    return fields


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        die("usage: bib_resolve.py <docPath> <bibKey>")
    doc = resolve_doc(argv[1])
    key = argv[2].strip()
    if not key:
        die("bibKey is empty")

    bib = find_bib_file(doc)
    out = {
        "bibKey": key,
        "bib": str(bib.relative_to(doc)) if bib else None,
        "entry": None,
        "type": None,
        "fields": {},
        "annotation": None,
    }
    if bib:
        text = bib.read_text(encoding="utf-8", errors="replace")
        entry, etype = find_entry_block(text, key)
        out["entry"] = entry
        out["type"] = etype
        if entry:
            out["fields"] = parse_fields(entry)

    # Annotations.json is keyed by bibKey -> { text } (per
    # src/lib/types.ts AnnotationsState).
    ann = read_json(sidecar(doc, "annotations.json"), default=None)
    if isinstance(ann, dict):
        # Tolerate either { annotations: { key: {text} } } or flat.
        flat = ann.get("annotations") if "annotations" in ann else ann
        if isinstance(flat, dict):
            v = flat.get(key)
            if isinstance(v, str):
                out["annotation"] = v
            elif isinstance(v, dict) and isinstance(v.get("text"), str):
                out["annotation"] = v["text"]

    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
