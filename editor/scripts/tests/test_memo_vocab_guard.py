#!/usr/bin/env python3
r"""Memo-vocabulary guard for the dev-loop / cowork-channel disambiguation.

The term "dev memo" used to name BOTH the dev-loop reflection channel
(editor/dev/memos/, written by /editor/reflect) AND the per-paper cowork
channel (<docPath>/.virgil/memos/). That overload misrouted reflections into
the paper folder. The fix retires "dev memo" as a routing term:

  • a **reflection** (about Virgil's *skills*) → /editor/reflect → editor/dev/memos/
  • a **cowork memo / paper note** (about *a paper*) → <docPath>/.virgil/memos/

This guard pins the disambiguation in prose so it can't silently regress. It
scans the editor/ MARKDOWN surface only (the env var VIRGIL_DEV_MEMOS_DIR and
the search literals in this test live in .py files, which are out of scope and
legitimately untouched). The literal phrase "dev memo" is still allowed in a
*negation* ("dev memo" is not a trigger / do not call it a "dev memo") — the
guard forbids only the affirmative LABEL forms and the colliding trigger.

Run from anywhere:  python3 editor/scripts/tests/test_memo_vocab_guard.py
"""
import sys
from pathlib import Path

# repo root = tests/ → scripts/ → editor/ → <root>
ROOT = Path(__file__).resolve().parents[3]
EDITOR = ROOT / "editor"
MD_FILES = sorted(EDITOR.rglob("*.md"))

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def hits(needle):
    """(path, lineno, line) for every md line containing `needle` (lower-cased)."""
    out = []
    for p in MD_FILES:
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if needle in line.lower():
                out.append((p.relative_to(ROOT), i, line.strip()))
    return out


def report(rows):
    return "; ".join(f"{p}:{n}" for p, n, _ in rows) or "(none)"


# 1. The AGENTS.md root label "dev memos under <docPath>/.virgil/memos/" is gone.
affirmative_root = hits("dev memos under")
check(not affirmative_root,
      f"no doc labels the paper channel 'dev memos under …' — {report(affirmative_root)}")

# 2. The "cowork dev memo" mislabel (iterate / reflect old rule) is gone.
cowork_dev = hits("cowork dev memo")
check(not cowork_dev,
      f"no doc calls the cowork channel a 'cowork dev memo' — {report(cowork_dev)}")

# 3. The old colliding reflect trigger "capture a dev memo" is gone.
old_trigger = hits("capture a dev memo")
check(not old_trigger,
      f"'capture a dev memo' is no longer a reflect trigger — {report(old_trigger)}")

# 4. No markdown line BOTH points at the paper path AND calls it a "dev memo"
#    (the exact AGENTS.md:262 bug shape — affirmative label on the path line).
colocated = [(p, n, ln) for p, n, ln in hits(".virgil/memos")
             if "dev memo" in ln.lower()]
check(not colocated,
      f"no line co-locates '.virgil/memos' with the 'dev memo' label — {report(colocated)}")

# 5. reflect.md frontmatter carries the canonical, unambiguous trigger set
#    and NOT the retired one.
reflect_md = (EDITOR / "skills/reflect.md").read_text(encoding="utf-8")
check("capture a reflection" in reflect_md,
      "reflect.md offers the canonical trigger 'capture a reflection'")
check("log a reflection" in reflect_md,
      "reflect.md offers the canonical trigger 'log a reflection'")

# 6. The shared routing rule is stated in BOTH channel docs, identically anchored
#    on "never file a reflection under `.virgil/memos/`".
agents_md = (EDITOR / "AGENTS.md").read_text(encoding="utf-8")
rule = "never file a reflection under `.virgil/memos/`"
check(rule in agents_md, "editor/AGENTS.md states the routing rule")
check(rule in reflect_md, "editor/skills/reflect.md states the routing rule")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
