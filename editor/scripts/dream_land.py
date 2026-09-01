#!/usr/bin/env python3
r"""Landing-mode classifier + the three-boundary guard for the dev-dream night.

This is the SHARED, low-risk seam the dream phase (/editor/dream, chip 18) and
the manual stress-test (/editor/iterate-virgil-editor, chip 11) can both stand
on — the genuinely-common mechanism extracted now, not a premature one-engine
rewrite. It answers two questions about a proposed change:

    classify_change(change) -> Verdict(mode, reason, boundary?, neverSelfMerge)
    task_route(finding)     -> { queue, status, priority, questionsRequired, ... }

    mode ∈ { "acts", "proposes", "refused" }

`mode` says how big and how risky the change is ("scoped, structural, or over a
boundary?").
`neverSelfMerge` is the SECOND, independent question asked of the same paths
("is this the loop's OWN rulebook?") — a change can be `proposes` because it is a
script and own-rulebook because it is THIS loop's script.  Both are answered here
so neither is re-derived by eye, and `task_route` reads the pair to decide
whether the night's task goes to the worker or to the human.

  • ACTS    — a single-skill-prompt change that does NOT touch a behavior
              contract: tighten wording, add a clarifying example, fix a typo,
              expand guidance.  The SMALL, scoped end of the scale.
  • PROPOSES — anything cross-skill, any .py script change, anything touching the
              manifest (docs/workspace/), any skill rename/merge/split, or any
              behavior-contract-adjacent change.  The STRUCTURAL end.
     Since task 522 neither mode is a landing INSTRUCTION any more — the dream
     files a task and the worker lands it, so the split says how big and how
     risky the edit is (which the digest records and which
     /editor/iterate-virgil-editor still honors by surfacing `proposes` for
     scrutiny), while WHICH QUEUE the task goes to is `task_route`'s separate
     answer below.
  • REFUSED — crosses one of the THREE load-bearing boundaries the loop CANNOT
              cross.  Logged in the digest as a refused item; never silently
              applied AND never proposed.

The three boundaries (design §4; editor/dev/README.md "Flagged for chip 18"):
  (B1) the architectural Don't-rules in editor/AGENTS.md  — and the DEV-mode
       reflection convention that lives in the same file (touching it would
       quietly unwire capture, a B3 cousin).
  (B2) the apply_response.py contract SHAPE — its subcommands, the
       RESULT_*/STATUS_* vocabulary, and the op-json schema.
  (B3) DEV mode itself — the VIRGIL_DEV gate / _common.dev_mode_enabled and its
       enforcement in reflect.py / dream.py.

The guard enforces these BY CONSTRUCTION (precedence: REFUSED > PROPOSES >
ACTS), not by convention: a boundary-sensitive file is adjudicated from the
change's actual content, and a boundary-file touch with no content to adjudicate
is refused (you cannot prove a blind edit safe).

Pure + dry-run-safe: this module NEVER writes a file, runs git, or applies an
edit.  It classifies; the caller (the dream skill) does the landing.  That is
why iterate can later adopt it unchanged — it shares the *decision*, not a
write path.

CLI (for the skill and the test slice):
  dream_land.py --change '<inline-json>'      # classify one change → JSON verdict
  dream_land.py --change @path/to/change.json
  dream_land.py --route '<inline-json>'       # a finding → its QUEUE routing
  dream_land.py --route @path/to/finding.json
        # → { "queue": "incoming"|"blocked", "status", "priority",
        #     "questionsRequired": bool, "reason", … }
        #   The whole operation the dream asks per finding.  The old
        #   `--self-merge-check` door asked half of it about a BRANCH; the dream
        #   has no branch since task 522, and the never-self-merge question now
        #   lives inside this answer.
A change object (every field but `paths` optional):
  { "summary": "tighten the anchor-lookup wording in draft-footnote",
    "paths": ["editor/skills/draft-footnote.md"],
    "intent": "tighten-wording",            # see INTENTS below
    "oldText": "<text being replaced>",     # for boundary adjudication
    "newText": "<replacement text>",
    "memoRefs": ["2026-06-06/12-00-00-draft-footnote.md"] }
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass, field

# Landing modes ---------------------------------------------------------------
LAND_ACTS = "acts"
LAND_PROPOSES = "proposes"
LAND_REFUSED = "refused"

# Boundary ids (stable strings the digest records) ----------------------------
B_AGENTS_DONT = "B1:agents-dont-rules"
B_CONTRACT_SHAPE = "B2:apply_response-contract-shape"
B_DEV_GATE = "B3:dev-mode-gate"

# Dev-loop procedure skills — the self-improvement machinery itself -----------
# An edit to one of these skill prompts REWRITES how the loop operates, so it is
# never an unattended ACTS even for a prose-polish intent: a dream/iterate run
# editing its own operating procedure must surface that self-modification for
# human review (→ PROPOSES).  This is the softer sibling of the three boundaries
# below — those REFUSE outright; this only WITHHOLDS the acts fast-lane.  The
# loop MUST be able to improve at looping (dream.md step 8's recursion), but only
# on a reviewed branch, never committed unattended to the acts-branch.  Retires
# the "should the dream editing dream.md always propose?" ruling flagged in the
# 2026-07-22 self-reflection, generalized to the whole self-improvement triad.
DEV_LOOP_SKILLS = {
    "editor/skills/dream.md",
    "editor/skills/reflect.md",
    "editor/skills/iterate-virgil-editor.md",
}

# Dev-loop procedure SCRIPTS — the same operating procedure, in script form ---
# `dream.py`/`reflect.py` decide what the loop READS and WRITES, `dream_land.py`
# IS this classifier, and `dev_loop.py` is the shared read→derive→route spine: a
# run editing one of them rewrites how the loop operates just as surely as an
# edit to the three markdowns above.  Deliberately a SECOND set rather than four
# more members of DEV_LOOP_SKILLS, because the two sets answer two different
# questions and only one of them had a gap (Gabriel's ruling, 2026-08-18):
#
#   • DEV_LOOP_SKILLS withholds the ACTS fast lane.  Every `.py` is ALREADY
#     withheld from acts by the non-skill-prompt rule (classify_change step 4),
#     so adding the scripts there would buy nothing — and would misstate what
#     the set means (its members are skill PROMPTS; `_skill_name` assumes it).
#   • DEV_LOOP_PROCEDURE answers the NEVER-SELF-MERGE question (dream.md §6):
#     may this branch merge unattended on green gates, or must it route to the
#     human?  That clause was keyed on the three markdowns alone, so the
#     2026-08-18 dream's edit to `dream.py`'s marker semantics — the file that
#     decides what the NEXT dream is allowed to read, i.e. the loop's memory —
#     reached `proposes` only incidentally (it is a `.py` at all) and never
#     fired the clause.
#
# The union is DERIVED, never re-listed: a fifth procedure file joins ONE set
# and both readers follow.
DEV_LOOP_SCRIPTS = {
    "editor/scripts/dream.py",
    "editor/scripts/reflect.py",
    "editor/scripts/dream_land.py",
    "editor/scripts/dev_loop.py",
}

DEV_LOOP_PROCEDURE = DEV_LOOP_SKILLS | DEV_LOOP_SCRIPTS

# Repo-relative boundary-sensitive paths --------------------------------------
AGENTS_MD = "editor/AGENTS.md"
APPLY_RESPONSE = "editor/scripts/apply_response.py"
COMMON_PY = "editor/scripts/_common.py"
REFLECT_PY = "editor/scripts/reflect.py"
DREAM_PY = "editor/scripts/dream.py"
# Files whose every edit is adjudicated against the DEV gate (B3): the gate's
# definition (_common) and its two enforcers (reflect/dream).
DEV_GATE_FILES = {COMMON_PY, REFLECT_PY, DREAM_PY}

# Intents -------------------------------------------------------------------
# Prose-polish intents are ACTS-eligible (a single skill prompt, no contract
# change).  Structural intents always force PROPOSES.  An unrecognized/omitted
# intent on a lone skill prompt falls through to PROPOSES (the safe default —
# ACTS is the privileged fast lane and must be asked for explicitly).
PROSE_INTENTS = {
    "tighten-wording", "add-example", "fix-typo", "expand-guidance", "clarify",
}
STRUCTURAL_INTENTS = {
    "cross-skill", "script-change", "manifest-change", "rename", "merge-skill",
    "split-skill", "contract-change", "new-helper", "behavior-change",
}

# Boundary signatures (lowercased substrings) ---------------------------------
# B1 — phrases unique to AGENTS.md's "## Don't" section + the DEV convention.
_DONT_SIGNS = [
    "## don't",
    "only**\n  writeback path", "only writeback path", "only** writeback path",
    "don't hand-edit a", "don't add a backend",
    "the apply_response.py contract is the",
]
_DEV_CONVENTION_SIGNS = [
    "reflection (dev mode)", "reflect after completing", "the one shared seam",
    "one convention, not a", "in dev mode, reflect",
]
# B2 — the apply_response contract shape: vocab + subcommands + op-json keys.
_CONTRACT_SHAPE_SIGNS = [
    "subcommands", "all_results", "fail_results", "result_", "status_",
    "safety_level_subcommand", "mutation_ops",
    "texedit", "bibedit", "renamecitekey", "settingsedit", "annotationedit",
    "complete-task", "write-silent", "write-with-comment", "complete-only",
]
# B3 — the gate's identifiers, plus explicit "turn it off" phrasings that could
# appear in a skill prompt anywhere (not just the gate files). The bare env
# name is matched as a TOKEN via _gate_token, not listed here as a substring:
# the sink/home seams share its prefix (VIRGIL_DEV_MEMOS_DIR, VIRGIL_DEV_HOME,
# VIRGIL_DEV_ITERATIONS_DIR) and are NOT the gate — a memo-sink fix must not
# read as a gate edit (the 2026-08-15 false positive this distinction retires;
# the guard refused the throwaway-paper fix on the substring alone).
_DEV_GATE_SIGNS = [
    "dev_mode_enabled", "dev_mode_env", "_dev_true_tokens",
]
_GATE_TOKEN_RE = re.compile(r"virgil_dev(?![a-z0-9_])")


def _gate_token(haystack: str) -> str | None:
    """The VIRGIL_DEV gate env named as a complete token (lowercased input)."""
    return "virgil_dev" if _GATE_TOKEN_RE.search(haystack) else None
_DISABLE_GATE_PHRASES = [
    "disable dev mode", "disable virgil_dev", "remove the dev gate",
    "remove the dev-mode gate", "skip the dev gate", "skip the dev-mode gate",
    "ungate reflect", "reflect regardless of dev", "always reflect regardless",
    "bypass the dev gate", "without the dev gate",
]
# Contract-USAGE tokens — a skill prompt that changes *which* contract verb /
# safety level it drives is behavior-contract-adjacent → PROPOSES (not ACTS),
# even though it lives in a single skill .md.  (Distinct from B2, which is the
# contract *definition* in apply_response.py.)
_CONTRACT_USAGE_SIGNS = [
    "safetylevel", "safety level", "safety-level", "--propose",
    "write-silent", "write-with-comment", "complete-task", "complete-only",
    "apply_response", "op-json", "subcommand", "renamecitekey", "bibedit",
    "texedit", "settingsedit", "annotationedit",
]


@dataclass
class Verdict:
    mode: str                    # acts | proposes | refused
    reason: str                  # one line, for the digest
    boundary: str | None = None  # set iff mode == refused
    paths: list[str] = field(default_factory=list)
    # dream.md §6's never-self-merge answer, PUBLISHED on every verdict — so the
    # skill READS A FLAG instead of re-deriving the membership by eye (the rule
    # `dream.py select`'s `driftChecked` already follows).  Stamped centrally in
    # `classify_change`, so no routing branch can forget it, and independent of
    # `mode`: a dev-loop-procedure change is `proposes` for one reason (it is a
    # script / a loop skill) and unmergeable-unattended for another.
    never_self_merge: bool = False
    procedure_paths: list[str] = field(default_factory=list)

    def to_json(self) -> dict:
        d = asdict(self)
        # camelCase on the wire, matching the loop's other JSON seams.
        d["neverSelfMerge"] = d.pop("never_self_merge")
        d["procedurePaths"] = d.pop("procedure_paths")
        return d


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _norm_path(p: str) -> str:
    return str(p).strip().lstrip("./")


def _norm_paths(change: dict) -> list[str]:
    raw = change.get("paths") or ([change["path"]] if change.get("path") else [])
    out: list[str] = []
    for p in raw:
        s = _norm_path(p)
        if s and s not in out:
            out.append(s)
    return out


def dev_loop_procedure_paths(paths) -> list[str]:
    """The DEV_LOOP_PROCEDURE members among `paths` (normalized, sorted).

    The whole operation, not a piece: "does this touch the loop's own operating
    procedure?" has ONE answer and every reader takes it from here — the verdict
    stamp below, and through it `task_route`, which turns the answer into a
    BLOCKED task.  A caller that re-listed the membership would be the hand list
    this set exists to retire."""
    touched = {_norm_path(p) for p in (paths or [])}
    return sorted(touched & DEV_LOOP_PROCEDURE)


def self_merge_check(paths) -> dict:
    """The own-rulebook question, answered for a set of paths.

    Kept (with its CLI door retired — task 522) because `task_route` reads it:
    the membership question still has exactly one implementation, and the reason
    string is what a blocked task quotes back to the human."""
    procedure = dev_loop_procedure_paths(paths)
    if procedure:
        reason = (f"touches the dev-loop's own operating procedure "
                  f"({', '.join(procedure)}) — the human reviews the loop's own "
                  f"rulebook, so this is a BLOCKED task with questions, never a "
                  f"work task the worker lands")
    else:
        reason = ("touches no dev-loop procedure file — an ordinary work task "
                  "for the worker")
    return {"neverSelfMerge": bool(procedure),
            "procedurePaths": procedure,
            "reason": reason}


def _content(change: dict) -> str:
    """Combined lowercased old+new edit text for signature scanning."""
    return ((change.get("oldText") or "") + "\n" + (change.get("newText") or "")).lower()


def _has_content(change: dict) -> bool:
    return bool((change.get("oldText") or "").strip() or (change.get("newText") or "").strip())


def _hits(haystack: str, needles: list[str]) -> str | None:
    for n in needles:
        if n in haystack:
            return n
    return None


def _is_skill_md(path: str) -> bool:
    return path.startswith("editor/skills/") and path.endswith(".md")


def _skill_name(path: str) -> str:
    return path[len("editor/skills/"):-len(".md")] if _is_skill_md(path) else path


def _is_manifest(path: str) -> bool:
    return path.startswith("docs/workspace/")


# ---------------------------------------------------------------------------
# The boundary guard (highest precedence — runs before any routing)
# ---------------------------------------------------------------------------


def boundary_for(change: dict) -> Verdict | None:
    """Return a REFUSED Verdict iff `change` crosses one of the three
    boundaries, else None.  A boundary-sensitive *file* with no edit content to
    adjudicate is refused — a blind edit cannot be proven safe (safe by
    construction)."""
    paths = _norm_paths(change)
    content = _content(change)
    has_content = _has_content(change)

    for p in paths:
        # B1 — AGENTS.md Don't-rules + the DEV-reflection convention.
        if p == AGENTS_MD:
            if not has_content:
                return Verdict(LAND_REFUSED,
                               "edit to editor/AGENTS.md without content to "
                               "adjudicate — refused by construction (it carries "
                               "the architectural Don't-rules + the DEV convention)",
                               boundary=B_AGENTS_DONT, paths=paths)
            sig = _hits(content, _DONT_SIGNS)
            if sig:
                return Verdict(LAND_REFUSED,
                               f"would edit the architectural Don't-rules in "
                               f"editor/AGENTS.md (matched {sig!r})",
                               boundary=B_AGENTS_DONT, paths=paths)
            sig = _hits(content, _DEV_CONVENTION_SIGNS)
            if sig:
                return Verdict(LAND_REFUSED,
                               f"would alter the DEV-mode reflection convention in "
                               f"editor/AGENTS.md (matched {sig!r}) — that unwires "
                               f"capture",
                               boundary=B_DEV_GATE, paths=paths)

        # B2 — apply_response.py contract shape.
        if p == APPLY_RESPONSE:
            if not has_content:
                return Verdict(LAND_REFUSED,
                               "edit to apply_response.py without content to "
                               "adjudicate — refused by construction (it defines "
                               "the contract shape)",
                               boundary=B_CONTRACT_SHAPE, paths=paths)
            sig = _hits(content, _CONTRACT_SHAPE_SIGNS)
            if sig:
                return Verdict(LAND_REFUSED,
                               f"would change the apply_response.py contract shape "
                               f"(matched {sig!r}: subcommands / RESULT_*/STATUS_* "
                               f"vocab / op schema)",
                               boundary=B_CONTRACT_SHAPE, paths=paths)

        # B3 — the DEV gate definition + its enforcers.
        if p in DEV_GATE_FILES:
            if not has_content:
                return Verdict(LAND_REFUSED,
                               f"edit to {p} without content to adjudicate — "
                               f"refused by construction (it defines or enforces "
                               f"the VIRGIL_DEV gate)",
                               boundary=B_DEV_GATE, paths=paths)
            sig = _hits(content, _DEV_GATE_SIGNS) or _gate_token(content)
            if sig:
                return Verdict(LAND_REFUSED,
                               f"would touch the VIRGIL_DEV gate in {p} "
                               f"(matched {sig!r})",
                               boundary=B_DEV_GATE, paths=paths)

    # B3 (global) — an explicit "turn the gate off" phrasing from ANY file
    # (e.g. a skill prompt trying to ungate reflection).
    sig = _hits(content, _DISABLE_GATE_PHRASES)
    if sig:
        return Verdict(LAND_REFUSED,
                       f"would disable DEV mode (matched {sig!r})",
                       boundary=B_DEV_GATE, paths=paths)

    return None


# ---------------------------------------------------------------------------
# The classifier
# ---------------------------------------------------------------------------


def classify_change(change: dict) -> Verdict:
    """Route one proposed change → acts | proposes | refused, and stamp the
    never-self-merge answer onto whatever verdict comes back.

    `change` keys (only `paths` required):
      paths      list[str]  repo-relative files the change would touch
      intent     str        one of PROSE_INTENTS / STRUCTURAL_INTENTS (or omit)
      oldText    str        the text being replaced (for boundary adjudication)
      newText    str        the replacement text
      summary    str        one-line human description (carried to the digest)

    The stamp is applied HERE rather than inside each routing branch, so the
    flag is a property of the classifier and not of the branch that happened to
    fire — the same reason the boundary guard runs before the routing at all.
    """
    verdict = _route_change(change)
    verdict.procedure_paths = dev_loop_procedure_paths(verdict.paths or _norm_paths(change))
    verdict.never_self_merge = bool(verdict.procedure_paths)
    return verdict


def _route_change(change: dict) -> Verdict:
    """The routing itself (see `classify_change`)."""
    paths = _norm_paths(change)
    if not paths:
        return Verdict(LAND_REFUSED, "change names no paths — nothing to classify",
                       boundary=None, paths=[])

    # 1) Boundary guard — highest precedence.
    refused = boundary_for(change)
    if refused is not None:
        return refused

    # 2) Self-modification guard — a dev-loop procedure skill editing ITSELF
    #    (the dream/reflect/iterate triad) always proposes, regardless of
    #    intent.  Rewriting the self-improvement machinery unattended is
    #    behavior-change to the loop; withhold the acts fast-lane and surface it
    #    for human review.  (Boundaries above still win — a self-mod that also
    #    crosses B1/B2/B3 is already refused before we get here.)
    loop_self = [p for p in paths if p in DEV_LOOP_SKILLS]
    if loop_self:
        names = ", ".join(sorted(_skill_name(p) for p in loop_self))
        return Verdict(LAND_PROPOSES,
                       f"self-modification of the dev-loop procedure skill(s) "
                       f"{names} — rewrites the loop's own operating procedure, "
                       f"so human-reviewed, never an unattended acts",
                       paths=paths)

    intent = (change.get("intent") or "").strip().lower()
    content = _content(change)

    # 3) Structural intent → always propose.
    if intent in STRUCTURAL_INTENTS:
        return Verdict(LAND_PROPOSES, f"structural change (intent: {intent})", paths=paths)

    # 4) Any non-skill-prompt path → propose (scripts, manifest, AGENTS.md prose,
    #    build files, …): only a lone skill .md is ACTS-eligible.
    non_skill = [p for p in paths if not _is_skill_md(p)]
    if non_skill:
        if any(p.endswith(".py") for p in non_skill):
            why = "touches a .py script"
        elif any(_is_manifest(p) for p in non_skill):
            why = "touches the manifest (docs/workspace/)"
        else:
            why = f"touches non-skill-prompt file(s): {', '.join(non_skill)}"
        return Verdict(LAND_PROPOSES, why, paths=paths)

    # 5) Cross-skill (≥2 distinct skill prompts) → propose.
    skills = sorted({_skill_name(p) for p in paths})
    if len(skills) > 1:
        return Verdict(LAND_PROPOSES, f"cross-skill change ({', '.join(skills)})", paths=paths)

    # 6) Behavior-contract-adjacent content in a single skill prompt → propose.
    sig = _hits(content, _CONTRACT_USAGE_SIGNS)
    if sig:
        return Verdict(LAND_PROPOSES,
                       f"behavior-contract-adjacent (skill prompt touches {sig!r})",
                       paths=paths)

    # 7) A single skill prompt with an explicit prose-polish intent → ACTS.
    if intent in PROSE_INTENTS:
        return Verdict(LAND_ACTS,
                       f"single skill-prompt polish ({intent}) in {skills[0]}.md",
                       paths=paths)

    # 8) Single skill prompt but the intent isn't a declared prose-polish one →
    #    propose (the safe default; don't act on an unspecified change).
    return Verdict(LAND_PROPOSES,
                   f"unspecified intent ({intent or 'none'}) on {skills[0]}.md — "
                   f"propose for review",
                   paths=paths)


# ---------------------------------------------------------------------------
# Where does this finding's TASK go?  (task 522)
# ---------------------------------------------------------------------------
# The dream LANDS nothing.  Every actionable output is a task file, so the one
# question a night actually has to answer per finding is WHICH QUEUE — `incoming/`
# (the worker executes it) or `blocked/` (the catcher surfaces it to the human).
# `classify_change` answers a DIFFERENT question and keeps answering it: how big
# and how risky is this edit (`acts` / `proposes` / `refused`).  That verdict is a
# PIECE; `task_route` is the whole operation the dream asks, so a night can never
# get the two half-right by asking one and forgetting the other.

ROUTE_CHANGE = "change"
ROUTE_GATE = "gate-failure"

QUEUE_INCOMING = "incoming"
QUEUE_BLOCKED = "blocked"

PRIORITY_NORMAL = "normal"
PRIORITY_HIGH = "high"


def _route(queue: str, priority: str, reason: str, **extra) -> dict:
    return {"queue": queue,
            "status": "ready" if queue == QUEUE_INCOMING else "blocked",
            "priority": priority,
            "questionsRequired": queue == QUEUE_BLOCKED,
            "reason": reason,
            **extra}


def task_route(finding: dict) -> dict:
    """Route ONE night's finding to a queue — the dream's only landing decision.

    `finding` keys:
      kind     "change" (default) | "gate-failure"
      change   the change object `classify_change` takes   (kind="change")
      fixNow   bool — the maintainer flagged it fix-now     (kind="change")
      commit   str  — the commit the redness is ATTRIBUTED to (kind="gate-failure")

    The rules, and why each is here rather than in the skill's prose:

    * a **boundary refusal** (B1/B2/B3) is a ruling owed, so it is BLOCKED with
      questions.  Pre-522 a refusal was "recorded, not acted" — recorded in a
      digest, which is write-only.  Filing it is the whole point of the merge: a
      refusal the human never reads is a refusal that decides by default.
    * an **own-rulebook** change (`neverSelfMerge` — the loop's own procedure
      files) is BLOCKED.  This is what the never-self-merge guard becomes once
      the dream merges nothing: the question stops being "may this land
      unattended?" and becomes "who reviews it?", and the answer is the same
      human it always was.
    * everything else is a READY work task; `fixNow` raises it to high.  The
      `acts`/`proposes` split survives on the verdict (the digest records it, and
      iterate still honors it) and buys no routing difference here, because the
      worker lands both kinds of diff with the same discipline — which is the
      distinction this merge dissolves.
    * a **red gate** is a work task about the TREE, never a self-modification
      proposal, so it routes to `incoming/` at high priority however deep in the
      loop's own scripts the break happens to sit: the dream is not authoring
      that repair, it is reporting a broken tree, and the worker lands it under
      its own safety.  BUT an UNATTRIBUTED red gate is blocked instead — filing
      one as a work task points a worker at a diff nobody has separated from the
      tree's own state, which is the measured 2026-08-25 defect (a markdown edit
      filed as the suspect for two guards a commit two hours older had broken).
      Attribution is the price of a work task; without it the honest artifact is
      a question."""
    kind = (finding.get("kind") or ROUTE_CHANGE).strip().lower()

    if kind == ROUTE_GATE:
        commit = (finding.get("commit") or "").strip()
        if not commit:
            return _route(QUEUE_BLOCKED, PRIORITY_HIGH,
                          "a red gate with no attributed commit is evidence about "
                          "the TREE that nobody has separated from your own night's "
                          "work — file the question, never a work task pointing a "
                          "worker at an unseparated diff",
                          kind=ROUTE_GATE, commit="")
        return _route(QUEUE_INCOMING, PRIORITY_HIGH,
                      f"red gate attributed to {commit} — a work task about the "
                      f"tree, which the worker lands under its own safety",
                      kind=ROUTE_GATE, commit=commit)

    if kind != ROUTE_CHANGE:
        return _route(QUEUE_BLOCKED, PRIORITY_NORMAL,
                      f"unrecognized finding kind {kind!r} — a shape this door does "
                      f"not understand is a question, never a silent work task",
                      kind=kind)

    verdict = classify_change(finding.get("change") or {})
    stamp = {"kind": ROUTE_CHANGE,
             "mode": verdict.mode,
             "boundary": verdict.boundary,
             "neverSelfMerge": verdict.never_self_merge,
             "procedurePaths": verdict.procedure_paths}

    if verdict.mode == LAND_REFUSED:
        return _route(QUEUE_BLOCKED, PRIORITY_NORMAL,
                      f"boundary refusal ({verdict.boundary}) — a ruling owed: "
                      f"{verdict.reason}", **stamp)
    if verdict.never_self_merge:
        return _route(QUEUE_BLOCKED, PRIORITY_NORMAL,
                      f"touches the loop's own operating procedure "
                      f"({', '.join(verdict.procedure_paths)}) — the human reviews "
                      f"the loop's rulebook, however green the gates",
                      **stamp)

    return _route(QUEUE_INCOMING,
                  PRIORITY_HIGH if finding.get("fixNow") else PRIORITY_NORMAL,
                  f"ordinary work ({verdict.mode}: {verdict.reason})", **stamp)



# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _load_change(arg: str) -> dict:
    if arg.startswith("@"):
        from pathlib import Path
        p = Path(arg[1:]).expanduser()
        if not p.exists():
            print(f"error: --change file not found: {p}", file=sys.stderr)
            sys.exit(2)
        arg = p.read_text(encoding="utf-8")
    try:
        data = json.loads(arg)
    except json.JSONDecodeError as e:
        print(f"error: invalid --change JSON: {e}", file=sys.stderr)
        sys.exit(2)
    if not isinstance(data, dict):
        print("error: --change must be a JSON object", file=sys.stderr)
        sys.exit(2)
    return data


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="dream_land.py", description=__doc__)
    p.add_argument("--change",
                   help="a change object as inline JSON or @file → a verdict")
    # `--self-merge-check` (a BRANCH's touched paths → may it merge unattended?)
    # is retired with task 522: the dream merges nothing, so there is no branch
    # to ask about and the question survives INSIDE `--route`, which answers it
    # as part of the whole operation. `self_merge_check` itself stays — it is
    # what `task_route` reads, so the membership question still has exactly one
    # implementation.
    p.add_argument("--route",
                   help="a finding object as inline JSON or @file → the QUEUE "
                        "routing (incoming/ ready vs blocked/ with questions)")
    a = p.parse_args(argv)

    if a.route:
        if a.change:
            print("error: --change and --route are separate doors",
                  file=sys.stderr)
            return 2
        print(json.dumps(task_route(_load_change(a.route)), indent=2))
        return 0

    if not a.change:
        p.error("one of --change or --route is required")
    verdict = classify_change(_load_change(a.change))
    print(json.dumps(verdict.to_json(), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
