#!/usr/bin/env python3
r"""Capture-slice test for the dev-dream day half — /editor/reflect (chip 17).

Runs the real reflect.py CLI against fresh copies of samples/annotation-history
(never mutating the sample), with the memo root + clock pinned to a temp dir via
the VIRGIL_DEV_MEMOS_DIR / VIRGIL_REFLECT_NOW seams. Asserts:

  • the DEV gate: VIRGIL_DEV unset → no memo, exit 0
  • every apply_response RESULT_* maps to the right tier floor (and the sync
    invariant: ALL_RESULTS ⊆ RESULT_TIER)
  • signal-bearing outcomes seed the right bucket
  • the agent's four buckets land under their titles
  • the user-tag tier promotion (noted → flagged) + idempotent accumulation
  • the --fix-now fast-path flag (→ flagged)
  • idempotency (same Task → one memo; Task-less → one floor per skill/doc/day,
    tallied in `runs`, merging rather than clobbering a same-second sibling)
  • a bib-review Task (status-only, no result)
  • the frontmatter round-trips (what chip 18's dream reads)

Run from anywhere:  python3 editor/scripts/tests/test_reflect_capture_slice.py
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

sys.path.insert(0, str(SCRIPTS))
from reflect import RESULT_TIER, TIER_ORDER, _parse_memo  # noqa: E402
from apply_response import ALL_RESULTS, FAIL_RESULTS  # noqa: E402

PASS, FAIL = 0, 0
NOW = "2026-06-06T12:00:00"


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="chip17-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def set_task(doc, idx, *, status, result):
    p = doc / "virgil" / "ai-requests.json"
    ar = json.loads(p.read_text())
    r = ar["requests"][idx]
    r["status"] = status
    if result is None:
        r.pop("result", None)
    else:
        r["result"] = result
    p.write_text(json.dumps(ar, indent=2) + "\n")
    return r["id"]


def task_id(doc, idx=0):
    ar = json.loads((doc / "virgil" / "ai-requests.json").read_text())
    return ar["requests"][idx]["id"]


def run(memos, *args, dev=True, now=NOW):
    env = dict(os.environ)
    env["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    env["VIRGIL_REFLECT_NOW"] = now
    if dev:
        env["VIRGIL_DEV"] = "1"
    else:
        env.pop("VIRGIL_DEV", None)
    return subprocess.run([sys.executable, REFLECT, *args],
                          capture_output=True, text=True, env=env)


def memo_files(memos):
    return sorted(Path(memos).rglob("*.md"))


def only_memo(memos):
    files = memo_files(memos)
    return files[0] if len(files) == 1 else None


def fm_of(path):
    fm, _ = _parse_memo(Path(path).read_text())
    return fm


def body_of(path):
    return Path(path).read_text()


# ── sync invariant: every contract result has a tier floor ───────────────────
print("\n=== sync invariant: ALL_RESULTS ⊆ RESULT_TIER ===")
for r in sorted(ALL_RESULTS):
    check(r in RESULT_TIER, f"result '{r}' has a tier floor in reflect.RESULT_TIER")
check(set(RESULT_TIER) == set(ALL_RESULTS),
      "RESULT_TIER keys == ALL_RESULTS exactly (no extra/missing)")
for t in RESULT_TIER.values():
    check(t in TIER_ORDER, f"tier floor '{t}' is a known tier")


# ── the DEV gate ─────────────────────────────────────────────────────────────
print("\n=== DEV gate: off → no memo, on → memo ===")
sb = sandbox()
mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="complete", result="silent-applied")
r = run(mem, str(sb), "draft-footnote", rid, dev=False)
check(r.returncode == 0, "DEV-off exits 0")
check(len(memo_files(mem)) == 0, "DEV-off wrote NO memo")
check("DEV mode off" in r.stdout, "DEV-off says it skipped")

r = run(mem, str(sb), "draft-footnote", rid, dev=True)
check(r.returncode == 0, f"DEV-on exits 0 (stderr={r.stderr.strip()[:120]})")
check(len(memo_files(mem)) == 1, "DEV-on wrote exactly one memo")


# ── every result → its tier floor (+ correct seed bucket) ───────────────────
print("\n=== result → tier floor ===")
SEED_BUCKET = {  # signal-bearing outcomes seed this section
    "rejected": "Alignment / fit",
    "refused": "Issues / ambiguities / errors",
    "impossible": "Issues / ambiguities / errors",
    "errored": "Issues / ambiguities / errors",
}
for result, want_tier in sorted(RESULT_TIER.items()):
    sb = sandbox()
    mem = tempfile.mkdtemp(prefix="chip17m-")
    status = "failed" if result in FAIL_RESULTS else "complete"
    rid = set_task(sb, 0, status=status, result=result)
    r = run(mem, str(sb), "draft-suggestion", rid)
    f = only_memo(mem)
    check(f is not None, f"{result}: one memo written")
    if f:
        fm = fm_of(f)
        check(fm.get("tier") == want_tier,
              f"{result}: tier={fm.get('tier')} (want {want_tier})")
        check(fm.get("result") == result, f"{result}: frontmatter result echoes the contract")
        seed = SEED_BUCKET.get(result)
        if seed:
            body = body_of(f)
            seg = body.split(f"## {seed}", 1)[-1].split("\n## ", 1)[0]
            check("None." not in seg and seg.strip(),
                  f"{result}: seeded the '{seed}' bucket (not empty)")

# A Level-3 draft (in-progress, no result) and a Task-less op → unremarkable.
print("\n=== no-result outcomes → unremarkable ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="in-progress", result=None)
run(mem, str(sb), "draft-suggestion", rid)
check(fm_of(only_memo(mem)).get("tier") == "unremarkable",
      "in-progress/no-result → unremarkable")

sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
r = run(mem, str(sb), "archive-card", "-")
f = only_memo(mem)
check(f is not None and fm_of(f).get("tier") == "unremarkable",
      "Task-less op (taskId=-) → unremarkable")
check(f is not None and fm_of(f).get("result") in ("", None),
      "Task-less op records empty result")

# status: failed with no classified result → noted (not silently unremarkable).
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="failed", result=None)
run(mem, str(sb), "draft-suggestion", rid)
check(fm_of(only_memo(mem)).get("tier") == "noted",
      "failed status + no result → noted")


# ── the agent's four buckets land under their titles ─────────────────────────
print("\n=== agent buckets land verbatim ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="complete", result="silent-applied")
memo_json = json.dumps({
    "buckets": {
        "issues": "ISSUE-MARKER the anchor lookup was ambiguous",
        "streamlining": "STREAM-MARKER re-derived find_request inline",
        "alignment": "ALIGN-MARKER the terse default felt wrong",
    },
    "summary": "Added footnote for 3301.",
})
r = run(mem, str(sb), "draft-footnote", rid, "--memo-json", memo_json)
body = body_of(only_memo(mem))
check("ISSUE-MARKER" in body.split("## Streamlining")[0], "issues bucket body landed")
check("STREAM-MARKER" in body, "streamlining bucket body landed")
check("ALIGN-MARKER" in body, "alignment bucket body landed")
check("**Done:** Added footnote for 3301." in body, "Done summary rendered")


# ── user-tag promotion + idempotent accumulation ─────────────────────────────
print("\n=== user-tag tier promotion (noted → flagged), idempotent ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="complete", result="rejected")
run(mem, str(sb), "draft-suggestion", rid)  # baseline: rejected → noted
first = only_memo(mem)
check(first is not None and fm_of(first).get("tier") == "noted", "baseline tier=noted")

# After-the-fact "put this in the memo" (later clock) → SAME file, → flagged.
run(mem, str(sb), "draft-suggestion", rid, "--tag", "TAG-A wrong tone default",
    now="2026-06-06T13:30:00")
check(len(memo_files(mem)) == 1, "tag run updated the SAME memo (still 1 file)")
same = only_memo(mem)
check(fm_of(same).get("tier") == "flagged", "user tag promoted tier → flagged")
check("- TAG-A wrong tone default" in body_of(same), "tag appended under User-tagged")
check(fm_of(same).get("reflectedAt", "").startswith("2026-06-06T12:00:00"),
      "reflectedAt kept from the first reflection (the memo is the Task's)")

# Re-tagging with the same text does not duplicate the bullet.
run(mem, str(sb), "draft-suggestion", rid, "--tag", "TAG-A wrong tone default",
    now="2026-06-06T14:00:00")
check(body_of(only_memo(mem)).count("- TAG-A wrong tone default") == 1,
      "identical tag is deduped (no double bullet)")
# A second distinct tag accumulates.
run(mem, str(sb), "draft-suggestion", rid, "--tag", "TAG-B also the spacing",
    now="2026-06-06T14:05:00")
b = body_of(only_memo(mem))
check("- TAG-A wrong tone default" in b and "- TAG-B also the spacing" in b,
      "distinct tags accumulate")

# A pure-tag run preserves the analytic buckets it never touched.
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="complete", result="silent-applied")
run(mem, str(sb), "draft-footnote", rid, "--memo-json",
    json.dumps({"buckets": {"issues": "KEEP-ME ambiguity"}}))
run(mem, str(sb), "draft-footnote", rid, "--tag", "late thought")
b = body_of(only_memo(mem))
check("KEEP-ME ambiguity" in b, "pure --tag run preserved the prior analytic bucket")
check("- late thought" in b, "pure --tag run appended the tag")

# ...but a SUPPLIED bucket REPLACES rather than appends. The two facts sit
# together deliberately: --tag's "additive across runs" is a property of TAGS,
# and a reader who carries that promise across to --memo-json silently destroys
# the paragraph they meant to extend (measured 2026-08-17, in the dream's own
# step 8). The help text now says so; this is what keeps it true.
run(mem, str(sb), "draft-footnote", rid, "--memo-json",
    json.dumps({"buckets": {"issues": "SECOND THOUGHT only"}}))
b = body_of(only_memo(mem))
check("SECOND THOUGHT only" in b, "a supplied bucket lands")
check("KEEP-ME ambiguity" not in b,
      "a supplied bucket REPLACES the prior body — it does not append")
check("- late thought" in b, "…while the additive tag channel is untouched")


# ── --fix-now fast-path flag ─────────────────────────────────────────────────
print("\n=== --fix-now → flagged + fixNow:true ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="complete", result="silent-applied")  # floor unremarkable
run(mem, str(sb), "draft-footnote", rid, "--fix-now")
fm = fm_of(only_memo(mem))
check(fm.get("tier") == "flagged", "--fix-now promotes tier → flagged")
check(str(fm.get("fixNow")).lower() == "true", "--fix-now sets fixNow:true")


# ── confidence:low → flagged ─────────────────────────────────────────────────
print("\n=== confidence:low → flagged ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="complete", result="accepted")  # floor unremarkable
run(mem, str(sb), "accept-suggestion", rid, "--memo-json",
    json.dumps({"confidence": "low"}))
check(fm_of(only_memo(mem)).get("tier") == "flagged", "low self-confidence → flagged")


# ── Task-less ops COALESCE per (skill, doc, day) ─────────────────────────────
# They used to be "never deduped — each gets a fresh file", which made the
# tail-trigger's floor un-enrichable by construction (no key → nothing for a
# later reflection to find) and left its only dedup to filename collision at
# one-second granularity, which CLOBBERS rather than merges. See
# reflect._find_existing.
print("\n=== Task-less ops coalesce per (skill, doc, day) ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
run(mem, str(sb), "archive-card", "-", now="2026-06-06T09:00:00")
run(mem, str(sb), "archive-card", "-", now="2026-06-06T09:00:01")
check(len(memo_files(mem)) == 1, "two Task-less reflections → ONE memo (the day's floor)")
check(fm_of(only_memo(mem)).get("runs") == "2", "the floor tallies runs=2")
check(fm_of(only_memo(mem)).get("doc") == str(sb.resolve()),
      "the floor names its paper (resolved path — two same-named papers must not merge)")

# A different SKILL on the same day gets its own floor.
run(mem, str(sb), "edit-card", "-", now="2026-06-06T09:00:02")
check(len(memo_files(mem)) == 2, "a different skill → its own floor")

# A different DAY gets its own floor (the key's third term).
run(mem, str(sb), "archive-card", "-", now="2026-06-07T09:00:00")
check(len(memo_files(mem)) == 3, "the next day → a fresh floor")

# THE POINT: content survives a same-second contentless tail-trigger. Before the
# key existed, the second call overwrote the first and the reflection was lost.
sb2 = sandbox(); mem2 = tempfile.mkdtemp(prefix="chip17m-")
run(mem2, str(sb2), "edit-card", "-", "--memo-json",
    '{"buckets": {"issues": "REAL SIGNAL"}}', now="2026-06-06T09:00:00")
run(mem2, str(sb2), "edit-card", "-", now="2026-06-06T09:00:00")  # same second
check(len(memo_files(mem2)) == 1, "same-second task-less pair → one memo")
check("REAL SIGNAL" in body_of(only_memo(mem2)),
      "a contentless floor MERGES into the reflection instead of clobbering it")

# Two papers on the same day never merge their floors.
sb3 = sandbox(); mem3 = tempfile.mkdtemp(prefix="chip17m-")
run(mem3, str(sb), "edit-card", "-", now="2026-06-06T09:00:00")
run(mem3, str(sb3), "edit-card", "-", now="2026-06-06T09:00:01")
check(len(memo_files(mem3)) == 2, "two papers, same skill+day → two floors")

# Task-BEARING memos carry no runs tally (one memo per Task is an update, not a
# second event).
sb4 = sandbox(); mem4 = tempfile.mkdtemp(prefix="chip17m-")
rid4 = set_task(sb4, 0, status="complete", result="accepted")
run(mem4, str(sb4), "accept-suggestion", rid4, now="2026-06-06T09:00:00")
check(fm_of(only_memo(mem4)).get("runs") is None, "a task-bearing memo has no runs key")


# ── propose→accept lifecycle: two skills, one taskId → two memos ────────────
print("\n=== lifecycle: draft then accept on one taskId → two memos ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="in-progress", result=None)  # the draft step
run(mem, str(sb), "draft-suggestion", rid, now="2026-06-06T12:00:00")
check(len(memo_files(mem)) == 1, "draft step wrote one memo")
# Later the user accepts → accept-suggestion runs on the SAME taskId.
set_task(sb, 0, status="complete", result="accepted")
run(mem, str(sb), "accept-suggestion", rid, now="2026-06-06T12:05:00")
files = memo_files(mem)
check(len(files) == 2, "accept on the same taskId → a SECOND memo (no clobber)")
skills = {fm_of(f).get("skill") for f in files}
check(skills == {"draft-suggestion", "accept-suggestion"},
      "the two memos belong to the two distinct skills")
# Re-running draft-suggestion is still idempotent (updates its own, not accept's).
run(mem, str(sb), "draft-suggestion", rid, now="2026-06-06T12:09:00")
check(len(memo_files(mem)) == 2, "re-running draft-suggestion stays idempotent (2 files)")


# ── a bib-review Task (status-only, no result) ──────────────────────────────
print("\n=== bib-review Task (status-only) ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
# samples/annotation-history ships a grafton1997 fields review.
r = run(mem, str(sb), "answer-bib-review", "grafton1997")
f = only_memo(mem)
check(f is not None, f"bib-review memo written (stderr={r.stderr.strip()[:120]})")
if f:
    fm = fm_of(f)
    check(fm.get("kind") == "bib-review", "kind=bib-review")
    check(fm.get("result") in ("", None), "bib-review carries no result (status-only)")
    check(fm.get("tier") == "unremarkable", "bib-review clean → unremarkable")


# ── frontmatter round-trips (what the dream reads) ──────────────────────────
print("\n=== frontmatter round-trips ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="chip17m-")
rid = set_task(sb, 0, status="complete", result="rejected")
run(mem, str(sb), "draft-suggestion", rid)
fm = fm_of(only_memo(mem))
for key in ("skill", "taskId", "kind", "status", "result", "tier", "fixNow",
            "reflectedAt", "skillSha"):
    check(key in fm, f"frontmatter carries '{key}'")
check(fm.get("taskId") == rid, "frontmatter taskId matches the Task")
check(fm.get("skill") == "draft-suggestion", "frontmatter skill matches")


# ── a supplied bucket REPLACES; only tags accumulate — and it SAYS so ────────
# The 2026-08-17 dream read `--tag`'s "Repeatable. Additive" across to
# `--memo-json`, sent one bucket to append a late finding, and silently
# destroyed the paragraph already there (caught by a character count). The
# behaviour is deliberate — the analytic buckets are this run's reflection —
# so the fix is the documentation, and this pins BOTH halves: the semantics,
# and the two surfaces that have to state them (the agent reads the skill
# markdown; a maintainer reads the script header).
print("\n=== --memo-json buckets REPLACE (documented, not additive) ===")

sb = sandbox(); mem = tempfile.mkdtemp(prefix="reflect-replace-")
rid = task_id(sb)
run(mem, str(sb), "draft-footnote", rid, "--memo-json",
    json.dumps({"buckets": {"issues": "first finding", "alignment": "keep me"}}))
run(mem, str(sb), "draft-footnote", rid, "--memo-json",
    json.dumps({"buckets": {"issues": "second finding"}}))
text = body_of(only_memo(mem))
check("second finding" in text, "a re-sent bucket lands")
check("first finding" not in text,
      "…and REPLACES the prior body (it does not append) — the behaviour the docs must state")
check("keep me" in text, "an OMITTED bucket is preserved")

run(mem, str(sb), "draft-footnote", rid, "--tag", "tag one")
run(mem, str(sb), "draft-footnote", rid, "--tag", "tag two")
text = body_of(only_memo(mem))
check("tag one" in text and "tag two" in text,
      "…while --tag really is additive (which is what got read across)")

REFLECT_HEADER = Path(REFLECT).read_text(encoding="utf-8")
flat = " ".join(REFLECT_HEADER.split())
check("REPLACES that bucket's prior body" in flat,
      "reflect.py's header states that a supplied bucket replaces")
skill_flat = " ".join((ROOT / "editor/skills/reflect.md").read_text(encoding="utf-8").split())
check("REPLACES that bucket's prior body" in skill_flat,
      "reflect.md states it too — the agent reads the skill, not the script header")
check("true of TAGS, not of buckets" in skill_flat and "true of TAGS, not of buckets" in flat,
      "…and both name the exact cross-reading that caused the loss")


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
