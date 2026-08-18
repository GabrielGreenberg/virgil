#!/usr/bin/env python3
r"""The digest must not advance its marker onto THIS run's own step-8 memo.

The measured incident (2026-08-17, corrected BY HAND in that digest's
frontmatter, and handed forward by that night's self-memo as "the concrete one
to pick up"):

  step 7  digest run 1        → marker = M, the last memo it consumed
  step 8  reflect             → writes a skill=dream self-memo S (S > M)
  step 4  digest run 2        (a SANCTIONED same-day re-run, to correct two
                               landing outcomes) → re-selects, finds S, and
                               advances the marker onto it.

The next dream then selects ZERO memos and the whole reflection is lost —
silently, with every gate green.  `_rotate_prior_digest`'s docstring asserted
the marker was safe here ("an empty re-select preserves it"); the re-select is
empty only while nothing was written between the two digest calls, and step 8
guarantees one WAS.

The fix is `_advance_marker`: never settle on a TRAILING skill=dream memo
written after the last digest ran.  Failure direction is deliberate — a held
marker costs the next dream a redundant RE-READ (bounded, self-healing);
advancing too far LOSES a reflection outright.

Run from anywhere:  python3 editor/scripts/tests/test_dream_marker_hold.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
REFLECT = str(SCRIPTS / "reflect.py")
DREAM = str(SCRIPTS / "dream.py")

sys.path.insert(0, str(SCRIPTS))
from dream import _advance_marker  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="markerhold-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def reflect(memos, doc, skill, task_id, *args, now):
    env = dict(os.environ)
    env["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    env["VIRGIL_REFLECT_NOW"] = now
    env["VIRGIL_DEV"] = "1"
    r = subprocess.run([sys.executable, REFLECT, str(doc), skill, task_id, *args],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return r


def dream(memos, digests, sub, *args, now):
    env = dict(os.environ)
    env["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    env["VIRGIL_DREAM_DIGESTS_DIR"] = str(digests)
    env["VIRGIL_DREAM_NOW"] = now
    env["VIRGIL_DEV"] = "1"
    r = subprocess.run([sys.executable, DREAM, sub, *args],
                       capture_output=True, text=True, env=env)
    assert r.returncode == 0, r.stderr
    return r


def select(memos, digests, now):
    return json.loads(dream(memos, digests, "select", now=now).stdout)


# ── the unit contract ────────────────────────────────────────────────────────
print("\n=== _advance_marker: the rule ===")

PRIOR = "2026-08-17T06:00:00.000Z"


def rec(ts, skill, name):
    return {"path": f"2026-08-17/{name}.md", "skill": skill, "reflectedAt": ts}


real = rec("2026-08-17T05:00:00.000Z", "draft-footnote", "05-00-00-draft-footnote")
own = rec("2026-08-17T06:31:00.000Z", "dream", "06-31-00-dream")
consumed = rec("2026-08-17T05:30:00.000Z", "dream", "05-30-00-dream")

m, held = _advance_marker([real, own], ("old", "old.md"), PRIOR)
check(m[0] == real["reflectedAt"], "trailing self-memo written AFTER the last digest is not the marker")
check(held == [own["path"]], f"…and is reported as held (got {held})")

m, held = _advance_marker([consumed, real], ("old", "old.md"), PRIOR)
check(m[0] == real["reflectedAt"] and held == [],
      "a non-dream memo is always eligible")

m, held = _advance_marker([consumed], ("old", "old.md"), PRIOR)
check(m[0] == consumed["reflectedAt"] and held == [],
      "a self-memo PREDATING the last digest was dreamed over → eligible")

m, held = _advance_marker([own], ("old", "old.md"), PRIOR)
check(m == ("old", "old.md") and held == [own["path"]],
      "a window of ONLY this run's self-memo keeps the inherited marker")

m, held = _advance_marker([real, own], ("old", "old.md"), "")
check(m[0] == own["reflectedAt"] and held == [],
      "no prior digest (bootstrap) → nothing is held")

m, held = _advance_marker([], ("old", "old.md"), PRIOR)
check(m == ("old", "old.md"), "empty window keeps the inherited marker")

# The high-water property: a later real memo covers earlier self-memos.
m, held = _advance_marker([own, real], ("old", "old.md"), PRIOR)
check(m[0] == real["reflectedAt"] and held == [],
      "a self-memo followed by a real memo needs no hold (high-water covers it)")


# ── the 2026-08-17 incident, end to end ──────────────────────────────────────
print("\n=== the incident: digest → reflect → digest re-run ===")

sb = sandbox()
mem = tempfile.mkdtemp(prefix="markerholdm-")
dig = tempfile.mkdtemp(prefix="markerholdd-")

# A real skill runs, and dream night 1 consumes it.
reflect(mem, sb, "draft-footnote", "-", now="2026-08-17T05:00:00")
dream(mem, dig, "digest", now="2026-08-17T06:00:00")
after_run1 = select(mem, dig, now="2026-08-17T06:10:00")
check(after_run1["memoCount"] == 0, "run 1 consumed the real memo (nothing left)")

# Step 8: the dream reflects on ITSELF.
reflect(mem, sb, "dream", "-", "--memo-json",
        json.dumps({"buckets": {"issues": "the reflection that must survive"}}),
        now="2026-08-17T06:31:00")

# What step 1 of a dream sees while its own self-memo is the newest thing:
# the flag is TRUE here, which is the moment the re-run's digest reads it.
mid = select(mem, dig, now="2026-08-17T06:32:00")
check(mid.get("markerHeld") == ["2026-08-17/06-31-00-dream.md"],
      f"select publishes markerHeld for the prompt to read "
      f"(got {mid.get('markerHeld')!r})")

# Step 4's sanctioned same-day re-run, AFTER step 8.
dream(mem, dig, "digest", now="2026-08-17T06:33:42")

after_rerun = select(mem, dig, now="2026-08-17T07:00:00")
check(after_rerun["memoCount"] == 1,
      f"the next dream still reads the self-memo (got {after_rerun['memoCount']})")
check(any(m["skill"] == "dream" for m in after_rerun["memos"]),
      "…and it is the skill=dream reflection, not something else")
body = json.dumps(after_rerun["memos"])
check("the reflection that must survive" in body,
      "…with its buckets intact")

# The digest says so, rather than leaving the next reader to re-derive it.
latest = sorted(Path(dig).glob("2026-08-17.md"))[0].read_text()
check("markerHeld: 2026-08-17/06-31-00-dream.md" in latest,
      "the digest records WHICH memo the marker was held from")
released = select(mem, dig, now="2026-08-17T06:35:00")
check(released.get("markerHeld") == [],
      f"the hold RELEASES once a later digest exists — it is not a permanent "
      f"quarantine (got {released.get('markerHeld')!r})")

# Non-regression: the marker still advances on an ordinary night.
reflect(mem, sb, "find-citation", "-", now="2026-08-18T05:00:00")
dream(mem, dig, "digest", now="2026-08-18T06:00:00")
after_night2 = select(mem, dig, now="2026-08-18T07:00:00")
check(after_night2["memoCount"] == 0,
      "an ordinary night consumes both the self-memo and the new real memo")

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
