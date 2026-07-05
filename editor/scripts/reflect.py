#!/usr/bin/env python3
r"""Write a dev-dream reflection memo for one completed editor-skill invocation.

This is the mechanical half of `/editor/reflect` — the "day" capture layer of
the dev-dream self-improvement loop (EDITOR_SKILLS_V1 §14; design in
MEMO_DEV_DREAM_DESIGN.md; subsystem SSOT in editor/dev/README.md). The skill
markdown (editor/skills/reflect.md) is the agent-facing half: the agent supplies
the qualitative four-bucket reflection; THIS script does the deterministic work
— gate on DEV mode, read the Task's already-classified `result`, derive the
tier, and write/merge the memo at the canonical path.

It does NOT re-derive the outcome. The two-field status/result vocabulary
(EDITOR_SKILLS_V1 §7) is set by the apply_response contract when the skill
lands; reflection CONSUMES `result` (rejected / silent-applied / refused / …)
as the tier floor and the dream's filter key — see RESULT_TIER below.

Gating: a no-op (writes nothing, exits 0) unless `VIRGIL_DEV` is truthy
(_common.dev_mode_enabled). Never runs in an end-user session.

Memos land at  editor/dev/memos/<YYYY-MM-DD>/<HH-MM-SS>-<skill>.md  — repo-side,
gitignored, the sibling of editor/dev/iterations/ (iterate-virgil-editor's
memos). It NEVER writes to the paper's own <doc>/.virgil/memos/ stream nor to
any paper file: the doc is read-only here (we only read its Task queue). chip 18
(/editor/dream) consumes these memos.

Usage:
  reflect.py <docPath> <skill> <taskId> [options]

  <taskId>  an ai-requests.json id, a bib-review-requests.json bibKey, a
            "virtual:<panel>:<cardId>" card-flag id, or "-" for a Task-less
            mechanical op (a card-op / writes-only edit that completed no Task).

Options:
  --memo-json <inline|@file>  the structured reflection (see SCHEMA below)
  --tag <text>                append a user tag ("put this in the memo");
                              promotes tier → flagged. Repeatable. Additive
                              across runs (deduped) — the after-the-fact channel.
  --fix-now                   set the fast-path flag (implies flagged)
  --tier <unremarkable|noted|flagged>  agent tier escalation (floor stays the
                              result-derived baseline; this can only raise it)
  --summary <text>            the skill's one-line Done: reply
  --kind <kind>               override the recorded kind (Task-less ops)

SCHEMA (--memo-json): every field optional.
  { "buckets": {
       "issues":       "...",   # Issues / ambiguities / errors
       "streamlining": "...",   # Streamlining / repetition
       "alignment":    "...",   # Alignment / fit
       "userTagged":   "..." }, # User-tagged (also promotes → flagged)
    "tier": "noted",            # agent escalation (raises the floor only)
    "fixNow": false,            # fast-path flag (implies flagged)
    "confidence": "low"|"med"|"high",  # low → flagged (low self-confidence, §3)
    "summary": "..." }          # one-line Done: reply

Env overrides (test seams; never set in prod):
  VIRGIL_DEV_MEMOS_DIR   memo root (default: <repo>/editor/dev/memos)
  VIRGIL_REFLECT_NOW     ISO timestamp for reflectedAt + the filename clock
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from _common import (
    atomic_write,
    dev_mode_enabled,
    die,
    memos_root as _shared_memos_root,
    read_json,
    resolve_doc,
    sidecar,
    source_repo_root,
)


# ---------------------------------------------------------------------------
# result → tier floor.  The contract already classified the outcome; we only
# map it to the reflection tier the dream phase reads first.  §3 of the design:
#   unremarkable  routine clean run — counted for stats, not read individually
#   noted         friction / non-obvious choice / a turned-down draft
#   flagged       read first — errors, low confidence, user-tagged, a near-miss
# ---------------------------------------------------------------------------

TIER_UNREMARKABLE = "unremarkable"
TIER_NOTED = "noted"
TIER_FLAGGED = "flagged"
TIER_ORDER = {TIER_UNREMARKABLE: 0, TIER_NOTED: 1, TIER_FLAGGED: 2}

# Keyed by the apply_response RESULT_* values (kept in sync with that module's
# ALL_RESULTS; the test slice pins every value maps here).
RESULT_TIER = {
    "accepted": TIER_UNREMARKABLE,       # L3 propose→accept worked
    "auto-applied": TIER_UNREMARKABLE,   # L2 apply+comment, clean
    "silent-applied": TIER_UNREMARKABLE, # L1 silent, clean (dream still audits)
    "direct-created": TIER_UNREMARKABLE, # user opted into a direct create
    "rejected": TIER_NOTED,              # the rejection corpus — read it
    "refused": TIER_NOTED,               # the refusal patterns — read it
    "impossible": TIER_NOTED,            # couldn't be done — read it
    "errored": TIER_FLAGGED,             # something broke — read first
}

BUCKET_TITLES = {
    "issues": "Issues / ambiguities / errors",
    "streamlining": "Streamlining / repetition",
    "alignment": "Alignment / fit",
    "userTagged": "User-tagged",
}
BUCKET_ORDER = ["issues", "streamlining", "alignment", "userTagged"]


def _max_tier(a: str, b: str) -> str:
    return a if TIER_ORDER.get(a, 0) >= TIER_ORDER.get(b, 0) else b


def _default_seed(result: str | None, status: str | None) -> dict[str, str]:
    """A canned bucket note for a signal-bearing outcome, used only when the
    agent left that bucket empty — so a terse reflect call on a rejected /
    refused / errored Task still produces a non-empty, dream-readable memo."""
    if result == "rejected":
        return {"alignment": "User rejected the drafted proposal (result: "
                "rejected) — what was drafted did not match what the user wanted."}
    if result == "refused":
        return {"issues": "Skill refused to act (result: refused) — record why "
                "the request fell outside what the skill will do."}
    if result == "impossible":
        return {"issues": "Skill reported the request impossible (result: "
                "impossible) — record the missing precondition."}
    if result == "errored":
        return {"issues": "Skill errored (result: errored) — investigate; an "
                "error reaching a terminal Task is high signal."}
    if result is None and status == "failed":
        return {"issues": "Task ended in status: failed with no classified "
                "result — record what went wrong."}
    return {}


# ---------------------------------------------------------------------------
# Time + paths
# ---------------------------------------------------------------------------


def _now_parts() -> tuple[str, str, str]:
    """(iso, YYYY-MM-DD, HH-MM-SS) from VIRGIL_REFLECT_NOW or the wall clock."""
    raw = os.environ.get("VIRGIL_REFLECT_NOW", "").strip()
    if raw:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = datetime.now(timezone.utc)
    dt = dt.astimezone(timezone.utc)
    iso = dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return iso, dt.strftime("%Y-%m-%d"), dt.strftime("%H-%M-%S")


def _memos_root() -> Path:
    # The one machine-global sink (shared with dream.py) — resolves the same
    # from a repo checkout OR a synced paper's .virgil/scripts/editor/ copy.
    return _shared_memos_root()


def _skill_sha(skill: str) -> str:
    """Best-effort `git rev-parse HEAD:editor/skills/<skill>.md`, short, against
    the Virgil SOURCE repo (resolved independently of `__file__`, so it still
    works when this script runs from a synced paper copy). Never fatal — a repo
    we can't find records 'unknown'; an uncommitted/unknown skill 'uncommitted'."""
    repo = source_repo_root()
    if repo is None:
        return "unknown"
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "--short",
             f"HEAD:editor/skills/{skill}.md"],
            capture_output=True, text=True, timeout=10,
        )
        sha = out.stdout.strip()
        return sha if out.returncode == 0 and sha else "uncommitted"
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Reading the Task (read-only; the contract already set status/result)
# ---------------------------------------------------------------------------


