#!/usr/bin/env python3
r"""End-to-end test of the paper-file capabilities through the apply_response v1
contract: the bibEdit (append / set-fields / replace), the texEdit region-replace
+ settingsEdit (style-merge), the annotationEdit (chip 12), and the renameCitekey
— the citekey rewrite across the .tex \cite*{} commands + virgil/citations.json,
bundled with a bibEdit replace into ONE atomic per-entry library swap (chip 16) —
all under the pen, in one atomic commit.

Runs the real CLIs against fresh copies of samples/annotation-history (never
mutating the sample).

Run from anywhere:  python3 editor/scripts/tests/test_bib_tex_slice.py
"""
import hashlib
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
sys.path.insert(0, str(SCRIPTS))
import bib_resolve as BR  # noqa: E402 — for entry-block assertions

PASS, FAIL = 0, 0


def check(cond, label):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  \033[32mPASS\033[0m {label}")
    else:
        FAIL += 1; print(f"  \033[31mFAIL\033[0m {label}")


def sandbox():
    d = Path(tempfile.mkdtemp(prefix="chip12-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def run(*args, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=e)


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def bib_of(doc):
    return (doc / "references.bib").read_text(encoding="utf-8")


def tex_of(doc):
    texs = list(doc.glob("*.tex"))
    return texs[0].read_text(encoding="utf-8") if texs else ""


def req_id(doc, kind):
    ar = load(doc, "ai-requests.json")
    return next((r["id"] for r in ar["requests"] if r.get("kind") == kind), None)


def bib_row(doc, bibkey):
    st = load(doc, "bib-review-requests.json")
    return next((r for r in st["requests"] if r.get("bibKey") == bibkey), None)


def inject_request(doc, req):
    p = doc / "virgil" / "ai-requests.json"
    ar = json.loads(p.read_text())
    ar["requests"].append(req)
    p.write_text(json.dumps(ar, indent=2) + "\n")


# Files the atomicity proofs snapshot (the full write-set of each slice).
SNAP_NAMES = [
    "citations.json", "ai-requests.json", "bib-review-requests.json",
    "annotations.json", "document-settings.json", "notifications.json", "version.txt",
]


def snapshot(doc):
    snap = {}
    for name in SNAP_NAMES:
        p = doc / "virgil" / name
        snap[name] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    snap["__bib__"] = hashlib.sha256((doc / "references.bib").read_bytes()).hexdigest()
    texs = list(doc.glob("*.tex"))
    snap["__tex__"] = hashlib.sha256(texs[0].read_bytes()).hexdigest()
    return snap


def pen_gone(doc):
    return not (doc / ".virgil/pen-context.json").exists()


# ============================================================ bibEdit: append
# find-citation: an unanchored CitationRef card + a NEW references.bib entry land
# together (one atomic op), replacing the old "card via apply_response, .bib via
# the Edit tool" split that could orphan one against the other.
print("\n=== bibEdit append: citation card + .bib entry are ONE atomic op (find-citation) ===")
sb = sandbox()
cit = req_id(sb, "citation")
check(cit is not None, "sample has a citation request")
ENTRY = (
    "@book{lessig2006,\n"
    "  author    = {Lawrence Lessig},\n"
    "  title     = {Code: Version 2.0},\n"
    "  publisher = {Basic Books},\n"
    "  year      = {2006},\n"
    "}"
)
card = {
    "id": "vc_chip12", "command": "\\citet{lessig2006}", "keys": ["lessig2006"],
    "createdAt": "2026-06-04T00:00:00.000Z", "unanchored": True,
}
op = {
    "requestId": cit, "panel": "citations", "card": card,
    "bibEdit": {"mode": "append", "entry": ENTRY},
    "summary": "Added lessig2006 to bibliography", "clearSourceFlag": False,
}
r = run(APPLY, str(sb), "complete-task", json.dumps(op))
check(r.returncode == 0, f"complete-task exited 0 (stderr={r.stderr.strip()[:160]})")
cits = load(sb, "citations.json")["citations"]
check(any(c["id"] == "vc_chip12" for c in cits), "citations.json gained the unanchored card")
bib = bib_of(sb)
check("@book{lessig2006" in bib, "references.bib gained the @book{lessig2006} entry")
check("Code: Version 2.0" in bib, ".bib carries the entry body (title)")
check(BR.find_entry_block(bib, "lessig2006")[0] is not None, "new entry is brace-balanced + locatable")
check(bib.endswith("}\n"), ".bib ends with a single trailing newline (house style)")
creq = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == cit)
check(creq["status"] == "complete", "citation request status=complete")
check(creq.get("result") == "direct-created", f"result=direct-created (got {creq.get('result')})")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped to 1")
check(pen_gone(sb), "pen released")

# ----- atomicity: a fault BETWEEN the card write and the .bib write leaves NEITHER
print("\n=== bibEdit append ATOMICITY: fault between card + .bib → NEITHER lands ===")
sb = sandbox()
cit = req_id(sb, "citation")
before = snapshot(sb)
# write order: citations.json(card) #1, ai-requests.json(task) #2, references.bib(bib) #3.
# Fail after 2 commits → the card committed then rolls back, the .bib is never touched.
r = run(APPLY, str(sb), "complete-task", json.dumps(op),
        env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "2"})
check(r.returncode != 0, "complete-task exited non-zero on injected mid-commit fault")
after = snapshot(sb)
check(before == after, "every target file byte-identical (full rollback — card AND .bib)")
check("lessig2006" not in bib_of(sb), ".bib entry did NOT land (no orphaned source)")
check(not any(c["id"] == "vc_chip12" for c in load(sb, "citations.json")["citations"]),
      "citation card did NOT land (no orphaned card)")
check(not (sb / "virgil/version.txt").exists(), "version.txt was NOT created (rolled back)")
check(pen_gone(sb), "pen released even though the write failed")

# ----- and a later fault (after the .bib commits) rolls the .bib back too
print("\n=== bibEdit append ATOMICITY: fault AFTER the .bib commit also rolls it back ===")
sb = sandbox(); cit = req_id(sb, "citation")
before = snapshot(sb)
r = run(APPLY, str(sb), "complete-task", json.dumps(op),
        env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "3"})
check(r.returncode != 0, "exited non-zero (fault after the .bib commit)")
check(before == snapshot(sb), "full rollback — the committed .bib was restored")

# ===================================================== bibEdit: set-fields
# answer-bib-review type=fields: surgically add a DOI to grafton1997, preserving
# every other field + the user's BibTeX formatting. The bib-review row flips.
print("\n=== bibEdit set-fields: add a DOI, preserve the rest (answer-bib-review fields) ===")
sb = sandbox()
check(bib_row(sb, "grafton1997")["status"] == "pending", "grafton1997 review starts pending")
check("doi" not in BR.parse_fields(BR.find_entry_block(bib_of(sb), "grafton1997")[0]),
      "grafton1997 has no DOI to start")
op = {
    "requestId": "grafton1997", "bibReviewType": "fields",
    "bibEdit": {"mode": "set-fields", "citekey": "grafton1997",
                "fields": {"doi": "10.1111/0018-2656.00033"}},
    "summary": "Verified grafton1997; added DOI",
}
r = run(APPLY, str(sb), "complete-only", json.dumps(op), "--result", "auto-applied")
check(r.returncode == 0, f"complete-only exited 0 (stderr={r.stderr.strip()[:160]})")
g = BR.find_entry_block(bib_of(sb), "grafton1997")[0]
fields = BR.parse_fields(g)
check(fields.get("doi") == "10.1111/0018-2656.00033", f"DOI set (got {fields.get('doi')!r})")
check(fields.get("pages") == "215--232", "existing pages field preserved verbatim")
check(fields.get("title") == "The Footnote: A Curious History", "existing title preserved")
check(g.startswith("@article{grafton1997"), "entry @type + citekey unchanged (surgical edit)")
check(bib_row(sb, "grafton1997")["status"] == "complete", "grafton1997 bib-review row → complete")
check(bib_row(sb, "vannevar1945")["status"] == "pending",
      "the OTHER (notes) review on a different key is NOT touched (type-narrowed)")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped")

# ===================================================== bibEdit: replace
# answer-bib-review type-reshape (and the library-sync paper-side swap): swap the
# whole entry block for a different @type, dropping fields that don't belong.
print("\n=== bibEdit replace: reshape @article → @book (type fix / library-sync swap) ===")
sb = sandbox()
NEW_GRAFTON = (
    "@book{grafton1997,\n"
    "  author    = {Anthony Grafton},\n"
    "  title     = {The Footnote: A Curious History},\n"
    "  publisher = {Harvard University Press},\n"
    "  address   = {Cambridge, MA},\n"
    "  year      = {1997},\n"
    "}"
)
op = {
    "requestId": "grafton1997", "bibReviewType": "fields",
    "bibEdit": {"mode": "replace", "citekey": "grafton1997", "entry": NEW_GRAFTON},
    "summary": "Reshaped grafton1997 @article → @book",
}
r = run(APPLY, str(sb), "complete-only", json.dumps(op), "--result", "auto-applied")
check(r.returncode == 0, f"complete-only exited 0 (stderr={r.stderr.strip()[:160]})")
g_text, g_type = BR.find_entry_block(bib_of(sb), "grafton1997")
check(g_type == "book", f"entry is now @book (got @{g_type})")
check("Harvard University Press" in g_text, "new publisher present")
check("journal" not in BR.parse_fields(g_text), "old @article-only field (journal) dropped")
check(bib_of(sb).count("@article{grafton1997") == 0 and bib_of(sb).count("grafton1997") >= 1,
      "no leftover @article{grafton1997} (block replaced in place, not duplicated)")
check(bib_row(sb, "grafton1997")["status"] == "complete", "bib-review row → complete")

# ===================================================== annotationEdit
# answer-bib-review type=notes: draft an annotation into annotations.json (the
# AnnotationsState = { [bibKey]: string } the Bibliography panel renders).
print("\n=== annotationEdit: draft a bib annotation (answer-bib-review notes) ===")
sb = sandbox()
ANNOT = "Vannevar Bush's 1945 Memex essay — the conceptual ancestor of the hyperlink; cite in §6 for the associative-trail claim."
op = {
    "requestId": "vannevar1945", "bibReviewType": "notes",
    "annotationEdit": {"bibKey": "vannevar1945", "text": ANNOT},
    "summary": "Annotated vannevar1945",
}
r = run(APPLY, str(sb), "complete-only", json.dumps(op), "--result", "auto-applied")
check(r.returncode == 0, f"complete-only exited 0 (stderr={r.stderr.strip()[:160]})")
ann = load(sb, "annotations.json")
check(ann.get("vannevar1945") == ANNOT, "annotations.json[vannevar1945] holds the note (flat string)")
check(ann.get("genette1997"), "pre-existing annotations preserved")
check(bib_row(sb, "vannevar1945")["status"] == "complete", "vannevar1945 (notes) review → complete")
check(bib_row(sb, "grafton1997")["status"] == "pending",
      "the OTHER (fields) review is NOT touched (type-narrowed)")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped")

# ============================================== texEdit region-replace + settingsEdit
# style-merge: rewrite the whole preamble [start..\begin{document}] AND flip the
# per-doc styleId AND complete the request — all in one pen-wrapped commit.
print("\n=== texEdit region-replace + settingsEdit: the style-merge transaction ===")
sb = sandbox()
inject_request(sb, {
    "id": "sm_chip12", "kind": "style-merge", "text": "Merge my microtype tweak onto amsart",
    "createdAt": "2026-06-04T00:00:00.000Z", "status": "submitted",
    "payload": {"kind": "style-merge", "targetStyleId": "amsart-clean"},
})
NEW_PREAMBLE = (
    "\\documentclass{amsart}\n"
    "\\usepackage[utf8]{inputenc}\n"
    "\\usepackage{microtype}\n"
    "\\providecommand{\\vfid}[1]{}\n"
    "\\providecommand{\\vcid}[1]{}\n"
    "\\providecommand{\\vexid}[1]{}\n"
    "\\providecommand{\\vxid}[1]{}\n"
    "\\begin{document}\n\n"
)
op = {
    "requestId": "sm_chip12",
    "texEdit": {"mode": "region-replace", "replacement": NEW_PREAMBLE},
    "settingsEdit": {"set": {"styleId": "amsart-clean"}},
    "summary": "Style merge: amsart-clean (carried microtype)",
}
r = run(APPLY, str(sb), "complete-only", json.dumps(op), "--result", "auto-applied")
check(r.returncode == 0, f"complete-only exited 0 (stderr={r.stderr.strip()[:160]})")
tex = tex_of(sb)
check("\\documentclass{amsart}" in tex, "new preamble landed (amsart)")
check("\\documentclass{article}" not in tex, "old preamble gone (article)")
check("\\usepackage{microtype}" in tex, "carried-forward package present")
check("\\usepackage{natbib}" not in tex, "old preamble package gone (natbib)")
check(tex.count("\\begin{document}") == 1, "exactly one \\begin{document} (no doubling)")
check("\\maketitle" in tex, "body preserved (\\maketitle)")
check("%!v:0c01" in tex, "body paragraph markers preserved")
check("\\section{Introduction}" in tex, "body section preserved")
check(load(sb, "document-settings.json")["styleId"] == "amsart-clean", "styleId flipped in virgil/document-settings.json")
smreq = next(r for r in load(sb, "ai-requests.json")["requests"] if r["id"] == "sm_chip12")
check(smreq["status"] == "complete" and smreq.get("result") == "auto-applied",
      "style-merge request: complete / auto-applied")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped")

# ----- atomicity: a fault rolls the preamble rewrite + settings + status all back
print("\n=== style-merge ATOMICITY: a fault rolls preamble + settings + status all back ===")
sb = sandbox()
inject_request(sb, {
    "id": "sm_chip12", "kind": "style-merge", "text": "x",
    "createdAt": "2026-06-04T00:00:00.000Z", "status": "submitted",
    "payload": {"kind": "style-merge", "targetStyleId": "amsart-clean"},
})
before = snapshot(sb)
r = run(APPLY, str(sb), "complete-only", json.dumps(op), "--result", "auto-applied",
        env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "2"})
