"""Deterministic cleanup passes for rich indexing.

Transforms raw-extracted main.tex into cleaner LaTeX by removing
extraction artifacts: repeating headers/footers, leaked page numbers,
hyphenated line breaks, broken paragraphs, and hard-wrapped lines.

Runs before the Claude skill applies AI-driven structural improvements.

Usage:
  python3 rich_preprocess.py papers/<citekey>/main.tex [--dry-run]
"""

from __future__ import annotations

import argparse
import difflib
import re
import sys
from pathlib import Path


PGMARK_RE = re.compile(r"^\\pgmark\{([^}]+)\}$")


def _split_pages(tex: str) -> list[tuple[str, list[str]]]:
    """Split tex into page chunks delimited by \\pgmark{N}.

    Returns list of (page_label, lines_after_marker). The first chunk
    has page_label="" for content before the first \\pgmark.
    """
    pages: list[tuple[str, list[str]]] = []
    current_label = ""
    current_lines: list[str] = []
    for line in tex.split("\n"):
        m = PGMARK_RE.match(line.strip())
        if m:
            pages.append((current_label, current_lines))
            current_label = m.group(1)
            current_lines = []
        else:
            current_lines.append(line)
    pages.append((current_label, current_lines))
    return pages


def _similarity(a: str, b: str) -> float:
    if not a.strip() or not b.strip():
        return 0.0
    return difflib.SequenceMatcher(None, a.strip(), b.strip()).ratio()


def strip_running_headers(tex: str) -> tuple[str, int]:
    """Remove lines that repeat at the top of 3+ pages.

    Handles both consecutive repeats and alternating recto/verso patterns
    (e.g., author name on even pages, article title on odd pages).
    """
    pages = _split_pages(tex)
    if len(pages) < 4:
        return tex, 0

    # Collect first non-empty lines after each pgmark (skip preamble chunk).
    page_tops: list[list[str]] = []
    for label, lines in pages:
        if not label:
            page_tops.append([])
            continue
        top = []
        for ln in lines[:4]:
            s = ln.strip()
            if s:
                top.append(s)
            if len(top) >= 2:
                break
        page_tops.append(top)

    headers_to_remove: set[str] = set()

    for line_idx in range(2):
        candidates = [
            tops[line_idx] if line_idx < len(tops) else ""
            for tops in page_tops
        ]

        # Pass 1: consecutive repeats (3+).
        run_start = 1
        while run_start < len(candidates):
            if not candidates[run_start]:
                run_start += 1
                continue
            run_end = run_start + 1
            while run_end < len(candidates) and candidates[run_end] and \
                    _similarity(candidates[run_start], candidates[run_end]) > 0.85:
                run_end += 1
            if run_end - run_start >= 3:
                for i in range(run_start, run_end):
                    headers_to_remove.add(candidates[i])
            run_start = run_end

        # Pass 2: alternating recto/verso (appears on every other page, 3+ times).
        even_cands = [(i, c) for i, c in enumerate(candidates) if i >= 1 and c and i % 2 == 0]
        odd_cands = [(i, c) for i, c in enumerate(candidates) if i >= 1 and c and i % 2 == 1]
        for group in [even_cands, odd_cands]:
            if len(group) < 3:
                continue
            # Cluster by similarity.
            clusters: list[list[str]] = []
            for _, text in group:
                placed = False
                for cluster in clusters:
                    if _similarity(cluster[0], text) > 0.85:
                        cluster.append(text)
                        placed = True
                        break
                if not placed:
                    clusters.append([text])
            for cluster in clusters:
                if len(cluster) >= 3:
                    headers_to_remove.update(cluster)

    if not headers_to_remove:
        return tex, 0

    count = 0
    out_lines = []
    for line in tex.split("\n"):
        if line.strip() in headers_to_remove:
            count += 1
            continue
        out_lines.append(line)
    return "\n".join(out_lines), count