def _read_task(doc: Path, task_id: str) -> dict:
    """Resolve <taskId> to {found, kind, status, result, paragraphIds, safetyLevel,
    text, source}. Tolerant: "-" / not-found → a Task-less stub (result=None),
    so a mechanical op or a stale id still reflects (with a noted gap)."""
    blank = {"found": False, "kind": None, "status": None, "result": None,
             "paragraphIds": [], "safetyLevel": None, "text": "", "source": None}
    if task_id in ("-", "", "none", "None"):
        return {**blank, "source": "task-less"}

    # virtual:<panel>:<cardId> — a card-flag Task; never carries a result row.
    if task_id.startswith("virtual:"):
        return {**blank, "found": True, "source": "card-flag",
                "kind": task_id.split(":", 2)[1] if task_id.count(":") >= 2 else None}

    ar = read_json(sidecar(doc, "ai-requests.json"), default={"requests": []})
    if isinstance(ar, dict):
        for r in ar.get("requests", []) or []:
            if r.get("id") == task_id:
                return {
                    "found": True, "source": "ai-requests",
                    "kind": r.get("kind"), "status": r.get("status"),
                    "result": r.get("result"),
                    "paragraphIds": r.get("paragraphIds") or [],
                    "safetyLevel": r.get("safetyLevel"),
                    "text": r.get("text", ""),
                }

    br = read_json(sidecar(doc, "bib-review-requests.json"), default={"requests": []})
    if isinstance(br, dict):
        items = br.get("requests") or br.get("reviews") or []
        for r in items:
            if r.get("bibKey") == task_id or r.get("id") == task_id:
                # Bib reviews are status-only — no result field by design.
                return {**blank, "found": True, "source": "bib-review",
                        "kind": "bib-review", "status": r.get("status"),
                        "text": r.get("requestNotes") or r.get("note") or ""}

    return {**blank, "source": "not-found"}


