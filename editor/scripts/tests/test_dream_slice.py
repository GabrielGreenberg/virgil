#!/usr/bin/env python3
r"""Dream-slice test for the dev-dream night half — /editor/dream (chip 18).

Two layers, matching the two scripts:

  • dream_land.classify_change — imported directly (pure, dry-run-safe): the
    acts-vs-proposes ROUTING by scope + the three-BOUNDARY-REFUSAL guard.
  • dream.py select / digest — driven as the real CLI against fixture memos
    written by reflect.py, with the memo root / digest root / clock pinned to
    temp dirs via the VIRGIL_DEV_MEMOS_DIR / VIRGIL_DREAM_DIGESTS_DIR /
    VIRGIL_DREAM_NOW seams (never mutating samples/annotation-history).

Asserts the chip-18 surface:
  (a) routing by scope: single-skill prose → acts; cross-skill / .py / manifest
      / rename / contract-adjacent / unspecified → proposes
  (b) boundary-refusal for each of the three (AGENTS.md Don't-rules / contract
      shape / DEV gate), incl. the no-content + global-disable variants
  (c) the flagged+fix-now fast-path (selected first, on the fix-now list)
  (d) the since-last-dream selector (already-digested memos skipped)
  (e) the digest with ACTED + PROPOSED + REFUSED entries + the next marker
  (f) the bootstrap recursion (a skill=dream memo the next dream reads)
  + the DEV gate (off → no-op) and the contract-vocab sync invariant.

Run from anywhere:  python3 editor/scripts/tests/test_dream_slice.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# repo root = tests/ → scripts/ → editor/ → <root>
ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
REFLECT = str(SCRIPTS / "reflect.py")
DREAM = str(SCRIPTS / "dream.py")
DREAM_LAND = str(SCRIPTS / "dream_land.py")

sys.path.insert(0, str(SCRIPTS))
from dream_land import (  # noqa: E402
    LAND_ACTS, LAND_PROPOSES, LAND_REFUSED,
    B_AGENTS_DONT, B_CONTRACT_SHAPE, B_DEV_GATE,
    DEV_LOOP_SKILLS, DEV_LOOP_SCRIPTS, DEV_LOOP_PROCEDURE,
    classify_change, dev_loop_procedure_paths, self_merge_check,
)
from apply_response import ALL_RESULTS  # noqa: E402
from reflect import RESULT_TIER  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def verdict(change):
    return classify_change(change)


# ── (a) routing by scope ─────────────────────────────────────────────────────
print("\n=== (a) acts-vs-proposes routing by scope ===")

v = verdict({"paths": ["editor/skills/draft-footnote.md"], "intent": "tighten-wording",
             "oldText": "add a footnote", "newText": "add a clarifying footnote"})
check(v.mode == LAND_ACTS, f"single skill-prompt prose-polish → acts (got {v.mode})")
check(v.boundary is None, "acts verdict carries no boundary")

for intent in ("add-example", "fix-typo", "expand-guidance", "clarify"):
    v = verdict({"paths": ["editor/skills/answer-note-request.md"], "intent": intent,
                 "newText": "a harmless clarification"})
    check(v.mode == LAND_ACTS, f"single skill-prompt {intent} → acts")

v = verdict({"paths": ["editor/skills/draft-footnote.md", "editor/skills/find-citation.md"],
             "intent": "tighten-wording", "newText": "shared wording"})
check(v.mode == LAND_PROPOSES, f"cross-skill (2 prompts) → proposes (got {v.mode})")

v = verdict({"paths": ["editor/scripts/card_by_id.py"], "intent": "script-change"})
check(v.mode == LAND_PROPOSES, ".py script change → proposes")

v = verdict({"paths": ["docs/workspace/anchoring.md"], "intent": "clarify",
             "newText": "manifest tweak"})
check(v.mode == LAND_PROPOSES, "manifest (docs/workspace/) change → proposes")

v = verdict({"paths": ["editor/skills/review.md"], "intent": "rename"})
check(v.mode == LAND_PROPOSES, "rename intent → proposes (even on one skill)")

# contract-adjacent content in a lone skill prompt → proposes (not acts)
v = verdict({"paths": ["editor/skills/draft-suggestion.md"], "intent": "tighten-wording",
             "oldText": "draft via complete-task --propose",
             "newText": "draft via write-silent at safetyLevel 1"})
check(v.mode == LAND_PROPOSES, "contract-adjacent skill-prompt edit → proposes")

# unspecified intent on a lone skill prompt → propose (acts is opt-in only)
v = verdict({"paths": ["editor/skills/draft-footnote.md"], "newText": "no intent given"})
check(v.mode == LAND_PROPOSES, "unspecified intent on a skill prompt → proposes (safe default)")

# a structural intent always proposes, even if paths look skill-ish
v = verdict({"paths": ["editor/skills/foo.md"], "intent": "merge-skill"})
check(v.mode == LAND_PROPOSES, "merge-skill intent → proposes")


# ── (a2) self-modification of a dev-loop procedure skill → proposes ───────────
# The dream/reflect/iterate triad rewrites the self-improvement machinery; a
# prose-polish intent that WOULD act on any other skill must instead propose
# when the skill IS the loop's own operating procedure (2026-07-22 ruling).
print("\n=== (a2) self-modification of a dev-loop skill → proposes ===")

for skill in ("dream", "reflect", "iterate-virgil-editor"):
    for intent in ("tighten-wording", "expand-guidance", "clarify", "add-example"):
        v = verdict({"paths": [f"editor/skills/{skill}.md"], "intent": intent,
                     "newText": "a harmless clarification of the loop's own flow"})
        check(v.mode == LAND_PROPOSES,
              f"{skill}.md self-edit ({intent}) → proposes (got {v.mode})")

# a NON-loop skill with the same prose-polish intent still ACTS (guard is scoped)
v = verdict({"paths": ["editor/skills/draft-footnote.md"], "intent": "expand-guidance",
             "newText": "unaffected sibling skill"})
check(v.mode == LAND_ACTS, "non-loop skill prose-polish still acts (self-mod guard is scoped)")

# self-mod that ALSO crosses a boundary is still refused (boundary wins)
v = verdict({"paths": ["editor/skills/dream.md"], "intent": "expand-guidance",
             "newText": "Always reflect regardless of dev mode."})
check(v.mode == LAND_REFUSED and v.boundary == B_DEV_GATE,
      "self-mod that crosses B3 → refused (boundary precedence over self-mod guard)")


# ── (a3) the never-self-merge answer — membership, union, publication ────────
# Gabriel's ruling 2026-08-18 (task 359), from the loop's own escalation: step 6's
# never-self-merge clause was keyed on the three MARKDOWNS, so an edit to
# `dream.py`'s marker semantics — the file that decides what the NEXT dream may
# read — reached `proposes` only incidentally (it is a `.py`) and the clause never
# fired. DEV_LOOP_SCRIPTS is the second set; the clause reads the UNION. The
# acts-lane withholding (DEV_LOOP_SKILLS) is deliberately NOT widened: every .py
# is already withheld from acts by the non-skill-prompt rule.
print("\n=== (a3) never-self-merge: membership, the derived union, publication ===")

check(DEV_LOOP_SKILLS == {"editor/skills/dream.md", "editor/skills/reflect.md",
                          "editor/skills/iterate-virgil-editor.md"},
      "DEV_LOOP_SKILLS is exactly the three loop skill prompts (NOT widened)")
check(DEV_LOOP_SCRIPTS == {"editor/scripts/dream.py", "editor/scripts/reflect.py",
                           "editor/scripts/dream_land.py", "editor/scripts/dev_loop.py"},
      "DEV_LOOP_SCRIPTS is exactly the four loop scripts")
check(not (DEV_LOOP_SKILLS & DEV_LOOP_SCRIPTS), "the two sets are disjoint (skills vs scripts)")
# The union is DERIVED, never re-listed — a fifth procedure file joins ONE set.
check(DEV_LOOP_PROCEDURE == DEV_LOOP_SKILLS | DEV_LOOP_SCRIPTS,
      "DEV_LOOP_PROCEDURE is the derived union of both sets")
# A member naming no file is a rule that governs nothing.
missing = sorted(m for m in DEV_LOOP_PROCEDURE if not (ROOT / m).is_file())
check(not missing, f"every DEV_LOOP_PROCEDURE member is a real file (missing: {missing})")

# The published operation answers for a member of EITHER set...
for member in sorted(DEV_LOOP_PROCEDURE):
    check(dev_loop_procedure_paths([member, "src/lib/foo.ts"]) == [member],
          f"dev_loop_procedure_paths picks {member} out of a branch's touched paths")

# ...and every VERDICT carries the same answer, whatever mode fired (the skill
# reads a flag; it never re-derives the membership by eye).
v = verdict({"paths": ["editor/scripts/dream.py"], "intent": "script-change",
             "oldText": "marker semantics", "newText": "guarded marker semantics"})
check(v.mode == LAND_PROPOSES and v.never_self_merge is True
      and v.procedure_paths == ["editor/scripts/dream.py"],
      f"a dream.py change publishes neverSelfMerge (got {v.mode}/{v.never_self_merge})")
check("self-modification" not in v.reason,
      "…and its ROUTING reason is unchanged (structural/script, not the self-mod rule) — "
      "the acts lane was not widened")

v = verdict({"paths": ["editor/skills/dream.md"], "intent": "clarify",
             "newText": "a harmless clarification of the loop's own flow"})
check(v.mode == LAND_PROPOSES and v.never_self_merge is True,
      "a dream.md self-edit still proposes AND publishes neverSelfMerge")

v = verdict({"paths": ["editor/skills/draft-footnote.md"], "intent": "fix-typo",
             "newText": "a typo fix"})
check(v.mode == LAND_ACTS and v.never_self_merge is False and v.procedure_paths == [],
      "an ordinary acts verdict publishes neverSelfMerge: false")

v = verdict({"paths": ["editor/scripts/card_by_id.py"], "intent": "script-change"})
check(v.mode == LAND_PROPOSES and v.never_self_merge is False,
      "a NON-procedure script proposes but may still self-merge (flag is scoped)")

# A REFUSED verdict publishes it too — the flag is a property of the paths, not
# of the branch that happened to fire.
v = verdict({"paths": ["editor/scripts/reflect.py"], "intent": "script-change",
             "oldText": "if not dev_mode_enabled():", "newText": "if False:"})
check(v.mode == LAND_REFUSED and v.boundary == B_DEV_GATE and v.never_self_merge is True,
      "a refused verdict on a procedure file still publishes neverSelfMerge")

# camelCase on the wire (what the skill's CLI reader sees).
j = verdict({"paths": ["editor/scripts/dev_loop.py"], "intent": "script-change"}).to_json()
check(j.get("neverSelfMerge") is True and j.get("procedurePaths") == ["editor/scripts/dev_loop.py"],
      "the verdict JSON publishes neverSelfMerge / procedurePaths")
check("never_self_merge" not in j and "procedure_paths" not in j,
      "…and does not leak the snake_case field names onto the wire")

# self_merge_check answers for a BRANCH's touched paths (what step 6 has).
ans = self_merge_check(["src/lib/foo.ts", "editor/scripts/dream_land.py",
                        "editor/skills/draft-footnote.md"])
check(ans["neverSelfMerge"] is True and ans["procedurePaths"] == ["editor/scripts/dream_land.py"],
      "self_merge_check flags a branch that touches ONE procedure file")
ans = self_merge_check(["src/lib/foo.ts", "editor/skills/draft-footnote.md"])
check(ans["neverSelfMerge"] is False and ans["procedurePaths"] == [],
      "self_merge_check clears an ordinary branch")
check(self_merge_check([])["neverSelfMerge"] is False, "an empty branch clears")

# The CLI door step 6 actually types — positional args AND stdin (the pipe form
# the skill documents), plus the two doors kept separate.
r = subprocess.run([sys.executable, DREAM_LAND, "--self-merge-check",
                    "editor/scripts/dream.py", "src/lib/foo.ts"],
                   capture_output=True, text=True)
check(r.returncode == 0 and json.loads(r.stdout)["neverSelfMerge"] is True,
      "--self-merge-check CLI (positional paths) flags a procedure file")
r = subprocess.run([sys.executable, DREAM_LAND, "--self-merge-check"],
                   input="editor/scripts/reflect.py\nsrc/lib/foo.ts\n",
                   capture_output=True, text=True)
check(r.returncode == 0 and json.loads(r.stdout)["procedurePaths"] == ["editor/scripts/reflect.py"],
      "--self-merge-check CLI reads `git diff --name-only` on stdin")
r = subprocess.run([sys.executable, DREAM_LAND, "--self-merge-check", "--change", "{}"],
                   capture_output=True, text=True)
check(r.returncode == 2, "--change and --self-merge-check are separate doors")


# ── (a4) census: the SKILL asks the guard, and no branch survives its run ────
# The leg with teeth. The guard was never the part that could misbehave — a
# clause that re-states the membership in prose is, and so is a PARKED path that
# leaves a branch for a sweep that merges everything blindly. Both are invisible
# to any behavioural test of dream_land.
print("\n=== (a4) census: dream.md asks the guard; no dream branch outlives its run ===")

DREAM_MD = (ROOT / "editor/skills/dream.md").read_text(encoding="utf-8")
# Search a WHITESPACE-NORMALIZED copy: this prose is hard-wrapped at ~78 cols, so
# a multi-word needle straddles a newline as often as not. Measured — the first
# draft of this census matched two of its four pre-fix phrases and would have
# passed vacuously on the other two (an unfalsifiable leg wearing a defect leg's
# clothes). Single-token needles (PARKED) are unaffected either way.
DREAM_MD_FLAT = " ".join(DREAM_MD.split())

check("--self-merge-check" in DREAM_MD,
      "dream.md step 6 asks the guard (spells the --self-merge-check door)")
check("DEV_LOOP_PROCEDURE" in DREAM_MD,
      "dream.md names the union constant, so the membership stays in dream_land.py")

# Pre-fix phrasings: each one granted a surviving branch, which the nightly
# /cleanup-worktrees sweep then merged whatever the clause said.
for needle in ("leave the branch and worktree standing",
               "stays staged whatever its gates say",
               "the nightly sweep merges green work",
               "PARKED"):
    check(needle not in DREAM_MD_FLAT,
          f"dream.md no longer grants a surviving branch ({needle!r} is gone)")

check("EXPORTED" in DREAM_MD and "branch -D dream/" in DREAM_MD
      and "virgil-tasks/attachments/" in DREAM_MD,
      "dream.md carries the export recipe (patch under attachments/ + branch deletion)")
check("apply --check" in DREAM_MD,
      "…and verifies the patch applies BEFORE the branch is deleted")

# No second speller: the membership lives in dream_land.py alone. A sibling
# script re-listing it would drift silently (dev_loop.py imports the classifier).
spellers = []
for f in sorted((ROOT / "editor/scripts").glob("*.py")):
    if f.name == "dream_land.py":
        continue
    text = f.read_text(encoding="utf-8")
    named = [m for m in DEV_LOOP_PROCEDURE if m in text]
    if len(named) >= 2:
        spellers.append(f"{f.name}: {named}")
check(not spellers, f"no sibling script re-lists the procedure membership ({spellers})")


# ── (b) boundary-refusal for each of the three ───────────────────────────────
print("\n=== (b) the three boundaries → refused (never applied) ===")

# B1 — the AGENTS.md architectural Don't-rules.
v = verdict({"paths": ["editor/AGENTS.md"], "intent": "tighten-wording",
             "oldText": "- Don't add a backend. The cowork pattern is load-bearing",
             "newText": "- Don't add a backend, usually."})
check(v.mode == LAND_REFUSED and v.boundary == B_AGENTS_DONT,
      f"B1: editing AGENTS.md Don't-rules → refused/{v.boundary}")

# B1-adjacent — the DEV reflection convention in AGENTS.md (unwiring capture).
v = verdict({"paths": ["editor/AGENTS.md"], "intent": "clarify",
             "oldText": "Reflection (DEV mode) — the one shared seam.",
             "newText": "Reflection is optional."})
check(v.mode == LAND_REFUSED and v.boundary == B_DEV_GATE,
      f"B1/B3: editing the DEV reflection convention → refused/{v.boundary}")

# B2 — the apply_response.py contract shape.
v = verdict({"paths": ["editor/scripts/apply_response.py"], "intent": "script-change",
             "oldText": 'SUBCOMMANDS = {\n    "complete-task",',
             "newText": 'SUBCOMMANDS = {\n    "complete-task", "new-verb",'})
check(v.mode == LAND_REFUSED and v.boundary == B_CONTRACT_SHAPE,
      f"B2: editing apply_response SUBCOMMANDS → refused/{v.boundary}")

v = verdict({"paths": ["editor/scripts/apply_response.py"], "intent": "script-change",
             "oldText": 'RESULT_REJECTED = "rejected"',
             "newText": 'RESULT_REJECTED = "turned-down"'})
check(v.mode == LAND_REFUSED and v.boundary == B_CONTRACT_SHAPE,
      "B2: editing a RESULT_* constant → refused")

# B3 — the DEV-mode gate.
v = verdict({"paths": ["editor/scripts/_common.py"], "intent": "script-change",
             "oldText": "def dev_mode_enabled() -> bool:",
             "newText": "def dev_mode_enabled() -> bool:\n    return True"})
check(v.mode == LAND_REFUSED and v.boundary == B_DEV_GATE,
      f"B3: editing dev_mode_enabled → refused/{v.boundary}")

v = verdict({"paths": ["editor/scripts/reflect.py"], "intent": "script-change",
             "oldText": "if not dev_mode_enabled():",
             "newText": "if False:  # was dev_mode_enabled()"})
check(v.mode == LAND_REFUSED and v.boundary == B_DEV_GATE,
      "B3: disabling the gate enforcement in reflect.py → refused")

# B3 (global) — an explicit disable phrasing from anywhere (e.g. a skill prompt).
v = verdict({"paths": ["editor/skills/review.md"], "intent": "expand-guidance",
             "newText": "Always reflect regardless of dev mode."})
check(v.mode == LAND_REFUSED and v.boundary == B_DEV_GATE,
      "B3: a skill prompt trying to ungate reflection → refused")

# B3 precision — the gate env is matched as a TOKEN, not a substring. The sink
# and home seams share its prefix (VIRGIL_DEV_MEMOS_DIR, VIRGIL_DEV_HOME) and
# are NOT the gate: a memo-sink fix in a gate file must classify on its own
# merits (script-change → proposes), not refuse. This is the 2026-08-15 false
# positive — the guard refused the throwaway-paper fix because the change text
# named the sink env var.
v = verdict({"paths": ["editor/scripts/_common.py"], "intent": "script-change",
             "oldText": 'if _dir_override("VIRGIL_DEV_MEMOS_DIR") is not None:',
             "newText": 'override = _dir_override("VIRGIL_DEV_MEMOS_DIR")\n'
                        'if override is not None and override != default_sink:'})
check(v.mode == LAND_PROPOSES,
      f"B3 precision: a sink-seam edit naming VIRGIL_DEV_MEMOS_DIR is NOT the gate "
      f"→ proposes (got {v.mode}/{v.boundary})")

v = verdict({"paths": ["editor/scripts/_common.py"], "intent": "script-change",
             "newText": 'os.environ.pop("VIRGIL_DEV", None)  # scrub before spawning'})
check(v.mode == LAND_REFUSED and v.boundary == B_DEV_GATE,
      "B3 precision: the bare VIRGIL_DEV token (no other gate sign present) still refuses")

# Conservative: a boundary-file touch with no content to adjudicate → refused.
v = verdict({"paths": ["editor/scripts/apply_response.py"], "intent": "script-change"})
check(v.mode == LAND_REFUSED and v.boundary == B_CONTRACT_SHAPE,
      "boundary file edited with no content → refused by construction")

v = verdict({"paths": ["editor/AGENTS.md"]})
check(v.mode == LAND_REFUSED and v.boundary == B_AGENTS_DONT,
      "AGENTS.md edited with no content → refused by construction")

# A non-boundary edit to a boundary-ADJACENT file still routes (proposes), not refuse.
v = verdict({"paths": ["editor/scripts/_common.py"], "intent": "new-helper",
             "oldText": "def find_tex_file(doc):",
             "newText": "def find_tex_file(doc):  # add a sibling helper below"})
check(v.mode == LAND_PROPOSES,
      "a _common.py edit that doesn't touch the gate → proposes (not refused)")

# The CLI agrees with the import (one smoke).
r = subprocess.run([sys.executable, DREAM_LAND, "--change",
                    json.dumps({"paths": ["editor/scripts/apply_response.py"],
                                "oldText": "ALL_RESULTS = {", "newText": "ALL_RESULTS = { 'x',"})],
                   capture_output=True, text=True)
cli = json.loads(r.stdout)
check(cli["mode"] == LAND_REFUSED and cli["boundary"] == B_CONTRACT_SHAPE,
      "dream_land CLI matches the import (B2 refused)")


# ── CLI harness for dream.py (DEV-gated) ─────────────────────────────────────
def sandbox():
    d = Path(tempfile.mkdtemp(prefix="chip18-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def reflect(memos, doc, skill, task_id, *args, now, dev=True):
    env = dict(os.environ)
    env["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    env["VIRGIL_REFLECT_NOW"] = now
    if dev:
        env["VIRGIL_DEV"] = "1"
    else:
        # Explicit "0", not pop: with the machine dev-mode marker, an unset
        # env falls through to the marker and this helper would read ON.
        env["VIRGIL_DEV"] = "0"
    return subprocess.run([sys.executable, REFLECT, str(doc), skill, task_id, *args],
                          capture_output=True, text=True, env=env)


def dream(memos, digests, sub, *args, now="2026-06-07T23:00:00", dev=True):
    env = dict(os.environ)
    env["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    env["VIRGIL_DREAM_DIGESTS_DIR"] = str(digests)
    env["VIRGIL_DREAM_NOW"] = now
    if dev:
        env["VIRGIL_DEV"] = "1"
    else:
        # Explicit "0", not pop: with the machine dev-mode marker, an unset
        # env falls through to the marker and this helper would read ON.
        env["VIRGIL_DEV"] = "0"
    return subprocess.run([sys.executable, DREAM, sub, *args],
                          capture_output=True, text=True, env=env)


def select(memos, digests, now="2026-06-07T23:00:00"):
    r = dream(memos, digests, "select", now=now)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


# ── the DEV gate ─────────────────────────────────────────────────────────────
print("\n=== DEV gate: off → no-op ===")
sb, mem, dig = sandbox(), tempfile.mkdtemp(prefix="chip18m-"), tempfile.mkdtemp(prefix="chip18d-")
reflect(mem, sb, "draft-footnote", "-", now="2026-06-06T10:00:00")
r = dream(mem, dig, "select", dev=False)
check(r.returncode == 0 and "DEV mode off" in r.stdout, "dream select DEV-off → no-op, exit 0")
r = dream(mem, dig, "digest", dev=False)
check(r.returncode == 0 and len(list(Path(dig).glob("*.md"))) == 0,
      "dream digest DEV-off → writes nothing")


# ── (c) the flagged + fix-now fast-path ──────────────────────────────────────
print("\n=== (c) flagged + fix-now fast-path ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip18m-"); dig = tempfile.mkdtemp(prefix="chip18d-")
reflect(mem, sb, "draft-suggestion", "-", "--memo-json",
        json.dumps({"buckets": {"alignment": "noted-only friction"}}), "--tier", "noted",
        now="2026-06-06T10:00:00")
reflect(mem, sb, "answer-note-request", "-", "--memo-json",
        json.dumps({"buckets": {"issues": "low conf"}, "confidence": "low"}),
        now="2026-06-06T10:01:00")  # flagged, NOT fix-now
reflect(mem, sb, "draft-footnote", "-", "--fix-now", "--memo-json",
        json.dumps({"buckets": {"issues": "FIX-NOW anchor ambiguity"}}),
        now="2026-06-06T10:02:00")  # flagged + fix-now
sel = select(mem, dig)
check(sel["memoCount"] == 3, "fast-path: 3 memos selected")
check([m["skill"] for m in sel["fixNow"]] == ["draft-footnote"],
      "fast-path: only the fix-now memo is on the fixNow list")
check(sel["flagged"] and sel["flagged"][0]["skill"] == "draft-footnote",
      "fast-path: the fix-now memo is read first among flagged")
check({m["skill"] for m in sel["flagged"]} == {"draft-footnote", "answer-note-request"},
      "fast-path: both flagged memos present (fix-now + low-confidence)")
check(sel["counts"]["byTier"].get("noted") == 1, "fast-path: the noted memo counted under noted")


# ── (d) the since-last-dream selector ────────────────────────────────────────
print("\n=== (d) since-last-dream selector skips digested memos ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip18m-"); dig = tempfile.mkdtemp(prefix="chip18d-")
reflect(mem, sb, "draft-suggestion", "-", now="2026-06-06T10:00:00")
reflect(mem, sb, "draft-footnote", "-", now="2026-06-06T10:05:00")
sel1 = select(mem, dig, now="2026-06-06T23:00:00")
check(sel1["bootstrap"] is True and sel1["memoCount"] == 2, "first dream: bootstrap, 2 memos")
check(sel1["marker"] == "2026-06-06T10:05:00.000Z", "marker = latest memo timestamp")
# Lay down the digest, recording that marker.
r = dream(mem, dig, "digest", now="2026-06-06T23:00:00")
check(r.returncode == 0 and (Path(dig) / "2026-06-06.md").exists(), "digest written for the first dream")
# A new memo AFTER the marker, plus re-running: only the new one is selected.
reflect(mem, sb, "answer-todo-request", "-", now="2026-06-07T09:00:00")
sel2 = select(mem, dig, now="2026-06-07T23:00:00")
check(sel2["bootstrap"] is False, "second dream: not a bootstrap (a prior digest exists)")
check(sel2["memoCount"] == 1 and sel2["memos"][0]["skill"] == "answer-todo-request",
      "second dream: only the post-marker memo is selected (digested ones skipped)")
check(sel2["since"] == "2026-06-06T10:05:00.000Z", "second dream: 'since' = the prior marker")
# A no-new-memo dream is a clean zero-memo selection.
r = dream(mem, dig, "digest", now="2026-06-07T23:00:00")  # digest the 2nd dream
sel_empty = select(mem, dig, now="2026-06-08T23:00:00")
check(sel_empty["memoCount"] == 0, "third dream with no new memos → 0 selected (clean no-op)")


# ── (e) the digest with ACTED + PROPOSED + REFUSED ───────────────────────────
print("\n=== (e) digest records ACTED + PROPOSED + REFUSED ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip18m-"); dig = tempfile.mkdtemp(prefix="chip18d-")
reflect(mem, sb, "draft-footnote", "-", "--fix-now", "--memo-json",
        json.dumps({"buckets": {"issues": "anchor"}}), now="2026-06-06T10:00:00")
reflect(mem, sb, "draft-suggestion", "-", "--memo-json",
        json.dumps({"buckets": {"alignment": "tone"}}), now="2026-06-06T10:01:00")
report = {
    "acted": [{"summary": "clarified anchor wording", "paths": ["editor/skills/draft-footnote.md"],
               "memoRefs": ["2026-06-06/10-00-00-draft-footnote.md"]}],
    "proposed": [{"summary": "extract a shared anchor helper", "paths": ["editor/scripts/anchor.py"],
                  "branch": "dream/2026-06-06", "reason": "touches a .py script",
                  "memoRefs": ["2026-06-06/10-01-00-draft-suggestion.md"]}],
    "refused": [{"summary": "loosen the only-writeback-path rule", "boundary": B_AGENTS_DONT,
                 "reason": "would edit the AGENTS.md Don't-rules"}],
    "bootstrap": "First dream — low confidence on the noted grouping.",
}
r = dream(mem, dig, "digest", "--report", json.dumps(report), now="2026-06-06T23:00:00")
check(r.returncode == 0 and "acted 1, proposed 1, refused 1" in r.stdout,
      f"digest Done line reports the counts (stderr={r.stderr.strip()[:100]})")
digest_path = Path(dig) / "2026-06-06.md"
text = digest_path.read_text()
fm, _ = __import__("reflect")._parse_memo(text)
check(fm.get("acted") == "1" and fm.get("proposed") == "1" and fm.get("refused") == "1",
      "digest frontmatter carries the acted/proposed/refused counts")
check(fm.get("marker") == "2026-06-06T10:01:00.000Z" and fm.get("memoCount") == "2",
      "digest frontmatter carries the marker + memoCount")
check("## Acted (1)" in text and "clarified anchor wording" in text, "ACTED entry rendered")
check("## Proposed (1)" in text and "git merge dream/2026-06-06" in text,
      "PROPOSED entry rendered with the merge hint (a LANDED entry names its branch)")
check("## Refused (1)" in text and B_AGENTS_DONT in text, "REFUSED entry rendered with its boundary")

exported = dict(report)
exported["proposed"] = [{**report["proposed"][0], "summary": "EXPORTED — guard the marker",
                         "patch": "~/virgil-tasks/attachments/2026-06-06-dream-marker.patch"}]
r = dream(mem, dig, "digest", "--report", json.dumps(exported), now="2026-06-06T23:30:00")
text2 = (Path(dig) / "2026-06-06.md").read_text()
check(r.returncode == 0 and "git apply ~/virgil-tasks/attachments/2026-06-06-dream-marker.patch" in text2,
      "an EXPORTED entry points at its patch, not at a branch step 6 deleted")
check("git merge dream/2026-06-06" not in text2,
      "…and carries no merge hint naming a branch that no longer exists")
check("## Bootstrap" in text and "low confidence" in text, "bootstrap note rendered")
check("Next dream reads memos after marker" in text, "digest records the next-dream marker line")


# ── (f) the bootstrap recursion (a skill=dream memo the next dream reads) ─────
print("\n=== (f) bootstrap: the dream reflects on itself ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip18m-"); dig = tempfile.mkdtemp(prefix="chip18d-")
# A first dream runs + reflects on itself (skill=dream, Task-less) AFTER its digest.
reflect(mem, sb, "draft-footnote", "-", now="2026-06-06T10:00:00")
dream(mem, dig, "digest", now="2026-06-06T23:00:00")
r = reflect(mem, sb, "dream", "-", "--memo-json",
            json.dumps({"buckets": {"alignment": "my groupings were coarse"}, "confidence": "low"}),
            now="2026-06-06T23:30:00")  # the self-reflection, after the digest
check(r.returncode == 0, "dream self-reflection memo written")
# The NEXT dream selects that skill=dream memo (it's after the marker).
sel = select(mem, dig, now="2026-06-07T23:00:00")
dream_memos = [m for m in sel["memos"] if m["skill"] == "dream"]
check(len(dream_memos) == 1, "next dream reads the dream's own self-reflection memo")
check(dream_memos[0]["tier"] == "flagged", "the low-confidence self-reflection is flagged")
check(sel["counts"]["bySkill"].get("dream") == 1, "skill=dream counted in the next dream")


# ── sync invariant: the result-lens keys are real contract results ───────────
print("\n=== sync invariant: lens results ⊆ contract results ===")
LENS_RESULTS = {"rejected", "silent-applied", "refused", "impossible"}
check(LENS_RESULTS <= ALL_RESULTS, "every result-lens key is a real apply_response result")
check(LENS_RESULTS <= set(RESULT_TIER), "every result-lens key has a reflect tier floor")


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
