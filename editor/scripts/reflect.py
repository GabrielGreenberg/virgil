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

Memos land at  <memo sink>/<YYYY-MM-DD>/<HH-MM-SS>-<skill>.md  — since task 521
the sink is normally the Dropbox-synced Virgil-Inbox/dev-loop/memos (so cowork on
a machine with no checkout still lands one), else <checkout>/editor/dev/memos —
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
  --memo-json <inline|@file>  the structured reflection (see SCHEMA below).
                              A supplied analytic bucket REPLACES that bucket's
                              prior body — it does NOT append. Only `userTagged`
                              (and `--tag`) accumulates. To add a late finding,
                              read the memo back and re-send the WHOLE bucket;
                              sending just the addition silently destroys what
                              was there (attested 2026-08-17, a dream appending
                              to its own memo — caught by a char count).
  --tag <text>                append a user tag ("put this in the memo");
                              promotes tier → flagged. Repeatable. Additive
                              across runs (deduped) — the after-the-fact channel.
                              "Additive" is true of TAGS, not of buckets.
  --fix-now                   set the fast-path flag (implies flagged)
  --tier <unremarkable|noted|flagged>  agent tier escalation (floor stays the
                              result-derived baseline; this can only raise it)
  --summary <text>            the skill's one-line Done: reply
  --kind <kind>               override the recorded kind (Task-less ops)

SCHEMA (--memo-json): every field optional. A supplied bucket REPLACES the
prior body; an omitted one is preserved (see --memo-json above).
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
  VIRGIL_DEV_MEMOS_DIR   memo root (default: the synced Virgil-Inbox/dev-loop/
                         memos, else <repo>/editor/dev/memos — _common.memos_root)
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
    DevHomeUnresolved,
    atomic_write,
    dev_mode_enabled,
    die,
    is_sync_conflict_name,
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

# The canonical rendering of an EMPTY bucket.  `_render_buckets` writes it, every
# reader must recognise it, and — the part that used to be missing — the tier
# resolver must treat it as empty too.  It was previously a magic string known to
# the writer here and re-typed as an inline literal in dream.py's reader, with
# nothing tying the two together: a memo that filled in the loop's own
# empty-bucket convention (`userTagged: "None."`) was read as a genuine user tag
# and HARD-set to tier=flagged, so contentless memos arrived as the next dream's
# top-priority "read these first" signal — across every skill, not just dream.
# One sentinel, one normalizer, shared by writer + reader + tier resolver.
EMPTY_BUCKET = "None."


def bucket_body(raw) -> str | None:
    """A bucket's real content, or None if it is empty — including the rendered
    `EMPTY_BUCKET` placeholder, which round-trips out of `_render_buckets` and
    must never be mistaken for content by whatever reads it back."""
    body = (raw or "").strip()
    if not body or body == EMPTY_BUCKET:
        return None
    return body


def _max_tier(a: str, b: str) -> str:
    return a if TIER_ORDER.get(a, 0) >= TIER_ORDER.get(b, 0) else b


# Skills whose terminal result *is* the user's executed decision, not a judgment
# on an artifact the skill authored. reject-suggestion completing with
# result=rejected is its SUCCESS path (it did the rejection the user asked for) —
# so it must not inherit the alignment-mismatch seed meant for the draft-* skill
# that authored the turned-down artifact. accept-suggestion is its sibling
# (result=accepted, an unremarkable tier that never reaches the rejected branch)
# and is listed to name the decision-executor class, not because it can trip it.
_DECISION_EXECUTOR_SKILLS = {"reject-suggestion", "accept-suggestion"}