# ---------------------------------------------------------------------------
# Memo (de)serialization — a tiny flat frontmatter, no YAML dep
# ---------------------------------------------------------------------------

FM_KEYS = ["skill", "taskId", "kind", "status", "result", "tier", "fixNow",
           "paragraphIds", "reflectedAt", "skillSha"]


def _parse_memo(text: str) -> tuple[dict, dict]:
    """(frontmatter, {bucketKey: body}) for an existing memo. Bucket bodies are
    matched back by their canonical title."""
    fm: dict = {}
    sections: dict = {}
    lines = text.split("\n")
    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            k, _, v = lines[i].partition(":")
            fm[k.strip()] = v.strip()
            i += 1
        i += 1  # skip closing ---
    title_to_key = {v: k for k, v in BUCKET_TITLES.items()}
    cur = None
    buf: list[str] = []
    for line in lines[i:]:
        if line.startswith("## "):
            if cur is not None:
                sections[cur] = "\n".join(buf).strip()
            cur = title_to_key.get(line[3:].strip())
            buf = []
        elif cur is not None:
            buf.append(line)
    if cur is not None:
        sections[cur] = "\n".join(buf).strip()
    return fm, sections


def _user_tag_bullets(body: str) -> list[str]:
    """Existing `- ` bullets in the User-tagged section, text only (for dedup)."""
    out = []
    for ln in (body or "").split("\n"):
        s = ln.strip()
        if s.startswith("- "):
            out.append(s[2:].strip())
    return out


def _find_existing(memos_root: Path, skill: str, task_id: str) -> Path | None:
    """The memo already written for this (skill, Task) pair, if any. Idempotency
    + after-the-fact tag promotion key on (skill, Task), NOT the time-stamped
    filename — so re-running the SAME skill updates its one memo, while a
    different skill on the same Task (the propose→accept lifecycle:
    draft-suggestion then accept-/reject-suggestion all share a taskId) gets its
    OWN memo and never clobbers the draft's reflection. Task-less ('-')
    reflections are never deduped — each gets a fresh file."""
    if task_id in ("-", "", "none", "None") or not memos_root.is_dir():
        return None
    for p in sorted(memos_root.rglob("*.md")):
        try:
            head = p.read_text(encoding="utf-8")[:2000]
        except OSError:
            continue
        fm, _ = _parse_memo(head)
        if fm.get("taskId") == task_id and fm.get("skill") == skill:
            return p
    return None


def _render_buckets(buckets: dict) -> list[str]:
    """The four canonical bucket sections, in BUCKET_ORDER, each headed by its
    BUCKET_TITLES title with `None.` for an empty body.

    The qualitative core of a dev-loop memo — shared verbatim between this
    module's `memos/` writer (reflect, the ambient capture stream) and
    `dev_loop`'s `iterations/` writer (iterate's synthesized stress-test
    stream), so the two streams render ONE bucket vocabulary by construction and
    `_parse_memo` reads both identically. The frontmatter differs per stream;
    the buckets do not."""
    out: list[str] = []
    for key in BUCKET_ORDER:
        out.append(f"## {BUCKET_TITLES[key]}")
        body = (buckets.get(key) or "").strip()
        out.append(body if body else "None.")
        out.append("")
    return out


def _render(fm: dict, buckets: dict) -> str:
    out = ["---"]
    for k in FM_KEYS:
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
    header_outcome = fm.get("result") or fm.get("status") or "no-outcome"
    out.append(f"# {fm.get('skill', '?')} — {header_outcome} ({fm.get('tier')})")
    out.append("")
    if fm.get("_summary"):
        out.append(f"**Done:** {fm['_summary']}")
        out.append("")
    out.append(f"**Outcome:** status={fm.get('status') or '—'}, "
               f"result={fm.get('result') or '—'} · source={fm.get('_source') or '—'}")
    out.append("")
    out.extend(_render_buckets(buckets))
    return "\n".join(out).rstrip() + "\n"


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="reflect.py")
    p.add_argument("doc")
    p.add_argument("skill")
    p.add_argument("taskId")
    p.add_argument("--memo-json", default=None)
    p.add_argument("--tag", action="append", default=[])
    p.add_argument("--fix-now", action="store_true")
    p.add_argument("--tier", choices=list(TIER_ORDER), default=None)
    p.add_argument("--summary", default=None)
    p.add_argument("--kind", default=None)
    return p.parse_args(argv)