def strip_running_footers(tex: str) -> tuple[str, int]:
    """Remove lines that repeat at the bottom of 3+ consecutive pages."""
    pages = _split_pages(tex)
    if len(pages) < 4:
        return tex, 0

    page_bottoms: list[list[str]] = []
    for label, lines in pages:
        if not label:
            page_bottoms.append([])
            continue
        bottom = []
        for ln in reversed(lines):
            s = ln.strip()
            if s:
                bottom.append(s)
            if len(bottom) >= 2:
                break
        page_bottoms.append(bottom)

    footers_to_remove: set[str] = set()
    for line_idx in range(2):
        candidates = [
            bots[line_idx] if line_idx < len(bots) else ""
            for bots in page_bottoms
        ]
        run_start = 1
        while run_start < len(candidates):
            if not candidates[run_start]:
                run_start += 1
                continue
            run_end = run_start + 1
            while run_end < len(candidates) and candidates[run_end] and \
                    _similarity(candidates[run_start], candidates[run_end]) > 0.85:
                run_end += 1
            if run_end - run_start >= 3:
                for i in range(run_start, run_end):
                    footers_to_remove.add(candidates[i])
            run_start = run_end

    if not footers_to_remove:
        return tex, 0

    count = 0
    out_lines = []
    for line in tex.split("\n"):
        if line.strip() in footers_to_remove:
            count += 1
            continue
        out_lines.append(line)
    return "\n".join(out_lines), count


def strip_leaked_page_numbers(tex: str) -> tuple[str, int]:
    """Remove standalone page numbers that leaked into body text.

    Checks both after \\pgmark{N} (the current page's number) and
    before \\pgmark{N+1} (the previous page's number at the bottom).
    A line is a leaked page number if it consists solely of a number
    (or roman numeral) matching a nearby pgmark value.
    """
    lines = tex.split("\n")
    to_remove: set[int] = set()

    BARE_NUM_RE = re.compile(r"^[ivxlcdm]+$|^\d+$", re.IGNORECASE)

    pgmarks: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = PGMARK_RE.match(line.strip())
        if m:
            pgmarks.append((i, m.group(1)))

    all_page_nums = {val for _, val in pgmarks}

    for idx, (mark_line, page_num) in enumerate(pgmarks):
        # Check after: page number echoed in body after its pgmark.
        checked = 0
        for j in range(mark_line + 1, min(mark_line + 5, len(lines))):
            s = lines[j].strip()
            if not s:
                continue
            checked += 1
            if s == page_num:
                to_remove.add(j)
                break
            if checked >= 2:
                break

        # Check before: standalone number at bottom of previous page.
        # This catches journal page numbers (e.g. "525") that don't
        # match pgmark values but are clearly leaked page footers.
        checked = 0
        for j in range(mark_line - 1, max(mark_line - 5, -1), -1):
            s = lines[j].strip()
            if not s:
                continue
            checked += 1
            if s in all_page_nums or BARE_NUM_RE.match(s):
                to_remove.add(j)
                break
            if checked >= 2:
                break

    if not to_remove:
        return tex, 0
    out = [ln for idx, ln in enumerate(lines) if idx not in to_remove]
    return "\n".join(out), len(to_remove)


def rejoin_hyphenated_words(tex: str) -> tuple[str, int]:
    """Rejoin words split by end-of-line hyphenation.

    Matches patterns like 'rea-\\n  sons' where the continuation starts
    with a lowercase letter. Avoids intentional hyphens like 'well-known'
    which don't span a line break.
    """
    # Pattern: word-fragment ending in hyphen at end of line, next line
    # starts (possibly after whitespace) with a lowercase letter.
    pattern = re.compile(r"([a-zA-Z])- *\n\s*([a-z])")
    result, count = pattern.subn(r"\1\2", tex)
    return result, count


_PGMARK_CAPTURE_RE = re.compile(r"^\\pgmark(?:\[[a-zA-Z]+\])?\{[^}]+\}$")


