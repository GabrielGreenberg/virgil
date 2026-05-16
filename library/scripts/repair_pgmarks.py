"""Repair an indexed main.tex by removing spurious \\pgmark{} anchors.

Operates on an already-emitted main.tex without re-extracting from the
source PDF — preserves any deep-index structural cleanup that has been
applied (heading hierarchy, footnote attachment, etc.).

Algorithm:

1. Parse every `\\pgmark{N}` and `\\pgmark[low]{N}` occurrence with its
   line and column position. Numeric labels only — roman / alphanumeric
   labels are left untouched.
2. Find the longest contiguous run of non-decreasing labels where
   consecutive deltas stay within ``MAX_DELTA``. This is the "real"
   sequence; any pgmark outside that run is spurious.
3. Remove the spurious pgmarks in place:
   - Standalone line → delete the line (and a following blank if the
     deletion would create two adjacent blanks).
   - Inline (mid-paragraph) → splice out the token plus exactly one
     adjacent space if both sides have one.
4. Idempotent — re-running on a clean .tex is a no-op.

Usage::

    python repair_pgmarks.py <main.tex> [--dry-run]

Exit code 0 on success, 1 on parse failure, 2 on argument error.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from typing import Optional


PGMARK_RE = re.compile(r"\\pgmark(?:\[([a-z]+)\])?\{([^}]*)\}")

# Largest forward jump that still counts as part of the same run.
# A real document might skip a page or two (blank insert, plate), but a
# 90-page jump is the OCR misreading the front matter as page 99+.
MAX_DELTA = 5


@dataclass
class Pgmark:
    line: int           # 1-indexed line number
    start: int          # column offset on the line
    end: int            # exclusive column offset
    text: str           # full matched text, e.g. r"\pgmark[low]{99}"
    label: str          # the N inside { }
    value: Optional[int]  # int(label) if numeric, else None


def _parse_pgmarks(content: str) -> list[Pgmark]:
    out: list[Pgmark] = []
    for line_idx, line in enumerate(content.splitlines(keepends=False), start=1):
        for m in PGMARK_RE.finditer(line):
            label = m.group(2).strip()
            value: Optional[int]
            try:
                value = int(label)
            except ValueError:
                value = None
            out.append(Pgmark(
                line=line_idx,
                start=m.start(),
                end=m.end(),
                text=m.group(0),
                label=label,
                value=value,
            ))
    return out


def _longest_run_indices(values: list[int], max_delta: int = MAX_DELTA) -> set[int]:
    """Mirror of pgmark.py's _longest_run_indices, copied to keep this
    script standalone."""
    n = len(values)
    if n == 0:
        return set()
    best_start = 0
    best_end = 0
    start = 0
    for i in range(1, n):
        diff = values[i] - values[i - 1]
        if diff < 0 or diff > max_delta:
            if i - 1 - start >= best_end - best_start:
                best_start, best_end = start, i - 1
            start = i
    if n - 1 - start >= best_end - best_start:
        best_start, best_end = start, n - 1
    return set(range(best_start, best_end + 1))


def _decide_removals(pgmarks: list[Pgmark]) -> set[int]:
    """Return the indices (into `pgmarks`) of entries to remove.

    Non-numeric pgmarks are always kept. Among numeric ones, keep the
    longest contiguous monotonic-with-bounded-jumps run; remove the rest.
    """
    numeric_idx = [i for i, pm in enumerate(pgmarks) if pm.value is not None]
    if len(numeric_idx) < 4:
        return set()  # too few to make a reliable judgement
    values = [pgmarks[i].value for i in numeric_idx]  # type: ignore[misc]
    keep_pos = _longest_run_indices(values)
    return {numeric_idx[pos] for pos in range(len(numeric_idx)) if pos not in keep_pos}


def _apply_removals(content: str, pgmarks: list[Pgmark], removals: set[int]) -> str:
    """Rewrite `content` with the given pgmarks removed."""
    lines = content.splitlines(keepends=True)
    # Group removals by line so we can splice multiple inline marks per line.
    by_line: dict[int, list[Pgmark]] = {}
    for idx in removals:
        by_line.setdefault(pgmarks[idx].line, []).append(pgmarks[idx])

    drop_lines: set[int] = set()
    for line_no, marks in by_line.items():
        original = lines[line_no - 1]
        stripped = original.rstrip("\n")
        # Sort marks by start descending so splicing doesn't shift later offsets.
        marks_sorted = sorted(marks, key=lambda m: m.start, reverse=True)
        new_line = stripped
        for m in marks_sorted:
            before = new_line[:m.start]
            after = new_line[m.end:]
            # If there's a space on both sides, collapse to one. Otherwise
            # just remove the token.
            if before.endswith(" ") and after.startswith(" "):
                new_line = before + after[1:]
            else:
                new_line = before + after
        # If the line is now only the pgmark and surrounding whitespace,
        # mark the whole line for deletion.
        if new_line.strip() == "":
            drop_lines.add(line_no)
        else:
            # Preserve the original line ending.
            ending = original[len(stripped):]
            lines[line_no - 1] = new_line + ending

    # Drop lines and any duplicate-blank cleanup.
    out_lines: list[str] = []
    prev_blank = False
    for i, line in enumerate(lines, start=1):
        if i in drop_lines:
            continue
        is_blank = line.strip() == ""
        # Collapse runs of blank lines that arose from the deletion to a
        # single blank. We only collapse when adjacent to a deleted line
        # (heuristic: any consecutive pair where both are blank, drop one).
        if is_blank and prev_blank:
            continue
        out_lines.append(line)
        prev_blank = is_blank
    return "".join(out_lines)


def _baseline_pgmark_count(baseline_path: str | None) -> int | None:
    """Return the numeric-pgmark count from a pre-deepindex baseline
    file. Returns None if the baseline isn't readable; callers should
    treat None as "use in-place count" (legacy behaviour)."""
    if not baseline_path:
        return None
    try:
        with open(baseline_path, encoding="utf-8") as f:
            baseline = f.read()
    except (OSError, UnicodeDecodeError):
        return None
    pgmarks = _parse_pgmarks(baseline)
    return sum(1 for pm in pgmarks if pm.value is not None)


def repair(
    path: str,
    dry_run: bool = False,
    max_page: int | None = None,
    safeguard_pct: float = 0.5,
    resume_baseline: str | None = None,
) -> dict:
    """Repair the file at `path`. Returns a summary dict.

    Safeguard: if the repair would remove >`safeguard_pct` of pgmarks
    (default 50%), the paper likely has multi-section page-label
    collisions (book with front matter + body + indexes). Abort and
    warn — let the validator emit pre-existing continuity warnings
    instead of silently dropping anchors.

    On a **resume pass** (where a prior /deep-index run already removed
    some pgmarks), the in-place file's pgmark count is lower than the
    baseline's. The 50% safeguard then mis-fires — it compares against
    the already-reduced count and may delete legitimate body anchors
    (willats1997art lost 86 body-page anchors this way). When
    `resume_baseline` points to the pre-deepindex baseline file, the
    safeguard ratio is computed against the baseline pgmark count
    instead of the in-place count. Skill callers should always pass the
    matching `.virgil/baselines/<citekey>-pre-deepindex.tex` path.

    The `max_page` argument bypasses the safeguard for unambiguously-bad
    high-value markers (`v > max_page`); those are stripped regardless.
    Useful when the catalog's `pageCount` is known or when `master.bib`
    has a `pages = {<lo>-<hi>}` field that bounds the realistic range.
    """
    with open(path, encoding="utf-8") as f:
        content = f.read()
    pgmarks = _parse_pgmarks(content)
    removals = _decide_removals(pgmarks)
    numeric_count = sum(1 for pm in pgmarks if pm.value is not None)
    baseline_count = _baseline_pgmark_count(resume_baseline)
    safeguard_denom = (
        baseline_count
        if baseline_count is not None and baseline_count >= numeric_count
        else numeric_count
    )
    # Pre-stage: forced removals for max_page-exceeding pgmarks.
    forced_removals: set[int] = set()
    if max_page is not None:
        for i, pm in enumerate(pgmarks):
            if pm.value is not None and pm.value > max_page:
                forced_removals.add(i)
    aborted = False
    if safeguard_denom > 0 and len(removals) > safeguard_denom * safeguard_pct:
        aborted = True
        removals = set()
    # Forced removals always go through, even when safeguard fires.
    removals = removals | forced_removals
    removed_descriptors = [
        {"line": pgmarks[i].line, "label": pgmarks[i].label, "text": pgmarks[i].text}
        for i in sorted(removals)
    ]
    new_content = _apply_removals(content, pgmarks, removals) if removals else content
    if not dry_run and removals:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_content)
    return {
        "path": path,
        "total_pgmarks": len(pgmarks),
        "removed_count": len(removals),
        "forced_removed_count": len(forced_removals),
        "removed": removed_descriptors,
        "dry_run": dry_run,
        "aborted_50_percent_guard": aborted,
        "safeguard_denom": safeguard_denom,
        "resume_baseline_used": baseline_count is not None,
    }


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: python repair_pgmarks.py <main.tex> "
            "[--dry-run] [--max-page N] [--safeguard-pct 0.5] "
            "[--resume-baseline <pre-deepindex.tex>]",
            file=sys.stderr,
        )
        return 2
    dry_run = "--dry-run" in argv[2:]
    max_page: int | None = None
    safeguard_pct = 0.5
    resume_baseline: str | None = None
    args = argv[2:]
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--max-page" and i + 1 < len(args):
            try:
                max_page = int(args[i + 1])
            except ValueError:
                pass
            i += 2
            continue
        if arg.startswith("--max-page="):
            try:
                max_page = int(arg.split("=", 1)[1])
            except ValueError:
                pass
        elif arg.startswith("--safeguard-pct="):
            try:
                safeguard_pct = float(arg.split("=", 1)[1])
            except ValueError:
                pass
        elif arg == "--resume-baseline" and i + 1 < len(args):
            resume_baseline = args[i + 1]
            i += 2
            continue
        elif arg.startswith("--resume-baseline="):
            resume_baseline = arg.split("=", 1)[1]
        i += 1
    path = argv[1]
    try:
        result = repair(
            path, dry_run=dry_run, max_page=max_page,
            safeguard_pct=safeguard_pct,
            resume_baseline=resume_baseline,
        )
    except FileNotFoundError:
        print(f"not found: {path}", file=sys.stderr)
        return 1
    if result.get("aborted_50_percent_guard"):
        forced = result.get("forced_removed_count", 0)
        extra = f" ({forced} forced removals applied)" if forced else ""
        print(
            f"Aborted pgmark repair on {result['path']}: would remove "
            f">{int(safeguard_pct * 100)}% of pgmarks ({result['total_pgmarks']} total). "
            f"Likely multi-section page-label collisions; leave baseline "
            f"pgmarks{extra}."
        )
        if forced == 0:
            return 0
    n = result["removed_count"]
    if n == 0:
        print(f"No spurious pgmarks in {result['path']}.")
    else:
        suffix = " (dry run)" if dry_run else ""
        forced = result.get("forced_removed_count", 0)
        forced_note = f" ({forced} forced via --max-page)" if forced else ""
        print(
            f"Repaired {result['path']}: "
            f"{n} spurious pgmark{'s' if n != 1 else ''} removed"
            f"{forced_note}{suffix}."
        )
        for r in result["removed"]:
            print(f"  line {r['line']}: {r['text']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
