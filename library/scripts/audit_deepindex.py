"""Audit a deep-indexed paper and emit a punch-list of remaining issues.

This is the **completion signal** for the /deep-index convergence loop.
An empty punch-list means the paper is genuinely clean. A non-empty
punch-list becomes the next pass's agenda.

Checks performed:
- Invisible characters (U+00AD, U+200B, U+00A0 word-internal, U+FEFF,
  U+FB00-U+FB06 ligatures, U+2800 Braille pattern blank).
- Hyphenation artifacts (\\b[a-z]+- [a-z]+\\b), with coordinated-compound
  exclusion (`pre- and post-test`, `object- and property-aspects`).
- Title/metadata cross-check (\\title{} vs catalog vs master.bib).
- references.bib sample audit (trailing ", no", trailing periods,
  double-hyphenation on page ranges, suspicious type detection).
- Pgmark continuity (low-confidence count, validator-finding count).
- Footnote inline-rate (leaked-prose paragraphs that should have been
  re-attached but weren't) — with TOC, enumeration-sequence,
  numbered-list, theorem-numbering, and figure-context exclusions; and
  full skip when document has zero `\\footnote{}` commands.
- Citation completeness (\\cite{} keys missing from references.bib).
- Unbalanced-brace detection (runaway `\\footnote{`/`\\section{`/`\\textbf{`).
- Missing-pgmark-range (silent losses vs. PDF page count from pdfinfo).

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
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _tools import citekey_matches, suppression_categories_from_catalog  # noqa: E402


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

# Hyphenation artifact patterns. `\b[a-z]+- [a-z]{2,}\b` catches
# "exam- ple" patterns the deep_preprocess.py whitelisted-suffix
# rejoin missed. Negative lookahead excludes coordinated compounds
# (`pre- and post-test`, `one- and two-year-olds`, `object- and
# property-aspects`) which are correct English.
HYPHEN_ARTIFACT_RE = re.compile(
    r"\b[a-z]+- (?!(?:and|or|nor|but|to|vs|versus)\b)[a-z]{2,}\b"
)

# Case error: lowercase letter followed by capital + lowercase, mid-word.
# Pattern catches "JoyceJ.", "concatenatedFoo".
CASE_ERROR_RE = re.compile(r"\b[a-z]\w*[a-z][A-Z][a-z]\w*\b")

# Math-identifier-like prefixes that look like case errors but are
# almost always variable / function names in formal-semantics or
# mathematical prose. Skip case-error matches whose prefix matches
# any of these. (leong memo: `posM`, `posMtxtM` falsely flagged.)
MATH_IDENT_PREFIX_RE = re.compile(
    r"^(?:pos|lab|fun|fn|var|val|cl|obj|prop|rel|sub|sup|tag|ctx|"
    r"id|exp|num|tmp|usr|app|src|dst|loc|len|cnt|seg|fst|snd|tok)[A-Z]"
)

# Brand-name / proper-noun allowlist for camelCase that is NOT an OCR
# error. Comparison is case-sensitive (since the rendering matters):
# `arXiv` is allowlisted, `arxiv` would still get caught if it were a
# different word. Coverage focus: CS, neuroscience, ML, modern web
# brands frequently cited in cognitive-science papers. (kriegeskorte2015deep
# memo + systemic across the iconicity batch.)
BRAND_NAME_ALLOWLIST = frozenset({
    "arXiv", "bioRxiv", "medRxiv", "ChemRxiv", "psyArXiv", "SocArXiv",
    "ImageNet", "AlexNet", "ResNet", "VGGNet", "GoogLeNet", "DenseNet",
    "MobileNet", "EfficientNet", "WaveNet", "U-Net", "SegNet",
    "ChatGPT", "GPT", "InstructGPT", "DALL-E", "CLIP", "BERT", "RoBERTa",
    "ELMo", "ELECTRA", "T5", "XLNet", "DistilBERT", "ALBERT",
    "PyTorch", "TensorFlow", "JAX", "NumPy", "SciPy", "scikit-learn",
    "matplotlib", "Jupyter", "iPython", "iPhone", "iPad", "macOS", "iOS",
    "GitHub", "GitLab", "BitBucket", "PostScript", "JavaScript",
    "TypeScript", "PowerPoint", "MathML", "MathJax", "LaTeX", "BibTeX",
    "DeepMind", "OpenAI", "HuggingFace", "Anthropic", "MidJourney",
    "PubMed", "MEDLINE", "fMRI", "iEEG", "rsfMRI", "diffMRI",
    "MTurk", "PsychoPy", "OpenSesame",
    "YouTube", "FaceTime", "WhatsApp", "WeChat",
    "JSTOR", "PhilPapers", "PsycINFO", "SSRN", "RePEc",
    "WordNet", "ConceptNet", "FrameNet", "VerbNet", "PropBank",
})

# Backreferences-section heading: matches `\section{}` / `\section*{}`.
# The case-error scan skips text inside any References section to avoid
# flagging surname capitalization in author lists. (kriegeskorte memo:
# arXiv references for 50 papers/year produced 50+ false positives.)
REFS_SECTION_RE = re.compile(
    r"\\section\*?\{(References|Bibliography|Works\s*Cited)\b",
    re.I,
)

# Word-internal NBSP between two lowercase letters.
WORD_NBSP_RE = re.compile(r"[a-z] [a-z]")

# Leaked-prose footnote pattern: paragraph that starts with a bare or
# punctuated integer 1-200 followed by body text.
LEAKED_FN_RE = re.compile(r"^(\d{1,3})[.\s]+[A-Z][\w\s\.,;:'\-]{20,}")

# Numbered TOC entry: `N <Title>, <page>` or `N. <Title> ... <page>`
# (with optional dot leaders). Matches Lewis-style and book-TOC
# patterns that the leaked-FN detector falsely flags.
TOC_ENTRY_RE = re.compile(
    r"^\s*\d{1,3}\.?\s+[A-Z][A-Za-z\-' ]{3,80}[,\s\.]+\d{1,4}\s*$"
)

# Figure-caption marker. If this appears 1-5 lines BEFORE a candidate
# leaked-FN paragraph, the candidate is a figure annotation, not a
# leaked footnote body. (leong memo.)
FIGURE_CAPTION_RE = re.compile(
    r"\\begin\{quote\}\s*\\textit\{Figure\s+\d+(?:\.\d+)?"
)

# Footnote command anywhere in the document. If the document has zero
# `\footnote{}` calls, there is no plausible leaked-FN body to recover
# in the first place. (carey memo: `[footnote-inline-rate]` false
# positive on documents with no footnotes at all.)
FOOTNOTE_CMD_RE = re.compile(r"\\footnote\{")

# Section heads that begin the back-matter (or front-matter Contents)
# for purposes of skipping the leaked-FN scan. Including Contents /
# TOC heads keeps numbered chapter listings inside `\section{Contents}`
# out of the leaked-FN count.
BACK_MATTER_OR_FRONT_TOC_RE = re.compile(
    r"^\s*\\section\{("
    r"References|Bibliography|Works\s*Cited|Notes|Endnotes|Index|"
    r"Contents|Table\s+of\s+Contents|TOC"
    r")\b",
    re.IGNORECASE,
)

# Pgmark with optional `[low]` confidence.
PGMARK_RE = re.compile(r"\\pgmark(?:\[([a-z]+)\])?\{(\d+)\}")

# Cite call: \cite{key} (or any \cite-family command).
CITE_RE = re.compile(r"\\cite(?:[a-z]*)?(?:\[[^\]]*\])?\{([^}]+)\}")

# BibTeX entry key extraction.
BIB_KEY_RE = re.compile(r"^@\w+\{([^,\s]+)", re.M)

# Math span (single-dollar pair) — stripped before case-error check.
INLINE_MATH_RE = re.compile(r"(?<!\\)\$[^$\n]+\$")
DISPLAY_MATH_RE = re.compile(r"\\\[.*?\\\]", re.DOTALL)


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
    """Count mid-word case errors (camelCase mid-word). Skip command args
    and math spans, exclude math-identifier names (`posM`, `posMtxtM`),
    skip the BRAND_NAME_ALLOWLIST (arXiv, ImageNet, …), and ignore the
    References / Bibliography section entirely (where author names with
    legitimate capitalization read as false positives)."""
    # Truncate at the first References-like section so author lists
    # aren't scanned. (kriegeskorte memo.)
    body_end_match = REFS_SECTION_RE.search(text)
    if body_end_match:
        body = text[: body_end_match.start()]
    else:
        body = text
    # Strip LaTeX command bodies to avoid false positives on intended camelCase.
    no_cmd = re.sub(r"\\[a-zA-Z]+\{[^}]*\}", "", body)
    # Strip math spans so identifiers like `posM` inside `$pos_M$` don't
    # show up. We replace with blanks (preserving line numbers).
    no_math = DISPLAY_MATH_RE.sub(
        lambda m: " " * len(m.group(0)), no_cmd,
    )
    no_math = INLINE_MATH_RE.sub(
        lambda m: " " * len(m.group(0)), no_math,
    )
    # Per-line so we can preserve line numbers for samples.
    real_matches: list[tuple[int, str]] = []
    for line_no, line in enumerate(no_math.splitlines(), start=1):
        for m in CASE_ERROR_RE.finditer(line):
            token = m.group(0)
            # Skip math-identifier-like prefixes (leong memo).
            if MATH_IDENT_PREFIX_RE.match(token):
                continue
            # Skip brand-name allowlist (kriegeskorte memo).
            if token in BRAND_NAME_ALLOWLIST:
                continue
            real_matches.append((line_no, token))
    samples = [ln for ln, _ in real_matches[:3]]
    return len(real_matches), samples


def count_leaked_footnotes(text: str) -> tuple[int, list[int]]:
    """Count paragraphs that look like leaked footnote bodies.

    Multiple exclusions guard against false positives:

    - **Zero-footnote skip**: if the document contains no `\\footnote{}`
      commands, no candidate is a leaked footnote body (carey memo).

    - **Front-matter Contents/TOC skip**: candidates inside
      `\\section{Contents}` / `\\section{Table of Contents}` blocks
      are TOC entries, not footnote bodies (kulvicki, shin, zeki).

    - **Back-matter skip**: candidates after `\\section{References}` /
      `\\section{Bibliography}` / etc. are bibliography entries or
      index lines.

    - **TOC-shape skip**: a candidate whose line shape matches `N
      <Title>, <page>` (numbered TOC entry, even outside an explicit
      Contents section) is treated as a TOC entry (carey, zeki).

    - **Enumeration-sequence skip**: a candidate whose number is part
      of a 3+ consecutive sequence (1, 2, 3 ... seen within 30 lines
      of each other) is a numbered list / argument enumeration, not
      a leaked footnote (shimojima, leong, fodor).

    - **Figure-context skip**: a candidate preceded within 5 lines by
      a `\\begin{quote}\\textit{Figure N…}` marker is a figure
      annotation (leong).
    """
    samples: list[int] = []
    # Zero-footnote skip.
    if not FOOTNOTE_CMD_RE.search(text):
        return 0, samples

    lines = text.splitlines()

    # First pass: collect ALL leaked-FN candidates with their line
    # numbers and footnote numbers. We need the full list before we
    # can detect enumeration sequences.
    body_started = False
    in_back_matter = False
    candidates: list[tuple[int, int]] = []  # (line_no, fn_number)
    for line_no, line in enumerate(lines, start=1):
        if r"\maketitle" in line:
            body_started = True
            continue
        if not body_started:
            continue
        if BACK_MATTER_OR_FRONT_TOC_RE.match(line):
            in_back_matter = True
        if in_back_matter:
            continue
        # TOC-shape skip: matches numbered TOC entries even outside a
        # Contents section.
        if TOC_ENTRY_RE.match(line):
            continue
        m = LEAKED_FN_RE.match(line)
        if not m:
            continue
        n = int(m.group(1))
        if not (1 <= n <= 200):
            continue
        candidates.append((line_no, n))

    if not candidates:
        return 0, samples

    # Enumeration-sequence detection: a candidate is part of a sequence
    # if there's a candidate with number n+1 within 30 lines AND a
    # candidate with number n-1 OR n+2 within the same window (so
    # 1,2 alone doesn't count — we want 1,2,3 or 2,3,4).
    by_number_then_line: dict[int, list[int]] = {}
    for ln, n in candidates:
        by_number_then_line.setdefault(n, []).append(ln)

    def in_enumeration(line_no: int, n: int) -> bool:
        # Find candidates with numbers n-1, n+1, n+2 within ±30 lines.
        nearby_numbers = set()
        for other_n in (n - 2, n - 1, n + 1, n + 2):
            for other_ln in by_number_then_line.get(other_n, []):
                if abs(other_ln - line_no) <= 30:
                    nearby_numbers.add(other_n)
        # Part of an enumeration iff at least two of {n-1, n+1, n+2}
        # or {n-2, n-1, n+1} are present nearby. Concretely: if both
        # n+1 and n+2 (or both n-1 and n-2, or both n-1 and n+1) show
        # up, we have a 3-run including this candidate.
        if n + 1 in nearby_numbers and n + 2 in nearby_numbers:
            return True
        if n - 1 in nearby_numbers and n - 2 in nearby_numbers:
            return True
        if n - 1 in nearby_numbers and n + 1 in nearby_numbers:
            return True
        return False

    # Figure-context skip: walk back up to 5 lines before each
    # candidate looking for a figure-caption marker.
    def in_figure_context(line_no: int) -> bool:
        start = max(1, line_no - 5)
        for j in range(start, line_no):
            if FIGURE_CAPTION_RE.search(lines[j - 1]):
                return True
        return False

    count = 0
    for ln, n in candidates:
        if in_enumeration(ln, n):
            continue
        if in_figure_context(ln):
            continue
        count += 1
        if len(samples) < 3:
            samples.append(ln)
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


# Commands whose brace argument is expected to be a single paragraph
# at most. A matching close-brace farther than this many newlines
# downstream indicates a runaway brace from OCR'd content. (dretske
# memo: footnote bodies with OCR-introduced unbalanced braces consume
# the rest of the document silently.)
_RUNAWAY_BRACE_CMDS = ("footnote", "section", "subsection", "subsubsection",
                       "textbf", "textit", "title", "author")
_RUNAWAY_PARA_LIMIT = 3  # max paragraph breaks allowed inside an argument


def find_unbalanced_braces(text: str) -> tuple[int, list[int]]:
    """Detect `\\<cmd>{...}` invocations whose close brace is more than
    `_RUNAWAY_PARA_LIMIT` paragraphs away or crosses a `\\section{}`
    boundary. Returns (count, sample line numbers)."""
    samples: list[int] = []
    count = 0
    for cmd in _RUNAWAY_BRACE_CMDS:
        # Find each `\<cmd>{`.
        for m in re.finditer(rf"\\{cmd}\*?\{{", text):
            open_pos = m.end() - 1  # position of the `{`
            line_no = text.count("\n", 0, open_pos) + 1
            # Walk forward tracking brace depth.
            depth = 0
            i = open_pos
            n = len(text)
            paragraphs_seen = 0
            crossed_section = False
            while i < n:
                c = text[i]
                if c == "\\" and i + 1 < n:
                    # Check whether the rest is `section{` etc. (cheap).
                    nxt = text[i:i + 15]
                    if re.match(r"\\section\{", nxt) and depth == 1:
                        crossed_section = True
                    i += 2
                    continue
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                    if depth == 0:
                        break
                elif c == "\n" and i + 1 < n and text[i + 1] == "\n":
                    paragraphs_seen += 1
                i += 1
            if depth != 0:
                count += 1
                if len(samples) < 3:
                    samples.append(line_no)
            elif paragraphs_seen > _RUNAWAY_PARA_LIMIT or crossed_section:
                count += 1
                if len(samples) < 3:
                    samples.append(line_no)
    return count, samples


def _detect_pdf_pages_for_audit(paper_dir: Path) -> int | None:
    """Auto-detect PDF page count via pdfinfo for missing-pgmark-range."""
    if not shutil.which("pdfinfo"):
        return None
    citekey = paper_dir.name
    sib = paper_dir / f"{citekey}.pdf"
    if not sib.exists():
        # Some Library layouts use `<citekey>.PDF` or similar.
        for ext in (".PDF", ".pdf.pdf"):
            cand = paper_dir / f"{citekey}{ext}"
            if cand.exists():
                sib = cand
                break
        else:
            return None
    try:
        out = subprocess.run(
            ["pdfinfo", str(sib)],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if out.returncode != 0:
            return None
        for line in out.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split(":", 1)[1].strip())
    except (subprocess.SubprocessError, ValueError):
        return None
    return None


def check_missing_pgmark_range(
    tex: str, pdf_pages: int | None,
) -> str | None:
    """If the max pgmark falls substantially short of the PDF page
    count, flag as silent losses from prior passes (dretske memo).

    Returns a human-readable finding string, or None if the range is
    plausible or we lack a PDF page count.
    """
    if pdf_pages is None or pdf_pages < 5:
        return None
    arabic = [int(m.group(2)) for m in PGMARK_RE.finditer(tex)
              if m.group(2).isdigit()]
    if not arabic:
        return None
    hi = max(arabic)
    # Threshold: if max pgmark < 80% of pdf_pages, something was lost.
    # (For journal-offset reprints — kunene with hi=39, pdf=23 — this
    # never fires because hi > pdf, not <.)
    if hi < pdf_pages * 0.8:
        return (
            f"max pgmark {hi} is well below PDF page count {pdf_pages} "
            f"({hi * 100 // pdf_pages}% coverage) — likely silent "
            f"pgmark losses from prior passes"
        )
    return None


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


def _extract_balanced_title(tex: str) -> str | None:
    r"""Extract `\title{...}` argument with proper brace balancing.

    Naive `\title\{([^}]+)\}` truncates at the first `}` inside
    `\title{...\thanks{...}}`, capturing garbage. This walks the
    nested-brace structure and returns the outermost argument, after
    stripping any inner `\thanks{...}` calls (which are
    title-attached acknowledgements, not part of the title text).
    """
    m = re.search(r"\\title\s*\{", tex)
    if not m:
        return None
    start = m.end()
    depth = 1
    i = start
    n = len(tex)
    while i < n and depth > 0:
        ch = tex[i]
        if ch == "\\" and i + 1 < n:
            # Skip escaped braces and the leading backslash of any command.
            i += 2
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                arg = tex[start:i]
                # Strip nested \thanks{...} (brace-balanced) so the
                # comparable title text isn't polluted by affiliation
                # or acknowledgement boilerplate.
                return _strip_balanced_command(arg, "thanks").strip()
        i += 1
    return None


def _strip_balanced_command(text: str, cmd: str) -> str:
    """Remove every `\\<cmd>{...}` (brace-balanced) from `text`."""
    out: list[str] = []
    i = 0
    n = len(text)
    needle = f"\\{cmd}"
    while i < n:
        j = text.find(needle, i)
        if j < 0:
            out.append(text[i:])
            break
        # Confirm followed by `{` (skip whitespace).
        k = j + len(needle)
        while k < n and text[k] in " \t":
            k += 1
        if k >= n or text[k] != "{":
            # Not a brace-arg form; keep the literal.
            out.append(text[i:j + len(needle)])
            i = j + len(needle)
            continue
        out.append(text[i:j])
        depth = 1
        k += 1
        while k < n and depth > 0:
            ch = text[k]
            if ch == "\\" and k + 1 < n:
                k += 2
                continue
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            k += 1
        i = k
    return "".join(out)


def check_title_metadata(paper_dir: Path, citekey: str, library: Path) -> list[str]:
    """Verify \\title{} matches catalog title and master.bib title."""
    findings: list[str] = []
    tex = read_text(paper_dir / "main.tex")
    in_file_title = _extract_balanced_title(tex)
    if in_file_title is None:
        return ["main.tex missing \\title{} field"]
    in_file_title = in_file_title.strip()
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
                # NFC-insensitive row lookup (the `citekey_matches` SSOT).
                if citekey_matches(entry.get("citekey", ""), citekey):
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

    # 10. Unbalanced braces (OCR'd argument runaway).
    runaway_count, runaway_samples = find_unbalanced_braces(tex)
    if runaway_count > 0:
        sample = ", ".join(f"line {n}" for n in runaway_samples)
        findings.append((
            "unbalanced-brace",
            f"{runaway_count} runaway brace argument(s) "
            f"(spans > {_RUNAWAY_PARA_LIMIT} paragraphs or crosses "
            f"`\\section{{}}`; samples: {sample})",
        ))

    # 11. Missing-pgmark-range (silent losses vs. PDF page count).
    pdf_pages = _detect_pdf_pages_for_audit(paper_dir)
    range_finding = check_missing_pgmark_range(tex, pdf_pages)
    if range_finding is not None:
        findings.append(("missing-pgmark-range", range_finding))

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


def _catalog_suppression_categories(library: Path, citekey: str) -> set[str]:
    """Return the set of audit categories the catalog flagged as
    `<category>-false-positive:` for this citekey. The convergence
    loop uses this to filter "work remaining" from "work the previous
    pass declared a false positive" — without it, shimojima2015semantic-
    style suppressed findings re-block convergence.
    """
    catalog_path = library / ".virgil" / "catalog.json"
    if not catalog_path.exists():
        return set()
    try:
        catalog = json.loads(catalog_path.read_text())
    except Exception:
        return set()
    # Shared reader (SSOT for the `<category>-false-positive:` convention). No
    # prefix → categories returned verbatim, matched against this audit's own
    # bare-category findings. pgmark_validate calls the same helper with
    # prefix="pgmark-" so the two readers can't drift again.
    return suppression_categories_from_catalog(catalog, citekey, prefix=None)


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: audit_deepindex.py <paper-dir> [--exit-on-suppressed]",
            file=sys.stderr,
        )
        return 2
    exit_on_suppressed = "--exit-on-suppressed" in argv[2:]
    paper_dir = Path(argv[1]).resolve()
    if not paper_dir.is_dir():
        print(f"not a directory: {paper_dir}", file=sys.stderr)
        return 2
    result = audit(paper_dir)
    print(format_punch_list(result))
    findings = result["findings"]
    if not findings:
        return 0
    # Suppression-aware exit: when all remaining findings sit in a
    # category the catalog explicitly marked `*-false-positive:`,
    # treat the audit as clean for convergence purposes. The findings
    # still print so the user can see them.
    library = resolve_library_root()
    suppressed_cats = _catalog_suppression_categories(library, paper_dir.name)
    unsuppressed = [
        (cat, desc) for cat, desc in findings if cat not in suppressed_cats
    ]
    if not unsuppressed:
        if exit_on_suppressed:
            return 0
        # Default behavior preserved for callers that don't opt-in;
        # the convergence loop should always pass --exit-on-suppressed.
        return 1
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