check(r.returncode != 0, "exited non-zero on injected fault")
check(before == snapshot(sb), "full rollback — .tex, settings, and request status all reverted")
check("\\documentclass{article}" in tex_of(sb), "original preamble intact after rollback")
check(pen_gone(sb), "pen released even though the write failed")

# ===================================================== writes-only (no Task)
# library-sync's paper-side .bib swap: a bibEdit that completes NO Task (no
# requestId) still lands atomically + notifies + bumps version.
print("\n=== writes-only: a bibEdit with no requestId lands + audits (library-sync .bib swap) ===")
sb = sandbox()
NEW_JACKSON = (
    "@book{jackson2001,\n"
    "  author    = {H. J. Jackson},\n"
    "  title     = {Marginalia: Readers Writing in Books},\n"
    "  publisher = {Yale University Press},\n"
    "  address   = {New Haven},\n"
    "  year      = {2001},\n"
    "  edition   = {Revised},\n"
    "}"
)
op = {
    "bibEdit": {"mode": "replace", "citekey": "jackson2001", "entry": NEW_JACKSON},
    "summary": "library-sync jackson2001", "clearSourceFlag": False,
}
nbox = load(sb, "notifications.json")
n_before = len(nbox["items"]) if isinstance(nbox, dict) else 0
r = run(APPLY, str(sb), "complete-only", json.dumps(op))
check(r.returncode == 0, f"writes-only complete-only exited 0 (stderr={r.stderr.strip()[:160]})")
check("edition" in BR.parse_fields(BR.find_entry_block(bib_of(sb), "jackson2001")[0]), "jackson2001 swapped (gained edition)")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped (writes-only still audits)")
check(len(load(sb, "notifications.json")["items"]) == n_before + 1, "one notification appended")

