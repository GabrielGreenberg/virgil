"""Validate \\pgmark{N} placement and printed-page continuity in main.tex.

Two layers of validation:

  - **Scope**: \\pgmark must live at document body scope. Any marker
    inside math mode (\\[...\\], $...$, equation/align/...), inside the
    brace-arg of a command (\\footnote{...}, \\textbf{...}, \\section{...},
    \\title{...}, \\author{...}, etc.), or in the preamble (above
    \\begin{document} or \\maketitle) is silently swallowed by the
    Virgil renderer and produces no margin chip.

  - **Continuity**: the ordered list of pgmark values should form a
    coherent sequence — no duplicates, no decreases in the arabic run,
    no large gaps, and not too many [low]-confidence markers.

  - **Range** (when --pdf-pages or sibling PDF available): pgmark
    values must be plausible relative to the PDF page count.
    `range-impossible` fires only when both `hi > pdf_pages × 1.5`
    AND `span > pdf_pages` — journal-offset reprints (e.g. pp.
    579–627 in a 49-page PDF, where the span fits within the PDF
    page count) are exempted. `range-suspiciously-wide` is a
    separate catastrophic-offset check (`span > pdf_pages × 1.3`)
    that would have caught the peacocke +170 silent extraction bug.

  - **Multi-section pagination**: a monotonic-reset transition
    (front-matter roman → body arabic, body → index restart) is
    detected and pgmark duplicates whose two occurrences straddle a
    reset are reported as `multi-section` (informational) rather
    than `duplicate` (blocker). This eliminates the schwarzlose /
    zeki false positives on books with separate page-label
    namespaces.

Used by:

  - scripts/index_paper.py — post-emit, soft (warn): findings populate
    catalog.json indexed.warnings[] but never gate the run.

  - /deep-index skill — post-AI-edit, hard (error): scope violations
    and *new* continuity breaks (relative to the previous catalog
    warnings for this citekey) cause exit code 1 and abort write-back.

CLI:
  python3 pgmark_validate.py <main.tex>
      [--baseline-from-catalog]   # compare against prior warnings
      [--severity=warn|error]     # default error (exit 1 on blockers)
      [--json]                    # machine-readable output
      [--pdf-pages N]             # PDF page count for range checks
      [--no-pdf-check]            # skip range checks entirely
      [--pdf <path>]              # explicit PDF path (else sibling auto-detect)
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _tools import suppression_categories_from_catalog  # noqa: E402


PGMARK_RE = re.compile(r"\\pgmark(?:\[([a-zA-Z]+)\])?\{([^}]*)\}")

MATH_BEGIN_ENVS = frozenset({
    "equation", "equation*", "align", "align*", "gather", "gather*",
    "multline", "multline*", "displaymath", "eqnarray", "eqnarray*",
    "math", "displaymath",
})

SAFE_OUTER_CMDS = frozenset({"item"})

BEGIN_RE = re.compile(r"\\begin\{([^}]+)\}")
END_RE = re.compile(r"\\end\{([^}]+)\}")
DOLLAR_RE = re.compile(r"(?<!\\)\$\$?")
DISP_OPEN_RE = re.compile(r"(?<!\\)\\\[")
DISP_CLOSE_RE = re.compile(r"(?<!\\)\\\]")


@dataclass
class ScopeViolation:
    line: int
    page_value: str
    context: str
    snippet: str


@dataclass
class ContinuityFinding:
    kind: str
    detail: str
    new_vs_baseline: bool


@dataclass
class ValidationReport:
    scope_violations: list[ScopeViolation] = field(default_factory=list)
    continuity_findings: list[ContinuityFinding] = field(default_factory=list)

    @property
    def has_blockers(self) -> bool:
        if self.scope_violations:
            return True
        return any(f.new_vs_baseline for f in self.continuity_findings)

    def summary_line(self) -> str:
        new_count = sum(1 for f in self.continuity_findings if f.new_vs_baseline)
        return (
            f"{len(self.scope_violations)} scope violation(s), "
            f"{len(self.continuity_findings)} continuity finding(s) "
            f"({new_count} new vs. baseline)"
        )

    def to_warnings(self) -> list[str]:
        out: list[str] = []
        for v in self.scope_violations:
            out.append(
                f"pgmark-scope: {v.context} at line {v.line} (page {v.page_value})"
            )
        for f in self.continuity_findings:
            out.append(f"pgmark-{f.kind}: {f.detail}")
        return out

    def to_markdown(self) -> str:
        lines = ["# pgmark validation report", ""]
        lines.append(f"**Summary:** {self.summary_line()}")
        lines.append("")
        if self.scope_violations:
            lines.append("## Scope violations (must fix)")
            lines.append("")
            for v in self.scope_violations:
                lines.append(
                    f"- **Line {v.line}** — pgmark `{v.page_value}` inside {v.context}:"
                )
                lines.append(f"      `{v.snippet}`")
            lines.append("")
        if self.continuity_findings:
            lines.append("## Continuity findings")
            lines.append("")
            for f in self.continuity_findings:
                tag = "**new**" if f.new_vs_baseline else "_pre-existing_"
                lines.append(f"- {tag} `{f.kind}`: {f.detail}")
            lines.append("")
        if not self.scope_violations and not self.continuity_findings:
            lines.append("No issues found.")
        return "\n".join(lines) + "\n"


def _strip_comments(line: str) -> str:
    """Strip a LaTeX `% comment` tail; respects `\\%`."""
    out: list[str] = []
    i = 0
    while i < len(line):
        c = line[i]
        if c == "\\" and i + 1 < len(line):
            out.append(c)
            out.append(line[i + 1])
            i += 2
            continue
        if c == "%":
            break
        out.append(c)
        i += 1
    return "".join(out)


def _detect_unclosed_cmd_arg(prefix: str) -> str | None:
    """Return command name if `prefix` ends inside an unclosed `\\<cmd>{...`.

    Walks the prefix, tracking brace depth. Each `{` opening immediately
    after a `\\<word>` (optionally past a `[opt]` argument) records that
    command name; each `}` closes the most recent. Escaped `\\{` and `\\}`
    are skipped. Returns the topmost-open command name, or None if no
    command arg is open at the end of the prefix.
    """
    stack: list[str | None] = []
    i = 0
    n = len(prefix)
    while i < n:
        c = prefix[i]
        if c == "\\":
            i += 2  # skip escaped char (\{, \}, \\, etc.)
            continue
        if c == "{":
            cmd: str | None = None
            j = i - 1
            # Skip an optional [opt] argument that may sit between cmd
            # name and the `{`. e.g. \pgmark[low]{N}.
            if j >= 0 and prefix[j] == "]":
                k = j - 1
                while k >= 0 and prefix[k] != "[":
                    k -= 1
                if k >= 0:
                    j = k - 1
            if j >= 0 and (prefix[j].isalpha() or prefix[j] == "*"):
                end = j + 1
                while j >= 0 and (prefix[j].isalpha() or prefix[j] == "*"):
                    j -= 1
                if j >= 0 and prefix[j] == "\\":
                    cmd = prefix[j + 1:end]
            stack.append(cmd)
            i += 1
            continue
        if c == "}":
            if stack:
                stack.pop()
            i += 1
            continue
        i += 1

    for cmd in reversed(stack):
        if cmd and cmd not in SAFE_OUTER_CMDS:
            return cmd
    return None


# ── Multi-line scope walker (for fusion / pgmark injection) ─────────────
#
# The original _scan_scope below is a per-line walker whose
# _detect_unclosed_cmd_arg query only inspects the same-line prefix —
# correct for the validator's purpose (every pgmark we've ever emitted
# was on its own line) but blind to multi-line `\\footnote{... \\n ...}`
# braces. The injection step in fuse_alternate.py needs a stricter
# check: "if I splice a fresh line in here, will it land at body scope
# considering everything above it?"
#
# ScopeWalker walks the whole document once, snapshotting state at the
# start of every line. is_body_scope_at_line(N) answers the injection
# query without re-scanning. _scan_scope is left untouched so the
# validate() contract stays byte-identical for every existing caller.


@dataclass
class ScopeState:
    in_preamble: bool = True
    math_depth: int = 0
    env_stack: list[str] = field(default_factory=list)
    # Cross-line command-argument stack. Each entry is the cmd name (or
    # None for an anonymous brace group). Tracks unclosed `\\<cmd>{` that
    # span multiple lines.
    cmd_arg_stack: list[str | None] = field(default_factory=list)

    def is_body_scope(self) -> bool:
        if self.in_preamble:
            return False
        if self.math_depth > 0:
            return False
        for cmd in self.cmd_arg_stack:
            if cmd and cmd not in SAFE_OUTER_CMDS:
                return False
        return True

    def clone(self) -> "ScopeState":
        return ScopeState(
            in_preamble=self.in_preamble,
            math_depth=self.math_depth,
            env_stack=list(self.env_stack),
            cmd_arg_stack=list(self.cmd_arg_stack),
        )


def _cmd_name_before(line: str, brace_pos: int) -> str | None:
    """If `{` at line[brace_pos] follows `\\<cmd>` (possibly past `[opt]`),
    return cmd. Else None. Mirrors _detect_unclosed_cmd_arg's heuristic."""
    j = brace_pos - 1
    if j >= 0 and line[j] == "]":
        k = j - 1
        while k >= 0 and line[k] != "[":
            k -= 1
        if k >= 0:
            j = k - 1
    if j >= 0 and (line[j].isalpha() or line[j] == "*"):
        end = j + 1
        while j >= 0 and (line[j].isalpha() or line[j] == "*"):
            j -= 1
        if j >= 0 and line[j] == "\\":
            return line[j + 1:end]
    return None


