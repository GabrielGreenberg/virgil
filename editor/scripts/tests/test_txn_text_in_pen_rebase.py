#!/usr/bin/env python3
r"""A writeback commits the .tex / .bib as they are INSIDE the pen (task 2026-10-14-1108).

Task 941 made every JSON sidecar a three-way merge resolved after the pen is
taken, but the paper's own text files were still queued as whole-file strings
built from a read taken BEFORE the pen. An app autosave of ANOTHER paragraph
(1500 ms debounce), or a bib-panel edit of ANOTHER entry, that landed in the
window was overwritten by the stale copy.

Now every text-file edit is a TRANSFORM queued through `_Txn.add_text`: if the
file is untouched at commit the precomputed bytes land; if it changed, the same
identity-addressed transform (anchor uuid / entry key) re-runs on the current
text, so both edits survive — and a change to the TARGET itself, which makes
the transform's own guard refuse, is a collision: nothing is written.

The concurrency is injected deterministically, as in test_txn_in_pen_rebase.py:
`_common.acquire_pen` is wrapped so the "app" write happens after every read and
before the commit.

Run from anywhere:  python3 editor/scripts/tests/test_txn_text_in_pen_rebase.py
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
import _common as C  # noqa: E402
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
    d = Path(tempfile.mkdtemp(prefix="txn-text-rebase-")) / "paper"
    shutil.copytree(SAMPLE, d)
    return d


def tex_path(doc):
    return doc / "document.tex"


def bib_path(doc):
    return doc / "references.bib"


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def version(doc):
    p = doc / "virgil" / "version.txt"
    return p.read_text().strip() if p.exists() else "0"


def edit_file(path, old, new):
    text = path.read_text(encoding="utf-8")
    assert old in text, f"fixture: {old!r} not in {path.name}"
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def run_with_app_write(doc, op, app_write):
    """Run a writes-only op in-process; `app_write()` fires inside acquire_pen,
    i.e. after the txn read everything and before it commits."""
    real = C.acquire_pen

    def acquire(d, *a, **k):
        app_write()
        return real(d, *a, **k)

    C.acquire_pen = acquire
    out, err = io.StringIO(), io.StringIO()
    code = 0
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                A.main(["apply_response.py", str(doc), "complete-only", json.dumps(op)])
            except SystemExit as e:
                code = e.code or 0
    finally:
        C.acquire_pen = real
    return code, out.getvalue(), err.getvalue()


SPAN = {"mode": "replace-span", "anchorUuid": "1102",
        "match": "This essay sketches", "replacement": "This essay outlines"}
APP_OTHER_PARA = ("A word on the form of the document itself.",
                  "A word, typed by the user mid-writeback, on the form of the document itself.")


# ---------------------------------------------------------------------------
print("\n=== texEdit: an app edit to ANOTHER paragraph in the window survives the splice ===")
doc = sandbox()
code, _, err = run_with_app_write(
    doc, {"texEdit": SPAN, "summary": "t", "clearSourceFlag": False},
    lambda: edit_file(tex_path(doc), *APP_OTHER_PARA))
tex = tex_path(doc).read_text(encoding="utf-8")
check(code == 0, f"the op landed (exit {code}; {err.strip()[:160]})")
check("This essay outlines" in tex, "the skill's splice landed")
check(APP_OTHER_PARA[1] in tex, "the app's concurrent edit to another paragraph survived")
check(pen_released(doc), "pen released")

# ---------------------------------------------------------------------------
print("\n=== texEdit: an untouched .tex writes the precomputed splice byte-for-byte ===")
doc = sandbox()
expected = A._tex_splice_text(tex_path(doc).read_text(encoding="utf-8"), SPAN)
code, _, _ = run_with_app_write(doc, {"texEdit": SPAN, "summary": "t", "clearSourceFlag": False},
                                lambda: None)
check(code == 0 and tex_path(doc).read_text(encoding="utf-8") == expected,
      "no concurrent write → exactly the T0 result")

# ---------------------------------------------------------------------------
print("\n=== texEdit: an app edit to the TARGET span collides → refused, nothing written ===")
doc = sandbox()
v0 = version(doc)


def app_edits_target():
    edit_file(tex_path(doc), "This essay sketches", "This essay drafts")


code, _, err = run_with_app_write(doc, {"texEdit": SPAN, "summary": "t", "clearSourceFlag": False},
                                  app_edits_target)
tex = tex_path(doc).read_text(encoding="utf-8")
check(code != 0, "the op is refused")
check("This essay drafts" in tex and "This essay outlines" not in tex,
      "the .tex is exactly the user's version (no stale overwrite, no splice)")
check(version(doc) == v0, "nothing else was written (version.txt unchanged)")
check("re-run" in err, "the refusal tells the caller to re-run against the current state")
check(pen_released(doc), "pen released after the refusal")

# ---------------------------------------------------------------------------
print("\n=== bibEdit: an app edit to ANOTHER entry in the window survives ===")
doc = sandbox()
NEW_ENTRY = "@misc{userAdded2026,\n  title = {Added in the bib panel mid-writeback},\n  year = {2026},\n}\n"
code, _, err = run_with_app_write(
    doc,
    {"bibEdit": {"mode": "set-fields", "citekey": "grafton1997", "fields": {"note": "verified"}},
     "summary": "b", "clearSourceFlag": False},
    lambda: bib_path(doc).write_text(bib_path(doc).read_text(encoding="utf-8") + "\n" + NEW_ENTRY,
                                     encoding="utf-8"))
bib = bib_path(doc).read_text(encoding="utf-8")
check(code == 0, f"the op landed (exit {code}; {err.strip()[:160]})")
check("userAdded2026" in bib, "the app's concurrently added entry survived")
check("verified" in bib, "the skill's set-fields landed")

# ---------------------------------------------------------------------------
print("\n=== renameCitekey: a cite + card the app added under the OLD key in the window are re-keyed ===")
doc = sandbox()


def app_cites_old_key():
    edit_file(tex_path(doc), *APP_OTHER_PARA)
    edit_file(tex_path(doc), "This essay sketches", "This essay \\citep{grafton1997} sketches")
    cits = load(doc, "citations.json")
    cits["citations"].append({"id": "ccnew", "command": "\\citep{grafton1997}",
                              "keys": ["grafton1997"], "createdAt": "x"})
    (doc / "virgil/citations.json").write_text(json.dumps(cits, indent=2))


code, _, err = run_with_app_write(
    doc,
    {"renameCitekey": {"oldKey": "grafton1997", "newKey": "graftonAnthony1997"},
     "summary": "r", "clearSourceFlag": False},
    app_cites_old_key)
tex = tex_path(doc).read_text(encoding="utf-8")
cits = load(doc, "citations.json")["citations"]
check(code == 0, f"the op landed (exit {code}; {err.strip()[:160]})")
check("grafton1997" not in tex, ".tex: no cite left under the old key — the late one included")
check("\\citep{graftonAnthony1997}" in tex, ".tex: the late cite was retargeted")
check(APP_OTHER_PARA[1] in tex, ".tex: the app's other edit survived")
ccnew = next((c for c in cits if c["id"] == "ccnew"), None)
check(ccnew is not None and ccnew["keys"] == ["graftonAnthony1997"],
      "citations.json: the card the app added under the old key followed the rename")
check(not any("grafton1997" in (c.get("keys") or []) for c in cits),
      "citations.json: no card left on the old key")

# ---------------------------------------------------------------------------
print("\n=== renameCitekey: a key absent at T0 but added in the window is still re-keyed ===")
doc = sandbox()
cit0 = (doc / "virgil/citations.json").read_text()


def app_cites_ghost():
    edit_file(tex_path(doc), "This essay sketches", "This essay \\citep{ghost1900} sketches")


code, _, _ = run_with_app_write(
    doc, {"renameCitekey": {"oldKey": "ghost1900", "newKey": "ghost1999"},
          "summary": "g", "clearSourceFlag": False}, app_cites_ghost)
tex = tex_path(doc).read_text(encoding="utf-8")
check(code == 0 and "\\citep{ghost1999}" in tex, ".tex: the late cite was retargeted")
check((doc / "virgil/citations.json").read_text() == cit0,
      "an untouched sidecar is not rewritten (the rule changed nothing)")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