# ============================================ renameCitekey + bibEdit: ONE atomic swap
# sync-bib-to-library (via answer-bib-review --library-sync): a matched entry is
# swapped to the library's authoritative version AND its citekey is renamed
# throughout the doc — the .bib body, every \cite*{} in the .tex, and every
# citations.json card, all in ONE writes-only atomic op (no requestId). This is
# the chip-16 endpoint: the citekey rename rides the SAME commit as the .bib swap,
# not a separate os.replace outside the pen.
print("\n=== renameCitekey + bibEdit replace: the per-entry library swap is ONE atomic op ===")
sb = sandbox()
LIB_GRAFTON = (
    "@article{graftonAnthony1997,\n"
    "  author    = {Anthony Grafton},\n"
    "  title     = {The Footnote: A Curious History},\n"
    "  journal   = {The American Historical Review},\n"
    "  volume    = {102},\n"
    "  pages     = {215--232},\n"
    "  year      = {1997},\n"
    "  doi       = {10.1111/0018-2656.00033},\n"
    "}"
)
# Preconditions: grafton1997 is in the .bib (1×), the .tex cites (2×, incl. a
# [ch.~3] bracket-arg form), and citations.json (cc04, cc05).
check(tex_of(sb).count("grafton1997") == 2, "precondition: 2 grafton1997 cites in .tex")
check(sum("grafton1997" in (c.get("keys") or []) for c in load(sb, "citations.json")["citations"]) == 2,
      "precondition: 2 grafton1997 citation cards")
