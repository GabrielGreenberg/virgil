#!/usr/bin/env python3
"""Resolve a bib key in the doc's references.bib + paired annotation.

Editor-side bib-review skills need to surface the existing entry text
(unparsed, since BibTeX preserves user intent) plus any annotation note
the user has attached in `virgil/annotations.json`. This script avoids
shipping a full BibTeX parser by pulling the verbatim entry block via a
brace-matching scan, which is enough for pretty-printing and surgical
field updates.

Usage:  python3 bib_resolve.py <docPath> <bibKey>
        python3 bib_resolve.py <docPath> --bibliography-anchor

Emits:
  { "bibKey": "...",
    "bib":    "<doc-relative path>",
    "entry":  "@article{key, ... }",  // verbatim entry block, or null
    "fields": { "title": "...", "author": "..." },
    "annotation": "<user note text or null>"
  }

`--bibliography-anchor` answers "where in the paper does the bibliography
sit?" instead: `{ "anchor": "<uuid>" | null, "tex": "<doc-relative path>" }`
— the `%!v:` uuid of the block holding `\\bibliography{…}` /
`\\printbibliography`, the paragraph a whole-bibliography finding (sync-bib's
review report, task 1595) anchors its card at. `null` when the paper prints no
bibliography or the block carries no uuid yet; the caller then has no anchor
and must carry the finding in its run notification instead.

For deeper Crossref/OpenAlex lookups, skills should call
`library/scripts/bib_auth.py` directly — that module already handles the
authentication-tier search and field-confidence reporting.
"""

from __future__ import annotations

import json
import re
import sys

from _common import (
    NODE_UUID_REGEX,
    die,
    find_bib_file,
    find_tex_file,
    read_json,
    resolve_doc,
    sidecar,
)


# THE entry-head rule for editor/scripts (task 884) — every reader here
# (`find_entry_span`, `all_citekeys`, `citekey_of`, `parse_fields`, the
# preservation census, and `citekey_sidecars`' vbid binder) iterates entries
# through `_iter_entries`, which scans with this ONE pattern, so "present" and
# "editable" cannot disagree. An opener starts a LINE, after optional
# indentation (BibTeX — and the app's `lineAnchoredOpeners` — accept an
# indented `  @article{key,`); line-anchoring is what lets a malformed entry be
# CONTAINED. A matched span starts at the LINE start, indentation included. The
# library's `_bib_parse._BIB_ENTRY_START_RE`, verbatim — both silos answer
# `src/lib/__tests__/fixtures/bib-entry-span-corpus.json`.
_ENTRY_START = re.compile(r"(?m)^[ \t]*@(\w+)[ \t]*\{[ \t]*([^,\s}]+)[ \t]*,")


def _brace_end(text: str, brace: int) -> int | None:
    """Index just past the `}` that closes the `{` at `brace`, or None if it
    never closes. BRACE-ONLY — BibTeX's own rule: braces balance in every field
    value, and a `"` inside `{…}` is a literal (`{Grundz"uge}`)."""
    depth = 0
    for j in range(brace, len(text)):
        ch = text[j]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return j + 1
    return None


def _iter_entries(text: str) -> list[tuple[str, str, int, int | None]]:
    """Every real entry in `text` as `(key, type, start, end|None)`, in file
    order — THE entry scan of editor/scripts (task 884). An opener that falls
    inside an earlier entry's BALANCED span is a field value, not an entry;
    `end` is None when the entry's braces never balance. Offsets are into
    `text` as given (strip a BOM first if the caller may hold one)."""
    out: list[tuple[str, str, int, int | None]] = []
    consumed = 0
    for m in _ENTRY_START.finditer(text):
        if m.start() < consumed:
            continue  # inside a prior balanced entry's value
        end = _brace_end(text, text.index("{", m.start()))
        if end is not None:
            consumed = end
        out.append((m.group(2), m.group(1), m.start(), end))
    return out


