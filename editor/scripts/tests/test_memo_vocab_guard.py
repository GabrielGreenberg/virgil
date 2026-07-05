#!/usr/bin/env python3
r"""Memo-vocabulary guard for the dev-loop / cowork-channel disambiguation.

The term "dev memo" used to name BOTH the dev-loop reflection channel
(editor/dev/memos/, written by /editor/reflect) AND the per-paper cowork
channel (<docPath>/.virgil/memos/). That overload misrouted reflections into
the paper folder. The fix retires "dev memo" as a routing term:

  • a **reflection** (about Virgil's *skills*) → /editor/reflect → editor/dev/memos/
  • a **cowork memo / paper note** (about *a paper*) → <docPath>/.virgil/memos/

This guard pins the disambiguation in prose so it can't silently regress. It
scans the editor/ MARKDOWN surface (the env var VIRGIL_DEV_MEMOS_DIR and the
search literals in this test live in .py files, which are out of scope and
legitimately untouched), PLUS the two synced cross-subsystem surfaces the
editor-only scan used to miss — the library-sourced workspace template
(library/scripts/skill-bundle-template/CLAUDE.md, which lands at each folder's
.claude/CLAUDE.md) and the operational-manifest memo doc (docs/workspace/memos.md,
which lands at .claude/virgil/memos.md). Missing those is exactly how the retired
"Dev memos → .virgil/memos/" label survived in the paper-facing CLAUDE.md long
after editor/AGENTS.md was fixed. The literal phrase "dev memo" is still allowed
in a *negation* ("dev memo" is not a trigger / do not call it a "dev memo") — the
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

# ---- The broadened synced surface ------------------------------------------
# The editor/ scan above never reached the library-sourced workspace CLAUDE.md
# or the operational-manifest memo doc — the two files that actually ship into a
# user's paper/library folder. That gap is why the retired "Dev memos" label
# survived there. These checks pin the same vocabulary on those surfaces too.
SYNCED_MEMO_DOCS = [
    ROOT / "library/scripts/skill-bundle-template/CLAUDE.md",  # → .claude/CLAUDE.md
    ROOT / "docs/workspace/memos.md",                          # → .claude/virgil/memos.md
]


def synced_hits(needle):
    out = []
    for p in SYNCED_MEMO_DOCS:
        for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if needle in line.lower():
                out.append((p.relative_to(ROOT), i, line.strip()))
    return out


# 7. No synced surface co-locates the paper path with the retired "dev memo"
#    label (the exact bug this task fixed — check #4's shape, wider scope).
synced_colocated = [(p, n, ln) for p, n, ln in synced_hits(".virgil/memos")
                    if "dev memo" in ln.lower()]
check(not synced_colocated,
      f"no synced memo doc co-locates '.virgil/memos' with the 'dev memo' label — {report(synced_colocated)}")

# 8. Both synced surfaces carry the shared routing-rule literal, so the
#    reflect-vs-cowork decision travels into every paper/library folder — not
#    just the editor repo docs. (Case-insensitive: the rule opens a sentence in
#    the CLAUDE.md template, so its "Never" is capitalized there.)
for p in SYNCED_MEMO_DOCS:
    text = p.read_text(encoding="utf-8").lower()
    check(rule in text, f"{p.relative_to(ROOT)} states the routing rule")

# 9. The manifest memo doc is a real SSOT, not a stub — it names all three
#    streams (cowork / library / reflection).
memos_md = (ROOT / "docs/workspace/memos.md").read_text(encoding="utf-8").lower()
check("cowork memo" in memos_md and "library memo" in memos_md and "reflection" in memos_md,
      "docs/workspace/memos.md names all three memo streams")

# 10. The library skill prompts that carry the "where any memo goes" reminder
#     (they ship to .claude/commands/library/) must label their pipeline stream
#     a **library memo**, never the retired "dev memo" — same overload, same
#     synced surface, so same guard. Scan every library skill that mentions the
#     memo path; flag any line co-locating it with the retired label.
LIBRARY_SKILL_DIR = ROOT / "library/skills"
lib_skill_hits = []
lib_skill_affirm = []
for p in sorted(LIBRARY_SKILL_DIR.glob("*.md")):
    for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
        low = line.lower()
        if ".virgil/memos" in low and "dev memo" in low:
            lib_skill_hits.append((p.relative_to(ROOT), i, line.strip()))
        # The affirmative LABEL/INSTRUCTION forms (path may be on the next line,
        # so co-location alone misses them — this is the merge-bibs.md shape).
        if "write a dev memo" in low or "dev memos (" in low:
            lib_skill_affirm.append((p.relative_to(ROOT), i, line.strip()))
check(not lib_skill_hits,
      f"no library skill co-locates '.virgil/memos' with the 'dev memo' label — {report(lib_skill_hits)}")
check(not lib_skill_affirm,
      f"no library skill uses the retired 'dev memo' as an affirmative label — {report(lib_skill_affirm)}")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
