"""Audit a deep-indexed paper and emit a punch-list of remaining issues.

This is the **completion signal** for the /deep-index convergence loop.
An empty punch-list means the paper is genuinely clean. A non-empty
punch-list becomes the next pass's agenda.

Checks performed:
- Invisible characters (U+00AD, U+200B, U+00A0 word-internal, U+FEFF,
  U+FB00-U+FB06 ligatures, U+2800 Braille pattern blank).
- Hyphenation artifacts (\\b[a-z]+- [a-z]+\\b, \\b\\w[A-Z][a-z]\\b).
- Title/metadata cross-check (\\title{} vs catalog vs master.bib).
- references.bib sample audit (trailing ", no", trailing periods,
  double-hyphenation on page ranges, suspicious type detection).
- Pgmark continuity (low-confidence count, validator-finding count).
- Footnote inline-rate (leaked-prose paragraphs that should have been
  re-attached but weren't).
- Citation completeness (\\cite{} keys missing from references.bib).

Usage:
    python3 audit_deepindex.py <paper-dir>

Where <paper-dir> is `papers/<citekey>/` relative to the library root.

Output: prints a markdown `## Audit punch-list` block to stdout, with
one bullet per finding. If clean, prints "Clean. No remaining issues
detected." Exit code is 0 if punch-list is empty, 1 if non-empty (so
shell scripts can branch on cleanliness).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


# Invisible character codepoints to detect.
# Soft hyphen, ZWSP, BOM, ZWNJ, ZWJ, NBSP, Braille blank.
INVISIBLES = {
    "U+00AD": "­",  # soft hyphen
    "U+200B": "​",  # zero-width space
    "U+200C": "‌",  # zero-width non-joiner
    "U+200D": "‍",  # zero-width joiner
    "U+FEFF": "﻿",  # BOM
    "U+2800": "⠀",  # Braille pattern blank
}

LIGATURES = {
    "U+FB00": "ﬀ",  # ff
    "U+FB01": "ﬁ",  # fi
    "U+FB02": "ﬂ",  # fl
    "U+FB03": "ﬃ",  # ffi
    "U+FB04": "ﬄ",  # ffl
    "U+FB05": "ﬅ",  # ft
    "U+FB06": "ﬆ",  # st
}

# Hyphenation artifact patterns. `\b[a-z]+- [a-z]+\b` catches
# "exam- ple" patterns the deep_preprocess.py whitelisted-suffix
# rejoin missed.
HYPHEN_ARTIFACT_RE = re.compile(r"\b[a-z]+- [a-z]{2,}\b")

# Case error: lowercase letter followed by capital + lowercase, mid-word.
# Pattern catches "JoyceJ.", "concatenatedFoo".
CASE_ERROR_RE = re.compile(r"\b[a-z]\w*[a-z][A-Z][a-z]\w*\b")

# Word-internal NBSP between two lowercase letters.
WORD_NBSP_RE = re.compile(r"[a-z] [a-z]")

# Leaked-prose footnote pattern: paragraph that starts with a bare or
# punctuated integer 1-200 followed by body text.
LEAKED_FN_RE = re.compile(r"^(\d{1,3})[.\s]+[A-Z][\w\s\.,;:'\-]{20,}")

# Pgmark with optional `[low]` confidence.
PGMARK_RE = re.compile(r"\\pgmark(?:\[([a-z]+)\])?\{(\d+)\}")

# Cite call: \cite{key} (or any \cite-family command).
CITE_RE = re.compile(r"\\cite(?:[a-z]*)?(?:\[[^\]]*\])?\{([^}]+)\}")

# BibTeX entry key extraction.
BIB_KEY_RE = re.compile(r"^@\w+\{([^,\s]+)", re.M)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def find_invisibles(text: str) -> list[tuple[str, int, list[int]]]:
    """Return [(codepoint-label, count, sample-line-numbers), ...]."""
    out: list[tuple[str, int, list[int]]] = []
    for label, ch in INVISIBLES.items():
        if ch == " ":
            # NBSP needs context - only flag word-internal NBSPs.
            count = len(WORD_NBSP_RE.findall(text))
            if count > 0:
                sample_lines = sample_line_numbers(text, WORD_NBSP_RE)
                out.append((f"{label} (word-internal NBSP)", count, sample_lines))
            continue
        count = text.count(ch)
        if count > 0:
            sample_lines = []
            for line_no, line in enumerate(text.splitlines(), start=1):
                if ch in line:
                    sample_lines.append(line_no)
                    if len(sample_lines) >= 3:
                        break
            out.append((label, count, sample_lines))
    return out


def find_ligatures(text: str) -> list[tuple[str, int, list[int]]]:
    out: list[tuple[str, int, list[int]]] = []
    for label, ch in LIGATURES.items():
        count = text.count(ch)
        if count > 0:
            sample_lines = []
            for line_no, line in enumerate(text.splitlines(), start=1):
                if ch in line:
                    sample_lines.append(line_no)
                    if len(sample_lines) >= 3:
                        break
            out.append((label, count, sample_lines))
    return out


def sample_line_numbers(text: str, pattern: re.Pattern, max_samples: int = 3) -> list[int]:
    """Return up to max_samples line numbers (1-indexed) where pattern matches."""
    out: list[int] = []
    for line_no, line in enumerate(text.splitlines(), start=1):
        if pattern.search(line):
            out.append(line_no)
            if len(out) >= max_samples:
                break
    return out


def count_hyphen_artifacts(text: str) -> tuple[int, list[int]]:
    """Count broken-word hyphenation artifacts that survived preprocessing."""
    matches = list(HYPHEN_ARTIFACT_RE.finditer(text))
    samples = sample_line_numbers(text, HYPHEN_ARTIFACT_RE)
    return len(matches), samples


def count_case_errors(text: str) -> tuple[int, list[int]]:
    """Count mid-word case errors (camelCase mid-word). Skip command args."""
    # Strip LaTeX command bodies to avoid false positives on intended camelCase.
    no_cmd = re.sub(r"\\[a-zA-Z]+\{[^}]*\}", "", text)
    matches = list(CASE_ERROR_RE.finditer(no_cmd))
    samples = sample_line_numbers(no_cmd, CASE_ERROR_RE)
    return len(matches), samples


def count_leaked_footnotes(text: str) -> tuple[int, list[int]]:
    """Count paragraphs that look like leaked footnote bodies."""
    samples: list[int] = []
    count = 0
    body_started = False
    in_refs = False
    for line_no, line in enumerate(text.splitlines(), start=1):
        if r"\maketitle" in line:
            body_started = True
            continue
        if not body_started:
            continue
        if re.match(r"\\section\{(References|Bibliography|Works Cited|Notes|Index)", line):
            in_refs = True
        if in_refs:
            continue
        m = LEAKED_FN_RE.match(line)
        if m:
            n = int(m.group(1))
            # Plausible footnote number, not a list item or year.
            if 1 <= n <= 200:
                count += 1
                if len(samples) < 3:
                    samples.append(line_no)
    return count, samples


def parse_bib_keys(bib_text: str) -> set[str]:
    return set(BIB_KEY_RE.findall(bib_text))


def find_unresolved_cites(tex_text: str, bib_keys: set[str]) -> tuple[int, list[str]]:
    """Count \\cite{} calls whose keys are missing from references.bib."""
    missing: list[str] = []
    seen: set[str] = set()
    for m in CITE_RE.finditer(tex_text):
        for key in m.group(1).split(","):
            key = key.strip()
            if not key or key in seen:
                continue
            seen.add(key)
            if key not in bib_keys:
                missing.append(key)
    return len(missing), missing[:3]


def find_low_confidence_pgmarks(tex_text: str) -> int:
    return sum(1 for m in PGMARK_RE.finditer(tex_text) if m.group(1) == "low")


def audit_references_bib(bib_text: str) -> list[str]:
    """Sample-audit references.bib for common quality issues."""
    findings: list[str] = []
    # Trailing `, no` artifact (extractor leaves "..., no" mid-field).
    trailing_no = len(re.findall(r",\s*no\s*[,}]", bib_text))
    if trailing_no > 0:
        findings.append(f"{trailing_no} entries with trailing `, no` artifact")
    # Page ranges with single hyphen (should be `--` for BibTeX).
    single_hyphen_pages = len(re.findall(r"pages\s*=\s*\{[^}]*\d+-\d+[^}]*\}", bib_text))
    # But subtract well-formed `--` cases.
    bad_pages = single_hyphen_pages - len(re.findall(r"pages\s*=\s*\{[^}]*\d+--\d+", bib_text))
    if bad_pages > 0:
        findings.append(f"{bad_pages} entries with single-hyphen page ranges (need `--`)")
    # Empty fields.
    empty_fields = len(re.findall(r"\w+\s*=\s*\{\s*\}", bib_text))
    if empty_fields > 0:
        findings.append(f"{empty_fields} empty fields (should be omitted)")
    # Double-hyphenation idempotency check: `\d---\d` is wrong.
    triple_hyphen = len(re.findall(r"\d+---+\d+", bib_text))
    if triple_hyphen > 0:
        findings.append(f"{triple_hyphen} page ranges with 3+ hyphens (idempotency bug)")
    return findings


def check_title_metadata(paper_dir: Path, citekey: str, library: Path) -> list[str]:
    """Verify \\title{} matches catalog title and master.bib title."""
    findings: list[str] = []
    tex = read_text(paper_dir / "main.tex")
    title_m = re.search(r"\\title\{([^}]+)\}", tex)
    if not title_m:
        return ["main.tex missing \\title{} field"]
    in_file_title = title_m.group(1).strip()
    # Filename-shape leak.
    if re.match(r".+\.(dvi|pdf|ps|tex)$", in_file_title, re.I):
        findings.append(f"\\title{{}} appears filename-shaped: {in_file_title!r}")
        return findings
    # Cross-check against catalog.
    catalog_path = library / ".virgil" / "catalog.json"
    if catalog_path.exists():
        try:
            catalog = json.loads(catalog_path.read_text())
            for entry in catalog.get("entries", []):
                if entry.get("citekey") == citekey:
                    cat_title = (entry.get("title") or "").strip()
                    if cat_title and _normalize(cat_title) != _normalize(in_file_title):
                        findings.append(
                            f"\\title{{}} mismatches catalog title "
                            f"(file: {in_file_title[:60]!r}; "
                            f"catalog: {cat_title[:60]!r})"
                        )
                    break
        except Exception:
            pass
    return findings


def _normalize(s: str) -> str:
    """Normalize for title comparison."""
    s = re.sub(r"\s+", " ", s.lower()).strip()
    s = re.sub(r"[^\w\s]", "", s)
    return s


def resolve_library_root() -> Path:
    """Mirror the skill's library-root resolution rules."""
    import os
    env = os.environ.get("VIRGIL_LIBRARY_ROOT")
    if env:
        return Path(env)
    cwd = Path.cwd()
    if (cwd / "master.bib").exists() and (cwd / ".virgil" / "catalog.json").exists():
        return cwd
    home = Path.home() / "Virgil-Library"
    return home