def _load_memo_json(arg: str | None) -> dict:
    if not arg:
        return {}
    if arg.startswith("@"):
        path = Path(arg[1:]).expanduser()
        if not path.exists():
            die(f"--memo-json file not found: {path}")
        arg = path.read_text(encoding="utf-8")
    try:
        data = json.loads(arg)
    except json.JSONDecodeError as e:
        die(f"invalid --memo-json: {e}")
    if not isinstance(data, dict):
        die("--memo-json must be a JSON object")
    return data


def main(argv: list[str]) -> int:
    a = parse_args(argv)

    # The gate. OFF (the default) → write nothing, succeed. This is the whole
    # "never in an end-user session" guarantee: no VIRGIL_DEV, no memo.
    if not dev_mode_enabled():
        print("reflect: DEV mode off (VIRGIL_DEV unset) — no memo written.")
        return 0

    doc = resolve_doc(a.doc)
    memo = _load_memo_json(a.memo_json)
    in_buckets = memo.get("buckets") or {}
    if not isinstance(in_buckets, dict):
        die("memo.buckets must be an object")

    task = _read_task(doc, a.taskId)
    result = task["result"]
    status = task["status"]
    kind = a.kind or task["kind"]

    # ---- tier resolution: result floor, raised by agent/confidence/tags ----
    tier = RESULT_TIER.get(result or "", TIER_UNREMARKABLE)
    if result is None and status == "failed":
        tier = _max_tier(tier, TIER_NOTED)
    agent_tier = a.tier or memo.get("tier")
    if agent_tier in TIER_ORDER:
        tier = _max_tier(tier, agent_tier)
    if str(memo.get("confidence", "")).lower() == "low":
        tier = _max_tier(tier, TIER_FLAGGED)  # low self-confidence → flagged (§3)

    fix_now = bool(a.fix_now or memo.get("fixNow"))
    new_tags = [t.strip() for t in (a.tag or []) if t.strip()]
    json_user_tagged = (in_buckets.get("userTagged") or "").strip()
    if new_tags or json_user_tagged:
        tier = TIER_FLAGGED  # user-tagged is always flagged (§3)
    if fix_now:
        tier = TIER_FLAGGED  # fast-path is a flagged subcase

    # ---- merge with any existing memo for this Task (idempotent + additive tags)
    memos_root = _memos_root()
    existing_path = _find_existing(memos_root, a.skill, a.taskId)
    prior_fm, prior_buckets, prior_summary = ({}, {}, None)
    if existing_path is not None:
        prior_text = existing_path.read_text(encoding="utf-8")
        prior_fm, prior_buckets = _parse_memo(prior_text)
        m = re.search(r"^\*\*Done:\*\* (.+)$", prior_text, re.M)
        prior_summary = m.group(1).strip() if m else None
        if prior_fm.get("tier") in TIER_ORDER:
            tier = _max_tier(tier, prior_fm["tier"])
        if str(prior_fm.get("fixNow", "")).lower() == "true":
            fix_now = True

    # The three analytic buckets: this run's reflection wins; on a pure-tag run
    # (no buckets supplied) the prior bodies are preserved. Seed a canned note
    # for a signal-bearing outcome only where still empty.
    seed = _default_seed(result, status)
    buckets: dict = {}
    for key in ("issues", "streamlining", "alignment"):
        body = (in_buckets.get(key) or "").strip()
        if not body:
            body = (prior_buckets.get(key) or "").strip()
        if not body:
            body = seed.get(key, "")
        buckets[key] = body

    # User-tagged accumulates, deduped, order-preserving.
    tag_bullets: list[str] = _user_tag_bullets(prior_buckets.get("userTagged", ""))
    for t in ([json_user_tagged] if json_user_tagged else []) + new_tags:
        if t and t not in tag_bullets:
            tag_bullets.append(t)
    buckets["userTagged"] = "\n".join(f"- {t}" for t in tag_bullets)

    iso, date_str, time_str = _now_parts()
    fm = {
        "skill": a.skill,
        "taskId": a.taskId,
        "kind": kind or "—",
        "status": status or "—",
        "result": result or "",
        "tier": tier,
        "fixNow": fix_now,
        "paragraphIds": task["paragraphIds"],
        # Keep the first reflection's timestamp on re-runs (the memo is the
        # Task's, not this invocation's); record the skill sha fresh.
        "reflectedAt": prior_fm.get("reflectedAt") or iso,
        "skillSha": _skill_sha(a.skill),
        # render-only (not persisted as frontmatter keys)
        "_summary": a.summary or memo.get("summary") or prior_summary,
        "_source": task["source"],
    }

    target = existing_path or (memos_root / date_str / f"{time_str}-{a.skill}.md")
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write([(target, _render(fm, buckets))])

    rel = target
    try:
        rel = target.relative_to(memos_root)
    except ValueError:
        pass
    action = "updated" if existing_path is not None else "wrote"
    print(f"Done: reflected on {a.skill} for {a.taskId} "
          f"(tier={tier}{', fix-now' if fix_now else ''}). {action} {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
