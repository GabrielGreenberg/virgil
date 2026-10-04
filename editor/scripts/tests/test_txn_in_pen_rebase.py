#!/usr/bin/env python3
r"""A writeback commits sidecars as they are INSIDE the pen (task 2026-10-04-941).

`apply_response._Txn` reads each JSON sidecar the first time an op touches it,
mutates that copy, and commits much later — after the `.tex` splice and the
preservation measure. The app writes the same files concurrently by design (a
user raising an AI flag appends an `ai-requests.json` row; editing a note
rewrites `notes.json`). Before this task the commit serialized the T0 snapshot,
so anything the app landed in the window was silently reverted.

The fix is the Python twin of task 220's rule: every dirty sidecar is written as
a three-way merge (T0 base / the op's version / the file as it is once the pen
is held), the notification append and version bump are recomputed in the pen,
and a genuine collision is REFUSED with nothing written.

The concurrency is injected deterministically: `_common.acquire_pen` is wrapped
so the "app" write happens after every `_Txn` read and before the commit — the
exact window the defect lived in. Driven through the real `archive` op.

Run from anywhere:  python3 editor/scripts/tests/test_txn_in_pen_rebase.py
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
    d = Path(tempfile.mkdtemp(prefix="txn-rebase-")) / "paper"
    shutil.copytree(SAMPLE, d)
    return d


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def write(doc, name, data):
    (doc / "virgil" / name).write_text(json.dumps(data, indent=2))


def run_with_app_write(doc, op_args, app_write):
    """Run apply_response in-process; `app_write()` fires inside acquire_pen,
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
                A.main(["apply_response.py", str(doc), *op_args])
            except SystemExit as e:
                code = e.code or 0
    finally:
        C.acquire_pen = real
    return code, out.getvalue(), err.getvalue()


def flagged_note(doc):
    notes = load(doc, "notes.json")
    notes["cards"][0]["aiRequest"] = True
    write(doc, "notes.json", notes)
    nid = notes["cards"][0]["id"]
    ar = load(doc, "ai-requests.json")
    ar["requests"].append({
        "id": "row-linked", "kind": "note", "text": "?", "createdAt": "x",
        "status": "pending", "paragraphIds": [], "linkedTo": {"panel": "notes", "cardId": nid},
    })
    write(doc, "ai-requests.json", ar)
    return nid, notes["cards"][1]["id"]


# ---------------------------------------------------------------------------
print("\n=== json_merge3: the merge rule ===")
ROWS = [{"key": "rows", "idFields": ["id"]}]
base = {"rows": [{"id": "a", "s": 1}, {"id": "b", "s": 1}]}
ours = {"rows": [{"id": "a", "s": 2}, {"id": "b", "s": 1}, {"id": "o", "s": 1}]}
theirs = {"rows": [{"id": "a", "s": 1}, {"id": "t", "s": 1}, {"id": "b", "s": 9}]}
m = C.json_merge3(base, ours, theirs, collections=ROWS)
check([r["id"] for r in m["rows"]] == ["a", "t", "b", "o"], "appends on both sides survive, disk order kept")
check(m["rows"][0]["s"] == 2 and m["rows"][2]["s"] == 9, "disjoint record edits both land")

m = C.json_merge3({"r": [{"id": "a"}, {"id": "b"}]}, {"r": [{"id": "b"}]},
                  {"r": [{"id": "a"}, {"id": "b"}, {"id": "c"}]}, collections=[{"key": "r", "idFields": ["id"]}])
check([r["id"] for r in m["r"]] == ["b", "c"], "our delete of an untouched record wins; their append survives")

BR = [{"key": "requests", "idFields": ["bibKey", "type"]}]
m = C.json_merge3({"requests": [{"bibKey": "k", "type": "fields", "s": 0}]},
                  {"requests": [{"bibKey": "k", "type": "fields", "s": 1}]},
                  {"requests": [{"bibKey": "k", "type": "fields", "s": 0}, {"bibKey": "k", "type": "notes", "s": 0}]},
                  collections=BR)
check(len(m["requests"]) == 2 and m["requests"][0]["s"] == 1, "a composite identity (bibKey, type) merges per record")

R = [{"key": "r", "idFields": ["id"]}]
for label, b, o, t, coll in [
    ("same value changed differently", {"x": 1}, {"x": 2}, {"x": 3}, None),
    ("delete vs concurrent edit", {"r": [{"id": "a", "v": 1}]}, {"r": []}, {"r": [{"id": "a", "v": 2}]}, R),
    ("edit vs concurrent delete", {"r": [{"id": "a", "v": 1}]}, {"r": [{"id": "a", "v": 2}]}, {"r": []}, R),
    ("an UNDECLARED array changed on both sides (fails closed)",
     {"r": [{"id": "a"}]}, {"r": [{"id": "a"}, {"id": "o"}]}, {"r": [{"id": "a"}, {"id": "t"}]}, None),
]:
    try:
        C.json_merge3(b, o, t, collections=coll)
        check(False, f"conflict: {label}")
    except C.SidecarConflict:
        check(True, f"conflict: {label}")
