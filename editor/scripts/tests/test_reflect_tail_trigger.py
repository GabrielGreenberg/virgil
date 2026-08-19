#!/usr/bin/env python3
r"""Cowork-capture slice — the apply_response reflect TAIL-TRIGGER + the sink SSOT.

This is the "day" floor that makes paper-directed cowork sessions accumulate
dev-dream memos WITHOUT the agent remembering to reflect: every writeback through
apply_response's commit finalizers (cmd_write / _mutation_commit) fires
/editor/reflect best-effort, into the ONE machine-global sink (so the repo-side
dream reads exactly where reflect wrote — even though the scripts ran from a
paper's .virgil/scripts/editor/ copy).

The trigger lives in the two SHARED finalizers, NOT in main(), so it also fires
for create_card.py's IN-PROCESS run_write_subcommand path (the card-creation
responder family) — the regression guard for that gap. The skill is named from
the Task's kind (writes) / the op label (mutations), so it MATCHES the
umbrella/convention reflection and merges into one (skill, taskId) memo.

Runs the real CLIs against fresh copies of samples/annotation-history (never
mutating the sample), the memo sink pinned to a temp dir. Asserts:

  • the SSOT identity invariant: reflect._memos_root() == dream._memos_root()
    == _common.memos_root(); machine-global default; env pins honored; a
    RELATIVE override anchors to $HOME (not cwd) so writer==reader still holds
  • a WRITE via create_card.py's in-process path (VIRGIL_DEV=1) → one memo,
    skill named from the Task kind (answer-note-request), in the PINNED sink
  • a WRITE via the apply_response CLI (complete-only) → one memo, skill from
    the Task kind (draft-footnote / find-citation)
  • a MUTATION (update / archive) → one memo, skill from the op label
  • the DEV gate: VIRGIL_DEV unset → the writeback succeeds, NO memo

Run from anywhere:  python3 editor/scripts/tests/test_reflect_tail_trigger.py
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
APPLY = str(SCRIPTS / "apply_response.py")
CREATE = str(SCRIPTS / "create_card.py")

sys.path.insert(0, str(SCRIPTS))
import _common  # noqa: E402
import reflect  # noqa: E402
import dream  # noqa: E402
from reflect import _parse_memo  # noqa: E402

PASS, FAIL = 0, 0

# In-sample ids (from samples/annotation-history/virgil/*.json).
NOTE_CARD = "ea4d5253-406d-499e-85b6-8055956c9f95"  # notes.json (a card, for mutations)
TODO_CARD = "ab7e7930-78cb-4d4c-b400-9ac04906a8fd"  # todos.json
REQ_FOOTNOTE = "ad4a69b1-9207-473b-ae54-7dcfbb80e8b4"  # ai-requests.json, kind=footnote
REQ_NOTE = "826ec44d-3572-4e53-8f4d-6c877fe02715"       # ai-requests.json, kind=note
REQ_CITATION = "2d92d440-15ad-47ef-a216-de86c78ccae7"   # ai-requests.json, kind=citation


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="cowork-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def env_for(memos, *, dev=True):
    e = dict(os.environ)
    e["VIRGIL_DEV_MEMOS_DIR"] = str(memos)
    e["VIRGIL_REFLECT_NOW"] = "2026-07-05T12:00:00"
    if dev:
        e["VIRGIL_DEV"] = "1"
    else:
        # Explicit "0", not pop: with the machine dev-mode marker, an unset
        # env falls through to the marker and this helper would read ON.
        e["VIRGIL_DEV"] = "0"
    return e


def run(argv, memos, *, dev=True):
    return subprocess.run([sys.executable, *argv], capture_output=True, text=True,
                          env=env_for(memos, dev=dev))


def memo_files(memos):
    return [p for p in sorted(Path(memos).rglob("*.md")) if p.name != ".gitkeep"]


def only_skill(memos):
    fs = memo_files(memos)
    if len(fs) != 1:
        return None
    fm, _ = _parse_memo(fs[0].read_text())
    return fm.get("skill")


# ── the SSOT identity invariant (writer == reader, machine-global) ───────────
print("\n=== sink SSOT: writer==reader, machine-global, relative→$HOME ===")
_saved = {k: os.environ.get(k) for k in
          ("VIRGIL_DEV_MEMOS_DIR", "VIRGIL_DREAM_DIGESTS_DIR", "VIRGIL_DEV_HOME")}
for k in _saved:
    os.environ.pop(k, None)
try:
    a, b, c = reflect._memos_root(), dream._memos_root(), _common.memos_root()
    check(a == b == c, f"reflect==dream==common memos_root ({a})")
    check("Programming/virgil" not in str(c) and str(c).endswith(".virgil-dev/memos"),
          "default is the machine-global home, NOT a repo-relative path")
    check(_common.digests_root() == dream._digests_root(),
          "digests_root shared between dream and _common")
    os.environ["VIRGIL_DEV_HOME"] = "/tmp/vh"
    check(_common.memos_root() == Path("/tmp/vh/memos").resolve(),
          "absolute VIRGIL_DEV_HOME relocates the home")
    # A RELATIVE override must anchor to $HOME, never cwd, so a paper-cwd writer
    # and a repo-cwd reader still resolve the SAME dir (the LOW-finding fix). A
    # home-anchored result is inherently cwd-independent; assert it while cwd is
    # demonstrably NOT $HOME (if it were cwd-anchored it'd be cwd/relhome/memos).
    os.environ["VIRGIL_DEV_HOME"] = "relhome"
    want = (Path.home() / "relhome" / "memos").resolve()
    check(os.getcwd() != str(Path.home()) and _common.memos_root() == want
          and reflect._memos_root() == dream._memos_root() == want,
          f"relative VIRGIL_DEV_HOME anchors to $HOME, not cwd ({want})")
    os.environ.pop("VIRGIL_DEV_HOME")
    os.environ["VIRGIL_DEV_MEMOS_DIR"] = "/tmp/pin/m"
    check(reflect._memos_root() == dream._memos_root() == Path("/tmp/pin/m").resolve(),
          "VIRGIL_DEV_MEMOS_DIR pin honored by writer AND reader")
    os.environ.pop("VIRGIL_DEV_MEMOS_DIR")
finally:
    for k, v in _saved.items():
        if v is not None:
            os.environ[k] = v


# ── WRITE via create_card.py's IN-PROCESS path (the HIGH-finding guard) ─────
print("\n=== create_card.py (in-process cmd_write) → one memo, skill from Task kind ===")
sb = sandbox()
mem = tempfile.mkdtemp(prefix="cowork-m-")
r = run([CREATE, str(sb), REQ_NOTE, "--kind", "note", "--body", "auto-capture probe.",
         "--safety-level", "1"], mem)
check(r.returncode == 0, f"create_card note exits 0 (stderr={r.stderr.strip()[:160]})")
check(len(memo_files(mem)) == 1, f"in-process write auto-wrote exactly one memo ({len(memo_files(mem))})")
check(only_skill(mem) == "answer-note-request",
      f"skill named from Task kind note → answer-note-request (got {only_skill(mem)})")
if memo_files(mem):
    check(_common.dot_virgil_dir(sb) not in memo_files(mem)[0].parents,
          "memo is in the PINNED sink, NOT under the paper's .virgil/ (doc-independent)")


# ── WRITE via the apply_response CLI (complete-only) → Task-kind skill ───────
print("\n=== apply_response CLI complete-only → skill from Task kind ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
run([APPLY, str(sb), "complete-only", REQ_FOOTNOTE], mem)
check(only_skill(mem) == "draft-footnote",
      f"footnote Task → draft-footnote (got {only_skill(mem)})")

sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
run([APPLY, str(sb), "complete-only", REQ_CITATION], mem)
check(only_skill(mem) == "find-citation",
      f"citation Task → find-citation (got {only_skill(mem)})")


def inject_request(doc, req):
    p = doc / "virgil" / "ai-requests.json"
    ar = json.loads(p.read_text())
    ar["requests"].append(req)
    p.write_text(json.dumps(ar, indent=2) + "\n")
    return req["id"]


# ── bridged comment rows ride kind="suggestion" — disambiguate by panel ─────
print("\n=== bridged comment (kind=suggestion + panel) → answer-*-comment ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
rid = inject_request(sb, {"id": "req-cutter-x", "kind": "suggestion", "status": "submitted",
                          "linkedTo": {"panel": "cutter", "cardId": "c1"}, "text": "…"})
run([APPLY, str(sb), "complete-only", rid], mem)
check(only_skill(mem) == "answer-cutter-comment",
      f"kind=suggestion + panel cutter → answer-cutter-comment (got {only_skill(mem)})")

sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
rid = inject_request(sb, {"id": "req-rev-x", "kind": "suggestion", "status": "submitted",
                          "linkedTo": {"panel": "revisions", "cardId": "c2"}, "text": "…"})
run([APPLY, str(sb), "complete-only", rid], mem)
check(only_skill(mem) == "answer-revision-request",
      f"kind=suggestion + panel revisions → answer-revision-request (got {only_skill(mem)})")

# A NATIVE suggestion (no linkedTo panel) still → draft-suggestion.
sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
run([APPLY, str(sb), "complete-only", "b5c93b58-33be-4ab5-bc9e-4507fa16e33a"], mem)
check(only_skill(mem) == "draft-suggestion",
      f"native suggestion Task → draft-suggestion (got {only_skill(mem)})")


# ── virtual card-flag reply → the answer-* skill from the panel, not "apply" ─
print("\n=== virtual:<panel>:<cardId> card-flag reply → panel-named skill ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
r = run([CREATE, str(sb), f"virtual:notes:{NOTE_CARD}", "--kind", "note",
         "--body", "flag reply", "--anchor", "2201", "--safety-level", "1"], mem)
check(r.returncode == 0, f"virtual note reply exits 0 (stderr={r.stderr.strip()[:160]})")
check(only_skill(mem) == "answer-note-request",
      f"virtual:notes → answer-note-request, NOT 'apply' (got {only_skill(mem)})")


# ── MUTATIONS → skill from the op label (via _OP_SKILL) ──────────────────────
print("\n=== mutations → skill from the op label ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
r = run([APPLY, str(sb), "update", json.dumps({"cardId": NOTE_CARD, "body": "x"})], mem)
check(r.returncode == 0 and only_skill(mem) == "edit-card",
      f"update → edit-card (got {only_skill(mem)})")

sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
run([APPLY, str(sb), "archive", json.dumps({"cardId": TODO_CARD})], mem)
check(only_skill(mem) == "archive-card", f"archive → archive-card (got {only_skill(mem)})")


# ── REVERT → capture too (the one writeback path that had no tail) ───────────
print("\n=== revert → capture (skill 'revert') ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
run([APPLY, str(sb), "complete-only", REQ_CITATION], mem)
mem2 = tempfile.mkdtemp(prefix="cowork-m-")
r = run([APPLY, str(sb), "revert", REQ_CITATION], mem2)
check(r.returncode == 0 and json.loads(r.stdout).get("reverted") is True,
      f"revert succeeds (stderr={r.stderr.strip()[:120]})")
check(only_skill(mem2) == "revert",
      f"revert fires the same day-capture floor → one 'revert' memo (got {only_skill(mem2)})")


# ── mint collision: same second, same skill, DIFFERENT identity → no clobber ─
# The mint path resolves `<HH-MM-SS>-<skill>.md`; before this leg's fix, two
# different-taskId memos landing in the same second silently overwrote each
# other (`existing_path is None` for both → same filename → atomic clobber).
print("\n=== mint collision: same-second same-skill different-task memos coexist ===")
mem = Path(tempfile.mkdtemp(prefix="cowork-m-"))
_prev_pin = os.environ.get("VIRGIL_DEV_MEMOS_DIR")
_prev_dev = os.environ.get("VIRGIL_DEV")
os.environ["VIRGIL_DEV_MEMOS_DIR"] = str(mem)
os.environ["VIRGIL_DEV"] = "1"
_real_now_parts = reflect._now_parts
reflect._now_parts = lambda: ("2026-01-01T00:00:00.000Z", "2026-01-01", "00-00-00")
try:
    sb = sandbox()
    inject_request(sb, {"id": "req-fn-collide", "kind": "footnote",
                        "status": "submitted", "text": "second footnote ask"})
    reflect.main([str(sb), "draft-footnote", REQ_FOOTNOTE])
    reflect.main([str(sb), "draft-footnote", "req-fn-collide"])
finally:
    reflect._now_parts = _real_now_parts
    os.environ.pop("VIRGIL_DEV_MEMOS_DIR", None)
    if _prev_pin is not None:
        os.environ["VIRGIL_DEV_MEMOS_DIR"] = _prev_pin
    if _prev_dev is None:
        os.environ.pop("VIRGIL_DEV", None)
    else:
        os.environ["VIRGIL_DEV"] = _prev_dev
_collide = sorted(p.name for p in (mem / "2026-01-01").glob("*.md"))
check(_collide == ["00-00-00-draft-footnote-2.md", "00-00-00-draft-footnote.md"],
      f"both memos survive, second disambiguated (got {_collide})")
_re_run = run([str(SCRIPTS / 'reflect.py'), str(sb), "draft-footnote", REQ_FOOTNOTE], str(mem))
_after = sorted(p.name for p in (mem / "2026-01-01").glob("*.md")) if (mem / "2026-01-01").exists() else []
check(len([n for n in _after if "draft-footnote" in n]) == 2,
      f"a RE-run for the same (skill, taskId) still MERGES rather than minting a third (got {_after})")


# ── DEV gate: off → writeback succeeds, NO memo ─────────────────────────────
print("\n=== DEV gate: off → writeback succeeds, NO memo ===")
sb = sandbox(); mem = tempfile.mkdtemp(prefix="cowork-m-")
r = run([APPLY, str(sb), "update", json.dumps({"cardId": NOTE_CARD, "body": "y"})], mem, dev=False)
check(r.returncode == 0 and json.loads(r.stdout).get("ok") is True,
      "DEV-off writeback still succeeds")
check(len(memo_files(mem)) == 0, "DEV-off wrote NO memo (the never-ships-to-users gate)")


# ── the throwaway-paper guard: a temp sandbox never reaches the DEFAULT sink ──
# The dominant source of dev-loop noise until 2026-08-09: this suite runs under
# VIRGIL_DEV=1, and the tail-trigger spawns reflect.py as a subprocess that
# inherits the ambient env — so a test that pins no sink filed its sandbox's
# card ops into the human's real ~/.virgil-dev/memos, ~280 per suite run.
# See _common._is_throwaway_paper.
print("\n=== throwaway-paper guard (temp sandbox + default sink → no memo) ===")
import _common  # noqa: E402  (imported here: the guard is the subject, not a helper)

# The predicate reads PROCESS STATE, so this block CONTROLS that state — the
# save/clear/restore idiom its own sibling at the top of this file already uses,
# and which the end-to-end leg 15 lines below already applies to this very
# variable (`env.pop(...)`). Before 2026-08-13 this block did neither and simply
# inherited whatever the developer's shell pinned, which cost two ways at once:
# on the one machine that runs the dev-loop ~/.zshenv pins VIRGIL_DEV_MEMOS_DIR,
# so the "NO pinned sink" case asserted a condition it never established (red for
# three nights, and reading as a code defect the whole time), while the
# "EXPLICITLY pinned" case passed VACUOUSLY — ambiently it would have passed with
# its own pin line deleted, a canary standing on the defect. A test that names an
# environment must establish it, or it is measuring the shell, not the code.
_prev = os.environ.get("VIRGIL_DEV_MEMOS_DIR")
os.environ.pop("VIRGIL_DEV_MEMOS_DIR", None)
try:
    sb = sandbox()
    check(_common._is_throwaway_paper(sb),
          "a temp-dir paper with NO pinned sink is throwaway (suppressed)")
    check(not _common._is_throwaway_paper(ROOT / "samples/annotation-history"),
          "a real in-repo paper is never throwaway")

    os.environ["VIRGIL_DEV_MEMOS_DIR"] = tempfile.mkdtemp(prefix="cowork-pin-")
    check(not _common._is_throwaway_paper(sb),
          "a sink pinned AWAY from the default always writes, temp paper or not")

    # The vacuous-pin case is now structural, not just an environment finding:
    # a pin whose value IS the computed default expresses no caller intent, so
    # the guard stays armed. This is what makes the standing "do NOT re-add the
    # ~/.zshenv pins" lore unnecessary — an ambient convenience export at the
    # default can no longer disarm anything.
    os.environ["VIRGIL_DEV_MEMOS_DIR"] = str(_common.dev_home() / "memos")
    check(_common._is_throwaway_paper(sb),
          "a pin AT the default sink expresses no intent — the guard stays armed")
finally:
    os.environ.pop("VIRGIL_DEV_MEMOS_DIR", None)
    if _prev is not None:
        os.environ["VIRGIL_DEV_MEMOS_DIR"] = _prev


# ── the ENVIRONMENT half of the same guard, reported as ITS OWN finding ──────
# The three checks above interrogate the CODE, and now pass on every machine.
# This one interrogates THIS MACHINE, because the guard's escape hatch ("an
# explicit pin means a caller has said where the memos go") is satisfied
# VACUOUSLY by a pin whose value IS the default it purports to override: the
# guard then suppresses nothing, one suite run files ~280 sandbox memos into the
# human's real dev-loop stream, and the next dream reads a window that is a
# census of test fixtures (measured 1 → 30 on both 2026-08-10 and 2026-08-11).
# Splitting it out is the point. Fused into the code checks it was unreadable —
# a red line whose label said "a temp-dir paper … is throwaway", which is a
# sentence about the predicate — so three consecutive digests argued about
# whether a *boundary* had to be crossed to repair a *config* line.
print("\n=== environment: is the throwaway guard actually armed on this machine? ===")
_pin = os.environ.get("VIRGIL_DEV_MEMOS_DIR", "").strip()
_vacuous = bool(_pin) and Path(_pin).expanduser().resolve() == (
    _common.dev_home() / "memos").resolve()
check(not _vacuous,
      "no VACUOUS sink pin in the ambient env (a pin that names the default "
      "expresses no caller intent, and disarms the throwaway guard)")
if _vacuous:
    print(f"       ENV  VIRGIL_DEV_MEMOS_DIR={_pin}")
    print( "            …is exactly _common.dev_home()/memos, so it redirects nothing,")
    print( "            …yet _is_throwaway_paper() reads it as intent and returns False.")
    print( "       FIX  no code change: drop the redundant VIRGIL_DEV_MEMOS_DIR and")
    print( "            VIRGIL_DREAM_DIGESTS_DIR exports from ~/.zshenv — both name the")
    print( "            values the code already computes. Keep VIRGIL_REPO_ROOT (load-bearing).")

# End to end: a real writeback on a temp sandbox, sink unpinned, writes nothing.
sb = sandbox()
env = dict(os.environ, VIRGIL_DEV="1"); env.pop("VIRGIL_DEV_MEMOS_DIR", None)
probe = Path(tempfile.mkdtemp(prefix="cowork-probe-")) / "memos"
env["VIRGIL_DEV_HOME"] = str(probe.parent)  # a private "default" home to observe
r = subprocess.run([sys.executable, APPLY, str(sb), "update",
                    json.dumps({"cardId": NOTE_CARD, "body": "z"})],
                   capture_output=True, text=True, env=env)
check(r.returncode == 0 and json.loads(r.stdout).get("ok") is True,
      "writeback on a temp sandbox still succeeds with the guard on")
check(not probe.exists() or len(sorted(probe.rglob('*.md'))) == 0,
      "…and wrote NO memo into the default sink")


# ── the gate itself: explicit env wins; unset env falls to the machine marker ─
# Dev mode is a fact about the MACHINE (the ~/.virgil-dev/dev-mode marker), so
# a session type that doesn't inherit ~/.zshenv still gates correctly — the
# 2026-08-16 cowork refusal class. An explicit env value beats the marker both
# ways, which is what keeps "simulate an end-user machine" testable on a dev box.
print("\n=== dev-mode gate: explicit env wins; unset env falls to the machine marker ===")
_prev_dev = os.environ.get("VIRGIL_DEV")
_prev_home = os.environ.get("VIRGIL_DEV_HOME")
_home = Path(tempfile.mkdtemp(prefix="cowork-devhome-"))
os.environ["VIRGIL_DEV_HOME"] = str(_home)
try:
    os.environ.pop("VIRGIL_DEV", None)
    check(not _common.dev_mode_enabled(), "no env + no marker → OFF (an end-user machine)")
    (_home / "dev-mode").write_text("this machine runs the Virgil dev loop\n")
    check(_common.dev_mode_enabled(), "no env + marker file → ON (dev mode is a machine fact)")
    os.environ["VIRGIL_DEV"] = "0"
    check(not _common.dev_mode_enabled(), "explicit VIRGIL_DEV=0 overrides the marker → OFF")
    os.environ["VIRGIL_DEV"] = "1"
    check(_common.dev_mode_enabled(), "explicit VIRGIL_DEV=1 is ON regardless of marker")
finally:
    if _prev_dev is None:
        os.environ.pop("VIRGIL_DEV", None)
    else:
        os.environ["VIRGIL_DEV"] = _prev_dev
    if _prev_home is None:
        os.environ.pop("VIRGIL_DEV_HOME", None)
    else:
        os.environ["VIRGIL_DEV_HOME"] = _prev_home


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