swap = {
    "bibEdit": {"mode": "replace", "citekey": "grafton1997", "entry": LIB_GRAFTON},
    "renameCitekey": {"oldKey": "grafton1997", "newKey": "graftonAnthony1997"},
    "summary": "library-sync grafton1997 -> graftonAnthony1997", "clearSourceFlag": False,
}
r = run(APPLY, str(sb), "complete-only", json.dumps(swap))
check(r.returncode == 0, f"bundled swap exited 0 (stderr={r.stderr.strip()[:160]})")
# --- the .bib swapped (old key gone, library entry in) ---
bib = bib_of(sb)
check("grafton1997" not in bib, ".bib: no leftover old citekey (grafton1997)")
check(BR.find_entry_block(bib, "graftonAnthony1997")[0] is not None, ".bib: library entry (graftonAnthony1997) present")
check("10.1111/0018-2656.00033" in bib, ".bib: library entry body landed (DOI)")
# --- every .tex \cite*{} retargeted (incl. the [ch.~3] bracket-arg form) ---
tex = tex_of(sb)
check(tex.count("grafton1997") == 0, ".tex: no \\cite*{grafton1997} left")
check("\\citet{graftonAnthony1997}" in tex, ".tex: \\citet{} retargeted")
check("\\citet[ch.~3]{graftonAnthony1997}" in tex, ".tex: bracket-arg \\citet[ch.~3]{} retargeted (args preserved)")
# --- every citation card retargeted (keys + command) ---
cits = load(sb, "citations.json")["citations"]
check(not any("grafton1997" in (c.get("keys") or []) for c in cits), "citations.json: no card keyed grafton1997")
check(sum("graftonAnthony1997" in (c.get("keys") or []) for c in cits) == 2, "citations.json: 2 cards retargeted")
cc05 = next(c for c in cits if c["id"] == "cc05")
check(cc05["command"] == "\\citet[ch.~3]{graftonAnthony1997}", "citations.json: bracket-arg command retargeted")
check(not any("grafton1997" in (c.get("command") or "") and "graftonAnthony1997" not in (c.get("command") or "")
              for c in cits), "citations.json: no command still references the old key")