def inline_pgmarks_at_split_paragraphs(tex: str) -> tuple[str, int]:
    """Splice `\\pgmark{N}` inline when a paragraph crosses the page
    boundary. After running-header stripping, the structure often looks
    like:

        ...end of page N-1 paragraph mid-sentence

        \\pgmark{N}

        continuing on page N...

    We detect this and merge into a single paragraph with the pgmark
    placed at the exact word boundary:

        ...end of page N-1 paragraph mid-sentence \\pgmark{N} continuing on page N...

    Conditions for merging:
    - Previous non-blank line is a paragraph ending without terminal
      punctuation (and isn't a heading or other LaTeX command).
    - Next non-blank line after the pgmark is plain text starting
      lowercase (or a hyphen continuation).
    """
    lines = tex.split("\n")
    out: list[str] = []
    count = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        m = _PGMARK_CAPTURE_RE.match(line.strip())
        if not m:
            out.append(line)
            i += 1
            continue

        # Find previous non-blank line in `out`.
        prev_idx = len(out) - 1
        while prev_idx >= 0 and out[prev_idx].strip() == "":
            prev_idx -= 1
        if prev_idx < 0:
            out.append(line)
            i += 1
            continue
        prev_text = out[prev_idx]
        prev_stripped = prev_text.strip()

        # Skip if previous line is a command, heading, or terminates
        # cleanly. Also skip short artifacts (likely running header
        # remnants that survived stripping).
        if (
            prev_stripped.startswith("\\")
            or prev_stripped.startswith("%")
            or _PGMARK_CAPTURE_RE.match(prev_stripped)
            or _is_short_artifact(prev_stripped)
        ):
            out.append(line)
            i += 1
            continue
        # The previous paragraph must end mid-word or mid-sentence —
        # signaled by ending on a lowercase letter, a comma, or a
        # hyphen-continuation. Lines ending on capitalized words /
        # proper nouns / digits typically indicate a *complete*
        # decoration line (e.g. journal copyright "...Cornell University")
        # that we should NOT merge across.
        last_char = prev_stripped[-1]
        if last_char in {".", "?", "!", ":", ";", '"', "'", ")", "]", "”", "’"}:
            out.append(line)
            i += 1
            continue
        last_token = prev_stripped.split()[-1]
        # Strip trailing hyphen for the lowercase test (mid-word break).
        last_token_for_test = last_token.rstrip("-")
        if not last_token_for_test:
            out.append(line)
            i += 1
            continue
        # Require the last token to be lowercase or to end with a hyphen
        # (mid-word break across pages). Capitalized last tokens (proper
        # nouns, end of decoration lines) don't qualify.
        is_lowercase_word = last_token_for_test[0].islower() and last_token_for_test.isalpha()
        is_hyphen_break = last_token.endswith("-")
        if not (is_lowercase_word or is_hyphen_break):
            out.append(line)
            i += 1
            continue

        # Find next non-blank line after the pgmark.
        next_idx = i + 1
        while next_idx < len(lines) and lines[next_idx].strip() == "":
            next_idx += 1
        if next_idx >= len(lines):
            out.append(line)
            i += 1
            continue
        next_stripped = lines[next_idx].strip()
        if (
            next_stripped.startswith("\\")
            or next_stripped.startswith("%")
            or _PGMARK_CAPTURE_RE.match(next_stripped)
            or _is_short_artifact(next_stripped)
        ):
            out.append(line)
            i += 1
            continue
        first_char = next_stripped[0]
        if not (first_char.islower() or first_char == "-"):
            out.append(line)
            i += 1
            continue

        # All conditions met — merge.
        merged = prev_text.rstrip() + " " + line.strip() + " " + next_stripped
        out[prev_idx] = merged
        # Drop everything between prev_idx and next_idx (inclusive of next_idx)
        # from the input by skipping ahead.
        # Also remove the blank lines we already emitted between prev_idx
        # and the current pgmark line (they're after prev_idx in `out`).
        del out[prev_idx + 1:]
        out.append("")
        i = next_idx + 1
        count += 1
    return "\n".join(out), count


_SPACED_CAPS_RE = re.compile(r"^[A-Z]( [A-Z]){2,}")


def _is_short_artifact(line: str) -> bool:
    """Return True if the line looks like a running header remnant rather
    than a broken paragraph: very short, all-caps spaced, or a single word."""
    if len(line) < 20 and not any(c.islower() for c in line):
        return True
    if _SPACED_CAPS_RE.match(line):
        return True
    if len(line.split()) <= 2:
        return True
    return False


def join_broken_paragraphs(tex: str) -> tuple[str, int]:
    """Join paragraph blocks that were broken by column extraction.

    Two consecutive text paragraphs are merged if the first ends without
    terminal punctuation and the next starts with a lowercase letter.
    Short artifact lines (headers, single words) are skipped.
    """
    lines = tex.split("\n")
    result: list[str] = []
    count = 0
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped or stripped.startswith("\\") or stripped.startswith("%"):
            result.append(line)
            i += 1
            continue

        if stripped and not stripped[-1] in ".?!:;\"')" and \
                not _is_short_artifact(stripped):
            j = i + 1
            intervening: list[str] = []
            has_pgmark = False
            while j < len(lines):
                sj = lines[j].strip()
                if not sj:
                    intervening.append(lines[j])
                    j += 1
                    continue
                if PGMARK_RE.match(sj):
                    has_pgmark = True
                    intervening.append(lines[j])
                    j += 1
                    continue
                break

            if j < len(lines) and not has_pgmark:
                next_stripped = lines[j].strip()
                if next_stripped and next_stripped[0].islower() and \
                        not next_stripped.startswith("\\"):
                    result.append(stripped + " " + next_stripped)
                    count += 1
                    i = j + 1
                    continue

        result.append(line)
        i += 1
    return "\n".join(result), count