def _find_entry(entries, key: str):
    """The entry for `key` — LAST wins on a duplicate, NFC then NFD (the
    library's lookup rule). The one lookup both `find_entry_span` (edit) and
    `append_entry`'s duplicate check (presence) ask, so they cannot disagree."""
    import unicodedata

    for form in ("NFC", "NFD"):
        k = unicodedata.normalize(form, key)
        hits = [e for e in entries if e[0] == k]
        if hits:
            return hits[-1]
    return None


def find_entry_span(text: str, key: str) -> tuple[int, int] | None:
    """Return the `(start, end)` offsets of the `@type{key, …}` entry block in
    `text`, or None when the key has no entry. The single source of truth for
    locating an entry; `find_entry_block` (verbatim text) and the surgical
    editors (`set_fields` / `replace_entry`) all splice by these offsets.

    The Python-editor port of the library's `_bib_parse.locate_entry_for_splice`
    (the two silos can't share code across the bundle seam, so both answer
    `src/lib/__tests__/fixtures/bib-entry-span-corpus.json` — task 614):

    - openers are line-anchored; one that falls inside an earlier entry's
      BALANCED span is a field value, not an entry;
    - the extent is brace-matched with NO string tracking. The old scan here
      toggled "in string" on every `"`, so a German `{Untersuchungen "uber}`
      ran the span through the next entries and a library-sync swap deleted
      them;
    - LAST wins on a duplicated key (NFC, then NFD), matching the library;
    - an entry whose extent can't be trusted DIES rather than returning a span
      a splice would widen into a neighbour: its braces never balance, or its
      balanced span covers another line-anchored opener."""
    bom = 1 if text.startswith("\ufeff") else 0
    body = text[bom:]
    target = _find_entry(_iter_entries(body), key)
    if target is None:
        return None
    _, _, start, end = target
    if end is None:
        die(f"bib entry {key!r}: its braces are unbalanced, so where the entry "
            f"ends is a guess — repair the .bib by hand")
    strays = [m.group(2) for m in _ENTRY_START.finditer(body, start + 1, end)]
    if strays:
        die(f"bib entry {key!r}: its span also covers {', '.join(strays)} — the "
            f"file has an unbalanced brace in a value; repair the .bib by hand")
    return start + bom, end + bom


def assert_entries_preserved(old: str, new: str, replaced: str | None = None) -> None:
    """Measure a `.bib` write before it lands: every entry the file held before
    must still be there after — except ONE instance of `replaced`, the key a
    `replace` swaps out (its successor may carry a different key). Dies naming
    what vanished. The splicers are offset-exact by construction; this is the
    check that doesn't trust the construction (the write-path law's rule:
    measure an automatic write against what was read — task 614, where a
    mis-scanned span silently deleted neighbouring references)."""
    import unicodedata
    from collections import Counter

    def census(text: str) -> Counter:
        return Counter(unicodedata.normalize("NFC", e[0])
                       for e in _iter_entries(text.lstrip("\ufeff")))

    before, after = census(old), census(new)
    if replaced is not None:
        replaced = unicodedata.normalize("NFC", replaced)
        if before[replaced] > 0:
            before[replaced] -= 1
    lost = sorted(k for k, n in before.items() if after[k] < n)
    if lost:
        die(f"bibEdit refused: the edit would remove {', '.join(lost)} from the "
            f".bib — nothing was written")


def find_entry_block(text: str, key: str) -> tuple[str | None, str | None]:
    """Return (entry_text, entry_type) for `key`, or (None, None)."""
    span = find_entry_span(text, key)
    if span is None:
        return None, None
    start, end = span
    head = _ENTRY_START.match(text, start)
    return text[start:end], (head.group(1) if head else None)


def citekeys_in_order(text: str) -> list[str]:
    """Every `@type{citekey,` key defined in a .bib's text, in FILE ORDER (a
    duplicate repeats) — the same entries `find_entry_span` can edit (one scan,
    `_iter_entries`). Order matters to the readers' case-folded lookup, which
    resolves a third spelling to the FIRST case-variant (task 1634)."""
    return [e[0] for e in _iter_entries(text.lstrip("\ufeff"))]