check(C.json_merge3({"x": 1}, {"x": 2}, {"x": 2}) == {"x": 2}, "identical change on both sides is no conflict")
check(C.json_merge3({"x": 1, "y": 1}, {"y": 1}, {"x": 1, "y": 2}) == {"y": 2}, "key removal merges with an edit elsewhere")
check(C.sidecar_collections("notes.json") == [{"key": "cards", "idFields": ["id"]}],
      "notes.json's collection comes from the projected app table")
check(C.sidecar_collections("ai-requests.json") == [{"key": "requests", "idFields": ["id"]}],
      "ai-requests.json's collection is the store's id")

# ---------------------------------------------------------------------------
print("\n=== archive: an app write inside the window survives the commit ===")
doc = sandbox()
nid, other_id = flagged_note(doc)
(doc / "virgil" / "version.txt").write_text("7\n")


def app_write():
    ar = load(doc, "ai-requests.json")
    ar["requests"].append({"id": "row-new", "kind": "note", "text": "new flag",
                           "createdAt": "y", "status": "pending", "paragraphIds": []})
    write(doc, "ai-requests.json", ar)
    notes = load(doc, "notes.json")
    for c in notes["cards"]:
        if c["id"] == other_id:
            c["title"] = "edited by the user mid-writeback"
    write(doc, "notes.json", notes)
    write(doc, "notifications.json", {"items": [{"kind": "app", "at": "z"}]})
    (doc / "virgil" / "version.txt").write_text("12\n")


code, out, err = run_with_app_write(doc, ["archive", json.dumps({"cardId": nid})], app_write)
check(code == 0, f"archive exited 0 (stderr={err.strip()[:200]})")
ar = load(doc, "ai-requests.json")
rows = {r["id"]: r for r in ar["requests"]}
check("row-new" in rows and rows["row-new"]["status"] == "pending", "the app's new AI-request row survives")
check(rows["row-linked"]["status"] == "complete", "the op's own change (linked row closed) landed")
notes = load(doc, "notes.json")
ids = [c["id"] for c in notes["cards"]]
check(nid not in ids, "the archived note left notes.json")
check(next(c for c in notes["cards"] if c["id"] == other_id)["title"] == "edited by the user mid-writeback",
      "the user's concurrent edit of ANOTHER note survives")
check(any(s.get("id") == nid for s in load(doc, "archive.json")["snippets"]), "the snippet landed in archive.json")
items = load(doc, "notifications.json")["items"]
check(items[0] == {"kind": "app", "at": "z"} and len(items) == 2, "notification appended to the inbox as it is in the pen")
check((doc / "virgil" / "version.txt").read_text().strip() == "13", "version bumped from the in-pen value")
check(json.loads(out.strip().splitlines()[-1]).get("version") == 13, "reported version is the one written")

# ---------------------------------------------------------------------------
print("\n=== archive: a genuine collision is refused, nothing written ===")
doc = sandbox()
nid, _ = flagged_note(doc)
archive_before = (doc / "virgil" / "archive.json").read_text()


def app_edits_same_card():
    notes = load(doc, "notes.json")
    for c in notes["cards"]:
        if c["id"] == nid:
            c["title"] = "user edited the card being archived"
    write(doc, "notes.json", notes)


code, out, err = run_with_app_write(doc, ["archive", json.dumps({"cardId": nid})], app_edits_same_card)
check(code == 2, f"collision exits 2 (got {code})")
check("nothing was written" in err and "notes.json" in err, f"error names the file + says nothing landed ({err.strip()[:160]})")
notes = load(doc, "notes.json")
check(next(c for c in notes["cards"] if c["id"] == nid)["title"] == "user edited the card being archived",
      "the user's edit is on disk, untouched")
check((doc / "virgil" / "archive.json").read_text() == archive_before, "archive.json unchanged (all-or-nothing)")
check(pen_released(doc), "pen released after the refusal")

# ---------------------------------------------------------------------------
print("\n=== no concurrent write: output is byte-identical to the old snapshot path ===")
doc = sandbox()
nid, _ = flagged_note(doc)
code, _, err = run_with_app_write(doc, ["archive", json.dumps({"cardId": nid})], lambda: None)
check(code == 0, f"archive exited 0 (stderr={err.strip()[:200]})")
raw = (doc / "virgil" / "notes.json").read_text()
check(raw == C.json_dumps(json.loads(raw)), "notes.json is canonical json_dumps output")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