def unwrap_hard_breaks(tex: str) -> tuple[str, int]:
    """Unwrap paragraphs that were hard-wrapped at a fixed column width.

    Detects runs of lines where all but the last are within 2 chars of
    the same length (and that length >= 50), indicating column extraction
    artifacts. Joins them with spaces.
    """
    lines = tex.split("\n")
    result: list[str] = []
    count = 0
    i = 0

    while i < len(lines):
        stripped = lines[i].strip()

        if not stripped or stripped.startswith("\\") or stripped.startswith("%") or \
                PGMARK_RE.match(stripped):
            result.append(lines[i])
            i += 1
            continue

        # Collect consecutive non-empty, non-command text lines.
        run_start = i
        run: list[str] = []
        while i < len(lines):
            s = lines[i].strip()
            if not s or s.startswith("\\") or s.startswith("%") or PGMARK_RE.match(s):
                break
            run.append(s)
            i += 1

        if len(run) < 3:
            for ln in run:
                result.append(ln)
            continue

        # Check if all lines except the last are within 2 chars of each
        # other's length, and that length is >= 50.
        full_lines = run[:-1]
        lengths = [len(ln) for ln in full_lines]
        median_len = sorted(lengths)[len(lengths) // 2]
        if median_len >= 50 and all(abs(l - median_len) <= 2 for l in lengths):
            result.append(" ".join(run))
            count += len(run) - 1
        else:
            for ln in run:
                result.append(ln)

    return "\n".join(result), count


def rich_preprocess(tex: str) -> tuple[str, dict]:
    """Apply all deterministic cleanup passes.

    Returns (cleaned_tex, stats_dict).
    """
    stats: dict[str, int] = {}

    tex, n = strip_running_headers(tex)
    stats["headers_removed"] = n

    tex, n = strip_running_footers(tex)
    stats["footers_removed"] = n

    tex, n = strip_leaked_page_numbers(tex)
    stats["page_numbers_removed"] = n

    tex, n = rejoin_hyphenated_words(tex)
    stats["hyphens_rejoined"] = n

    tex, n = join_broken_paragraphs(tex)
    stats["paragraphs_joined"] = n

    tex, n = unwrap_hard_breaks(tex)
    stats["lines_unwrapped"] = n

    # Inline pgmark splicing must run AFTER all the cleanup passes —
    # we need running headers/footers gone before we can spot real
    # paragraph-crosses-page-boundary cases.
    tex, n = inline_pgmarks_at_split_paragraphs(tex)
    stats["pgmarks_inlined"] = n

    # Clean up runs of 3+ blank lines left by removals.
    tex = re.sub(r"\n{4,}", "\n\n\n", tex)

    return tex, stats


def main() -> int:
    p = argparse.ArgumentParser(description="Deterministic preprocessing for rich indexing.")
    p.add_argument("texfile", help="Path to main.tex")
    p.add_argument("--dry-run", action="store_true",
                   help="Print diff without writing")
    args = p.parse_args()

    path = Path(args.texfile)
    if not path.exists():
        print(f"error: {path} not found", file=sys.stderr)
        return 1

    original = path.read_text(encoding="utf-8")
    cleaned, stats = rich_preprocess(original)

    total = sum(stats.values())
    stat_parts = [f"{v} {k.replace('_', ' ')}" for k, v in stats.items() if v > 0]
    summary = ", ".join(stat_parts) if stat_parts else "no changes"

    if args.dry_run:
        if total == 0:
            print(f"No changes needed for {path}.")
        else:
            print(f"Would apply: {summary}")
            diff = difflib.unified_diff(
                original.splitlines(keepends=True),
                cleaned.splitlines(keepends=True),
                fromfile=str(path),
                tofile=str(path) + " (preprocessed)",
            )
            sys.stdout.writelines(diff)
    else:
        if total == 0:
            print(f"No changes needed for {path}.")
        else:
            path.write_text(cleaned, encoding="utf-8")
            print(f"Preprocessed {path}: {summary}.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