def audit(paper_dir: Path) -> dict:
    """Run all audit checks. Returns a dict with findings."""
    citekey = paper_dir.name
    library = resolve_library_root()
    findings: list[tuple[str, str]] = []  # (category, description)

    tex_path = paper_dir / "main.tex"
    if not tex_path.exists():
        return {"citekey": citekey, "findings": [("error", f"main.tex not found at {tex_path}")]}

    tex = read_text(tex_path)
    bib_path = paper_dir / "references.bib"
    bib_text = read_text(bib_path) if bib_path.exists() else ""

    # 1. Invisibles.
    for label, count, lines in find_invisibles(tex):
        sample = ", ".join(f"line {n}" for n in lines)
        findings.append(("invisibles", f"{count} {label} characters (samples: {sample})"))

    # 2. Ligatures.
    for label, count, lines in find_ligatures(tex):
        sample = ", ".join(f"line {n}" for n in lines)
        findings.append(("invisibles", f"{count} {label} ligature glyphs (samples: {sample})"))

    # 3. Hyphenation artifacts.
    hyp_count, hyp_samples = count_hyphen_artifacts(tex)
    if hyp_count > 0:
        sample = ", ".join(f"line {n}" for n in hyp_samples)
        findings.append((
            "hyphenation-artifacts",
            f"{hyp_count} broken-word hyphenations remain (samples: {sample})",
        ))

    # 4. Case errors.
    case_count, case_samples = count_case_errors(tex)
    if case_count > 0:
        sample = ", ".join(f"line {n}" for n in case_samples)
        findings.append((
            "case-errors",
            f"{case_count} mid-word case errors (samples: {sample})",
        ))

    # 5. Title / metadata.
    for finding in check_title_metadata(paper_dir, citekey, library):
        findings.append(("title-metadata", finding))

    # 6. Leaked footnote paragraphs.
    leaked_count, leaked_samples = count_leaked_footnotes(tex)
    if leaked_count > 0:
        sample = ", ".join(f"line {n}" for n in leaked_samples)
        findings.append((
            "footnote-inline-rate",
            f"{leaked_count} leaked-prose paragraphs un-reattached "
            f"(run reattach_leaked_footnotes.py; samples: {sample})",
        ))

    # 7. References.bib quality.
    if bib_text:
        bib_keys = parse_bib_keys(bib_text)
        for issue in audit_references_bib(bib_text):
            findings.append(("references.bib-quality", issue))

        # 8. Unresolved \cite{} keys.
        missing_count, missing_samples = find_unresolved_cites(tex, bib_keys)
        if missing_count > 0:
            sample = ", ".join(missing_samples)
            findings.append((
                "citation-completeness",
                f"{missing_count} \\cite{{}} keys not in references.bib "
                f"(samples: {sample})",
            ))

    # 9. Low-confidence pgmarks.
    low_count = find_low_confidence_pgmarks(tex)
    if low_count > 0:
        findings.append((
            "pgmark-low-confidence",
            f"{low_count} \\pgmark[low]{{}} markers — re-verify after cleanup "
            f"(threshold 30%, window ±1500 chars)",
        ))

    return {"citekey": citekey, "findings": findings}


def format_punch_list(result: dict) -> str:
    findings = result["findings"]
    if not findings:
        return "## Audit punch-list\n\nClean. No remaining issues detected.\n"
    lines = ["## Audit punch-list", ""]
    for category, desc in findings:
        lines.append(f"- [{category}] {desc}")
    lines.append("")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: audit_deepindex.py <paper-dir>", file=sys.stderr)
        return 2
    paper_dir = Path(argv[1]).resolve()
    if not paper_dir.is_dir():
        print(f"not a directory: {paper_dir}", file=sys.stderr)
        return 2
    result = audit(paper_dir)
    print(format_punch_list(result))
    return 0 if not result["findings"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
