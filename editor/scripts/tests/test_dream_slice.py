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

# self_merge_check answers the own-rulebook question for a set of paths.
#
# RENEGOTIATED (task 522): these legs used to say "a BRANCH's touched paths
# (what step 6 has)". The dream has no branch — it lands nothing and files
# tasks — so the FUNCTION survives with a live caller (`task_route` reads it to
# decide `incoming/` vs `blocked/`) while its CLI door is retired below. The
# question and every answer here are byte-for-byte what they were; only the
# caller changed.
ans = self_merge_check(["src/lib/foo.ts", "editor/scripts/dream_land.py",
                        "editor/skills/draft-footnote.md"])
check(ans["neverSelfMerge"] is True and ans["procedurePaths"] == ["editor/scripts/dream_land.py"],
      "self_merge_check flags a path set touching ONE procedure file")
ans = self_merge_check(["src/lib/foo.ts", "editor/skills/draft-footnote.md"])
check(ans["neverSelfMerge"] is False and ans["procedurePaths"] == [],
      "self_merge_check clears an ordinary path set")
check(self_merge_check([])["neverSelfMerge"] is False, "an empty path set clears")

# The CLI door the night actually types is `--route`, not `--self-merge-check`.
# RENEGOTIATED (task 522): the retired door asked HALF the question about a
# BRANCH (`git diff --name-only main...dream/<date>`); with no branch to ask
# about, the same question survives INSIDE the whole operation. Its absence is
# pinned, so nothing quietly re-adds a second door for one answer.
r = subprocess.run([sys.executable, DREAM_LAND, "--self-merge-check",
                    "editor/scripts/dream.py"], capture_output=True, text=True)
check(r.returncode != 0 and "--self-merge-check" not in r.stdout,
      "the retired --self-merge-check CLI door is gone")
r = subprocess.run([sys.executable, DREAM_LAND, "--route",
                    json.dumps({"kind": "change",
                                "change": {"paths": ["editor/scripts/dream.py"],
                                           "intent": "script-change",
                                           "oldText": "a", "newText": "b"}})],
                   capture_output=True, text=True)
route = json.loads(r.stdout)
check(r.returncode == 0 and route["queue"] == "blocked"
      and route["neverSelfMerge"] is True,
      "--route answers the own-rulebook question as part of the whole operation")
r = subprocess.run([sys.executable, DREAM_LAND, "--route", "{}", "--change", "{}"],
                   capture_output=True, text=True)
check(r.returncode == 2, "--change and --route are separate doors")


# ── (a4) census: the SKILL asks the door, and the night lands NOTHING ────────
# The leg with teeth. The door was never the part that could misbehave — a
# clause that re-states the membership in prose is, and so is a surviving
# instruction to merge, branch, or export. Both are invisible to any
# behavioural test of dream_land.
#
# RENEGOTIATED (task 522): this census used to REQUIRE the export recipe
# (`branch -D dream/`, a patch under `attachments/`, `apply --check`) and the
# `--self-merge-check` door, because in that world the night's own landing
# machinery was the thing that could half-follow a rule. The dream lands
# nothing now: it files tasks and the worker executes them, so the same census
# is inverted — every live landing instruction is the defect, and the doors it
# must spell are `--route` and `file-task`.
print("\n=== (a4) census: dream.md asks the door; the night lands NOTHING ===")

DREAM_MD_RAW = (ROOT / "editor/skills/dream.md").read_text(encoding="utf-8")
# Strip the `<!-- RETIRED … -->` notes before searching. This repo's convention
# is to renegotiate a retired claim IN PLACE with the reason at the site, so a
# raw-source needle would make writing that sentence a test failure — and, worse
# in this direction, every negative needle below would match its own obituary
# and pass for the wrong reason. (Measured: with the comments left in, four of
# the six negative needles below flip.) Same rule `_source-scan.ts`'s
# `commentsStripped` states one silo over.
import re as _re
DREAM_MD = _re.sub(r"<!--.*?-->", " ", DREAM_MD_RAW, flags=_re.S)
# Search a WHITESPACE-NORMALIZED copy: this prose is hard-wrapped at ~78 cols, so
# a multi-word needle straddles a newline as often as not. Measured — the first
# draft of this census matched two of its four pre-fix phrases and would have
# passed vacuously on the other two (an unfalsifiable leg wearing a defect leg's
# clothes).
DREAM_MD_FLAT = " ".join(DREAM_MD.split())

check("--route" in DREAM_MD and "dream_land.py" in DREAM_MD,
      "dream.md asks the routing door (spells --route)")
check("file-task" in DREAM_MD and "dream.py file-task" in DREAM_MD_FLAT,
      "dream.md files through the script, not by hand")