def _default_seed(
    result: str | None, status: str | None, skill: str | None = None
) -> dict[str, str]:
    """A canned bucket note for a signal-bearing outcome, used only when the
    agent left that bucket empty — so a terse reflect call on a rejected /
    refused / errored Task still produces a non-empty, dream-readable memo."""
    if result == "rejected":
        if skill in _DECISION_EXECUTOR_SKILLS:
            # This skill EXECUTED the user's rejection — success, not a mismatch.
            # Seed nothing rather than a false "drafted didn't match" alignment
            # note that would pollute the dream's rejection-corpus lens.
            return {}
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
    # The one sink (shared with dream.py) — the synced inbox, else the
    # PRIMARY checkout (tasks 431, 521) —
    # resolves the same from a repo checkout, a worktree, OR a synced paper's
    # .virgil/scripts/editor/ copy (via VIRGIL_REPO_ROOT). Unresolvable is a
    # loud refusal, never a second default (task 431).
    try:
        return _shared_memos_root()
    except DevHomeUnresolved as e:
        die(str(e))
        raise  # unreachable; for the type checker


def _skill_sha(skill: str) -> str:
    """Best-effort `git rev-parse HEAD:editor/skills/<skill>.md` against the
    Virgil SOURCE repo (resolved independently of `__file__`, so it still works
    when this script runs from a synced paper copy). Returns the full blob hash
    sliced to 7 chars — NOT git `--short`, whose length floats with HEAD's
    disambiguation needs (8+ chars) and would then never string-equal the 7-char
    `_skill_working_sha`, silently defeating the equal-shas-are-clean signal the
    two are meant to support. Both slice the same object hash to the same width,
    so equal content compares equal. Never fatal — a repo we can't find records
    'unknown'; an uncommitted/unknown skill 'uncommitted'."""
    repo = source_repo_root()
    if repo is None:
        return "unknown"
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "rev-parse",
             f"HEAD:editor/skills/{skill}.md"],
            capture_output=True, text=True, timeout=10,
        )
        sha = out.stdout.strip()
        return sha[:7] if out.returncode == 0 and sha else "uncommitted"
    except Exception:
        return "unknown"


def _skill_working_sha(skill: str) -> str:
    """Content hash of the skill markdown AS IT EXISTS ON DISK in the source
    repo working tree (`git hash-object`, short), so a divergence from
    `_skill_sha`'s HEAD blob is itself the staleness signal: it means the copy
    on disk (and therefore the copy that could have been bundled/served) is not
    what HEAD attests. Equal shas → clean; differing shas → an uncommitted or
    stale local skill ran. Never fatal — same 'unknown'/'uncommitted' vocabulary
    as `_skill_sha` so the two are directly comparable in the corpus.

    NOTE: this hashes the source-repo working file, which is the closest truth
    reflect.py can compute locally. It does NOT reach into a built skill bundle;
    when the served prompt comes from a stale *bundle* (built off an older
    commit) both shas can still agree. That residual is a bundle-provenance
    problem tracked separately — see the digest escalation on build:skill-bundles."""
    repo = source_repo_root()
    if repo is None:
        return "unknown"
    try:
        out = subprocess.run(
            ["git", "-C", str(repo), "hash-object", "--",
             f"editor/skills/{skill}.md"],
            capture_output=True, text=True, timeout=10,
        )
        sha = out.stdout.strip()
        return sha[:7] if out.returncode == 0 and sha else "uncommitted"
    except Exception:
        return "unknown"


