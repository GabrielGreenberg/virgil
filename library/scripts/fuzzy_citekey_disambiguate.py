"""Resolve citekey collisions in references.bib using deeper fields.

When `populate_references_bib_from_itemize.py` (or any other emitter)
produces multiple entries with the same surname+year+titleword
citekey, the simple numeric-suffix disambiguator (`-2`, `-3`) drops
the semantic distinction that distinguishes the entries (different
title second word, different journal, different publisher).

This script walks `references.bib`, finds all collision groups
(entries that share `<surname><year>` prefix), and rewrites their
citekeys to use:

1. The first distinguishing title-word past the original title-anchor.
2. Falling back to the journal abbreviation (`jcp`, `cogsci`).
3. Falling back to the publisher initials.
4. Falling back to alphabetic year-suffix (`a`, `b`, `c`).

Also rewrites every `\\cite{}`-family command in the paper's
`main.tex` to point at the new citekey.

(kehler memo: linguistics/philosophy papers with 30+ self-citations
from one author need this disambiguation.)

Usage:
    python3 fuzzy_citekey_disambiguate.py <paper-dir> [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path


YEAR_RE = re.compile(r"\b(1[6-9]\d{2}|20\d{2})([a-c]?)\b")
ENTRY_RE = re.compile(
    r"^(@\w+\{)([^,\s]+)(,[\s\S]*?\n\})",
    re.M,
)
TITLE_RE = re.compile(r"title\s*=\s*\{([^}]+)\}", re.I)
JOURNAL_RE = re.compile(r"journal\s*=\s*\{([^}]+)\}", re.I)
PUBLISHER_RE = re.compile(r"publisher\s*=\s*\{([^}]+)\}", re.I)

STOP_WORDS = frozenset({
    "the", "an", "of", "on", "in", "and", "for", "with", "to", "at",
    "by", "from", "into", "onto", "is", "as", "a",
})


def _slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    return re.sub(r"[^a-z]", "", s)


def _surname_year_key(citekey: str) -> tuple[str, str] | None:
    """Return (surname, year) parsed from citekey, or None."""
    m = re.match(r"^([a-z]+)(\d{4})", citekey)
    if not m:
        return None
    return m.group(1), m.group(2)


def _title_significant_words(title: str) -> list[str]:
    return [
        _slug(w) for w in re.findall(r"\b([A-Za-z]+)\b", title)
        if _slug(w) and _slug(w) not in STOP_WORDS and len(_slug(w)) >= 3
    ]


def _journal_initials(journal: str) -> str:
    return "".join(
        w[0].lower() for w in journal.split()
        if w[0].isupper() and w.lower() not in STOP_WORDS
    )[:6]


def _publisher_initials(publisher: str) -> str:
    return "".join(
        w[0].lower() for w in publisher.split()
        if w[0].isupper() and w.lower() not in STOP_WORDS
    )[:6]


def _candidate_suffixes(fields: dict[str, str]) -> list[str]:
    """In priority order, candidate distinguishing suffixes."""
    out: list[str] = []
    title = fields.get("title", "")
    for w in _title_significant_words(title)[:3]:
        out.append(w[:8])
    j = fields.get("journal", "")
    if j:
        ji = _journal_initials(j)
        if ji:
            out.append(ji)
    p = fields.get("publisher", "")
    if p:
        pi = _publisher_initials(p)
        if pi:
            out.append(pi)
    # Year-suffix fallback (a, b, c, ...).
    for letter in "abcdefghij":
        out.append(letter)
    return out


def disambiguate(paper_dir: Path, dry_run: bool = False) -> dict:
    bib_path = paper_dir / "references.bib"
    tex_path = paper_dir / "main.tex"
    if not bib_path.exists():
        return {"error": "references.bib not found"}

    bib_text = bib_path.read_text(encoding="utf-8")
    tex_text = tex_path.read_text(encoding="utf-8") if tex_path.exists() else ""

    # Parse entries with their positions for in-place rewriting.
    entries: list[tuple[int, int, str, str, str, dict[str, str]]] = []
    # (start, end, prefix, citekey, body, fields)
    for m in ENTRY_RE.finditer(bib_text):
        prefix = m.group(1)
        citekey = m.group(2).strip()
        body = m.group(3)
        fields: dict[str, str] = {}
        for fr in (TITLE_RE, JOURNAL_RE, PUBLISHER_RE):
            fm = fr.search(body)
            if fm:
                name = fr.pattern.split(r"\s*=")[0]
                fields[name] = fm.group(1).strip()
        entries.append((m.start(), m.end(), prefix, citekey, body, fields))

    # Group by surname+year prefix.
    groups: dict[tuple[str, str], list[int]] = {}
    for idx, e in enumerate(entries):
        sy = _surname_year_key(e[3])
        if sy is None:
            continue
        groups.setdefault(sy, []).append(idx)

    collisions = {k: v for k, v in groups.items() if len(v) > 1}
    if not collisions:
        return {"renamed": 0, "collisions": 0}

    # Assign new citekeys per collision group.
    renames: dict[str, str] = {}  # old -> new
    for (surname, year), idxs in collisions.items():
        # Sort by source position for deterministic year-letter
        # assignment if all else fails.
        idxs.sort()
        used: set[str] = set()
        for idx in idxs:
            _, _, _, citekey, _, fields = entries[idx]
            new_key = citekey
            for cand in _candidate_suffixes(fields):
                if not cand:
                    continue
                candidate_key = f"{surname}{year}{cand}"
                if candidate_key not in used and candidate_key != citekey:
                    new_key = candidate_key
                    used.add(candidate_key)
                    break
            if new_key == citekey:
                # Fallback: keep original (will collide; report).
                used.add(citekey)
                continue
            renames[citekey] = new_key
            used.add(new_key)

    if not renames:
        return {"renamed": 0, "collisions": len(collisions)}

    # Apply renames in bib_text.
    new_bib = bib_text
    # Order matters: longest-key-first to avoid prefix overlap.
    for old in sorted(renames, key=len, reverse=True):
        new = renames[old]
        # Replace the citekey declaration (after `@type{`).
        new_bib = re.sub(
            rf"(@\w+\{{){re.escape(old)}(,)",
            rf"\1{new}\2",
            new_bib,
        )

    # Apply renames in tex (every \cite{}-family arg).
    new_tex = tex_text
    if tex_text:
        for old in sorted(renames, key=len, reverse=True):
            new = renames[old]
            # Match inside any \cite-family argument; preserve other
            # keys in a multi-key argument.
            new_tex = re.sub(
                rf"(\\cite[a-zA-Z]*(?:\[[^\]]*\])?\{{[^}}]*?)\b{re.escape(old)}\b",
                rf"\1{new}",
                new_tex,
            )

    if not dry_run:
        bib_path.write_text(new_bib, encoding="utf-8")
        if tex_text:
            tex_path.write_text(new_tex, encoding="utf-8")

    return {
        "renamed": len(renames),
        "collisions": len(collisions),
        "renames": renames,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Disambiguate citekey collisions in references.bib.",
    )
    parser.add_argument("paper_dir")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    paper_dir = Path(args.paper_dir).resolve()
    result = disambiguate(paper_dir, dry_run=args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Renamed {result['renamed']} citekey(s) across "
        f"{result['collisions']} collision group(s){suffix}."
    )
    if args.dry_run and result.get("renames"):
        for old, new in list(result["renames"].items())[:20]:
            print(f"  {old} -> {new}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
