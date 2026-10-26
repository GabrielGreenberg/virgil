#!/usr/bin/env python3
"""Task 1313 — a Task-less run closes through `apply_response.py <doc> notify`.

`sync-bib-to-library` used to finish with an inline
`python3 -c "from editor.scripts._common import append_notification, bump_version …"`:
a dotted import that resolves only in the source repo (in a paper folder the
helpers live at `.virgil/scripts/editor/`), calling the only two `_common`
writers that bypassed the editing pen. Both writers are deleted; the run's
"finished" signal has one door.

Legs:
  1. BUNDLE LAYOUT — the scripts copied to `<paper>/.virgil/scripts/editor/`,
     invoked by path with cwd = the paper (exactly as the skill teaches): the
     notification and the version bump land; existing inbox items survive.
  2. UNDER THE PEN — in-process, `commit_under_pen` receives BOTH writes in
     one write-set, each DEFERRED (resolved inside the pen, task 941).
  3. NO TASK — ai-requests.json is untouched (a run is not a Task).
  4. Refusal — an empty summary writes nothing.

Run from anywhere:  python3 editor/scripts/tests/test_notify_run.py
"""
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SCRIPTS))

_legs: list[str] = []


def _leg(name: str) -> None:
    _legs.append(name)
    print(f"{name} OK")


def _paper() -> Path:
    d = Path(tempfile.mkdtemp(prefix="t1313-")) / "paper"
    (d / "virgil").mkdir(parents=True)
    (d / "document.tex").write_text("\\documentclass{article}\n\\begin{document}\nHi.\n\\end{document}\n")
    (d / "virgil" / "version.txt").write_text("7\n")
    (d / "virgil" / "notifications.json").write_text(json.dumps({"items": [{"kind": "x", "summary": "old"}]}))
    (d / "virgil" / "ai-requests.json").write_text(json.dumps({"requests": []}))
    return d


# --- 1. bundle layout, invoked by path from the paper folder -----------------
paper = _paper()
bundle = paper / ".virgil" / "scripts" / "editor"
shutil.copytree(SCRIPTS, bundle, ignore=shutil.ignore_patterns("tests", "__pycache__"))
ar_before = (paper / "virgil" / "ai-requests.json").read_bytes()
r = subprocess.run(
    [sys.executable, ".virgil/scripts/editor/apply_response.py", str(paper), "notify",
     "--skill", "sync-bib-to-library", "--summary", "sync-bib-to-library: 3 matched, 1 added, 0 flagged"],
    cwd=paper, capture_output=True, text=True,
)
assert r.returncode == 0, r.stderr
out = json.loads(r.stdout)
assert out["ok"] is True and out["version"] == 8, out
assert (paper / "virgil" / "version.txt").read_text() == "8\n"
items = json.loads((paper / "virgil" / "notifications.json").read_text())["items"]
assert [i["summary"] for i in items] == ["old", "sync-bib-to-library: 3 matched, 1 added, 0 flagged"], items
assert items[-1]["kind"] == "ai-request-complete" and items[-1]["at"], items[-1]
assert "requestId" not in items[-1], items[-1]
_leg("bundle-layout notify lands notification + version")

# --- 3. no Task touched --------------------------------------------------------
assert (paper / "virgil" / "ai-requests.json").read_bytes() == ar_before
_leg("no Task synthesized or touched")

# --- 2. under the pen, deferred ------------------------------------------------
import apply_response as A  # noqa: E402

paper2 = _paper()
seen: list = []
real = A.commit_under_pen


def spy(doc, writes):
    seen.append([(p.name, callable(c)) for p, c in writes])
    return real(doc, writes)


A.commit_under_pen = spy
try:
    res = A.cmd_notify(paper2, "done", "sync-bib-to-library")
finally:
    A.commit_under_pen = real
assert res["version"] == 8, res
assert seen == [[("notifications.json", True), ("version.txt", True)]], seen
_leg("both writes ride ONE commit_under_pen, deferred")

# --- 4. empty summary refused, nothing written ----------------------------------
paper3 = _paper()
before = {p.name: p.read_bytes() for p in (paper3 / "virgil").iterdir()}
r = subprocess.run(
    [sys.executable, str(SCRIPTS / "apply_response.py"), str(paper3), "notify",
     "--skill", "x", "--summary", "  "],
    capture_output=True, text=True,
)
assert r.returncode != 0 and "non-empty --summary" in r.stderr, (r.returncode, r.stderr)
assert {p.name: p.read_bytes() for p in (paper3 / "virgil").iterdir()} == before
_leg("empty summary refused, nothing written")

print(f"{len(_legs)}/{len(_legs)} passed")
