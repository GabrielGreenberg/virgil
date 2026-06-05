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


def find_entry_span(text: str, key: str) -> tuple[int, int] | None:
    """Return the `(start, end)` byte offsets of the `@type{key, …}` entry block
    in `text`, or None. Brace-matched (string-aware), so a `{…}` group inside a
    field value doesn't end the entry early. The single source of truth for
    locating an entry; `find_entry_block` (verbatim text) and the surgical
    editors (`set_fields` / `replace_entry`) all splice by these offsets."""
    for m in ENTRY_HEAD.finditer(text):
        if m.group(2) != key:
            continue
        start = m.start()
        i = text.find("{", start)
        if i < 0:
            continue
        depth = 0
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
                    return start, j + 1
    return None


def find_entry_block(text: str, key: str) -> tuple[str | None, str | None]:
    """Return (entry_text, entry_type) for `key`, or (None, None)."""
    span = find_entry_span(text, key)
    if span is None:
        return None, None
    start, end = span
    head = ENTRY_HEAD.search(text, start)
    etype = head.group(1) if head and head.start() == start else None
    return text[start:end], etype


def all_citekeys(text: str) -> set[str]:
    """Every `@type{citekey,` key defined in a .bib's text."""
    return {m.group(2) for m in ENTRY_HEAD.finditer(text)}


def citekey_of(entry_text: str) -> str | None:
    """The citekey of a single `@type{citekey, …}` entry, or None."""
    m = ENTRY_HEAD.search(entry_text)
    return m.group(2) if m else None


def _value_span(text: str, start: int) -> int:
    """Given `start` at a field value's first char, return the index just past
    the value. Handles `{braced}` (brace-matched), `"quoted"` (escape-aware),
    and bare values up to the next comma/newline. Mirrors the value scan in
    `parse_fields`, factored out so the surgical field editor reuses it."""
    i = start
    while i < len(text) and text[i] in " \t":
        i += 1
    if i >= len(text):
        return start
    ch = text[i]
    if ch == "{":
        depth = 0
        for j in range(i, len(text)):
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
                if depth == 0:
                    return j + 1
        return len(text)
    if ch == '"':
        j = i + 1
        while j < len(text) and (text[j] != '"' or text[j - 1] == "\\"):
            j += 1
        return min(j + 1, len(text))
    j = i
    while j < len(text) and text[j] not in ",\n":
        j += 1
    return j


def _set_field_in_entry(entry: str, name: str, value: str) -> str:
    """Set field `name` to `{value}` in a single entry block — replacing the
    existing value in place (preserving the rest of the entry verbatim, the
    BibTeX-intent rule) if the field exists, else inserting it before the
    entry's closing brace. Field-name match is case-insensitive."""
    new_val = "{" + value + "}"
    m = re.search(r",(\s*)" + re.escape(name) + r"(\s*=\s*)", entry, re.IGNORECASE)
    if m:
        vstart = m.end()
        vend = _value_span(entry, vstart)
        return entry[:vstart] + new_val + entry[vend:]
    close = entry.rstrip().rfind("}")
    if close < 0:
        return entry  # malformed; leave untouched
    head = entry[:close].rstrip()
    sep = "" if head.endswith(",") else ","
    return head + sep + "\n  " + name + " = " + new_val + ",\n" + entry[close:]


def set_fields(bib_text: str, citekey: str, fields: dict) -> str:
    """Return `bib_text` with `fields` set/added on the entry for `citekey`.
    Surgical — every other byte of the entry (and the rest of the file) is
    preserved. Dies if the entry isn't present."""
    span = find_entry_span(bib_text, citekey)
    if span is None:
        die(f"bibEdit set-fields: no entry for citekey {citekey!r} in the .bib")
    start, end = span
    entry = bib_text[start:end]
    for name, value in fields.items():
        entry = _set_field_in_entry(entry, str(name), str(value))
    return bib_text[:start] + entry + bib_text[end:]


def replace_entry(bib_text: str, citekey: str, entry_text: str) -> str:
    """Return `bib_text` with the entry block for `citekey` swapped for
    `entry_text` (a full `@type{…}` block). Splices by offset so it's robust to
    the new entry carrying a different `@type` or citekey (the type-reshape and
    library-sync cases). Dies if the old entry isn't present."""
    span = find_entry_span(bib_text, citekey)
    if span is None:
        die(f"bibEdit replace: no entry for citekey {citekey!r} in the .bib")
    start, end = span
    return bib_text[:start] + entry_text.strip() + bib_text[end:]


def append_entry(bib_text: str, entry_text: str) -> str:
    """Return `bib_text` with `entry_text` appended — one blank line separating
    it from the prior entry, a single trailing newline (find-citation's
    house style). Dies if the new entry's citekey already exists (append never
    silently duplicates; use replace/set-fields to edit an existing entry)."""
    entry_text = entry_text.strip()
    key = citekey_of(entry_text)
    if key is None:
        die("bibEdit append: entry has no parseable @type{citekey, header")
    if key in all_citekeys(bib_text):
        die(f"bibEdit append: citekey {key!r} already present — use replace/set-fields to edit it")
    base = bib_text.rstrip()
    return (base + "\n\n" + entry_text + "\n") if base else (entry_text + "\n")


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