def all_citekeys(text: str) -> set[str]:
    """`citekeys_in_order` as a set — for presence checks."""
    return set(citekeys_in_order(text))


def citekey_of(entry_text: str) -> str | None:
    """The citekey of a single `@type{citekey, …}` entry, or None."""
    entries = _iter_entries(entry_text.strip().lstrip("\ufeff"))
    return entries[0][0] if entries else None


def _field_grammar():
    """The library's `_bib_parse` — the ONE Python field grammar (task 1628:
    this file's own parser read `#`, comma-less lines and whitespace
    differently from the library's, so a verify compared the paper's entry
    against master.bib through two readings of the same bytes). Imported
    lazily through the `_silo_path` door, so the entry scanners here never
    depend on the sibling silo."""
    from _silo_path import import_path_for

    import_path_for("library", needs=("_bib_parse.py",))
    import _bib_parse

    return _bib_parse


def _value_span(text: str, start: int) -> int:
    """Given `start` at a field value (whitespace before it allowed), return
    the index just past the WHOLE value — every `#` part — so a surgical
    replace cannot leave a dangling `# "…"` tail. The same scan
    `parse_fields` reads by (`_bib_parse.value_end`)."""
    return _field_grammar().value_end(text, start)


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
    if _find_entry(_iter_entries(bib_text.lstrip("\ufeff")), key) is not None:
        die(f"bibEdit append: citekey {key!r} already present — use replace/set-fields to edit it")
    base = bib_text.rstrip()
    return (base + "\n\n" + entry_text + "\n") if base else (entry_text + "\n")


def parse_fields(entry: str) -> dict:
    """Field=value pairs of one `@type{key, …}` entry block, read by the
    library's `_bib_parse.parse_fields` (the shared grammar, pinned by
    `bib-field-parse-corpus.json`). Values keep their inner whitespace; a
    compare that wants the app's collapsed reading calls
    `_bib_parse.normalize_field_value` on both sides."""
    body = entry
    head = _ENTRY_START.search(body)
    if head:
        body = body[head.end():]
    return _field_grammar().parse_fields(body)


# A bibliography-printing command at the START of a line (after indentation),
# so a commented-out `% \bibliography{…}` never counts.
_BIBLIOGRAPHY_CMD = re.compile(r"(?m)^[ \t]*\\(?:bibliography|printbibliography)(?![A-Za-z])")
_BLANK_LINE = re.compile(r"\n[ \t]*\n")


def bibliography_anchor(tex: str) -> str | None:
    """The `%!v:` uuid of the block that prints the bibliography, or None.
    The block's uuid is the first marker at or after the command within the
    same blank-line-delimited slab (the `marker_paragraph_ids` rule) — the
    LAST such command wins, since that is where the reader meets the list."""
    hits = list(_BIBLIOGRAPHY_CMD.finditer(tex))
    if not hits:
        return None
    m = hits[-1]
    blank = _BLANK_LINE.search(tex, m.end())
    u = NODE_UUID_REGEX.search(tex, m.end(), blank.start() if blank else len(tex))
    return u.group(1) if u else None


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        die("usage: bib_resolve.py <docPath> <bibKey> | <docPath> --bibliography-anchor")
    doc = resolve_doc(argv[1])
    if argv[2] == "--bibliography-anchor":
        tex = find_tex_file(doc)
        text = tex.read_text(encoding="utf-8", errors="replace")
        print(json.dumps({"anchor": bibliography_anchor(text),
                          "tex": str(tex.relative_to(doc))}, indent=2))
        return 0
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

    # annotations.json has two live shapes (V1 flat citekey map, V2 uid-keyed);
    # read it the way the app's panel does (citekey_sidecars, task 615).
    import citekey_sidecars as CS

    ann = read_json(sidecar(doc, "annotations.json"), default=None)
    uid = CS.vbid_uid_for(text, key) if bib and CS.is_annotations_v2(ann) else None
    out["annotation"] = CS.get_annotation(ann, key, uid)

    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
