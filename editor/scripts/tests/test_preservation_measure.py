#!/usr/bin/env python3
r"""The PYTHON half of the preservation-measure parity contract (task 357).

`_common.py` carries a port of `src/lib/tex-preservation.ts` because the
`/editor/*` skills are the third writer of a paper's `.tex` and
`apply_response.py`'s `region-replace` rewrites the whole preamble from model
output. A rule reimplemented in a second language drifts, and nothing can share
code across that seam — so both languages answer the SAME fixture corpus and
must produce the SAME numbers.

The corpus is `src/lib/__tests__/fixtures/preservation-corpus.json`, and its
`expected` block is generated from the shipped TS implementation, so this suite
compares against TypeScript's own answer rather than against a second hand-typed
table. The TS reader is `preservation-measure-parity.test.ts`.

Beside the parity legs, this drives the REAL `apply_response.py` end to end for
the two `region-replace` refusals — the body-content gate and the
`\begin{document}` structural invariant — because a test of the measure alone
structurally cannot see a splice that never asks it, which is exactly what
shipped.

Runs from anywhere, no pytest:
    python3 editor/scripts/tests/test_preservation_measure.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# repo root = tests/ -> scripts/ -> editor/ -> <root>
ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "editor/scripts"
SAMPLE = ROOT / "samples/annotation-history"
APPLY = str(SCRIPTS / "apply_response.py")
CORPUS = ROOT / "src/lib/__tests__/fixtures/preservation-corpus.json"
sys.path.insert(0, str(SCRIPTS))

import _common as C  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1
        print(f"  \033[31mFAIL\033[0m {label}")


# ---------------------------------------------------------------------------
# Parity: every corpus case, measured by the Python port.
# ---------------------------------------------------------------------------

def test_corpus_parity():
    print("\ncorpus parity (Python answers what TypeScript recorded)")
    data = json.loads(CORPUS.read_text(encoding="utf-8"))
    cases = data["cases"]
    check(len(cases) >= 10, f"corpus is populated ({len(cases)} cases)")
    for case in cases:
        got = C.check_tex_preservation(case["before"], case["after"])
        want = case["expected"]
        same = (
            got["ok"] == want["ok"]
            and got["body"] == want["body"]
            and got["preamble"] == want["preamble"]
        )
        check(same, f"{case['name']}" + ("" if same else f"\n      got  {got}\n      want {want}"))


def test_shortfall_properties():
    print("\nthe shortfall's own properties")
    # Never smaller than the net difference — what makes this a safe change to
    # a shipped gate rather than a loosening.
    data = json.loads(CORPUS.read_text(encoding="utf-8"))
    ok = True
    for case in data["cases"]:
        v = C.check_tex_preservation(case["before"], case["after"])
        for region in ("body", "preamble"):
            r = v[region]
            if r["lost"] < max(0, r["before"] - r["after"]):
                ok = False
    check(ok, "shortfall >= net loss for every corpus case")
    # The property the shortfall exists for, stated directly rather than left to
    # the one corpus case that happens to exercise it: a region that GREW can
    # still have lost words, and a net count scores that at zero.
    grew_before = C.measure_content_bag("alpha beta gamma delta")
    grew_after = C.measure_content_bag("alpha beta one two three")
    check(
        sum(grew_after.values()) > sum(grew_before.values())
        and C.missing_words(grew_before, grew_after) == 2,
        "a growing region can still report a loss (a net count cannot)",
    )
    # Order-invariant: the reason it is a multiset and not a run check.
    a = C.measure_content_bag("\\title{On Annotation} \\usepackage{expex}")
    b = C.measure_content_bag("\\usepackage{expex} \\title{On Annotation}")
    check(C.missing_words(a, b) == 0, "a pure reordering loses nothing")
    # Virgil's own markers are projected away on both sides.
    check(
        C.measure_content_words("A claim.\\vfid{ab12} %!v:c3d4")
        == C.measure_content_words("A claim."),
        "Virgil's markers are not counted as the user's words",
    )


# ---------------------------------------------------------------------------
# The REAL CLI: region-replace refuses, and refuses without writing.
# ---------------------------------------------------------------------------

def sandbox():
    d = Path(tempfile.mkdtemp(prefix="preserve357-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def tex_of(doc: Path) -> Path:
    return next(p for p in doc.glob("*.tex"))


def run_op(doc: Path, op: dict):
    """Drive apply_response.py `complete-only` with an inline JSON op."""
    path = doc / ".virgil"
    path.mkdir(exist_ok=True)
    blob = path / "op.json"
    blob.write_text(json.dumps(op), encoding="utf-8")
    env = dict(os.environ)
    return subprocess.run(
        [sys.executable, APPLY, str(doc), "complete-only", f"@{blob}", "--result", "auto-applied"],
        capture_output=True,
        text=True,
        env=env,
    )


def first_request_id(doc: Path) -> str | None:
    p = doc / "virgil" / "ai-requests.json"
    if not p.exists():
        return None
    rows = json.loads(p.read_text(encoding="utf-8")).get("requests", [])
    return rows[0]["id"] if rows else None


def test_region_replace_refusals():
    print("\nregion-replace: the CLI refuses and writes nothing")
    doc = sandbox()
    rid = first_request_id(doc)
    if rid is None:
        check(False, "sample paper has no ai-request to complete (harness broken)")
        return
    tex = tex_of(doc)
    before = tex.read_text(encoding="utf-8")

    # (1) A replacement that forgets to re-supply `\begin{document}`. The body
    #     bytes survive verbatim, so a word gate alone sees nothing wrong — and
    #     the resulting file cannot compile and reads as one enormous body.
    r = run_op(doc, {
        "requestId": rid,
        "texEdit": {"mode": "region-replace", "replacement": "\\documentclass{article}\n\n"},
        "summary": "no marker",
    })
    check(r.returncode != 0, "refuses a replacement with no \\begin{document}")
    check("begin{document}" in (r.stderr or ""), "…and says why")
    check(tex.read_text(encoding="utf-8") == before, "…and the .tex is byte-identical")

    # (2) An `endMarker` that occurs LATER in the file than the caller believed,
    #     so the splice eats real body content. This is the catastrophic case
    #     the word measure is here for.
    body_marker = "\\end{document}"
    r2 = run_op(doc, {
        "requestId": rid,
        "texEdit": {
            "mode": "region-replace",
            "endMarker": body_marker,
            "replacement": "\\documentclass{article}\n\n\\begin{document}\n\nReplaced.\n\n\\end{document}\n",
        },
        "summary": "greedy end marker",
    })
    check(r2.returncode != 0, "refuses a splice that ate the body")
    check("BODY" in (r2.stderr or ""), "…and names the region")
    check(tex.read_text(encoding="utf-8") == before, "…and the .tex is byte-identical")

    # (3) CONTROL — an honest preamble swap still lands, so no leg above passes
    #     because the CLI is simply broken. The merge legitimately drops the
    #     current \documentclass and the Virgil shim block, which is why the
    #     preamble is deliberately NOT word-gated.
    i = before.find("\\begin{document}")
    r3 = run_op(doc, {
        "requestId": rid,
        "texEdit": {
            "mode": "region-replace",
            "replacement": "\\documentclass{amsart}\n\\usepackage{amsmath}\n\n\\begin{document}\n\n",
        },
        "summary": "honest style merge",
    })
    after = tex.read_text(encoding="utf-8")
    check(r3.returncode == 0, f"an honest preamble swap lands (rc={r3.returncode}) {r3.stderr[:200]}")
    check(after.startswith("\\documentclass{amsart}"), "…with the new preamble")
    check(after.endswith(before[i + len("\\begin{document}"):].lstrip("\n")), "…and the body verbatim")

    shutil.rmtree(doc.parent, ignore_errors=True)


if __name__ == "__main__":
    test_corpus_parity()
    test_shortfall_properties()
    test_region_replace_refusals()
    total = PASS + FAIL
    print(f"\n{PASS}/{total} passed")
    sys.exit(1 if FAIL else 0)
