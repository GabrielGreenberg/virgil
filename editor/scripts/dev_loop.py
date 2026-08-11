#!/usr/bin/env python3
r"""The shared dev-loop engine — one critique-memo shape, one reader, one guard.

Virgil's editor dev-loop has TWO entry points that both { read a structured
critique memo → derive proposed skill-markdown changes → route each through the
boundary guard → land it → record }:

  • /editor/reflect + /editor/dream  — the AMBIENT, real-input, cross-skill,
    DEV-gated overnight pass.  Memos land in editor/dev/memos/ (reflect.py
    writes them; dream.py consumes them).
  • /editor/iterate-virgil-editor    — the SYNCHRONOUS, synthesized-input,
    single-skill stress-test the maintainer watches.  Memos land in
    editor/dev/iterations/ (this module writes them; the loop driver consumes
    them inline).

This module is where the two entry points stand on the SAME engine.  It does
NOT re-implement the shared pieces — it composes them:

  • the READER + the bucket/tier VOCABULARY come from reflect.py
    (`_parse_memo`, `BUCKET_*`, `TIER_*`, `_render_buckets`) — ONE reader, ONE
    vocabulary; there is no second parser.
  • the BOUNDARY GUARD comes from dream_land.py (`classify_change`, the three
    boundaries) — ONE guard, pure + dry-run-safe.

What this module ADDS — the two iterate-facing seams that let iterate adopt the
engine without taking on dream's autonomy machinery:

  write_iteration_memo(critique)  — write iterate's runner critique in the
      UNIFIED memo shape (reflect's frontmatter + the four buckets, via
      `_render_buckets`), mapping the old `[block]`/`[nice-to-have]` vocabulary
      onto tiers + buckets (see TIER + BUCKET MAPPING below).  NOT DEV-gated:
      the iterations/ stream is an explicit, synchronous, user-invoked test, not
      ambient capture.
  route_edits(edits)              — the read→derive→ROUTE spine: classify each
      proposed skill edit through `dream_land.classify_change` and partition
      into { acts, surface, blocked }.  This is iterate's BOUNDARY-GUARD
      adoption: `refused` → blocked (never landed); `proposes` → surfaced
      (landed inline but flagged "extra scrutiny / consider a separate pass");
      `acts` → landed inline silently.  iterate stays synchronous + inline +
      no-commit — it does NOT spin up a propose-via-worktree (that is dream-only).

TIER + BUCKET MAPPING (iterate's `[block]`/`[nice-to-have]` → the unified shape):
  [block]                 → tier `flagged`, the item recorded in the `issues` bucket
  [nice-to-have]          → tier `noted`,   the item recorded in the `streamlining` bucket
  Ambiguities encountered → the `issues` bucket
  Judgment calls made     → the `alignment` bucket
  result: failure         → tier `flagged` (a broken run — like reflect's `errored`)
  result: partial         → tier `noted`
A clean success with no blocking/nice edit and no logged friction → `unremarkable`.

iterate-specific facts the shared reader TOLERATES (extra frontmatter keys
`_parse_memo` reads but reflect/dream ignore): `stream`, `case`, `attempt`,
`sandbox`, `blockCount`, `niceCount` — plus the per-attempt actions log + the
final-sandbox-state, rendered as body sections AFTER the four buckets (unknown
`##` sections the reader skips).  iterate's `result` (success/partial/failure)
rides the `result` frontmatter field; `stream: iterations` labels the stream so
it is never confused with a contract result (the dream never reads iterations/).

Env overrides:
  VIRGIL_DEV_ITERATIONS_DIR  iterations root (default: ~/.virgil-dev/iterations,
                             via _common.iterations_root / VIRGIL_DEV_HOME)
  VIRGIL_ITERATE_NOW         ISO timestamp for reflectedAt + the filename clock

CLI (for the runner subagent + the loop driver):
  dev_loop.py write-iteration-memo --json <inline|@file>   # write the memo → path + tier
  dev_loop.py route-edits --edits <inline|@file>           # partition edits → JSON
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from _common import atomic_write, iterations_root as _shared_iterations_root

# The shared READER + the bucket/tier VOCABULARY — reused, not re-implemented.
from reflect import (  # noqa: E402  (sibling module in editor/scripts/)
    BUCKET_TITLES,
    EMPTY_BUCKET,
    FM_KEYS,
    SHARED_FM_KEYS,
    TIER_FLAGGED,
    TIER_NOTED,
    TIER_UNREMARKABLE,
    _parse_memo,
    _render_buckets,
    _skill_sha,
    bucket_body,
)

# The shared boundary GUARD — reused, not re-implemented.
from dream_land import (  # noqa: E402
    LAND_ACTS,
    LAND_PROPOSES,
    LAND_REFUSED,
    Verdict,
    classify_change,
)

# Re-export the engine's shared surface so a consumer (or a test) can import the
# whole spine from one place — the reader, the vocabulary, and the guard live in
# reflect/dream_land; this is just the named door onto them.
__all__ = [
    "BUCKET_TITLES", "FM_KEYS", "SHARED_FM_KEYS", "_parse_memo", "_render_buckets",
    "EMPTY_BUCKET", "bucket_body",
    "TIER_FLAGGED", "TIER_NOTED", "TIER_UNREMARKABLE",
    "classify_change", "Verdict", "LAND_ACTS", "LAND_PROPOSES", "LAND_REFUSED",
    "SEVERITY_BLOCK", "SEVERITY_NICE", "ITER_RESULTS", "ITER_FM_KEYS",
    "tier_for_iteration", "write_iteration_memo",
    "RoutedEdits", "route_edits",
]

# iterate's critique severities (the old vocabulary the runner still emits).
SEVERITY_BLOCK = "block"
SEVERITY_NICE = "nice-to-have"

# iterate's run outcome (its own vocabulary — NOT an apply_response result).
ITER_RESULTS = {"success", "partial", "failure"}

# The unified frontmatter for an iterations/ memo = reflect's shared keys (so
# the ONE reader + the dream read them identically) followed by iterate extras.
ITER_FM_KEYS = [*FM_KEYS, "stream", "case", "attempt", "sandbox",
                "blockCount", "niceCount"]


# ---------------------------------------------------------------------------
# Time + paths (mirrors reflect.py's clock + root seams, for the iterations stream)
# ---------------------------------------------------------------------------


def _now_parts() -> tuple[str, str, str]:
    """(iso, YYYY-MM-DD, HH-MM-SS) from VIRGIL_ITERATE_NOW or the wall clock."""
    raw = os.environ.get("VIRGIL_ITERATE_NOW", "").strip()
    if raw:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    dt = dt.astimezone(timezone.utc)
    iso = dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return iso, dt.strftime("%Y-%m-%d"), dt.strftime("%H-%M-%S")


def _iterations_root() -> Path:
    # Shared machine-global home (VIRGIL_DEV_ITERATIONS_DIR overrides) — one
    # dev-loop home for memos / digests / iterations, resolved via _common.
    return _shared_iterations_root()


# ---------------------------------------------------------------------------
# The [block]/[nice-to-have] → tier + bucket mapping (LOCKED — chip 19)
# ---------------------------------------------------------------------------


def tier_for_iteration(result: str, block_count: int, nice_count: int,
                       has_friction: bool) -> str:
    """The iterate critique's tier, mapped onto reflect's three tiers.

      flagged  — the run failed, or there is ≥1 `[block]` item (the skill could
                 not be reliably executed without a fix — read first, re-run).
      noted    — the run was partial, or there is a `[nice-to-have]` item or
                 logged friction (an ambiguity / a judgment call) — read, group.
      unremarkable — a clean success with nothing to surface (most attempts once
                 a skill stabilizes).
    """
    if result == "failure" or block_count > 0:
        return TIER_FLAGGED
    if result == "partial" or nice_count > 0 or has_friction:
        return TIER_NOTED
    return TIER_UNREMARKABLE


def _fmt_ambiguity(a: dict) -> str:
    quote = str(a.get("quote", "")).strip()
    fix = str(a.get("fix", "")).strip()
    if quote and fix:
        return f'- ambiguity: "{quote}" → {fix}'
    if quote:
        return f'- ambiguity: "{quote}"'
    return f"- ambiguity: {fix}" if fix else ""


def _fmt_edit(e: dict) -> str:
    change = str(e.get("change", "")).strip()
    line = e.get("line")
    loc = f"skills:{line} — " if line not in (None, "", 0) else ""
    return f"- {loc}{change}".rstrip()


def _assemble_buckets(critique: dict) -> tuple[dict, int, int]:
    """Map a runner critique → the four buckets + (block_count, nice_count).

    Ambiguities → `issues`; Judgment calls → `alignment`; `[block]` edits →
    `issues`; `[nice-to-have]` edits → `streamlining`.  `userTagged` is always
    empty for the synthesized stream (iterate has no maintainer 'put this in the
    memo' channel)."""
    issues: list[str] = []
    alignment: list[str] = []
    streamlining: list[str] = []

    for a in critique.get("ambiguities") or []:
        line = _fmt_ambiguity(a if isinstance(a, dict) else {"quote": str(a)})
        if line:
            issues.append(line)

    for j in critique.get("judgmentCalls") or []:
        s = str(j).strip()
        if s:
            alignment.append(f"- {s}")

    block_count = nice_count = 0
    for e in critique.get("edits") or []:
        if not isinstance(e, dict):
            e = {"change": str(e), "severity": SEVERITY_NICE}
        sev = str(e.get("severity", SEVERITY_NICE)).strip().lower()
        line = _fmt_edit(e)
        if sev == SEVERITY_BLOCK:
            block_count += 1
            if line.strip("- ").strip():
                issues.append(f"- [block]{line[1:]}")  # block → issues bucket
        else:
            nice_count += 1
            if line.strip("- ").strip():
                streamlining.append(f"- [nice-to-have]{line[1:]}")

    buckets = {
        "issues": "\n".join(issues),
        "streamlining": "\n".join(streamlining),
        "alignment": "\n".join(alignment),
        "userTagged": "",
    }
    return buckets, block_count, nice_count


def _render_iteration_memo(fm: dict, buckets: dict, critique: dict) -> str:
    """The unified memo text: reflect's frontmatter (shared keys + iterate
    extras) + the four buckets (the SHARED renderer) + iterate's actions log and
    final-sandbox-state as trailing body sections the reader skips."""
    out: list[str] = ["---"]
    for k in ITER_FM_KEYS:
        if k not in fm:
            continue
        v = fm[k]
        if isinstance(v, list):
            v = ", ".join(str(x) for x in v)
        elif isinstance(v, bool):
            v = "true" if v else "false"
        out.append(f"{k}: {v}")
    out.append("---")
    out.append("")
    out.append(f"# {fm.get('skill', '?')} on {fm.get('case', '?')} — "
               f"attempt {fm.get('attempt', '?')} ({fm.get('tier')})")
    out.append("")
    if fm.get("_summary"):
        out.append(f"**Done:** {fm['_summary']}")
        out.append("")
    out.append(f"**Outcome:** result={fm.get('result') or '—'} · "
               f"sandbox={fm.get('sandbox') or '—'} · "
               f"block={fm.get('blockCount')} nice={fm.get('niceCount')}")
    out.append("")

    # The qualitative core — the SAME four-bucket renderer reflect uses.
    out.extend(_render_buckets(buckets))

    # iterate-specific body sections (the reader skips these unknown titles).
    out.append("## Actions taken")
    actions = [str(x).strip() for x in (critique.get("actions") or []) if str(x).strip()]
    if actions:
        out.extend(a if a.startswith("- ") else f"- {a}" for a in actions)
    else:
        out.append("None.")
    out.append("")

    final = critique.get("finalState") or {}
    out.append("## Final sandbox state")
    if isinstance(final, dict) and final:
        for k, v in final.items():
            out.append(f"- {k}: {v}")
    else:
        out.append("- (not recorded)")
    out.append("")
    return "\n".join(out).rstrip() + "\n"


def write_iteration_memo(critique: dict, *, iterations_root: Path | None = None) -> Path:
    """Write one iterate stress-test critique in the UNIFIED memo shape and
    return the path.

    `critique` (the runner subagent's structured output):
      skill, case, attempt        (required — identify the run)
      result                      success | partial | failure (default success)
      taskId, kind, paragraphIds  the synthetic request's frame (optional)
      sandbox                     the per-attempt sandbox path (optional)
      summary                     one-line Done:/request summary (optional)
      actions                     list[str] — the per-attempt actions log
      ambiguities                 list[{quote, fix}] → the `issues` bucket
      judgmentCalls               list[str]          → the `alignment` bucket
      edits                       list[{severity, line, change}] —
                                  `[block]` → issues + flagged; `[nice-to-have]`
                                  → streamlining + noted
      finalState                  dict — the closing sandbox-state summary

    NOT DEV-gated: the synthesized stress-test stream is an explicit, synchronous
    test the maintainer invoked, not ambient capture.  The path mirrors the
    legacy iterate layout: editor/dev/iterations/<date>-<skill>/<case>-attempt<k>.md
    """
    skill = str(critique.get("skill") or "?").strip()
    case = str(critique.get("case") or "?").strip()
    attempt = critique.get("attempt")
    result = str(critique.get("result") or "success").strip().lower()
    if result not in ITER_RESULTS:
        result = "success"

    buckets, block_count, nice_count = _assemble_buckets(critique)
    has_friction = bool(critique.get("ambiguities") or critique.get("judgmentCalls"))
    tier = tier_for_iteration(result, block_count, nice_count, has_friction)

    iso, date_str, _time = _now_parts()
    pids = critique.get("paragraphIds") or []
    if isinstance(pids, str):
        pids = [p.strip() for p in pids.split(",") if p.strip()]

    fm = {
        "skill": skill,
        "taskId": str(critique.get("taskId") or "-"),
        "kind": str(critique.get("kind") or "—"),
        "status": "failed" if result == "failure" else "complete",
        "result": result,
        "tier": tier,
        "fixNow": False,
        "paragraphIds": pids,
        "reflectedAt": iso,
        "skillSha": _skill_sha(skill),
        # iterate-specific (the shared reader tolerates these; the dream never
        # reads this stream, so `result`'s native vocabulary never leaks).
        "stream": "iterations",
        "case": case,
        "attempt": attempt if attempt is not None else "?",
        "sandbox": str(critique.get("sandbox") or "—"),
        "blockCount": block_count,
        "niceCount": nice_count,
        # render-only
        "_summary": critique.get("summary") or critique.get("request"),
    }

    root = iterations_root or _iterations_root()
    target = root / f"{date_str}-{skill}" / f"{case}-attempt{attempt}.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write([(target, _render_iteration_memo(fm, buckets, critique))])
    return target


# ---------------------------------------------------------------------------
# The read→derive→ROUTE spine — iterate's boundary-guard adoption
# ---------------------------------------------------------------------------


@dataclass
class RoutedEdits:
    """A partition of proposed skill edits by the boundary guard's verdict.

    iterate is SYNCHRONOUS (the maintainer watches `git diff editor/skills/`),
    so everything non-refused lands INLINE in the working tree — there is no
    propose-via-worktree here (that is dream-only).  The three lists encode
    iterate's policy:

      acts     — single-skill prose polish → land inline, no flag.
      surface  — `proposes` (cross-skill / .py / manifest / contract-adjacent /
                 structural) → land inline BUT surface 'extra scrutiny / consider
                 a separate pass' to the watching maintainer.  NOT auto-worktree'd.
      blocked  — `refused` (an AGENTS.md Don't-rule / the contract shape / the
                 DEV gate) → do NOT land; log it.  The safety net iterate lacked.
    """
    acts: list[dict] = field(default_factory=list)
    surface: list[dict] = field(default_factory=list)
    blocked: list[dict] = field(default_factory=list)

    @property
    def inline(self) -> list[dict]:
        """Everything that lands in the working tree this loop (acts + surface —
        i.e. every non-refused edit)."""
        return self.acts + self.surface

    def to_json(self) -> dict:
        return {"acts": self.acts, "surface": self.surface, "blocked": self.blocked,
                "counts": {"acts": len(self.acts), "surface": len(self.surface),
                           "blocked": len(self.blocked)}}


def _routed_entry(change: dict, v: Verdict) -> dict:
    return {
        "summary": change.get("summary") or "",
        "paths": v.paths,
        "intent": change.get("intent") or "",
        "mode": v.mode,
        "reason": v.reason,
        "boundary": v.boundary,
        "memoRefs": change.get("memoRefs") or [],
    }


def route_edits(edits) -> RoutedEdits:
    """Classify each proposed skill edit through `dream_land.classify_change`
    and partition into acts / surface / blocked (see RoutedEdits).  Pure — it
    classifies, it never writes; the caller lands the inline edits."""
    out = RoutedEdits()
    for change in edits or []:
        if not isinstance(change, dict):
            change = {"summary": str(change), "paths": []}
        v = classify_change(change)
        entry = _routed_entry(change, v)
        if v.mode == LAND_REFUSED:
            out.blocked.append(entry)
        elif v.mode == LAND_PROPOSES:
            out.surface.append(entry)
        else:
            out.acts.append(entry)
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _load_json_arg(arg: str, what: str) -> object:
    if arg.startswith("@"):
        p = Path(arg[1:]).expanduser()
        if not p.exists():
            print(f"error: --{what} file not found: {p}", file=sys.stderr)
            sys.exit(2)
        arg = p.read_text(encoding="utf-8")
    try:
        return json.loads(arg)
    except json.JSONDecodeError as e:
        print(f"error: invalid --{what} JSON: {e}", file=sys.stderr)
        sys.exit(2)


def cmd_write_iteration_memo(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="dev_loop.py write-iteration-memo")
    p.add_argument("--json", required=True, help="the runner critique as inline JSON or @file")
    a = p.parse_args(argv)
    critique = _load_json_arg(a.json, "json")
    if not isinstance(critique, dict):
        print("error: --json must be a JSON object", file=sys.stderr)
        return 2
    target = write_iteration_memo(critique)
    rel = target
    try:
        rel = target.relative_to(_iterations_root())
    except ValueError:
        pass
    fm, _ = _parse_memo(target.read_text(encoding="utf-8"))
    print(f"Done: wrote {rel} (tier={fm.get('tier')}, "
          f"block={fm.get('blockCount')}, nice={fm.get('niceCount')}).")
    return 0


def cmd_route_edits(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="dev_loop.py route-edits")
    p.add_argument("--edits", required=True,
                   help="a list of change objects (or {edits:[...]}) as inline JSON or @file")
    a = p.parse_args(argv)
    data = _load_json_arg(a.edits, "edits")
    edits = data.get("edits") if isinstance(data, dict) else data
    if not isinstance(edits, list):
        print("error: --edits must be a JSON list (or {edits:[...]})", file=sys.stderr)
        return 2
    print(json.dumps(route_edits(edits).to_json(), indent=2))
    return 0


_SUBCOMMANDS = {
    "write-iteration-memo": cmd_write_iteration_memo,
    "route-edits": cmd_route_edits,
}


def main(argv: list[str]) -> int:
    if not argv or argv[0] not in _SUBCOMMANDS:
        print(f"usage: dev_loop.py {{{'|'.join(_SUBCOMMANDS)}}} [options]",
              file=sys.stderr)
        return 2
    return _SUBCOMMANDS[argv[0]](argv[1:])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