def _bundle_version(doc: Path | None = None) -> str:
    """The `version` stamp of the skill BUNDLE that was actually distributed to
    the paper this reflection ran under — the provenance of what REALLY ran,
    unified across every skill in one field. This closes the residual the
    `_skill_working_sha` docstring names: `skillSha`/`skillWorkingSha` compare
    the source repo against itself, so they cannot see that the SERVED prompt
    came from an older *bundle* (built off a past commit, then synced into the
    paper's `.virgil/`) — when that happens both shas still agree while a stale
    prompt runs. Reading the bundle's own `.skill-bundle-version.json` makes a
    stale-bundle run finally visible in the corpus. Resolution, most-specific
    first: the paper's `<doc>/.virgil/.skill-bundle-version.json`; else walk up
    from this file for a `.virgil/.skill-bundle-version.json` (the synced-copy
    case reflect.py runs from); else the source repo's
    `library-data/.virgil/.skill-bundle-version.json` (dev/SSOT runs). Never
    fatal — 'unknown' when no stamp is found."""
    candidates: list[Path] = []
    if doc is not None:
        candidates.append(Path(doc) / ".virgil" / ".skill-bundle-version.json")
    for parent in Path(__file__).resolve().parents:
        candidates.append(parent / ".virgil" / ".skill-bundle-version.json")
        candidates.append(parent / ".skill-bundle-version.json")
    repo = source_repo_root()
    if repo is not None:
        candidates.append(
            repo / "library-data" / ".virgil" / ".skill-bundle-version.json")
    for p in candidates:
        try:
            if p.is_file():
                v = str(json.loads(p.read_text()).get("version", "")).strip()
                if v:
                    return v
        except Exception:
            continue
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

FM_KEYS = ["skill", "taskId", "doc", "runs", "kind", "status", "result", "tier",
           "fixNow", "paragraphIds", "reflectedAt", "skillSha",
           "skillWorkingSha", "bundleVersion"]
# `doc` and `runs` are the task-less coalescing key's carriers (see
# `_find_existing`): `doc` is the identity term that must round-trip for the
# next lookup to match, `runs` the tally that keeps the frequency signal a
# collapsed burst would otherwise lose. `_render` skips a key absent from the
# dict, so a task-bearing memo simply carries no `runs` line.

# The keys BOTH dev-loop streams actually populate — the honest statement of the
# "ONE reader, ONE vocabulary" seam (chip 19). `FM_KEYS` is *this* stream's key
# list, and `dev_loop.ITER_FM_KEYS` opens with all of it so the two render in the
# same shape; but declaring a key is not filling it, and `_render` omits a key
# whose value the writer never supplied. Four keys are memos-only in practice:
# `skillWorkingSha`/`bundleVersion` (provenance of a SERVED prompt — an iterate
# run drives the working copy directly, so there is no served artifact to stamp)
# and `doc`/`runs` (the task-less coalescing key — iterate writes one memo per
# iteration into `iterations/`, keyed on case+attempt, and names its paper
# `sandbox`). A round-trip test that walks `FM_KEYS` therefore asserts something
# neither stream ever promised, and had been failing on the first two since they
# were added. Walk THIS list to check the shared vocabulary; walk `FM_KEYS` to
# check the declaration shape. The distinction is the missing notion, not the
# missing check — same shape as `EMPTY_BUCKET` above.
SHARED_FM_KEYS = [k for k in FM_KEYS
                  if k not in ("doc", "runs", "skillWorkingSha", "bundleVersion")]


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


def _is_task_less(task_id: str) -> bool:
    """The task-less sentinel set, in one place — `spawn_reflection` passes '-'
    for a writeback that answers no Task, and a hand-run reflect may pass any of
    the empty spellings."""
    return task_id in ("-", "", "none", "None")


def doc_key(doc: Path) -> str:
    """The paper a reflection is about, as a stable frontmatter value: the
    RESOLVED absolute path. The task-less dedup key's middle term (see
    `_find_existing`), so two papers worked on the same day never merge floors.

    The folder NAME is the tempting choice — the same paper is reached through
    different prefixes (a synced folder, a worktree checkout, a sample copy),
    and a path key splits one paper's day into two floors when it is. That was
    the first cut here, and the capture-slice test refuted it inside a minute:
    its `sandbox()` mints every paper as `<tmpdir>/paper`, so two genuinely
    different papers collided on the name and merged into one memo. Which is the
    same conflation this whole change exists to stop.

    So the two failure modes are not symmetric and the choice is not a toss-up.
    A path key over-splits: two floors for one paper, mild noise, every word
    still attributed to the paper that produced it. A name key over-merges: two
    papers' reflections in one memo, silently, with no way to tell them apart
    afterwards. Prefer the recoverable failure."""
    try:
        return str(doc.resolve())
    except OSError:
        return str(doc)


