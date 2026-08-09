#!/usr/bin/env python3
r"""Unification-slice test for the chip-19 dev-loop engine.

Chip 19 makes /editor/iterate-virgil-editor stand on the SAME engine as
/editor/reflect + /editor/dream: one critique-memo shape, one reader
(reflect._parse_memo), one boundary guard (dream_land.classify_change). The new
seams live in editor/scripts/dev_loop.py. This slice asserts the unification —
and the chip-17/18 slices (run alongside) prove backward-compat.

Asserts:
  (0) ONE engine, no forks: dev_loop reuses reflect._parse_memo (the reader),
      reflect._render_buckets (the bucket renderer) and dream_land.classify_change
      (the guard) by identity — no second parser/guard/renderer.
  (a) one shape: a reflect memo AND an iterate critique memo BOTH parse via the
      ONE shared reader into the same structure (the shared frontmatter keys +
      the four buckets); the iterate memo's extra keys are tolerated.
  (b) the [block] → flagged / [nice-to-have] → noted mapping (+ ambiguities →
      issues, judgment calls → alignment, failure → flagged, partial → noted,
      clean → unremarkable).
  (c) iterate's BOUNDARY-REFUSAL: an apply-step OR survey-step edit to an
      AGENTS.md Don't-rule / the contract shape / the DEV gate → refused +
      blocked + NOT landed inline.
  (d) iterate's normal single-skill prose edit is NOT blocked → lands inline.
  (e) a cross-skill survey edit is surfaced as `proposes`-class (flagged for
      scrutiny) — landed inline + flagged, NOT auto-worktree'd.
  + the iterations stream stays gitignored-by-default + DEV-ungated, and the
    CLI agrees with the import.

Run from anywhere:  python3 editor/scripts/tests/test_unify_slice.py
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
DEV_LOOP = str(SCRIPTS / "dev_loop.py")

sys.path.insert(0, str(SCRIPTS))
import reflect  # noqa: E402
import dream_land  # noqa: E402
import dev_loop as dl  # noqa: E402
from reflect import BUCKET_ORDER, FM_KEYS, SHARED_FM_KEYS, _parse_memo  # noqa: E402
from dream_land import (  # noqa: E402
    LAND_ACTS, LAND_PROPOSES, LAND_REFUSED,
    B_AGENTS_DONT, B_CONTRACT_SHAPE, B_DEV_GATE,
)

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def iter_memo(critique, root, now="2026-06-06T10:00:00"):
    """Write an iterate critique via dev_loop with the root + clock pinned."""
    env_root, env_now = os.environ.get("VIRGIL_DEV_ITERATIONS_DIR"), os.environ.get("VIRGIL_ITERATE_NOW")
    os.environ["VIRGIL_DEV_ITERATIONS_DIR"] = str(root)
    os.environ["VIRGIL_ITERATE_NOW"] = now
    try:
        p = dl.write_iteration_memo(critique)
    finally:
        for k, v in (("VIRGIL_DEV_ITERATIONS_DIR", env_root), ("VIRGIL_ITERATE_NOW", env_now)):
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
    fm, sections = _parse_memo(p.read_text(encoding="utf-8"))
    return p, fm, sections


# ── (0) ONE engine, no forks — the shared pieces are reused by identity ──────
print("\n=== (0) one engine: dev_loop reuses the reader + guard + renderer ===")
check(dl._parse_memo is reflect._parse_memo,
      "dev_loop reuses reflect._parse_memo (THE reader — no second parser)")
check(dl.classify_change is dream_land.classify_change,
      "dev_loop reuses dream_land.classify_change (THE guard — no second router)")
check(dl._render_buckets is reflect._render_buckets,
      "dev_loop reuses reflect._render_buckets (ONE bucket renderer)")
check(dl.ITER_FM_KEYS[:len(FM_KEYS)] == FM_KEYS,
      "the iterate memo's leading frontmatter keys ARE reflect's FM_KEYS (same shape)")


# ── (a) one shape: reflect memo + iterate memo parse the same ────────────────
print("\n=== (a) one shape: the shared reader parses BOTH streams identically ===")
work = Path(tempfile.mkdtemp(prefix="chip19-"))

# A real reflect memo (the memos/ stream), written by the real reflect.py CLI.
sb = work / "paper"; shutil.copytree(SAMPLE, sb)
mem = work / "memos"
env = dict(os.environ, VIRGIL_DEV="1", VIRGIL_DEV_MEMOS_DIR=str(mem),
           VIRGIL_REFLECT_NOW="2026-06-06T12:00:00")
r = subprocess.run([sys.executable, REFLECT, str(sb), "draft-suggestion", "-"],
                   capture_output=True, text=True, env=env)
reflect_files = sorted(mem.rglob("*.md"))
check(r.returncode == 0 and len(reflect_files) == 1, f"reflect.py wrote one memos/ memo (stderr={r.stderr[:80]})")
rfm, rsec = _parse_memo(reflect_files[0].read_text())

# An iterate memo (the iterations/ stream), written by dev_loop.
_, ifm, isec = iter_memo(
    {"skill": "draft-footnote", "case": "happy-path", "attempt": 1, "kind": "footnote",
     "taskId": "rid-1", "paragraphIds": ["f1c5"], "sandbox": "/tmp/sb", "result": "success",
     "summary": "Added footnote.", "actions": ["ran apply_response.py"]},
    work / "iterations")

# The SAME reader yields the SAME structure for both: the shared FM keys + 4 buckets.
for k in SHARED_FM_KEYS:
    check(k in rfm and k in ifm, f"both streams' frontmatter carries the shared key '{k}'")
# The memos-only keys are memos-only BY CONSTRUCTION, not by omission — pin that
# too, so a key silently dropped from the reflect writer still fails somewhere.
for k in (set(FM_KEYS) - set(SHARED_FM_KEYS)):
    check(k in rfm and k not in ifm, f"'{k}' is a memos-only key (in reflect, absent from iterations)")
for bkey in BUCKET_ORDER:
    check(bkey in rsec and bkey in isec, f"both streams parse into the '{bkey}' bucket")
check(ifm.get("stream") == "iterations", "iterate memo is stream-labeled 'iterations'")
check(ifm.get("case") == "happy-path" and ifm.get("attempt") == "1",
      "the reader tolerates the iterate-specific keys (case/attempt)")
check(ifm.get("skill") == "draft-footnote" and ifm.get("taskId") == "rid-1",
      "iterate frontmatter round-trips skill + synthetic taskId")


# ── (b) the [block] / [nice-to-have] → tier + bucket mapping ─────────────────
print("\n=== (b) [block] → flagged / [nice-to-have] → noted (+ bucket routing) ===")
itr = work / "iterations"

_, fm_block, sec_block = iter_memo(
    {"skill": "draft-footnote", "case": "missing-anchor", "attempt": 1, "result": "success",
     "ambiguities": [{"quote": "pick a real anchor", "fix": "name the fallback when paragraphIds is empty"}],
     "judgmentCalls": ["chose the terse footnote"],
     "edits": [{"severity": "block", "line": 42, "change": "specify the anchor fallback"}]},
    itr)
check(fm_block.get("tier") == "flagged", f"a [block] edit → tier flagged (got {fm_block.get('tier')})")
check(fm_block.get("blockCount") == "1", "blockCount recorded")
check("[block]" in sec_block["issues"], "the [block] item landed in the issues bucket")
check("ambiguity" in sec_block["issues"], "an ambiguity landed in the issues bucket")
check(sec_block["alignment"].startswith("- chose"), "a judgment call landed in the alignment bucket")

_, fm_nice, sec_nice = iter_memo(
    {"skill": "draft-footnote", "case": "terse-ask", "attempt": 1, "result": "success",
     "edits": [{"severity": "nice-to-have", "line": 7, "change": "add an example"}]},
    itr)
check(fm_nice.get("tier") == "noted", f"a [nice-to-have]-only critique → tier noted (got {fm_nice.get('tier')})")
check("[nice-to-have]" in sec_nice["streamlining"], "the [nice-to-have] item landed in the streamlining bucket")

_, fm_clean, _ = iter_memo(
    {"skill": "draft-footnote", "case": "happy-path", "attempt": 2, "result": "success"}, itr)
check(fm_clean.get("tier") == "unremarkable", "a clean success with no items → unremarkable")

_, fm_fail, _ = iter_memo(
    {"skill": "draft-footnote", "case": "broke", "attempt": 1, "result": "failure"}, itr)
check(fm_fail.get("tier") == "flagged", "result: failure → flagged (a broken run)")
check(fm_fail.get("status") == "failed", "result: failure → status failed")

_, fm_part, _ = iter_memo(
    {"skill": "draft-footnote", "case": "partial", "attempt": 1, "result": "partial"}, itr)
check(fm_part.get("tier") == "noted", "result: partial → noted")

# the pure mapping function, asserted directly
check(dl.tier_for_iteration("success", 1, 0, False) == "flagged", "tier_for_iteration: block → flagged")
check(dl.tier_for_iteration("success", 0, 1, False) == "noted", "tier_for_iteration: nice → noted")
check(dl.tier_for_iteration("success", 0, 0, True) == "noted", "tier_for_iteration: friction → noted")
check(dl.tier_for_iteration("success", 0, 0, False) == "unremarkable", "tier_for_iteration: clean → unremarkable")


# ── (c) iterate's BOUNDARY-REFUSAL — the safety net it now inherits ──────────
print("\n=== (c) iterate honors `refused`: a boundary edit is blocked, NOT landed ===")
# An apply-step edit (step 2d) AND a survey-step edit (step 3) both route through
# route_edits → dream_land. Each of the three boundaries → blocked.
b1 = {"summary": "soften the only-writeback rule", "paths": ["editor/AGENTS.md"],
      "intent": "clarify", "oldText": "The apply_response.py contract is the only writeback path",
      "newText": "usually the writeback path"}
b2 = {"summary": "rename a result const", "paths": ["editor/scripts/apply_response.py"],
      "intent": "script-change", "oldText": "RESULT_REJECTED = 'rejected'", "newText": "RESULT_REJECTED = 'nope'"}
b3 = {"summary": "ungate reflection in the survey", "paths": ["editor/skills/review.md"],
      "intent": "expand-guidance", "newText": "Always reflect regardless of dev mode."}
routed = dl.route_edits([b1, b2, b3])
check(len(routed.blocked) == 3 and not routed.acts and not routed.surface,
      "all three boundary edits → blocked (none acted, none surfaced)")
check({e["boundary"] for e in routed.blocked} == {B_AGENTS_DONT, B_CONTRACT_SHAPE, B_DEV_GATE},
      "blocked edits carry the three distinct boundary ids")
inline_summaries = [e["summary"] for e in routed.inline]
for e in (b1, b2, b3):
    check(e["summary"] not in inline_summaries, f"refused edit NOT landed inline: {e['summary']!r}")

# A blind boundary-file touch (no content to adjudicate) is still refused.
routed_blind = dl.route_edits([{"summary": "blind AGENTS.md edit", "paths": ["editor/AGENTS.md"]}])
check(len(routed_blind.blocked) == 1 and routed_blind.blocked[0]["boundary"] == B_AGENTS_DONT,
      "a blind AGENTS.md touch → refused by construction")


# ── (d) iterate's normal single-skill prose edit lands inline ────────────────
print("\n=== (d) a normal single-skill prose edit is NOT blocked → lands inline ===")
ok = {"summary": "tighten the anchor wording", "paths": ["editor/skills/draft-footnote.md"],
      "intent": "tighten-wording", "oldText": "add a footnote", "newText": "add a clarifying footnote"}
routed = dl.route_edits([ok])
check(len(routed.acts) == 1 and routed.acts[0]["mode"] == LAND_ACTS,
      "single-skill prose-polish edit → acts")
check(ok["summary"] in [e["summary"] for e in routed.inline], "the acts edit lands inline")
check(not routed.blocked, "a normal prose edit is never blocked")


# ── (e) a cross-skill survey edit is surfaced (proposes), not auto-worktree'd ─
print("\n=== (e) a cross-skill survey edit → surfaced for scrutiny (proposes) ===")
xskill = {"summary": "unify the Done: line across skills",
          "paths": ["editor/skills/draft-footnote.md", "editor/skills/find-citation.md"],
          "intent": "tighten-wording", "newText": "Done: <action> for <id>."}
routed = dl.route_edits([xskill])
check(len(routed.surface) == 1 and routed.surface[0]["mode"] == LAND_PROPOSES,
      "cross-skill survey edit → surface (proposes-class)")
check(xskill["summary"] in [e["summary"] for e in routed.inline],
      "iterate is synchronous: the surfaced edit STILL lands inline (just flagged)")
check(not routed.blocked and not routed.acts, "the cross-skill edit is neither blocked nor a silent act")
# A .py / manifest / structural survey edit also surfaces (not acts).
for ch, why in [
    ({"summary": "extract a helper", "paths": ["editor/scripts/anchor.py"], "intent": "new-helper"}, ".py script"),
    ({"summary": "tweak the manifest", "paths": ["docs/workspace/anchoring.md"], "intent": "clarify", "newText": "x"}, "manifest"),
    ({"summary": "merge two skills", "paths": ["editor/skills/foo.md"], "intent": "merge-skill"}, "structural"),
]:
    rr = dl.route_edits([ch])
    check(len(rr.surface) == 1, f"a {why} survey edit → surfaced (proposes), not acted")


# ── the iterations stream: DEV-ungated + the CLI agrees with the import ──────
print("\n=== iterations stream is DEV-ungated; CLI matches the import ===")
# write_iteration_memo writes regardless of VIRGIL_DEV (an explicit, synchronous
# test — not ambient capture). Prove it writes with DEV unset.
env2 = {k: v for k, v in os.environ.items() if k != "VIRGIL_DEV"}
env2.update(VIRGIL_DEV_ITERATIONS_DIR=str(work / "it-cli"), VIRGIL_ITERATE_NOW="2026-06-06T10:00:00")
r = subprocess.run([sys.executable, DEV_LOOP, "write-iteration-memo", "--json",
                    json.dumps({"skill": "review", "case": "all-kinds", "attempt": 1,
                                "result": "success", "edits": [{"severity": "block", "change": "x"}]})],
                   capture_output=True, text=True, env=env2)
check(r.returncode == 0 and "tier=flagged" in r.stdout and len(list((work / "it-cli").rglob("*.md"))) == 1,
      "write-iteration-memo CLI writes a flagged memo with DEV unset (the stream is ungated)")

r = subprocess.run([sys.executable, DEV_LOOP, "route-edits", "--edits",
                    json.dumps([b1, ok])], capture_output=True, text=True)
out = json.loads(r.stdout)
check(out["counts"] == {"acts": 1, "surface": 0, "blocked": 1},
      "route-edits CLI partitions acts/surface/blocked like the import")
check(out["blocked"][0]["boundary"] == B_AGENTS_DONT, "route-edits CLI reports the boundary id")

shutil.rmtree(work, ignore_errors=True)
print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
