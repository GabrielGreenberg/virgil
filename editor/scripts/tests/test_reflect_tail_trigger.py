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
        e.pop("VIRGIL_DEV", None)
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

sb = sandbox()
check(_common._is_throwaway_paper(sb),
      "a temp-dir paper with NO pinned sink is throwaway (suppressed)")
check(not _common._is_throwaway_paper(ROOT / "samples/annotation-history"),
      "a real in-repo paper is never throwaway")

_prev = os.environ.get("VIRGIL_DEV_MEMOS_DIR")
os.environ["VIRGIL_DEV_MEMOS_DIR"] = tempfile.mkdtemp(prefix="cowork-pin-")
check(not _common._is_throwaway_paper(sb),
      "an EXPLICITLY pinned sink always writes, temp paper or not")
if _prev is None:
    os.environ.pop("VIRGIL_DEV_MEMOS_DIR", None)
else:
    os.environ["VIRGIL_DEV_MEMOS_DIR"] = _prev

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


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
