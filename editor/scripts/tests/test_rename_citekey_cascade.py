#!/usr/bin/env python3
r"""Task 615 — the skill-side citekey rename re-keys EVERY citekey-keyed sidecar,
writes annotations in the shape the app reads, and finds every legal spelling of
a cite.

  1. the census: `citekey_keyed_sidecars.json`'s `rekey` rules all have a
     re-keyer, and the two lists are disjoint (the TS half —
     `citekey-keyed-sidecars-census.test.ts` — pins their union to the app's
     sidecar SSOT);
  2. the pure re-keyers (annotations V1 flat / wrapper / V2 orphan bucket,
     collisions, bib-review rows) and the `\vbid` uid binder;
  3. the key-list grammar: comments, whitespace, gaps between a command and its
     argument groups — each rewritten with every other byte preserved;
  4. end to end through apply_response: a library-sync swap moves the entry's
     annotation and review rows in the same commit; `annotationEdit` writes a V2
     file by uid and a V1 file flat.

Run from anywhere:  python3 editor/scripts/tests/test_rename_citekey_cascade.py
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
APPLY = str(SCRIPTS / "apply_response.py")
sys.path.insert(0, str(SCRIPTS))

import citekey_sidecars as CS  # noqa: E402
import rename_citekey as RC  # noqa: E402

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="t615-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def run(*args):
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=dict(os.environ))


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def dump(doc, name, data):
    (doc / "virgil" / name).write_text(json.dumps(data, indent=2))


# ============================================================ 1. census
print("\n=== census: every declared rule has a re-keyer ===")
manifest = CS.load_manifest()
rules = [row["rule"] for row in manifest["rekey"]]
files = [row["file"] for row in manifest["rekey"]]
check(set(rules) <= set(CS.REKEYERS), f"every manifest rule has a re-keyer ({rules})")
check(set(rules) <= set(CS.EMPTY_STATE), "every manifest rule has an empty state")
check(set(CS.REKEYERS) == set(rules), "no re-keyer is dead (every one is named by the manifest)")
check(len(files) == len(set(files)), "no sidecar is listed twice")
check(not set(files) & set(manifest["notCitekeyKeyed"]), "rekey and notCitekeyKeyed are disjoint")
check({"citations.json", "annotations.json", "bib-review-requests.json"} <= set(files),
      "the three surfaces the app's cascade names are all declared")
check([f for f, _ in CS.rekey_plan()] == files, "rekey_plan follows the manifest")

# ============================================================ 2. re-keyers
print("\n=== annotations: both shapes, collisions ===")
v1 = {"old": "A note", "other": "B"}
check(CS.rekey_annotations(v1, "old", "new") == 1 and v1 == {"new": "A note", "other": "B"},
      "V1 flat: old → new")
wrapped = {"annotations": {"old": "A"}}
CS.rekey_annotations(wrapped, "old", "new")
check(wrapped == {"annotations": {"new": "A"}}, "V1 legacy wrapper: re-keyed inside the wrapper")
coll = {"old": "Mine", "new": "Theirs"}
CS.rekey_annotations(coll, "old", "new")
check(coll == {"new": "Theirs\n\nMine"}, "collision: concatenated, nothing overwritten")
same = {"old": "X", "new": "X"}
CS.rekey_annotations(same, "old", "new")
check(same == {"new": "X"}, "collision with identical text: one copy")
empty_new = {"old": "X", "new": ""}
CS.rekey_annotations(empty_new, "old", "new")
check(empty_new == {"new": "X"}, "an empty annotation under the new key is replaced")
odd = {"old": ["??"], "new": "keep"}
check(CS.rekey_annotations(odd, "old", "new") == 0 and odd == {"old": ["??"], "new": "keep"},
      "an unreadable value is never dropped")
check(CS.rekey_annotations({"x": "y"}, "old", "new") == 0, "absent key: 0 changes")
v2 = {"v": 2, "byUid": {"u1": "by uid"}, "orphanByKey": {"old": "orphan"}}
check(CS.rekey_annotations(v2, "old", "new") == 1, "V2: the orphan bucket moves")
check(v2 == {"v": 2, "byUid": {"u1": "by uid"}, "orphanByKey": {"new": "orphan"}},
      "V2: byUid untouched (the uid survives a rename), orphan re-keyed")

print("\n=== bib-review rows ===")
br = {"requests": [{"bibKey": "old", "type": "fields"}, {"bibKey": "old", "entryUid": "u1"},
                   {"bibKey": "other"}]}
check(CS.rekey_bib_review(br, "old", "new") == 2, "two rows re-pointed")
check([r["bibKey"] for r in br["requests"]] == ["new", "new", "other"], "bibKey mirrors follow the rename")
check(br["requests"][1]["entryUid"] == "u1", "entryUid kept")
check(CS.rekey_bib_review({}, "old", "new") == 0, "malformed state: no-op")

print("\n=== \\vbid binder (port of orderedVbidBindings) ===")
bib = ("\\vbid{a1b2}\n@article{first,\n title={T}}\n\n"
       "@book{nomarker,\n title={U}}\n\n"
       "\\vbid{c3d4}\n\n@misc{third,\n title={V}}\n\\vbid{dang}\n")
check(CS.vbid_uid_for(bib, "first") == "a1b2", "marker binds to the entry after it")
check(CS.vbid_uid_for(bib, "third") == "c3d4", "blank line between marker and entry tolerated")
check(CS.vbid_uid_for(bib, "nomarker") is None, "an unmarked entry has no uid")
check(CS.vbid_uid_for("@article{x,\n}", "x") is None, "a markerless file has no uids")

# ============================================================ 3. grammar
print("\n=== key lists + argument gaps ===")
cases = [
    ("\\cite{jones,%\n  smith2020}", "\\cite{jones,%\n  NEW}"),
    ("\\citep [p.~4]{smith2020}", "\\citep [p.~4]{NEW}"),
    ("\\citep[see] [p.~4] {smith2020}", "\\citep[see] [p.~4] {NEW}"),
    ("\\textcites{a}\n  {smith2020}", "\\textcites{a}\n  {NEW}"),
    ("\\autocites{a}%\n[p.~2]{smith2020}", "\\autocites{a}%\n[p.~2]{NEW}"),
    ("\\citet{a,smith2020 ,  b}", "\\citet{a,NEW ,  b}"),
    ("\\citet{ smith2020 }", "\\citet{ NEW }"),
]
for src, want in cases:
    got, n = RC.rewrite_tex(src, "smith2020", "NEW")
    check(got == want and n == 1, f"{src!r} → {want!r} (got {got!r}, n={n})")
untouched = [
    "\\cite{a,% smith2020, x\n b}",   # the key only appears inside a comment
    "\\cite{smith2020x}",             # a longer key
    "\\citet\n\n{smith2020}",         # a blank line ends the command
    "\\cite{a} {smith2020}",          # a singular command takes ONE group
    "\\citeauthorX{smith2020}",       # not a cite command
]
for src in untouched:
    got, n = RC.rewrite_tex(src, "smith2020", "NEW")
    check(got == src and n == 0, f"{src!r} left alone (got {got!r})")
check(RC.split_keys("a ,%c,d\n b") == ["a", "b"], "a comma inside a comment does not split")
check(RC.split_keys("a,\\%b") == ["a", "\\%b"], "an escaped percent is not a comment")
cj = {"citations": [{"keys": ["smith2020"], "command": "\\citep [p.~4]{smith2020}"}]}
_, n = RC.rewrite_citations_json(cj, "smith2020", "NEW")
check(n == 1 and cj["citations"][0]["command"] == "\\citep [p.~4]{NEW}",
      "citations.json command with a gap is retargeted too")

# ============================================================ 4. end to end
LIB_GRAFTON = ("@article{graftonAnthony1997,\n  author = {Anthony Grafton},\n"
               "  title = {The Footnote: A Curious History},\n  year = {1997},\n}")
SWAP = {
    "bibEdit": {"mode": "replace", "citekey": "grafton1997", "entry": LIB_GRAFTON},
    "renameCitekey": {"oldKey": "grafton1997", "newKey": "graftonAnthony1997"},
    "summary": "library-sync", "clearSourceFlag": False,
}

print("\n=== e2e: library-sync swap moves the annotation + review rows (V1, flag OFF) ===")
sb = sandbox()
ann = load(sb, "annotations.json")
ann["grafton1997"] = "My reading notes on Grafton."
dump(sb, "annotations.json", ann)
check(any(r["bibKey"] == "grafton1997" for r in load(sb, "bib-review-requests.json")["requests"]),
      "precondition: a grafton1997 review row exists")
r = run(APPLY, str(sb), "complete-only", json.dumps(SWAP))
check(r.returncode == 0, f"swap exited 0 (stderr={r.stderr.strip()[:200]})")
ann = load(sb, "annotations.json")
check("grafton1997" not in ann, "annotations.json: nothing left under the retired key")
check(ann.get("graftonAnthony1997") == "My reading notes on Grafton.", "annotations.json: note under the new key")
check(ann.get("genette1997", "").startswith("The foundational"), "annotations.json: other notes untouched")
rows = load(sb, "bib-review-requests.json")["requests"]
check(not any(r["bibKey"] == "grafton1997" for r in rows), "bib-review: no row left on the retired key")
check(any(r["bibKey"] == "graftonAnthony1997" for r in rows), "bib-review: the row follows the rename")

print("\n=== e2e: the V2 shape (flag ON) — orphan re-keyed, byUid untouched ===")
sb = sandbox()
dump(sb, "annotations.json", {"v": 2, "byUid": {"b0b0": "uid note"},
                              "orphanByKey": {"grafton1997": "orphan note"}})
r = run(APPLY, str(sb), "complete-only", json.dumps(SWAP))
check(r.returncode == 0, f"swap exited 0 (stderr={r.stderr.strip()[:200]})")
check(load(sb, "annotations.json") == {"v": 2, "byUid": {"b0b0": "uid note"},
                                       "orphanByKey": {"graftonAnthony1997": "orphan note"}},
      "V2 file keeps its shape; the orphan follows the rename")

print("\n=== e2e: annotationEdit writes the shape the app reads ===")
sb = sandbox()
bibp = sb / "references.bib"
bibp.write_text(bibp.read_text().replace("@article{grafton1997,", "\\vbid{9f9f}\n@article{grafton1997,"))
dump(sb, "annotations.json", {"v": 2, "byUid": {}, "orphanByKey": {"grafton1997": "stale"}})
op = {"annotationEdit": {"bibKey": "grafton1997", "text": "fresh"}, "summary": "a", "clearSourceFlag": False}
r = run(APPLY, str(sb), "complete-only", json.dumps(op))
check(r.returncode == 0, f"V2 annotationEdit exited 0 (stderr={r.stderr.strip()[:200]})")
check(load(sb, "annotations.json") == {"v": 2, "byUid": {"9f9f": "fresh"}, "orphanByKey": {}},
      "V2: written by the entry's \\vbid uid, stale same-key orphan cleared, nothing at the top level")
op = {"annotationEdit": {"bibKey": "jackson2001", "text": "no uid"}, "summary": "a", "clearSourceFlag": False}
run(APPLY, str(sb), "complete-only", json.dumps(op))
check(load(sb, "annotations.json")["orphanByKey"] == {"jackson2001": "no uid"},
      "V2 without a uid: the orphan bucket the app re-homes")
out = run(str(SCRIPTS / "bib_resolve.py"), str(sb), "grafton1997")
check(json.loads(out.stdout).get("annotation") == "fresh", "bib_resolve reads the V2 note back by uid")

sb = sandbox()
op = {"annotationEdit": {"bibKey": "grafton1997", "text": "flat"}, "summary": "a", "clearSourceFlag": False}
r = run(APPLY, str(sb), "complete-only", json.dumps(op))
ann = load(sb, "annotations.json")
check(r.returncode == 0 and ann.get("grafton1997") == "flat" and "v" not in ann, "V1: stays flat")
out = run(str(SCRIPTS / "bib_resolve.py"), str(sb), "grafton1997")
check(json.loads(out.stdout).get("annotation") == "flat", "bib_resolve reads the V1 note back")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