check("DEV_LOOP_PROCEDURE" in DREAM_MD,
      "dream.md names the union constant, so the membership stays in dream_land.py")
check("blocked/" in DREAM_MD and "## Questions" in DREAM_MD,
      "dream.md routes the human's half to blocked/ with questions")

# Pre-522 phrasings. Each one is a LIVE instruction to land something, and the
# whole merge is that the night lands nothing: the worker is the one executor.
for needle in ("git worktree add -b dream/",
               "branch -D dream/",
               "virgil-tasks/attachments/",
               "--self-merge-check",
               "merge --no-ff dream/",
               "apply --check"):
    check(needle not in DREAM_MD_FLAT,
          f"dream.md carries no live landing instruction ({needle!r} is gone)")

# ...and the older pre-fix phrasings stay pinned dead: they granted a surviving
# branch, which the nightly /cleanup-worktrees sweep then merged blindly. Moot
# now (no branch is created at all) and cheap to keep, since a regression here
# would be a re-added branch.
for needle in ("leave the branch and worktree standing",
               "stays staged whatever its gates say",
               "the nightly sweep merges green work",
               "PARKED"):
    check(needle not in DREAM_MD_FLAT,
          f"dream.md no longer grants a surviving branch ({needle!r} is gone)")

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
                  "task": "2026-06-06-004", "queue": "incoming",
                  "reason": "touches a .py script",
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
# RENEGOTIATED (task 522): these legs pinned "## Acted"/"## Proposed" headings
# and a `git merge <branch>` / `git apply <patch>` POINTER. The dream neither
# merges nor exports now — the three buckets keep their keys (they are the
# classifier's three verdicts) and every entry points at the TASK it was filed
# as. The `acted`/`proposed`/`refused` COUNTS above are unchanged and still
# pinned, which is the part these legs were really guarding.
check("## Scoped — filed (1)" in text and "clarified anchor wording" in text,
      "an `acts` entry renders under Scoped, filed")
check("## Structural — filed (1)" in text and "task `2026-06-06-004`" in text
      and "in `incoming/`" in text,
      "a `proposes` entry points at the TASK it was filed as, not a branch")
check("git merge dream/" not in text and "git apply " not in text,
      "…and the digest carries no merge hint and no patch pointer at all")
check("## Refused — filed as questions (1)" in text and B_AGENTS_DONT in text,
      "a REFUSED entry renders with its boundary")

# An entry the night did NOT file is a LOST finding, and the digest says so
# rather than reading like an ordinary line — the digest is a courtesy record
# and the queue is the only surface anyone reads (task 522).
unfiled = dict(report)
unfiled["proposed"] = [{k: v for k, v in report["proposed"][0].items()
                        if k not in ("task", "queue")}]
r = dream(mem, dig, "digest", "--report", json.dumps(unfiled), now="2026-06-06T23:30:00")
text2 = (Path(dig) / "2026-06-06.md").read_text()
check(r.returncode == 0 and "NOT FILED" in text2,
      "an entry with no task id is flagged NOT FILED")
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


# ── (g) a MISSING sink is not a quiet night ──────────────────────────────────
# The leg with teeth is the CONTROL: `memoCount == 0` in BOTH arms, so a flag
# that merely echoed the count would pass the absent arm and fail here.
print("\n=== (g) missing memo sink is distinguishable from an empty one ===")
dig_g = tempfile.mkdtemp(prefix="chip18d-")

absent = Path(tempfile.mkdtemp(prefix="chip18m-")) / "never-created"
sel_absent = select(absent, dig_g)
check(sel_absent["memoSinkPresent"] is False, "absent sink → memoSinkPresent false")
check(sel_absent["memoCount"] == 0, "absent sink → memoCount 0 (the ambiguous half)")

present = Path(tempfile.mkdtemp(prefix="chip18m-"))       # exists, holds no memos
sel_empty = select(present, tempfile.mkdtemp(prefix="chip18d-"))
check(sel_empty["memoSinkPresent"] is True, "empty-but-present sink → memoSinkPresent true")
check(sel_empty["memoCount"] == 0, "empty sink → memoCount 0 (same count, different flag)")
check(sel_absent["memoCount"] == sel_empty["memoCount"]
      and sel_absent["memoSinkPresent"] != sel_empty["memoSinkPresent"],
      "the two states share a count and differ ONLY in the flag")

# ...and the durable record carries it, or the silence is permanent.
r = dream(absent, dig_g, "digest", now="2026-06-07T23:00:00")
check(r.returncode == 0, "digest over an absent sink still writes")
dtext = (Path(dig_g) / "2026-06-07.md").read_text()
check("memoSinkPresent: false" in dtext, "digest frontmatter records the absent sink")
check("deaf one" in dtext, "digest body calls out the deaf night")
check(str(absent) in dtext, "digest names the sink path the human must check")

