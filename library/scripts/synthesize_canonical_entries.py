"""Synthesize `references.bib` entries for well-known cited works
when the source PDF's bibliography is truncated or incomplete.

When `/library/deep-index` finishes with a long list of
`missing-bib-entry: Author Year` warnings, two paths are available:

- **Defer** — leave the warnings and emit a `source-missing`
  outstanding-work item. This is the right call when the source
  bibliography is genuinely absent and the cited works are obscure.
- **Synthesize** (this script) — for well-known cited works
  (philosophy / cog-sci classics, frequently-cited papers), look up
  the canonical reference and write an entry the user can verify.

## What a `missing-bib-entry:` warning gives us, and what it does NOT

The warning payload is `<Author phrase> <Year>` and nothing else
(`clean-bibliography.md`, "Missing-bib-entry lookup spec"). **There is no
target title.** That single fact governs the whole acceptance design
below, and the pre-372 code got it wrong in the most expensive direction:
its docstring promised "title-similarity >= 0.85 AND author overlap >= 1"
while the body compared no titles at all, never read `--min-similarity`,
never called its own `_title_similarity`, and ranked candidates with
`score = 1.0 if not best else best[0] + 0.01` — so whichever candidate the
loop happened to see LAST was written into the user's `references.bib` as
the canonical entry for a work it may not be.

A wrong canonical entry is worse than an unresolved warning: it looks
correct, survives every structural validator, and is only caught by a
human who tries to follow it. So this script now **declines** wherever the
evidence does not single out one work.

## The acceptance contract (what the code actually does)

Per target `(<Author phrase>, <Year>)`:

1. **Library first** (`_find-or-surface.md` rule 2). Scan the library's own
   `master.bib` for entries whose year matches and whose authors cover the
   cited surnames. A unique hit is the answer — the user's own
   authenticated entry, copied verbatim, tagged `% from master.bib`. This
   is also the ONE path on which a target title exists at all.
2. **Crossref**, only when the Library has nothing. A candidate must clear
   BOTH bars, checked locally rather than trusted from the wire query:
   - **year** — the record's `issued` year equals the warning's year;
   - **author coverage** — every cited surname appears among the record's
     author surnames (for an `et al.` mention, the first cited surname is
     among the record's first three authors). This mirrors
     `clean-bibliography.md`'s lookup spec §3(b)(ii), and it replaces a
     substring test that matched `Smith` inside `Smithson` and inspected
     only the LAST token of a multi-author phrase.
3. **Unambiguity.** Survivors are clustered into distinct works
   (`--min-similarity` on `work_identity.title_jaccard`, or an identical
   DOI). **More than one distinct work ⇒ REFUSE** and leave the warning
   for the next pass / a human. With no target title this is the only
   defensible substitute for the promised title bar: the evidence must
   point at exactly one work.
4. **Ranking** inside the surviving cluster is a real, order-independent
   score (surname coverage, then metadata completeness, then title length,
   tie-broken lexicographically on DOI/title) — never "last seen wins".

Every refusal is REPORTED (`result["refusals"]`, printed by the CLI), so a
declined target is surfaced rather than silently dropped.

## Stated residual (do not promise this away again)

With no target title, a target whose Crossref result is a SINGLE
author-and-year-plausible record is accepted on author+year evidence
alone — it may still be the wrong work by that author in that year. That
is the synthesis assumption, and it is why every written entry carries a
`review before final publication` tag. Closing it needs the warning to
carry more than `<Author> <Year>` (a mention context or a title), which is
a change to the warning grammar and its merge semantics, not to this file.

Identity primitives (surname normalization, title normalization, Jaccard,
year parsing) are taken from `work_identity.py`, the library's stated SSOT
for "are these two records the same work" — this file holds no private
fork of them.

The written entries are flagged so future passes / users can verify or
replace them.

(fodor, kulvicki memos.)

Usage:
    python3 synthesize_canonical_entries.py <citekey>
        [--min-similarity 0.85] [--max-entries 30] [--dry-run]
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

import work_identity as wi  # noqa: E402
from _tools import citekey_matches, read_master_bib  # noqa: E402

CROSSREF_URL = "https://api.crossref.org/works"
UA = "virgil-library/synthesize-canonical (mailto:gabriel.greenberg@gmail.com)"


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _read_catalog_warnings(library: Path, citekey: str) -> list[str]:
    cat = library / ".virgil" / "catalog.json"
    if not cat.exists():
        return []
    try:
        data = json.loads(cat.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    for entry in data.get("entries", []):
        # NFC-insensitive: the writer normalizes the citekey, so a raw `!=`
        # returns [] on an NFD-spelled row and synthesis silently reports
        # "no missing-bib-entry warnings" on exactly the papers whose
        # citekeys carry diacritics (Tichý / Čerić / López).
        if not citekey_matches(entry.get("citekey", ""), citekey):
            continue
        warnings = (entry.get("indexed") or {}).get("warnings") or []
        return [w for w in warnings if isinstance(w, str)]
    return []


def _missing_bib_targets(warnings: list[str]) -> list[tuple[str, str]]:
    """Return list of (author-string, year) tuples from missing-bib-entry
    warnings."""
    out: list[tuple[str, str]] = []
    for w in warnings:
        if not w.startswith("missing-bib-entry:"):
            continue
        payload = w.split(":", 1)[1].strip()
        m = re.match(r"(.+?)\s+(\d{4}[a-c]?)", payload)
        if m:
            out.append((m.group(1).strip(), m.group(2).strip()))
    return out


def _crossref_query(author: str, year: str, rows: int = 5) -> list[dict]:
    time.sleep(0.3)  # courtesy rate limit; lives with the wire call, not the loop
    params = {
        "query.author": author,
        "query": author + " " + year,
        "rows": str(rows),
        "filter": f"from-pub-date:{year[:4]},until-pub-date:{year[:4]}",
    }
    url = CROSSREF_URL + "?" + urllib.parse.urlencode(params)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=15) as r:
            data = json.loads(r.read())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return []
    return data.get("message", {}).get("items", [])


def _record_to_bib(record: dict, citekey: str) -> str | None:
    """Convert a Crossref record to a BibTeX entry."""
    title_list = record.get("title", [])
    title = title_list[0] if title_list else None
    authors_list = record.get("author", [])
    if not title or not authors_list:
        return None
    author_str = " and ".join(
        f"{a.get('family', '')}, {a.get('given', '')}".strip(", ")
        for a in authors_list
    )
    issued = record.get("issued", {}).get("date-parts", [[None]])
    year = str(issued[0][0]) if issued and issued[0] else ""
    cr_type = record.get("type", "")
    if cr_type in ("book", "monograph", "reference-book"):
        bib_type = "book"
    elif cr_type in ("book-chapter", "book-part"):
        bib_type = "incollection"
    elif cr_type == "proceedings-article":
        bib_type = "inproceedings"
    elif cr_type == "dissertation":
        bib_type = "phdthesis"
    else:
        bib_type = "article"

    lines = [
        f"@{bib_type}{{{citekey},",
        f"  author = {{{author_str}}},",
        f"  year = {{{year}}},",
        f"  title = {{{title}}},",
    ]
    container = record.get("container-title", [])
    if container:
        if bib_type == "article":
            lines.append(f"  journal = {{{container[0]}}},")
        elif bib_type == "incollection":
            lines.append(f"  booktitle = {{{container[0]}}},")
    vol = record.get("volume")
    if vol and bib_type == "article":
        lines.append(f"  volume = {{{vol}}},")
    page = record.get("page")
    if page:
        lines.append(f"  pages = {{{page}}},")
    publisher = record.get("publisher")
    if publisher and bib_type in ("book", "incollection"):
        lines.append(f"  publisher = {{{publisher}}},")
    doi = record.get("DOI")
    if doi:
        lines.append(f"  doi = {{{doi}}},")
    lines.append("}")
    return "\n".join(lines)


# ── Matching primitives ────────────────────────────────────────────────
#
# Every normalizer here delegates to `work_identity`, the library's stated
# SSOT for bibliographic identity ("are these two records the same work?").
# The pre-372 file carried private forks of both halves — a crude Jaccard
# (`_title_similarity`, defined and never called) and a substring test over a
# concatenated family-name blob — and the forks are what let the acceptance
# rule drift away from its own docstring.


def _surname_key(one_author: str) -> str:
    """Normalized surname key for ONE name, from any of our three sources.

    The three spellings that must agree are a prose mention (`Barbara Grosz`),
    a Crossref `family` value (`Grosz`, `van Fraassen`) and a bib `author`
    token (`Grosz, Barbara`). Reducing all three to the cleaned LAST
    whitespace token of the surname portion makes them symmetric — which
    `work_identity.author_surnames` alone does not give us, since it keeps
    `van Fraassen` whole while a prose mention of the same author normalizes
    to `fraassen`. Cleaning (NFKD fold, accent strip, alpha-only) is
    `work_identity`'s, not a fourth copy.
    """
    a = (one_author or "").strip()
    if "," in a:
        a = a.split(",", 1)[0]
    toks = a.split()
    if not toks:
        return ""
    return wi.first_author_surname(toks[-1])


_ET_AL_RE = re.compile(r"\bet\.?\s+al\.?", re.I)
_MENTION_SPLIT_RE = re.compile(r"\s*(?:,|&|\band\b)\s*", re.I)


def _parse_cited_mention(phrase: str) -> tuple[tuple[str, ...], bool]:
    """`<Author phrase>` → (ordered unique cited surnames, saw-`et al.`).

    Implements the author half of `clean-bibliography.md`'s "Missing-bib-entry
    lookup spec" §2 — `A and B`, `A & B`, `A, B, and C` (Oxford comma
    optional), `A et al.`. Kept here rather than hoisted because this is its
    only Python consumer today (§3g's own lookup is agent-executed markdown);
    a second consumer hoists it to `_tools`.
    """
    et_al = bool(_ET_AL_RE.search(phrase or ""))
    body = _ET_AL_RE.sub(" ", phrase or "")
    out: list[str] = []
    for part in _MENTION_SPLIT_RE.split(body):
        key = _surname_key(part)
        if key and key not in out:
            out.append(key)
    return tuple(out), et_al


def _bib_author_surnames(author_field: str) -> list[str]:
    """Ordered surname keys from a BibTeX `author = {...}` field."""
    if not author_field:
        return []
    parts = re.split(r"\s+and\s+", author_field.strip())
    return [k for k in (_surname_key(p) for p in parts) if k]


def _record_author_surnames(record: dict) -> list[str]:
    """Ordered surname keys from a Crossref record's author list."""
    out: list[str] = []
    for a in record.get("author", []) or []:
        key = _surname_key(a.get("family", "") or a.get("name", ""))
        if key:
            out.append(key)
    return out


def _authors_cover(
    cited: tuple[str, ...], et_al: bool, record_surnames: list[str],
) -> bool:
    """The acceptance rule from the lookup spec §3(b)(ii).

    Every cited surname must appear among the record's surnames; an `et al.`
    mention is a PREFIX claim, so only the first cited surname is required and
    it must sit among the record's first three authors. Failing OPEN here
    would be the pre-372 behavior — a missed match costs a refusal (the
    warning survives to the next pass), a false match writes a wrong entry
    into the user's `references.bib`.
    """
    if not cited or not record_surnames:
        return False
    if et_al:
        return cited[0] in record_surnames[:3]
    return all(c in record_surnames for c in cited)


def _braces_balanced(text: str) -> bool:
    """Cheap brace-balance check over a BibTeX entry's raw span."""
    depth = 0
    for ch in text:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _record_title(record: dict) -> str:
    titles = record.get("title", []) or []
    if isinstance(titles, str):
        return titles
    return titles[0] if titles else ""


def _record_year(record: dict) -> "int | None":
    issued = (record.get("issued") or {}).get("date-parts") or []
    if issued and issued[0]:
        return wi.norm_year(str(issued[0][0]))
    return None


def _same_work(a_title: str, a_doi: str, b_title: str, b_doi: str,
               min_similarity: float) -> bool:
    """Do two CANDIDATES describe one work?

    An identical DOI settles it. Otherwise the bar is plain title agreement at
    `--min-similarity` — deliberately NOT `work_identity.classify`, whose
    rules are tuned for de-duplication, where a wrong merge is recoverable.
    Here a wrong merge writes a wrong canonical entry into a user's `.bib`, so
    the test is the one the CLI names and the knob is monotone in the safe
    direction: raising the threshold splits candidates and refuses more.
    """
    da, db = wi.normalize_doi(a_doi), wi.normalize_doi(b_doi)
    if da and db:
        return da == db
    return wi.title_jaccard(wi.norm_title(a_title), wi.norm_title(b_title)) >= min_similarity


def _cluster_distinct_works(
    items: list[tuple[str, str]], min_similarity: float,
) -> list[list[int]]:
    """Greedy clustering of `(title, doi)` pairs into distinct works.

    Deterministic: the caller sorts `items` first, so the greedy pass cannot
    depend on the order Crossref (or a dict) happened to hand them over — the
    order-dependence that made the pre-372 ranking "last seen wins".
    """
    clusters: list[list[int]] = []
    for i, (title, doi) in enumerate(items):
        for cl in clusters:
            rt, rd = items[cl[0]]
            if _same_work(title, doi, rt, rd, min_similarity):
                cl.append(i)
                break
        else:
            clusters.append([i])
    return clusters


def _build_citekey(author: str, year: str, title: str) -> str:
    """Produce `<surname><year><title-first-word>` lowercase."""
    surname = _surname_key(author)
    title_word_m = re.search(r"\b([A-Za-z]{3,})\b", title)
    title_word = title_word_m.group(1).lower() if title_word_m else ""
    stop = {"the", "an", "of", "on", "in", "and", "for", "with", "to"}
    if title_word in stop and title_word_m:
        next_m = re.search(r"\b([A-Za-z]{3,})\b", title[title_word_m.end():])
        if next_m:
            title_word = next_m.group(1).lower()
    return f"{surname}{year[:4]}{title_word[:10]}"


# ── Resolution: Library first, then Crossref ───────────────────────────


def _master_candidates(
    master: dict, cited: tuple[str, ...], et_al: bool, year: str,
) -> list[tuple[str, dict]]:
    """`master.bib` entries clearing the year + author-coverage bars."""
    want_year = wi.norm_year(year)
    hits: list[tuple[str, dict]] = []
    for key in sorted(master):
        entry = master[key]
        fields = entry.get("fields", {}) or {}
        if want_year is None or wi.norm_year(fields.get("year", "")) != want_year:
            continue
        if not _authors_cover(cited, et_al, _bib_author_surnames(fields.get("author", ""))):
            continue
        hits.append((key, entry))
    return hits


def _crossref_candidates(
    records: list[dict], cited: tuple[str, ...], et_al: bool, year: str,
) -> list[dict]:
    """Crossref records clearing the year + author-coverage bars.

    The year is re-checked LOCALLY: `_crossref_query`'s `from-pub-date` /
    `until-pub-date` filter is on the publication date, which drifts from the
    issued year for online-first records, so the wire filter is a narrowing
    hint and not the bar.
    """
    want_year = wi.norm_year(year)
    out: list[dict] = []
    for rec in records:
        if not _record_title(rec):
            continue
        if want_year is None or _record_year(rec) != want_year:
            continue
        if not _authors_cover(cited, et_al, _record_author_surnames(rec)):
            continue
        out.append(rec)
    return out


def _rank_crossref(rec: dict, cited: tuple[str, ...]) -> tuple:
    """Order-INDEPENDENT candidate score, best-is-largest.

    Replaces `score = 1.0 if not best else best[0] + 0.01`, under which every
    later candidate outscored the incumbent by construction. The trailing
    lexicographic pair makes the maximum unique, so two equally-scored records
    resolve the same way whatever order they arrive in.
    """
    surnames = _record_author_surnames(rec)
    coverage = sum(1 for c in cited if c in surnames)
    return (
        coverage,
        1 if rec.get("DOI") else 0,
        1 if rec.get("container-title") else 0,
        1 if rec.get("page") else 0,
        len(wi.norm_title(_record_title(rec))),
        wi.normalize_doi(rec.get("DOI", "") or ""),
        wi.norm_title(_record_title(rec)),
    )


def _resolve_target(
    author: str,
    year: str,
    master: dict,
    min_similarity: float,
) -> tuple[str, dict]:
    """Resolve one `missing-bib-entry:` target to a decision.

    Returns `(outcome, payload)` where outcome is `master` / `crossref` /
    a refusal reason. Refusals are values, not silence: `synthesize` reports
    every one of them so a declined target is surfaced.
    """
    cited, et_al = _parse_cited_mention(author)
    if not cited:
        return "unparsed-author", {}

    # 1. Library first (_find-or-surface.md rule 2).
    hits = _master_candidates(master, cited, et_al, year)
    if hits:
        clusters = _cluster_distinct_works(
            [(e.get("fields", {}).get("title", ""), e.get("fields", {}).get("doi", ""))
             for _, e in hits],
            min_similarity,
        )
        if len(clusters) > 1:
            return "ambiguous-in-library", {"candidates": len(hits)}
        key, entry = hits[clusters[0][0]]
        return "master", {"citekey": key, "entry": entry}

    # 2. Crossref, unambiguous only.
    records = _crossref_query(author, year)
    survivors = _crossref_candidates(records, cited, et_al, year)
    if not survivors:
        return ("no-author-year-match" if records else "no-crossref-records",
                {"candidates": len(records)})
    survivors.sort(key=lambda r: (wi.norm_title(_record_title(r)),
                                  wi.normalize_doi(r.get("DOI", "") or "")))
    clusters = _cluster_distinct_works(
        [(_record_title(r), r.get("DOI", "") or "") for r in survivors],
        min_similarity,
    )
    if len(clusters) > 1:
        return "ambiguous-candidates", {"candidates": len(survivors),
                                        "works": len(clusters)}
    best = max((survivors[i] for i in clusters[0]),
               key=lambda r: _rank_crossref(r, cited))
    return "crossref", {"record": best}


def synthesize(
    citekey: str,
    min_similarity: float = 0.85,
    max_entries: int = 30,
    dry_run: bool = False,
) -> dict:
    library = _resolve_library_root()
    paper_dir = library / "papers" / citekey
    bib_path = paper_dir / "references.bib"
    if not bib_path.exists():
        return {"error": f"references.bib not found at {bib_path}"}

    warnings = _read_catalog_warnings(library, citekey)
    targets = _missing_bib_targets(warnings)
    if not targets:
        return {"synthesized": 0, "refusals": [], "reason": "no missing-bib-entry warnings"}

    existing_keys = set(
        re.findall(r"^@\w+\{([^,\s]+),",
                   bib_path.read_text(encoding="utf-8"),
                   re.M)
    )
    master = read_master_bib(library / "master.bib")
    new_entries: list[tuple[str, str]] = []  # (citekey, bib_text)
    refusals: list[dict] = []
    timestamp = datetime.date.today().isoformat()

    for author, year in targets[:max_entries]:
        outcome, payload = _resolve_target(author, year, master, min_similarity)
        if outcome not in ("master", "crossref"):
            refusals.append({"target": f"{author} {year}", "reason": outcome, **payload})
            continue

        if outcome == "master":
            proposed_key = payload["citekey"]
            if proposed_key in existing_keys:
                refusals.append({"target": f"{author} {year}",
                                 "reason": "already-in-references-bib",
                                 "citekey": proposed_key})
                continue
            body = (payload["entry"].get("raw") or "").strip()
            # `read_master_bib` caps an UNBALANCED entry's span at the next
            # opener rather than letting it swallow the file, so its `raw` can
            # be a truncated fragment. Copying that verbatim would splice
            # broken BibTeX into the user's `references.bib` — refuse instead.
            if not body or not _braces_balanced(body):
                refusals.append({"target": f"{author} {year}",
                                 "reason": "library-entry-unreadable",
                                 "citekey": proposed_key})
                continue
            provenance = (
                f"% from library master.bib on {timestamp} "
                f"(authenticated by the Library, not synthesized)\n"
            )
        else:
            record = payload["record"]
            proposed_key = _build_citekey(author, year, _record_title(record))
            if proposed_key in existing_keys:
                refusals.append({"target": f"{author} {year}",
                                 "reason": "already-in-references-bib",
                                 "citekey": proposed_key})
                continue
            body = _record_to_bib(record, proposed_key)
            if not body:
                refusals.append({"target": f"{author} {year}",
                                 "reason": "record-not-convertible"})
                continue
            provenance = (
                f"% synthesized via Crossref on {timestamp}; review before "
                f"final publication\n"
            )

        annotated = (
            f"{provenance}"
            f"% original warning: missing-bib-entry: {author} {year}\n"
            f"{body}"
        )
        new_entries.append((proposed_key, annotated))
        existing_keys.add(proposed_key)

    if not new_entries:
        return {"synthesized": 0, "refusals": refusals,
                "reason": "no unambiguous match for any target"}

    if not dry_run:
        addition = "\n\n% --- synthesized canonical entries ---\n\n" + (
            "\n\n".join(e[1] for e in new_entries)
        ) + "\n"
        existing_bib = bib_path.read_text(encoding="utf-8")
        bib_path.write_text(existing_bib + addition, encoding="utf-8")

    return {"synthesized": len(new_entries),
            "refusals": refusals,
            "citekeys": [e[0] for e in new_entries]}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Synthesize canonical bib entries for missing-bib warnings.",
    )
    parser.add_argument("citekey")
    parser.add_argument("--min-similarity", type=float, default=0.85)
    parser.add_argument("--max-entries", type=int, default=30)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = synthesize(
        args.citekey, args.min_similarity, args.max_entries, args.dry_run,
    )
    if "error" in result:
        print(f"error: {result['error']}", file=sys.stderr)
        return 1
    refusals = result.get("refusals") or []
    if result["synthesized"] == 0:
        print(f"No entries synthesized: {result.get('reason', 'unknown')}.")
    else:
        suffix = " (dry run)" if args.dry_run else ""
        print(f"Resolved {result['synthesized']} canonical entries{suffix}.")
        for ck in result["citekeys"][:10]:
            print(f"  - {ck}")
    # Surfaced, never silent: a declined target is the success mode of the
    # find-or-surface doctrine, so it is reported rather than dropped.
    if refusals:
        print(f"Declined {len(refusals)} target(s) — warning left in place:")
        for r in refusals[:10]:
            print(f"  - {r['target']}: {r['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