# --- audited (writes-only still bumps version + notifies) ---
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped (writes-only swap audits)")
check(pen_gone(sb), "pen released")

# ----- ATOMICITY: a fault mid-write rolls back .bib + .tex + citations.json TOGETHER
# Commit order is [citations.json, references.bib, document.tex, notifications, version].
# A fault BETWEEN the .bib and the .tex (K=2) must leave all three byte-identical;
# a fault AFTER all three paper files commit (K=3) must still restore all three.
print("\n=== renameCitekey + bibEdit ATOMICITY: a fault leaves .bib + .tex + citations ALL untouched ===")
for K in (2, 3):
    sb = sandbox()
    before = snapshot(sb)
    r = run(APPLY, str(sb), "complete-only", json.dumps(swap),
            env={"VIRGIL_TEST_FAIL_AFTER_WRITES": str(K)})
    check(r.returncode != 0, f"K={K}: exited non-zero on injected mid-commit fault")
    check(before == snapshot(sb), f"K={K}: every file byte-identical (full rollback — .bib AND .tex AND citations)")
    check("@article{grafton1997" in bib_of(sb), f"K={K}: .bib still has the ORIGINAL @article{{grafton1997}}")
    check(tex_of(sb).count("grafton1997") == 2 and "graftonAnthony1997" not in tex_of(sb),
          f"K={K}: .tex cites unchanged (no half-applied rename)")
    check(any("grafton1997" in (c.get("keys") or []) for c in load(sb, "citations.json")["citations"]),
          f"K={K}: citations.json cards unchanged")
    check(pen_gone(sb), f"K={K}: pen released even though the write failed")

