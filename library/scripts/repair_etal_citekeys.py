"""One-time mop-up: rename library citekeys that were derived from
"et al" or the last (instead of first) author of a multi-author byline.

Scans every catalog entry, computes the canonical citekey from its
master.bib `author` field, and renames any entry whose current citekey
differs. Renames touch all 7 disk locations that reference a citekey:

  1. master.bib            (entry `@type{<key>,...}` opener)
  2. .virgil/catalog.json  (entry `citekey` field; bumps catalog-version)
  3. papers/<key>/         (directory rename + inner source file)
  4. papers/<key>/references.bib (local entry opener)
  5. .virgil/queue/<key>.*  (rename .done / .json / -bibedit / -deepindex / -richindex)
  6. .virgil/logs/<key>/   (directory rename)
  7. papers/*/main.tex + */references.bib  (cross-paper \\cite{<old>})
  8. .virgil/notifications/inbox.json (append a rename event)

Concurrency:
- master.bib, catalog.json, inbox.json mutations go through the
  self-locking helpers in `_tools.py`.
- Per-paper files (main.tex, references.bib, directory renames, queue
  markers, log dirs) are not in the shared-lock set — they're protected
  by the per-paper convention (one Claude session operates on one
  paper at a time).

Usage:
    python3 repair_etal_citekeys.py [--library <path>] [--apply] [--report <path>]

Default is DRY-RUN. Pass `--apply` to mutate.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _tools import (  # noqa: E402
    append_inbox_item,
    bump_catalog_version,
    read_catalog,
    read_master_bib,
    rename_catalog_entry,
    rename_master_bib_entry,
)

_CITEKEY_STOPWORDS = frozenset({
    "the", "a", "an",
    "of", "in", "on", "for", "to", "from", "with", "by", "at", "as", "into", "through",
    "and", "or", "but", "nor",
    "is", "are", "was", "were",
})

_QUEUE_SUFFIXES = (".done", ".json", "-bibedit.json", "-deepindex.json", "-richindex.json")


def _resolve_library_root() -> Path:
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    return Path.home() / "Virgil-Library"


def _ascii_lower(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-zA-Z]", "", s).lower()


def _first_significant_word(title: str) -> str:
    for word in re.findall(r"[a-zA-Z]+", title or ""):
        if word.lower() not in _CITEKEY_STOPWORDS:
            return word.lower()
    return ""


def _bibtex_first_surname(author_field: str) -> str:
    """First-author surname from a BibTeX `author = {...}` value.

    BibTeX list separator is ' and '. Within one author chunk,
    'Lastname, First' has the surname before the comma; 'First Lastname'
    has it as the last whitespace token.
    """
    s = (author_field or "").strip()
    if not s:
        return ""
    first = re.split(r"\s+and\s+", s, maxsplit=1)[0].strip()
    # Drop any 'et al' / 'et al.' that leaked into the author field
    # (defensive — should not happen in a well-formed BibTeX list).
    first = re.sub(r"\bet\s+al\.?\b", "", first, flags=re.IGNORECASE).strip(", ").strip()
    if not first:
        return ""
    if "," in first:
        return _ascii_lower(first.split(",", 1)[0])
    toks = first.split()
    if not toks:
        return ""
    return _ascii_lower(toks[-1])


def _canonical_citekey(author: str, year: str, title: str) -> str:
    """Mirror triage_batch._propose_citekey using BibTeX author semantics."""
    surname = _bibtex_first_surname(author)
    if not surname or not year:
        return ""
    word = _first_significant_word(title)
    return surname + str(year) + word


@dataclass
class Rename:
    old: str
    new: str
    author: str = ""
    title: str = ""
    reason: str = ""


@dataclass
class Plan:
    """Three buckets:

    - renames:   high-confidence rewrites (the literal `al*` etal bug,
                 with a clean canonical target available). --apply
                 applies these.
    - review:    other wrong-first-author cases (chapter-vs-editor,
                 typoed surname, etc.). Surfaced for human eyes; not
                 auto-applied.
    - duplicates: canonical citekey already taken — the same paper
                 exists twice under different keys. Manual merge.
    - skipped:   user-chosen abbreviation of a hyphenated surname
                 (Goldin / Goldin-Meadow). Not a bug.
    - problems:  could not compute a canonical (missing fields,
                 irregular citekey, etc.).
    """
    renames: list[Rename] = field(default_factory=list)
    etal_duplicates: list[dict] = field(default_factory=list)
    review: list[dict] = field(default_factory=list)
    duplicates: list[dict] = field(default_factory=list)
    skipped: list[dict] = field(default_factory=list)
    collisions: list[dict] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)
    scanned: int = 0


_ETAL_PREFIX_RE = re.compile(r"^(al|etal|et|and)\d{4}")


def _diagnose_reason(old: str, canonical: str) -> str:
    if re.match(r"^al\d{4}", old):
        return "etal"
    if re.match(r"^etal\d{4}", old):
        return "etal"
    return "wrong-first-author"


_CITEKEY_PREFIX_RE = re.compile(r"^([a-z]+)(\d{4})")


def _surname_prefix(citekey: str) -> str:
    m = _CITEKEY_PREFIX_RE.match(citekey)
    return m.group(1) if m else ""


def build_plan(library: Path) -> Plan:
    catalog = read_catalog(library)
    master = read_master_bib(library / "master.bib")
    plan = Plan()
    taken: set[str] = set(master.keys())
    for e in catalog.get("entries", []):
        taken.add(e.get("citekey", ""))
    taken.discard("")

    for entry in catalog.get("entries", []):
        plan.scanned += 1
        old_ck = entry.get("citekey", "")
        if not old_ck:
            continue
        bib_entry = master.get(old_ck)
        if not bib_entry:
            plan.problems.append(f"{old_ck}: no master.bib entry")
            continue
        fields = bib_entry.get("fields", {})
        author = fields.get("author", "") or fields.get("editor", "")
        year = fields.get("year", "") or str(entry.get("year", "") or "")
        title = fields.get("title", "") or entry.get("title", "")
        if not author:
            plan.problems.append(f"{old_ck}: empty author/editor field — manual lookup needed")
            continue
        canonical = _canonical_citekey(author, year, title)
        if not canonical:
            plan.problems.append(
                f"{old_ck}: could not derive canonical (author={author!r}, year={year!r})"
            )
            continue
        # Conservative scope: only flag when the FIRST-AUTHOR SURNAME in
        # the existing citekey disagrees with the canonical one.
        canon_surname = _surname_prefix(canonical)
        old_surname = _surname_prefix(old_ck)
        if not canon_surname or canon_surname == old_surname:
            continue
        # Skip user-chosen surname abbreviations of hyphenated names
        # (goldin ⊂ goldinmeadow, quilty ⊂ quiltydunn, patel ⊂ patelgrosz,
        # benthem ⊂ vanbenthem). These are legitimate citekey choices,
        # not bugs.
        if old_surname and (old_surname in canon_surname or canon_surname in old_surname):
            plan.skipped.append({
                "old": old_ck, "canonical": canonical,
                "reason": "surname-substring (hyphenated/abbreviated)",
                "author": author,
            })
            continue
        # Irregular citekey shape (no clean surname+year prefix) — can't
        # cleanly splice the new surname. Flag for manual cleanup.
        if not _CITEKEY_PREFIX_RE.match(old_ck):
            plan.problems.append(
                f"{old_ck}: irregular citekey shape (no surname+year prefix); "
                f"canonical would be {canonical!r}"
            )
            continue
        # Duplicate: the canonical citekey is already in the library —
        # the same paper exists twice under different keys. For et-al
        # bug cases this is a high-confidence merge target; for
        # everything else it's a review item.
        if canonical in taken:
            bucket = plan.etal_duplicates if _ETAL_PREFIX_RE.match(old_ck) else plan.duplicates
            bucket.append({
                "old": old_ck, "canonical": canonical,
                "reason": _diagnose_reason(old_ck, canonical),
                "author": author, "title": title,
            })
            continue
        # Swap the surname prefix only; preserve the user-chosen
        # title-word and any disambiguator suffix.
        rest = old_ck[len(old_surname):]
        candidate = canon_surname + rest
        if candidate == old_ck or candidate in taken:
            plan.collisions.append({
                "old": old_ck, "canonical": canonical,
                "candidate": candidate,
                "reason": "preserved-suffix candidate collides",
            })
            continue
        rename_obj = Rename(
            old=old_ck,
            new=candidate,
            author=author,
            title=title,
            reason=_diagnose_reason(old_ck, canonical),
        )
        # High-confidence: literal `al*` / `etal*` et-al bug → auto-rename
        # candidate. Everything else goes to review (the user can re-
        # invoke the script with a curated subset later if needed).
        if _ETAL_PREFIX_RE.match(old_ck):
            plan.renames.append(rename_obj)
            taken.add(candidate)
            taken.discard(old_ck)
        else:
            plan.review.append({
                "old": old_ck, "candidate": candidate,
                "author": author, "title": title,
                "reason": rename_obj.reason,
            })
    return plan


def _title_words(title: str) -> list[str]:
    out: list[str] = []
    for w in re.findall(r"[a-zA-Z]+", title or ""):
        lo = w.lower()
        if lo in _CITEKEY_STOPWORDS or len(lo) < 3:
            continue
        out.append(lo[:10])
    return out


def _rewrite_cite_args(text: str, old: str, new: str) -> tuple[str, int]:
    """Rewrite any \\cite-family arg containing `old` to use `new`.
    Preserves other keys in multi-key args. Mirrors fuzzy_citekey_disambiguate.
    """
    pattern = re.compile(
        rf"(\\cite[a-zA-Z]*(?:\[[^\]]*\])?\{{[^}}]*?)\b{re.escape(old)}\b"
    )
    return pattern.subn(rf"\g<1>{new}", text)


def _rewrite_bib_entry_opener(text: str, old: str, new: str) -> tuple[str, int]:
    pattern = re.compile(r"(@\w+\s*\{\s*)" + re.escape(old) + r"(\s*,)")
    return pattern.subn(rf"\g<1>{new}\g<2>", text)


def apply_merge_duplicate(library: Path, old: str, canonical: str) -> dict:
    """Merge a buggy `old` citekey into the existing `canonical` one.

    Rewrites cross-paper \\cite{old} → \\cite{canonical}, then removes
    the buggy entry from master.bib + catalog, quarantines the paper
    folder under `.virgil/quarantine/<timestamp>-<old>/`, and renames
    queue markers to `.merged` so the queue doesn't re-process them.
    """
    status: dict = {"steps": [], "kind": "merge"}

    # 1. Rewrite cross-paper \cite{old} to \cite{canonical}.
    cross_count = 0
    papers_dir = library / "papers"
    if papers_dir.exists():
        for paper in papers_dir.iterdir():
            if not paper.is_dir() or paper.name == old:
                continue
            for fname in ("main.tex", "references.bib"):
                f = paper / fname
                if not f.exists():
                    continue
                txt = f.read_text(encoding="utf-8")
                if old not in txt:
                    continue
                new_txt, n = _rewrite_cite_args(txt, old, canonical)
                if n:
                    f.write_text(new_txt, encoding="utf-8")
                    cross_count += n
                    status["steps"].append(f"cite:{paper.name}/{fname}:{n}")
    status["cross_refs"] = cross_count

    # 2. Remove the buggy entry from master.bib.
    master_path = library / "master.bib"
    if master_path.exists():
        from _tools import lock_master_bib, _atomic_write_text  # noqa
        with lock_master_bib(library):
            text = master_path.read_text()
            pattern = re.compile(
                r"(?:^|\n)(@\w+\s*\{\s*" + re.escape(old) + r"\s*,)",
                re.MULTILINE,
            )
            m = pattern.search(text)
            if m:
                # Find end of this @entry by brace-balancing.
                opener_start = m.start(1)
                brace_pos = text.index("{", opener_start)
                depth = 1
                j = brace_pos + 1
                while j < len(text) and depth > 0:
                    if text[j] == "{":
                        depth += 1
                    elif text[j] == "}":
                        depth -= 1
                    j += 1
                # Eat trailing newline.
                while j < len(text) and text[j] in ("\n",):
                    j += 1
                # Also eat preceding `% bib.state` comment line, if present.
                line_start = text.rfind("\n", 0, opener_start)
                line_start = 0 if line_start < 0 else line_start + 1
                prev_nl = text.rfind("\n", 0, max(0, line_start - 1))
                prev_start = 0 if prev_nl < 0 else prev_nl + 1
                if text[prev_start:line_start].strip().startswith("% bib.state"):
                    opener_start = prev_start
                _atomic_write_text(master_path, text[:opener_start] + text[j:])
                status["steps"].append("master_bib:removed")
            else:
                status["steps"].append("master_bib:not_found")

    # 3. Remove the buggy catalog entry.
    from _tools import lock_catalog, read_catalog, write_catalog  # noqa
    with lock_catalog(library):
        catalog = read_catalog(library)
        before = len(catalog.get("entries", []))
        catalog["entries"] = [e for e in catalog.get("entries", []) if e.get("citekey") != old]
        if len(catalog["entries"]) != before:
            write_catalog(library, catalog)
            status["steps"].append("catalog:removed")
        else:
            status["steps"].append("catalog:not_found")

    # 4. Quarantine the paper folder.
    paper_dir = library / "papers" / old
    if paper_dir.exists():
        import datetime
        quarantine = library / ".virgil" / "quarantine"
        quarantine.mkdir(parents=True, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%Y%m%dT%H%M%S")
        dest = quarantine / f"{stamp}-{old}"
        paper_dir.rename(dest)
        status["steps"].append(f"paper_dir:quarantined({dest})")

    # 5. Mark queue files as merged (so the queue drainer ignores them).
    qdir = library / ".virgil" / "queue"
    if qdir.exists():
        for suffix in _QUEUE_SUFFIXES:
            src = qdir / f"{old}{suffix}"
            if src.exists():
                src.rename(qdir / f"{old}{suffix}.merged")
                status["steps"].append(f"queue:{suffix}:tagged_merged")

    # 6. Inbox event.
    append_inbox_item(library, {
        "kind": "citekey-merged",
        "old": old,
        "canonical": canonical,
        "crossRefs": cross_count,
    })
    status["steps"].append("inbox:appended")
    return status


def apply_rename(library: Path, r: Rename) -> dict:
    """Apply one rename across all disk locations. Returns a per-step
    status dict. Caller wraps in try/except for per-entry isolation."""
    status: dict = {"steps": []}
    old, new = r.old, r.new

    # 1. master.bib opener.
    if rename_master_bib_entry(library, old, new):
        status["steps"].append("master_bib:renamed")
    else:
        status["steps"].append("master_bib:not_found")

    # 2. catalog.json citekey field.
    if rename_catalog_entry(library, old, new):
        status["steps"].append("catalog:renamed")
    else:
        status["steps"].append("catalog:not_found")

    # 3. Paper directory + inner source file + local references.bib opener.
    paper_old = library / "papers" / old
    paper_new = library / "papers" / new
    if paper_old.exists():
        if paper_new.exists():
            status["steps"].append(f"paper_dir:collision({paper_new})")
        else:
            paper_old.rename(paper_new)
            status["steps"].append("paper_dir:renamed")
            # Inner source file: <old>.<ext> → <new>.<ext>
            for ext in ("pdf", "docx", "tex"):
                src = paper_new / f"{old}.{ext}"
                if src.exists():
                    src.rename(paper_new / f"{new}.{ext}")
                    status["steps"].append(f"source:{ext}:renamed")
            # Local references.bib opener.
            refs = paper_new / "references.bib"
            if refs.exists():
                txt = refs.read_text(encoding="utf-8")
                new_txt, n = _rewrite_bib_entry_opener(txt, old, new)
                if n:
                    refs.write_text(new_txt, encoding="utf-8")
                    status["steps"].append(f"references_bib:rewrote({n})")
    else:
        status["steps"].append("paper_dir:not_found")

    # 4. Queue markers.
    qdir = library / ".virgil" / "queue"
    if qdir.exists():
        for suffix in _QUEUE_SUFFIXES:
            src = qdir / f"{old}{suffix}"
            if src.exists():
                dst = qdir / f"{new}{suffix}"
                if dst.exists():
                    status["steps"].append(f"queue:{suffix}:collision")
                else:
                    src.rename(dst)
                    status["steps"].append(f"queue:{suffix}:renamed")

    # 5. Log directory.
    log_old = library / ".virgil" / "logs" / old
    log_new = library / ".virgil" / "logs" / new
    if log_old.exists() and not log_new.exists():
        log_old.rename(log_new)
        status["steps"].append("logs:renamed")

    # 6. Cross-paper \cite{old} rewrite across every other paper.
    cross_count = 0
    papers_dir = library / "papers"
    if papers_dir.exists():
        for paper in papers_dir.iterdir():
            if not paper.is_dir():
                continue
            for fname in ("main.tex", "references.bib"):
                f = paper / fname
                if not f.exists():
                    continue
                txt = f.read_text(encoding="utf-8")
                if old not in txt:
                    continue
                if fname == "references.bib":
                    # Local references.bib in the renamed paper is already
                    # handled above; here we only rewrite cross-references
                    # by treating \cite forms.
                    pass
                new_txt, n = _rewrite_cite_args(txt, old, new)
                if n:
                    f.write_text(new_txt, encoding="utf-8")
                    cross_count += n
                    status["steps"].append(f"cite:{paper.name}/{fname}:{n}")
    status["cross_refs"] = cross_count

    # 7. Append an inbox event.
    append_inbox_item(library, {
        "kind": "citekey-renamed",
        "old": old,
        "new": new,
        "reason": r.reason,
        "title": r.title,
    })
    status["steps"].append("inbox:appended")

    return status


def _print_plan(plan: Plan, library: Path, applied: bool) -> dict:
    out = {
        "library": str(library),
        "dryRun": not applied,
        "scannedEntries": plan.scanned,
        "summary": {
            "renames": len(plan.renames),
            "etalDuplicates": len(plan.etal_duplicates),
            "review": len(plan.review),
            "duplicates": len(plan.duplicates),
            "skipped": len(plan.skipped),
            "collisions": len(plan.collisions),
            "problems": len(plan.problems),
        },
        "renames": [
            {"old": r.old, "new": r.new, "author": r.author,
             "title": r.title, "reason": r.reason}
            for r in plan.renames
        ],
        "etalDuplicates": plan.etal_duplicates,
        "review": plan.review,
        "duplicates": plan.duplicates,
        "skipped": plan.skipped,
        "collisions": plan.collisions,
        "problems": plan.problems,
    }
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--library", type=Path, default=None,
                    help="Library root (default: env VIRGIL_LIBRARY_ROOT, "
                         "else CWD if it has master.bib, else ~/Virgil-Library)")
    ap.add_argument("--apply", action="store_true",
                    help="Actually rename. Default is dry-run.")
    ap.add_argument("--report", type=Path, default=None,
                    help="Write JSON report to this file (otherwise stdout)")
    args = ap.parse_args(argv)

    library = args.library or _resolve_library_root()
    if not (library / "master.bib").exists():
        print(f"error: {library}/master.bib not found", file=sys.stderr)
        return 2

    plan = build_plan(library)
    applied_results: list[dict] = []

    if args.apply:
        for r in plan.renames:
            try:
                status = apply_rename(library, r)
                applied_results.append({"old": r.old, "new": r.new,
                                        "ok": True, "status": status})
            except Exception as e:
                applied_results.append({"old": r.old, "new": r.new,
                                        "ok": False, "error": str(e)})
        for d in plan.etal_duplicates:
            try:
                status = apply_merge_duplicate(library, d["old"], d["canonical"])
                applied_results.append({"old": d["old"], "merged_into": d["canonical"],
                                        "ok": True, "status": status})
            except Exception as e:
                applied_results.append({"old": d["old"], "merged_into": d["canonical"],
                                        "ok": False, "error": str(e)})
        if plan.renames or plan.etal_duplicates:
            bump_catalog_version(library)

    report = _print_plan(plan, library, applied=args.apply)
    if applied_results:
        report["appliedResults"] = applied_results

    output = json.dumps(report, indent=2)
    if args.report:
        args.report.write_text(output + "\n")
        print(f"report written to {args.report}")
    else:
        print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