def _find_existing(memos_root: Path, skill: str, task_id: str,
                   doc: Path | None = None, date_str: str | None = None) -> Path | None:
    """The memo this reflection belongs to, if one already exists.

    TWO identity keys, because there are two kinds of reflection and only one of
    them has a Task:

    • **Task-bearing** → keyed on (skill, Task), NOT the time-stamped filename —
      so re-running the SAME skill updates its one memo, while a different skill
      on the same Task (the propose→accept lifecycle: draft-suggestion then
      accept-/reject-suggestion all share a taskId) gets its OWN memo and never
      clobbers the draft's reflection.

    • **Task-less** → keyed on (skill, doc, day). These used to be "never
      deduped — each gets a fresh file", and that was the single largest source
      of noise in the whole dev-loop. The tail-trigger fires one floor memo per
      writeback (`_common.spawn_reflection`) and promises the buckets will be
      "enriched later via the reflection convention" — but with no dedup key
      there is no file for a later reflection to FIND, so every task-less floor
      was contentless by construction and stayed that way. Measured on the night
      of 2026-08-09: 345 task-less memos in one 32-minute burst of mechanical
      card ops (edit-card ×104, link-cards ×81, archive-card ×66), of which
      exactly ONE carried content — and that one was written by hand with
      `--memo-json`, not by the trigger. The dream's top-priority triage stream
      was 99.8% files that could never say anything.

      Keying them on (skill, doc, day) makes the promise reachable: the burst
      collapses to one memo per skill per paper per day carrying `runs: N`, and
      an agent that later reflects on the same skill lands IN it. The aggregate
      fact those 104 files existed to record is a count, so a count is what it
      keeps — the frequency data survives at 1/104 the file count.

      And the noise was the *mild* half. "Never deduped" was not actually true:
      the mint path is `<HH-MM-SS>-<skill>.md`, so two task-less reflections for
      one skill in the SAME SECOND resolved to the same filename and the second
      one **overwrote** the first — a bare `atomic_write`, no merge, since the
      merge is gated on `existing_path` and that was hard-None here. So the only
      dedup task-less memos had was accidental, at one-second granularity, and
      its resolution was silent data loss. The victim is the case that matters
      most: an agent reflects with real content, does one more card op inside
      the same second, and the tail-trigger's contentless floor lands on top of
      its reflection and erases it. At the 68-memos-per-minute rate this burst
      actually ran at, that is not a hypothetical. A/B on identical input, six
      task-less writebacks: before → 2 files (four reflections destroyed);
      after → 1 file, `runs: 6`, content preserved. Keying the lookup turns an
      accidental clobber into an intentional merge, which is the same fix.

    The task-less lookup is also scoped to the day's directory rather than the
    whole sink, so it costs O(today) where the task-bearing scan is O(all memos
    ever) — a scan that is 38 ms at 689 memos and grows without bound, paid
    inside the 20 s subprocess that blocks every writeback before it prints its
    result. That residual is untouched here and stated in the digest.

    Since the sink became SYNCED (task 521) this scan also has to skip a sync
    daemon's CONFLICTED COPIES — `is_sync_conflict_name`, the same predicate
    the dream's corpus scan reads. Picking one here would land the enrichment
    in the orphaned copy and leave the real memo un-updated, which is the
    silent divergence between writer and reader this subsystem exists to
    prevent, arriving through the filesystem instead of through resolution."""
    if not memos_root.is_dir():
        return None
    if _is_task_less(task_id):
        # No Task to key on; (skill, doc, day) is the identity instead. Needs
        # both terms — a caller that supplies neither gets the old behaviour
        # (a fresh file) rather than a wrong merge.
        if doc is None or not date_str:
            return None
        day_dir = memos_root / date_str
        if not day_dir.is_dir():
            return None
        want = doc_key(doc)
        for p in sorted(day_dir.glob("*.md")):
            if is_sync_conflict_name(p.name):
                continue        # a daemon's rename, not a memo — see the door
            try:
                head = p.read_text(encoding="utf-8")[:2000]
            except OSError:
                continue
            fm, _ = _parse_memo(head)
            if (fm.get("skill") == skill and _is_task_less(str(fm.get("taskId", "")))
                    and fm.get("doc") == want):
                return p
        return None
    for p in sorted(memos_root.rglob("*.md")):
        if is_sync_conflict_name(p.name):
            continue            # a daemon's rename, not a memo — see the door
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
        out.append(bucket_body(buckets.get(key)) or EMPTY_BUCKET)
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
        print("reflect: DEV mode off (no VIRGIL_DEV, no <repo>/editor/dev/dev-mode marker) — no memo written.")
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
    json_user_tagged = bucket_body(in_buckets.get("userTagged")) or ""
    if new_tags or json_user_tagged:
        tier = TIER_FLAGGED  # user-tagged is always flagged (§3)
    if fix_now:
        tier = TIER_FLAGGED  # fast-path is a flagged subcase

    # ---- merge with any existing memo for this Task (idempotent + additive tags)
    # The clock is read BEFORE the lookup: the task-less key's third term is the
    # day, so `date_str` is an input to `_find_existing`, not just to the
    # filename it may end up minting.
    iso, date_str, time_str = _now_parts()
    memos_root = _memos_root()
    existing_path = _find_existing(memos_root, a.skill, a.taskId, doc, date_str)
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
    seed = _default_seed(result, status, a.skill)
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

    # A task-less memo is the day's floor for (skill, doc), so it counts the
    # writebacks that landed in it. Task-bearing memos are one-per-Task and
    # carry no count (re-running the same skill on one Task is an UPDATE of one
    # reflection, not two events).
    runs = None
    if _is_task_less(a.taskId):
        try:
            runs = int(str(prior_fm.get("runs", 0)) or 0) + 1
        except ValueError:
            runs = 1

    fm = {
        "skill": a.skill,
        "taskId": a.taskId,
        # The paper this reflection is about — the task-less dedup key's middle
        # term, so it must be persisted for the next lookup to match on it.
        "doc": doc_key(doc),
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
        # Companion to skillSha: hash of the on-disk working copy. skillSha ==
        # skillWorkingSha → clean; they differ → a stale/uncommitted skill ran.
        # (The HEAD blob sha and hash-object blob sha are the same object hash,
        # so equal values compare directly.)
        "skillWorkingSha": _skill_working_sha(a.skill),
        # Provenance of the BUNDLE that actually ran (see _bundle_version): the
        # one stamp that catches a stale served prompt even when both shas above
        # agree — the residual _skill_working_sha's docstring flags as open.
        "bundleVersion": _bundle_version(doc),
        # render-only (not persisted as frontmatter keys)
        "_summary": a.summary or memo.get("summary") or prior_summary,
        "_source": task["source"],
    }
    if runs is not None:
        fm["runs"] = runs

    target = existing_path or (memos_root / date_str / f"{time_str}-{a.skill}.md")
    if existing_path is None and target.exists():
        # Same second, same skill, DIFFERENT identity (a different taskId, or a
        # different doc on the task-less path) — minting here would silently
        # clobber the other memo. Disambiguate rather than overwrite.
        n = 2
        while (alt := target.with_name(f"{time_str}-{a.skill}-{n}.md")).exists():
            n += 1
        target = alt
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_write([(target, _render(fm, buckets))])

    rel = target
    try:
        rel = target.relative_to(memos_root)
    except ValueError:
        pass
    action = "updated" if existing_path is not None else "wrote"
    tally = f", run {runs}" if runs is not None and runs > 1 else ""
    print(f"Done: reflected on {a.skill} for {a.taskId} "
          f"(tier={tier}{', fix-now' if fix_now else ''}{tally}). {action} {rel}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