class ScopeWalker:
    """Walks a LaTeX document and snapshots ScopeState at the start of every
    line. Use is_body_scope_at_line(N) to decide whether splicing a fresh
    `\\pgmark{N}` line in front of line N would land at body scope.

    Inline math `$...$` is intentionally NOT tracked across lines (it
    can't span lines in well-formed LaTeX, and the line-resetting logic
    in _scan_scope reflects that). Display math `\\[...\\]`, math envs,
    and command-arg braces ARE tracked across lines.

    Line numbers are 1-indexed, matching LaTeX / editor convention.
    """

    def __init__(self, tex: str) -> None:
        self._lines = tex.split("\n")
        self._state_before: list[ScopeState] = []
        self._compute()

    def _compute(self) -> None:
        st = ScopeState()
        for raw in self._lines:
            self._state_before.append(st.clone())
            line = _strip_comments(raw)

            if st.in_preamble and (
                "\\begin{document}" in line or "\\maketitle" in line
            ):
                st.in_preamble = False

            # Walk the line with two parallel iterators:
            #   • brace events (chars `{` / `}` respecting `\\{` / `\\}`)
            #   • environment / display-math events (regex-based)
            # We compute the env events upfront and step them in
            # position order alongside the char walk so brace and env
            # state stay consistent.
            events: list[tuple[int, str, str]] = []
            for m in DISP_OPEN_RE.finditer(line):
                events.append((m.start(), "disp_open", ""))
            for m in DISP_CLOSE_RE.finditer(line):
                events.append((m.start(), "disp_close", ""))
            for m in BEGIN_RE.finditer(line):
                events.append((m.start(), "begin", m.group(1)))
            for m in END_RE.finditer(line):
                events.append((m.start(), "end", m.group(1)))
            events.sort()

            ev_idx = 0
            i = 0
            n = len(line)
            while i < n:
                while ev_idx < len(events) and events[ev_idx][0] == i:
                    _, kind, payload = events[ev_idx]
                    if kind == "disp_open":
                        st.math_depth += 1
                    elif kind == "disp_close":
                        st.math_depth = max(0, st.math_depth - 1)
                    elif kind == "begin":
                        st.env_stack.append(payload)
                        if payload in MATH_BEGIN_ENVS:
                            st.math_depth += 1
                    elif kind == "end":
                        if st.env_stack and st.env_stack[-1] == payload:
                            st.env_stack.pop()
                        if payload in MATH_BEGIN_ENVS:
                            st.math_depth = max(0, st.math_depth - 1)
                    ev_idx += 1
                c = line[i]
                if c == "\\" and i + 1 < n:
                    i += 2
                    continue
                if c == "{":
                    st.cmd_arg_stack.append(_cmd_name_before(line, i))
                    i += 1
                    continue
                if c == "}":
                    if st.cmd_arg_stack:
                        st.cmd_arg_stack.pop()
                    i += 1
                    continue
                i += 1
            # Drain trailing events past end-of-line (defensive — regex
            # event positions should always be ≤ n).
            while ev_idx < len(events):
                _, kind, payload = events[ev_idx]
                if kind == "disp_open":
                    st.math_depth += 1
                elif kind == "disp_close":
                    st.math_depth = max(0, st.math_depth - 1)
                elif kind == "begin":
                    st.env_stack.append(payload)
                    if payload in MATH_BEGIN_ENVS:
                        st.math_depth += 1
                elif kind == "end":
                    if st.env_stack and st.env_stack[-1] == payload:
                        st.env_stack.pop()
                    if payload in MATH_BEGIN_ENVS:
                        st.math_depth = max(0, st.math_depth - 1)
                ev_idx += 1

    def state_at_line(self, line_no: int) -> ScopeState:
        """State at the START of `line_no` (1-indexed)."""
        idx = max(0, line_no - 1)
        if idx >= len(self._state_before):
            return (
                self._state_before[-1] if self._state_before else ScopeState()
            )
        return self._state_before[idx]

    def is_body_scope_at_line(self, line_no: int) -> bool:
        return self.state_at_line(line_no).is_body_scope()


