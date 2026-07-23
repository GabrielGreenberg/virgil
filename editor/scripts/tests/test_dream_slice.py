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
    classify_change,
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
        env.pop("VIRGIL_DEV", None)
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
        env.pop("VIRGIL_DEV", None)
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
      "PROPOSED entry rendered with the merge hint")
check("## Refused (1)" in text and B_AGENTS_DONT in text, "REFUSED entry rendered with its boundary")
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