dig_ok = tempfile.mkdtemp(prefix="chip18d-")
r = dream(present, dig_ok, "digest", now="2026-06-07T23:00:00")
ok_text = (Path(dig_ok) / "2026-06-07.md").read_text()
check("deaf one" not in ok_text, "a genuinely quiet night raises NO deaf-night callout")
check("memoSinkPresent: true" in ok_text, "healthy digest still records the flag")


# ── sync invariant: the result-lens keys are real contract results ───────────
print("\n=== sync invariant: lens results ⊆ contract results ===")
LENS_RESULTS = {"rejected", "silent-applied", "refused", "impossible"}
check(LENS_RESULTS <= ALL_RESULTS, "every result-lens key is a real apply_response result")
check(LENS_RESULTS <= set(RESULT_TIER), "every result-lens key has a reflect tier floor")


# ── an empty marker must not make a whole digest INVISIBLE ───────────────────
# The zero-memo bootstrap night writes `marker:` blank (_advance_marker's
# fallback).  _last_marker used to `continue` past such a digest entirely, so it
# lost the digest PATH along with the marker -- and that path is what becomes
# _advance_marker's `prior_digest_at`, the argument that ARMS the trailing
# self-memo hold.  An empty marker therefore inverted the guard's stated failure
# direction from "redundant re-read" to "lose a reflection outright".
print("\n=== an empty marker does not hide the digest (hold guard stays armed) ===")


def _write_digest(digests, name, dreamed_at, marker=""):
    Path(digests, name).write_text(
        "---\n"
        f"dreamedAt: {dreamed_at}\n"
        f"marker: {marker}\n"
        "markerMemo: \n"
        "memoCount: 0\n"
        "---\n\n# Dream digest\n", encoding="utf-8")


def _write_memo(memos, day, name, skill, reflected_at, tier="noted"):
    d = Path(memos, day)
    d.mkdir(parents=True, exist_ok=True)
    (d / name).write_text(
        "---\n"
        f"skill: {skill}\ntaskId: -\nkind: \u2014\nstatus: \u2014\nresult: \n"
        f"tier: {tier}\nfixNow: false\nparagraphIds: \n"
        f"reflectedAt: {reflected_at}\n"
        "---\n\n## What went wrong\nbody\n", encoding="utf-8")


def _emptymarker_tree(marker=""):
    mem = tempfile.mkdtemp(prefix="emk-m-")
    dig = tempfile.mkdtemp(prefix="emk-d-")
    _write_memo(mem, "2026-08-20", "10-00-00-draft-footnote.md",
                "draft-footnote", "2026-08-20T10:00:00.000Z")
    _write_digest(dig, "2026-08-21.md", "2026-08-21T05:00:00.000Z", marker=marker)
    # a trailing step-8 self-reflection, written AFTER that digest ran
    _write_memo(mem, "2026-08-21", "05-30-00-dream.md",
                "dream", "2026-08-21T05:30:00.000Z", tier="flagged")
    return mem, dig


mem, dig = _emptymarker_tree(marker="")
sel = select(mem, dig, now="2026-08-22T23:00:00")
check(sel["lastDigest"] is not None,
      "a digest that recorded NO marker is still seen as a prior digest")
check(sel["markerHeld"] == ["2026-08-21/05-30-00-dream.md"],
      "hold guard stays ARMED after an empty-marker night (the self-memo is held back)")
check(sel["marker"] != "2026-08-21T05:30:00.000Z",
      "the marker does NOT advance onto the unread self-reflection")
check(sel["bootstrap"] is True,
      "no high-water mark anywhere → still bootstrap (read every memo)")

# control: the same tree with a marker present behaved correctly before and must
# keep behaving correctly -- a non-regression pin, not a defect leg.
mem, dig = _emptymarker_tree(marker="2026-08-19T00:00:00.000Z")
sel = select(mem, dig, now="2026-08-22T23:00:00")
check(sel["bootstrap"] is False, "control: a recorded marker still means not-bootstrap")
check(sel["markerHeld"] == ["2026-08-21/05-30-00-dream.md"],
      "control: hold guard armed when the marker is present")

# control: a genuinely first dream -- no digest at all -- must still read as one.
mem2 = tempfile.mkdtemp(prefix="emk-m2-")
dig2 = tempfile.mkdtemp(prefix="emk-d2-")
_write_memo(mem2, "2026-08-20", "10-00-00-draft-footnote.md",
            "draft-footnote", "2026-08-20T10:00:00.000Z")
sel = select(mem2, dig2, now="2026-08-22T23:00:00")
check(sel["lastDigest"] is None and sel["bootstrap"] is True,
      "control: no digest at all → genuinely bootstrap, no phantom prior digest")


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