def is_body_scope_at_line(tex: str, line_no: int) -> bool:
    """One-shot helper: True iff splicing a fresh line at `line_no`
    (1-indexed) would land at body scope. For many queries on the same
    `tex`, instantiate ScopeWalker(tex) once and call its method instead."""
    return ScopeWalker(tex).is_body_scope_at_line(line_no)


def _scan_scope(tex: str) -> list[ScopeViolation]:
    """Find all \\pgmark{} occurrences in disallowed scopes."""
    violations: list[ScopeViolation] = []
    in_preamble = True
    math_depth = 0
    inline_math_open = False
    env_stack: list[str] = []

    for lineno, raw in enumerate(tex.split("\n"), start=1):
        line = _strip_comments(raw)

        if in_preamble and ("\\begin{document}" in line or "\\maketitle" in line):
            # Flip preamble flag *before* processing the line so a
            # \maketitle on the same line as later content is treated as
            # the body boundary.
            in_preamble = False

        events: list[tuple[int, str, str]] = []
        for m in DISP_OPEN_RE.finditer(line):
            events.append((m.start(), "disp_open", ""))
        for m in DISP_CLOSE_RE.finditer(line):
            events.append((m.start(), "disp_close", ""))
        for m in DOLLAR_RE.finditer(line):
            events.append((m.start(), "dollar", ""))
        for m in BEGIN_RE.finditer(line):
            events.append((m.start(), "begin", m.group(1)))
        for m in END_RE.finditer(line):
            events.append((m.start(), "end", m.group(1)))
        for m in PGMARK_RE.finditer(line):
            events.append((m.start(), "pgmark", m.group(2)))
        events.sort()

        for pos, kind, payload in events:
            if kind == "disp_open":
                math_depth += 1
            elif kind == "disp_close":
                math_depth = max(0, math_depth - 1)
            elif kind == "dollar":
                inline_math_open = not inline_math_open
            elif kind == "begin":
                env_stack.append(payload)
                if payload in MATH_BEGIN_ENVS:
                    math_depth += 1
            elif kind == "end":
                if env_stack and env_stack[-1] == payload:
                    env_stack.pop()
                if payload in MATH_BEGIN_ENVS:
                    math_depth = max(0, math_depth - 1)
            elif kind == "pgmark":
                ctx: str | None = None
                if in_preamble:
                    ctx = "preamble"
                elif math_depth > 0:
                    ctx = "math display"
                elif inline_math_open:
                    ctx = "inline math ($...$)"
                else:
                    cmd = _detect_unclosed_cmd_arg(line[:pos])
                    if cmd:
                        ctx = f"argument of \\{cmd}"
                if ctx is not None:
                    snippet = raw.strip()
                    if len(snippet) > 120:
                        snippet = snippet[:117] + "..."
                    violations.append(ScopeViolation(
                        line=lineno,
                        page_value=payload,
                        context=ctx,
                        snippet=snippet,
                    ))

        # Inline math `$...$` should not span lines; reset to avoid a
        # stray unmatched `$` in one line poisoning the next.
        inline_math_open = False

    return violations