# ----- IDEMPOTENCY: a renameCitekey for a key absent from the doc is a no-op
# (sync mustn't fail the whole run when an entry's old key the doc never used).
print("\n=== renameCitekey IDEMPOTENCY: oldKey absent from the doc → no-op, doesn't fail ===")
sb = sandbox()
tex_h0 = hashlib.sha256(next(sb.glob("*.tex")).read_bytes()).hexdigest()
bib_h0 = hashlib.sha256((sb / "references.bib").read_bytes()).hexdigest()
cit_h0 = hashlib.sha256((sb / "virgil/citations.json").read_bytes()).hexdigest()
op = {"renameCitekey": {"oldKey": "ghost1900", "newKey": "ghost1999"},
      "summary": "library-sync ghost1900 (absent)", "clearSourceFlag": False}
r = run(APPLY, str(sb), "complete-only", json.dumps(op))
check(r.returncode == 0, f"absent-key rename exited 0 — a no-op, not a failure (stderr={r.stderr.strip()[:160]})")
check(hashlib.sha256(next(sb.glob("*.tex")).read_bytes()).hexdigest() == tex_h0, ".tex byte-identical (no-op)")
check(hashlib.sha256((sb / "references.bib").read_bytes()).hexdigest() == bib_h0, "references.bib byte-identical (no-op)")
check(hashlib.sha256((sb / "virgil/citations.json").read_bytes()).hexdigest() == cit_h0, "citations.json byte-identical (no-op)")
check((sb / "virgil/version.txt").read_text().strip() == "1", "writes-only op still ran (version bumped), it just changed no paper text")

# ----- GUARD: texEdit + renameCitekey in one op is refused (can't queue two .tex writes)
print("\n=== guard: texEdit + renameCitekey in one op is refused (same-path write) ===")
sb = sandbox()
op = {
    "texEdit": {"mode": "replace-span", "anchorUuid": "0c01", "match": "x", "replacement": "y"},
    "renameCitekey": {"oldKey": "grafton1997", "newKey": "graftonAnthony1997"},
}
r = run(APPLY, str(sb), "complete-only", json.dumps(op))
check(r.returncode != 0, "an op carrying BOTH texEdit and renameCitekey is rejected, not silently last-write-wins")
check("graftonAnthony1997" not in tex_of(sb) and tex_of(sb).count("grafton1997") == 2,
      ".tex untouched by the refused op")

# ===================================================== guard: malformed op
# An op with neither a requestId nor any paper write is still rejected (the
# legacy "op missing requestId" guard survives the writes-only relaxation).
print("\n=== guard: an op with no requestId AND no writes is still rejected ===")
sb = sandbox()
r = run(APPLY, str(sb), "complete-only", json.dumps({"summary": "nothing to do"}))
check(r.returncode != 0, "empty op (no id, no writes) is rejected, not silently no-op'd")

print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
