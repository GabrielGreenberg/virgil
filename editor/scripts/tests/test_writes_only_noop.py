#!/usr/bin/env python3
r"""A writes-only op that changes no byte announces nothing (task 2026-11-02-1429).

`/editor/sync-bib-to-library` re-runs `answer-bib-review --library-sync` over
every matched entry, already-synced ones included, and its prose promises a
re-run is a no-op. It was not: every writes-only op (no Task, no card) appended
an `ai-request-complete` notification and bumped `version.txt`, so a re-run over
N synced entries wrote N notifications and N version bumps for zero changed
paper bytes. The write door now decides, INSIDE the pen, whether any paper write
changed a byte; when none did, the announcement resolves to nothing too.

Run from anywhere:  python3 editor/scripts/tests/test_writes_only_noop.py
"""
import contextlib
import io
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
sys.path.insert(0, str(ROOT / "editor/scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _pen_state import pen_released  # noqa: E402
import apply_response as A  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="writes-only-noop-")) / "paper"
    shutil.copytree(SAMPLE, d)
    return d


def version(doc):
    p = doc / "virgil" / "version.txt"
    return p.read_text().strip() if p.exists() else "0"


def notif_count(doc):
    p = doc / "virgil" / "notifications.json"
    return len(json.loads(p.read_text()).get("items", [])) if p.exists() else 0


def entry_text(doc, key):
    bib = (doc / "references.bib").read_text(encoding="utf-8")
    start = bib.index("@book{" + key)
    nxt = bib.find("\n@", start + 1)
    return bib[start:] if nxt < 0 else bib[start:nxt + 1]


def run(doc, op):
    out, err = io.StringIO(), io.StringIO()
    code = 0
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        try:
            A.main(["apply_response.py", str(doc), "complete-only", json.dumps(op)])
        except SystemExit as e:
            code = e.code or 0
    return code, out.getvalue(), err.getvalue()


# ---------------------------------------------------------------------------
print("\n=== bibEdit replace with the entry's own bytes: nothing written, nothing announced ===")
doc = sandbox()
bib0 = (doc / "references.bib").read_bytes()
v0, n0 = version(doc), notif_count(doc)
op = {"bibEdit": {"mode": "replace", "citekey": "tschichold1991",
                  "entry": entry_text(doc, "tschichold1991")},
      "summary": "library-sync tschichold1991 -> tschichold1991", "clearSourceFlag": False}
code, out, err = run(doc, op)
check(code == 0, f"exit 0 (got {code}; {err.strip()[:160]})")
check('"unchanged": true' in out, "the result says unchanged")
check((doc / "references.bib").read_bytes() == bib0, "references.bib byte-identical")
check(version(doc) == v0, "no version bump")
check(notif_count(doc) == n0, "no notification appended")
check(pen_released(doc), "pen released")

print("\n=== a re-run over N synced entries stays at zero announcements ===")
for key in ("tschichold1991", "bringhurst2004", "derrida1967"):
    run(doc, {"bibEdit": {"mode": "replace", "citekey": key, "entry": entry_text(doc, key)},
              "summary": f"library-sync {key}", "clearSourceFlag": False})
check(version(doc) == v0 and notif_count(doc) == n0, "three no-op swaps → still v0, still n0")

# ---------------------------------------------------------------------------
print("\n=== a replace that DOES change bytes still lands and announces ===")
doc = sandbox()
v0, n0 = version(doc), notif_count(doc)
changed = entry_text(doc, "tschichold1991").replace("{", "{ ", 1)
code, out, err = run(doc, {"bibEdit": {"mode": "replace", "citekey": "tschichold1991",
                                        "entry": changed},
                           "summary": "library-sync tschichold1991", "clearSourceFlag": False})
check(code == 0, f"exit 0 (got {code}; {err.strip()[:160]})")
check('"unchanged"' not in out, "the result is a normal landing")
check(int(version(doc)) == int(v0) + 1, "version bumped once")
check(notif_count(doc) == n0 + 1, "one notification appended")

# ---------------------------------------------------------------------------
print("\n=== a rename with no cite anywhere is a no-op too (rules change nothing) ===")
doc = sandbox()
v0, n0 = version(doc), notif_count(doc)
code, out, _ = run(doc, {"renameCitekey": {"oldKey": "ghost1900", "newKey": "ghost1999"},
                         "summary": "g", "clearSourceFlag": False})
check(code == 0 and '"unchanged": true' in out, "unchanged")
check(version(doc) == v0 and notif_count(doc) == n0, "no bump, no notification")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
