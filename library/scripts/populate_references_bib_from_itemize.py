"""Populate `references.bib` from an itemized References section.

When `/index-paper` only seeds `references.bib` with the paper itself,
every inline `Author Year` mention in the body fires a
`missing-bib-entry:` audit warning. The fix is to populate
`references.bib` from the itemized `\\section{References}` block of
`main.tex` after `format_references_section.py` has shaped it.

The script walks `\\item \\textbf{<author+year>}<rest>` entries,
parses authors / year / title / journal / publisher / pages, and
emits one BibTeX entry per `\\item`, with the citekey derived as
`<firstauthor-surname-lowercase><year><firstsignificant-titleword>`.

Skips entries that already exist in `references.bib` by citekey
collision. Idempotent.

Usage:
    python3 populate_references_bib_from_itemize.py <paper-dir> \\
        [--style=apa|chicago] [--dry-run]
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path


YEAR_RE = re.compile(r"\b(1[6-9]\d{2}|20\d{2})([a-c]?)\b")
ITEM_RE = re.compile(
    r"\\item\s+\\textbf\{([^}]+)\}\s*([^\n]+(?:\n(?!\s*\\item)[^\n]*)*)",
    re.MULTILINE,
)
STOP_WORDS = frozenset({
    "the", "an", "of", "on", "in", "and", "for", "with", "to", "at",
    "by", "from", "into", "onto", "is", "as",
})


def _normalize_for_citekey(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    return re.sub(r"[^a-z]", "", s)


def _first_significant_title_word(title: str) -> str:
    for w in re.findall(r"\b([A-Za-z]+)\b", title):
        lw = w.lower()
        if lw in STOP_WORDS or len(lw) < 3:
            continue
        return lw[:10]
    return ""


def _parse_author_year(bold: str) -> tuple[list[str], str]:
    """From the `\\textbf{...}` content, split into surnames and year."""
    ym = YEAR_RE.search(bold)
    if not ym:
        return [], ""
    year = ym.group(1) + ym.group(2)
    author_str = bold[:ym.start()].rstrip(" .,")
    # Tokens separated by `,`, ` and `, ` & `.
    raw = re.split(r"\s*(?:,\s*and\s+|,\s+and\s+|,\s+|\s+and\s+|\s+&\s+)", author_str)
    surnames: list[str] = []
    for part in raw:
        part = part.strip()
        if not part:
            continue
        # `Lastname, F.` form — surname is before the first comma.
        if "," in part:
            surnames.append(part.split(",")[0].strip())
        else:
            # `F. Lastname` form — surname is the last word.
            toks = part.split()
            if toks:
                surnames.append(toks[-1].rstrip("."))
    return surnames, year


def _detect_entry_type(body: str) -> str:
    lower = body.lower()
    if "dissertation" in lower or "ph.d." in lower or "thesis" in lower:
        return "phdthesis"
    if "proceedings of" in lower or "in proc." in lower:
        return "inproceedings"
    if "in " in lower and ("ed." in lower or "eds." in lower or "edited by" in lower):
        return "incollection"
    if re.search(r"\\textit\{[^}]+\}[,\s]+\d+", body) or re.search(
        r"\d+[:,]\s*\d+[-–—]\d+", body,
    ):
        return "article"
    if "press" in lower or "publisher" in lower:
        return "book"
    return "misc"


def _parse_fields(body: str, entry_type: str) -> dict[str, str]:
    """Extract title / journal / volume / pages / publisher heuristically."""
    fields: dict[str, str] = {}

    # Title: first quoted run, OR first `\\textit{...}`, OR first
    # period-terminated sentence after the year-anchor.
    title_m = re.search(r'["“]([^"”]+)["”]', body)
    if title_m:
        fields["title"] = title_m.group(1).strip()
    else:
        it_m = re.search(r"\\textit\{([^}]+)\}", body)
        if it_m:
            fields["title"] = it_m.group(1).strip()
        else:
            sent_m = re.match(r"\s*([^.]+)\.", body)
            if sent_m:
                fields["title"] = sent_m.group(1).strip()

    # Journal: an italic run with a following Vol(N) / N(M) pattern.
    j_m = re.search(
        r"\\textit\{([^}]+)\}[,\s]+(\d+)(?:\s*\((\d+)\))?", body,
    )
    if j_m and entry_type == "article":
        fields["journal"] = j_m.group(1).strip()
        fields["volume"] = j_m.group(2)
        if j_m.group(3):
            fields["number"] = j_m.group(3)

    # Pages: `123-145`, `123--145`, `pp. 123–145`.
    p_m = re.search(r"(?:pp?\.?\s*)?(\d+)\s*[-–—]+\s*(\d+)", body)
    if p_m:
        fields["pages"] = f"{p_m.group(1)}--{p_m.group(2)}"

    # Publisher: capitalized phrase followed by Press / Publishers,
    # or `<City>: <Publisher>` pattern.
    pub_m = re.search(
        r"([A-Z][A-Za-z\s]+?(?:Press|Publishers|University Press|Books))",
        body,
    )
    if pub_m and entry_type in ("book", "incollection"):
        fields["publisher"] = pub_m.group(1).strip()

    # DOI: `doi:10.xxxx/...` or `https://doi.org/10.xxxx/...`.
    doi_m = re.search(r"(?:doi:|doi\.org/)([\d\.]+/[^\s,;]+)", body)
    if doi_m:
        fields["doi"] = doi_m.group(1).strip().rstrip(".")

    return fields


def _emit_entry(
    entry_type: str, citekey: str, authors: list[str], year: str,
    fields: dict[str, str],
) -> str:
    lines = [f"@{entry_type}{{{citekey},"]
    if authors:
        lines.append(
            f"  author = {{{' and '.join(authors)}}},"
        )
    if year:
        lines.append(f"  year = {{{re.sub(r'[a-c]$', '', year)}}},")
    for k in ("title", "journal", "volume", "number", "pages", "publisher", "doi"):
        if k in fields:
            lines.append(f"  {k} = {{{fields[k]}}},")
    lines.append("}")
    return "\n".join(lines)


def populate(
    paper_dir: Path, style: str | None = None, dry_run: bool = False,
) -> dict:
    tex_path = paper_dir / "main.tex"
    bib_path = paper_dir / "references.bib"
    if not tex_path.exists():
        return {"error": "main.tex not found"}

    tex = tex_path.read_text(encoding="utf-8")
    bib_existing = bib_path.read_text(encoding="utf-8") if bib_path.exists() else ""
    existing_keys = set(re.findall(r"^@\w+\{([^,\s]+),", bib_existing, re.M))

    refs_start = tex.find("\\section{References}")
    if refs_start < 0:
        refs_start = tex.find("\\section{Bibliography}")
    if refs_start < 0:
        return {"error": "no References section found"}
    next_section = re.search(r"\\section\{", tex[refs_start + 1:])
    refs_end = refs_start + 1 + next_section.start() if next_section else len(tex)
    refs_section = tex[refs_start:refs_end]

    new_entries: list[str] = []
    skipped_dupes = 0
    skipped_unparsable = 0
    seen_keys: set[str] = set(existing_keys)

    for m in ITEM_RE.finditer(refs_section):
        bold = m.group(1).strip()
        rest = m.group(2).strip()
        surnames, year = _parse_author_year(bold)
        if not surnames or not year:
            skipped_unparsable += 1
            continue
        entry_type = _detect_entry_type(rest)
        fields = _parse_fields(rest, entry_type)
        first_surname = _normalize_for_citekey(surnames[0])
        title_word = _first_significant_title_word(fields.get("title", ""))
        citekey = f"{first_surname}{year}{title_word}"
        if not first_surname:
            skipped_unparsable += 1
            continue
        # Disambiguate citekey collisions with a numeric suffix.
        base_citekey = citekey
        suffix = 2
        while citekey in seen_keys:
            citekey = f"{base_citekey}-{suffix}"
            suffix += 1
            if suffix > 99:
                break
        if citekey in existing_keys:
            skipped_dupes += 1
            continue
        seen_keys.add(citekey)
        bib_entry = _emit_entry(entry_type, citekey, surnames, year, fields)
        new_entries.append(bib_entry)

    if not new_entries:
        return {
            "added": 0,
            "skipped_dupes": skipped_dupes,
            "skipped_unparsable": skipped_unparsable,
        }

    addition = (
        "\n\n% --- populated from main.tex References section ---\n\n"
        + "\n\n".join(new_entries) + "\n"
    )

    if not dry_run:
        bib_path.write_text(bib_existing + addition, encoding="utf-8")

    return {
        "added": len(new_entries),
        "skipped_dupes": skipped_dupes,
        "skipped_unparsable": skipped_unparsable,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Populate references.bib from itemized References section.",
    )
    parser.add_argument("paper_dir")
    parser.add_argument("--style", default=None,
                        choices=["apa", "chicago", "siggraph", "author-year-paren"])
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    paper_dir = Path(args.paper_dir).resolve()
    result = populate(paper_dir, style=args.style, dry_run=args.dry_run)
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    suffix = " (dry run)" if args.dry_run else ""
    print(
        f"Added {result['added']} bib entries"
        f" (skipped: {result['skipped_dupes']} dupes, "
        f"{result['skipped_unparsable']} unparsable){suffix}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