_ROMAN_RE = re.compile(r"^[ivxlcdm]+$", re.IGNORECASE)


def _is_roman(s: str) -> bool:
    return bool(s) and bool(_ROMAN_RE.match(s))


def _detect_section_resets(
    arabic_seq: list[tuple[int, int]],
) -> list[tuple[int, int]]:
    """Detect monotonic-reset transitions in the arabic pgmark sequence.

    A "reset" is a transition from a high value to a value substantially
    lower (≥ 50% drop AND prior value ≥ 10). Common in books with
    separate front-matter / body / index paginations or in book chapters
    whose page numbers restart from 1.

    Returns list of (marker_index_before, marker_index_after) for each
    reset, where marker indexes refer to positions in `arabic_seq`.
    """
    resets: list[tuple[int, int]] = []
    for idx in range(1, len(arabic_seq)):
        _, v_prev = arabic_seq[idx - 1]
        _, v_curr = arabic_seq[idx]
        if v_prev >= 10 and v_curr <= v_prev * 0.5:
            resets.append((arabic_seq[idx - 1][0], arabic_seq[idx][0]))
    return resets


def _detect_pdf_pages(
    tex_path: Path | None,
    pdf_arg: Path | None,
) -> int | None:
    """Auto-detect PDF page count via pdfinfo on sibling .pdf or explicit path.

    Returns None if no PDF is available or pdfinfo isn't installed.
    Sibling resolution: tex_path = papers/<citekey>/main.tex → look for
    papers/<citekey>/<citekey>.pdf (the canonical Library layout).
    """
    if not shutil.which("pdfinfo"):
        return None
    candidate: Path | None = None
    if pdf_arg is not None and pdf_arg.exists():
        candidate = pdf_arg
    elif tex_path is not None:
        citekey = tex_path.parent.name
        sib = tex_path.parent / f"{citekey}.pdf"
        if sib.exists():
            candidate = sib
    if candidate is None:
        return None
    try:
        out = subprocess.run(
            ["pdfinfo", str(candidate)],
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


def _scan_continuity(
    tex: str,
    baseline_kinds: set[str] | None = None,
    pdf_pages: int | None = None,
) -> list[ContinuityFinding]:
    findings: list[ContinuityFinding] = []
    pgmarks: list[tuple[str, str]] = []
    for m in PGMARK_RE.finditer(tex):
        conf = m.group(1) or ""
        val = m.group(2)
        pgmarks.append((val, conf))

    if not pgmarks:
        return findings

    def _is_new(kind: str) -> bool:
        return baseline_kinds is None or kind not in baseline_kinds

    arabic_seq: list[tuple[int, int]] = [
        (i, int(v)) for i, (v, _) in enumerate(pgmarks) if v.isdigit()
    ]
    section_resets = _detect_section_resets(arabic_seq)
    reset_boundary_indexes: set[int] = set()
    for before_i, after_i in section_resets:
        # Mark every index from `before_i+1` through end of doc as living
        # in a different "page namespace" than indexes ≤ before_i for
        # duplicate-detection purposes. We accumulate a "namespace id"
        # assignment below.
        reset_boundary_indexes.add(after_i)

    # Assign each pgmark index to a "section namespace" id. Indexes
    # before the first reset are namespace 0; after the first reset, 1;
    # after the second, 2; etc.
    namespace_of: dict[int, int] = {}
    ns = 0
    for i in range(len(pgmarks)):
        if i in reset_boundary_indexes:
            ns += 1
        namespace_of[i] = ns

    counts: dict[str, list[int]] = {}
    for i, (v, _) in enumerate(pgmarks):
        counts.setdefault(v, []).append(i)
    for v, positions in counts.items():
        if len(positions) <= 1:
            continue
        # Group occurrences by section namespace. Within one namespace,
        # a duplicate is a real `duplicate` finding. Across namespaces,
        # it's a benign `multi-section` finding.
        per_ns: dict[int, list[int]] = {}
        for pos in positions:
            per_ns.setdefault(namespace_of[pos], []).append(pos)
        within_ns_dups = [
            (n, ps) for n, ps in per_ns.items() if len(ps) > 1
        ]
        cross_ns = len(per_ns) > 1
        if within_ns_dups:
            for n_id, ps in within_ns_dups:
                findings.append(ContinuityFinding(
                    kind="duplicate",
                    detail=f"page '{v}' appears {len(ps)} times within section "
                           f"namespace {n_id} (at marker indexes {ps})",
                    new_vs_baseline=_is_new("duplicate"),
                ))
        if cross_ns:
            findings.append(ContinuityFinding(
                kind="multi-section",
                detail=f"page '{v}' appears in {len(per_ns)} section "
                       f"namespaces (at marker indexes {positions}); "
                       f"likely legitimate (front-matter / body / index)",
                new_vs_baseline=False,
            ))

    # Out-of-order / gap checks. Skip transitions that cross a section
    # reset boundary — those are expected page-namespace restarts.
    reset_pairs = set(section_resets)
    for (i1, v1), (i2, v2) in zip(arabic_seq, arabic_seq[1:]):
        if (i1, i2) in reset_pairs:
            continue
        if v2 < v1:
            findings.append(ContinuityFinding(
                kind="out-of-order",
                detail=f"page {v1} → page {v2} (marker indexes {i1}, {i2})",
                new_vs_baseline=_is_new("out-of-order"),
            ))
        elif v2 - v1 > 1:
            findings.append(ContinuityFinding(
                kind="gap",
                detail=f"page {v1} → page {v2} (skipped {v2 - v1 - 1})",
                new_vs_baseline=_is_new("gap"),
            ))

    n = len(pgmarks)
    low = sum(1 for _, c in pgmarks if c == "low")
    if n >= 5 and low / n > 0.3:
        findings.append(ContinuityFinding(
            kind="low-confidence-flood",
            detail=f"{low}/{n} markers ({low * 100 // n}%) carry [low] confidence",
            new_vs_baseline=_is_new("low-confidence-flood"),
        ))

    # Range checks against PDF page count. Only run when we have a
    # plausible pdf_pages value AND at least one arabic pgmark.
    if pdf_pages is not None and pdf_pages > 0 and arabic_seq:
        lo = min(v for _, v in arabic_seq)
        hi = max(v for _, v in arabic_seq)
        span = hi - lo + 1

        # `range-impossible`: hi exceeds pdf_pages × 1.5 AND the span
        # also exceeds pdf_pages. Both conditions required to avoid
        # firing on journal-offset reprints (kunene, neander, davidson,
        # kriegeskorte, haugeland, greenberg).
        if hi > pdf_pages * 1.5 and span > pdf_pages:
            findings.append(ContinuityFinding(
                kind="range-impossible",
                detail=f"max pgmark {hi} exceeds 1.5× PDF page count "
                       f"({pdf_pages}) AND span {span} exceeds PDF pages — "
                       f"likely extractor offset bug",
                new_vs_baseline=_is_new("range-impossible"),
            ))

        # `range-suspiciously-wide`: span > pdf_pages × 1.3. Would have
        # caught the peacocke +170 silent offset (where max-min still
        # formed a consistent ascending sequence but the range was
        # impossible). Reported as informational unless catastrophic.
        elif span > pdf_pages * 1.3:
            findings.append(ContinuityFinding(
                kind="range-suspiciously-wide",
                detail=f"pgmark span {span} pages ({lo}–{hi}) exceeds 1.3× "
                       f"PDF page count ({pdf_pages}) — possible silent "
                       f"offset bug",
                new_vs_baseline=_is_new("range-suspiciously-wide"),
            ))

    return findings


def validate(
    tex: str,
    *,
    baseline_kinds: set[str] | None = None,
    pdf_pages: int | None = None,
) -> ValidationReport:
    return ValidationReport(
        scope_violations=_scan_scope(tex),
        continuity_findings=_scan_continuity(
            tex,
            baseline_kinds=baseline_kinds,
            pdf_pages=pdf_pages,
        ),
    )


def _baseline_kinds_from_catalog(
    catalog_path: Path, citekey: str,
) -> set[str]:
    if not catalog_path.exists():
        return set()
    try:
        catalog = json.loads(catalog_path.read_text())
    except Exception:
        return set()
    # `pgmark-<kind>-false-positive:` suppressions (operator-verified false
    # positives, written by add_validator_suppression.py) → bare finding kind.
    # Routed through the shared reader so the `-false-positive` suffix is
    # actually stripped; the old inline reader kept it, so every suppression
    # was silently ignored and the finding re-blocked convergence each pass.
    kinds: set[str] = suppression_categories_from_catalog(
        catalog, citekey, prefix="pgmark-",
    )
    # Plain prior-pass warnings `pgmark-<kind>: <detail>` (the validator's own
    # emitted findings from a previous pass). Suffix `-false-positive` entries
    # are handled above, so skip them here.
    for e in catalog.get("entries", []):
        if e.get("citekey") == citekey:
            warnings = (e.get("indexed") or {}).get("warnings") or []
            for w in warnings:
                if not (isinstance(w, str) and w.startswith("pgmark-") and ":" in w):
                    continue
                head = w.split(":", 1)[0]
                if head.endswith("-false-positive"):
                    continue
                kinds.add(head[len("pgmark-"):])
            break
    return kinds


def main() -> int:
    p = argparse.ArgumentParser(
        description="Validate \\pgmark placement and continuity in a main.tex."
    )
    p.add_argument("tex", help="Path to main.tex (typically papers/<citekey>/main.tex)")
    p.add_argument("--baseline-from-catalog", action="store_true",
                   help="Read previous warnings from <library>/catalog.json and "
                        "treat matching kinds as pre-existing (non-blocking).")
    p.add_argument("--severity", choices=["warn", "error"], default="error",
                   help="error (default): exit 1 on blockers. warn: always exit 0.")
    p.add_argument("--json", action="store_true",
                   help="Emit JSON instead of markdown.")
    p.add_argument("--pdf-pages", type=int, default=None,
                   help="PDF page count for range checks. If omitted, "
                        "auto-detect via pdfinfo on sibling <citekey>.pdf "
                        "or --pdf path.")
    p.add_argument("--pdf", type=str, default=None,
                   help="Explicit PDF path for pdfinfo auto-detection.")
    p.add_argument("--no-pdf-check", action="store_true",
                   help="Skip PDF range checks entirely.")
    p.add_argument("--journal-cumulative", action="store_true",
                   help="Treat printed pages N..N+K as journal-offset reprint "
                        "(skip range-impossible and range-suspiciously-wide). "
                        "Useful for Springer/Elsevier articles where the PDF "
                        "starts at the article's first printed page.")
    args = p.parse_args()

    tex_path = Path(args.tex)
    if not tex_path.exists():
        print(f"error: {tex_path} not found", file=sys.stderr)
        return 2
    tex = tex_path.read_text()

    baseline: set[str] | None = None
    if args.baseline_from_catalog:
        try:
            citekey = tex_path.parent.name
            library = tex_path.parent.parent.parent
            baseline = _baseline_kinds_from_catalog(library / ".virgil" / "catalog.json", citekey)
        except Exception:
            baseline = None

    pdf_pages: int | None = None
    if not args.no_pdf_check:
        if args.pdf_pages is not None:
            pdf_pages = args.pdf_pages
        else:
            pdf_path = Path(args.pdf) if args.pdf else None
            pdf_pages = _detect_pdf_pages(tex_path, pdf_path)

    # `--journal-cumulative` suppresses the high-end range checks
    # since journal offset reprints legitimately have pgmarks far
    # above 1. The multi-section duplicate-detection and out-of-order
    # checks remain active.
    if args.journal_cumulative:
        pdf_pages = None

    report = validate(tex, baseline_kinds=baseline, pdf_pages=pdf_pages)

    if args.json:
        print(json.dumps({
            "scope_violations": [v.__dict__ for v in report.scope_violations],
            "continuity_findings": [f.__dict__ for f in report.continuity_findings],
            "has_blockers": report.has_blockers,
            "summary": report.summary_line(),
            "pdf_pages": pdf_pages,
        }, indent=2))
    else:
        print(report.to_markdown(), end="")

    if args.severity == "error" and report.has_blockers:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
