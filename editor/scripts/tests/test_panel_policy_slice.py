#!/usr/bin/env python3
r"""Contract test for the per-op panel applicability SSOT (task 2026-07-17-156).

`apply_response.MUTATION_PANEL_POLICY` is the ONE table every existing-card
mutation op asks before it writes. Before it existed each op hand-enumerated its
own refused panels inline and the five card-CRUD skill markdowns carried a second,
hand-written copy — and the fork was live: `cmd_update` guarded `archive` and
`examples` and forgot `citations`, while `cmd_archive`/`cmd_move` both refused it.
So `update {"set":{"command":"citep"}}` on a citation card rewrote `citations.json`
alone while the `.tex \vcid\cite{}` marker and the `references.bib` entry stayed
put — the exact sidecar-vs-.tex-vs-.bib desync edit-card.md promises the op
prevents. Nothing failed and nothing warned; the written contract was the only
thing between an agent and the corruption, and `cmd_update` had NO regression test
pinning its refusal set at all.

Three legs, in the order they'd catch a regression:

1. **The reported defect** — every shape of citation `update` refuses, and the
   sidecar comes out byte-identical.
2. **The asymmetry the naive fix breaks** — footnote *body* editing (with its
   `.tex \footnote{}` sync) is a real feature of the same op, so the guard is
   citation-specific and NOT `hit.panel in ATOM_BEARING_PANELS`. Both directions
   are asserted: citations refused AND footnotes/notes/todos/reports/cutter/
   revisions still writable.
3. **The table itself** — every op governed, every op exhaustive over the panel
   universe, and the fail-safe default (an unclassified panel REFUSES) exercised
   through `_guard_panel` directly, which is the property that makes a future
   sidecar unable to inherit "silently mutable" the way citations did.

Run from anywhere:  python3 editor/scripts/tests/test_panel_policy_slice.py
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
import apply_response as AR          # noqa: E402
import card_by_id as CBID            # noqa: E402

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
    d = Path(tempfile.mkdtemp(prefix="task156-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def op(sb, sub, payload):
    return subprocess.run([sys.executable, APPLY, str(sb), sub, json.dumps(payload)],
                          capture_output=True, text=True, env=dict(os.environ))


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def digest(doc, name):
    p = doc / "virgil" / name
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def tex_of(doc):
    texs = list(doc.glob("*.tex"))
    return texs[0].read_text(encoding="utf-8") if texs else ""


def by_id(doc, name, key, cid):
    st = load(doc, name) or {}
    return next((c for c in st.get(key, []) if c.get("id") == cid), None)


def text_of_content(card):
    return (card.get("content", {}).get("content", [{}])[0]
            .get("content", [{}])[0].get("text"))


# In-sample card ids (samples/annotation-history/virgil/*.json).
CIT = "cc01"                                       # citations.json — \citet{bringhurst2004}
FN = "f001"                                        # footnotes.json — a real \footnote
NOTE = "ea4d5253-406d-499e-85b6-8055956c9f95"      # notes.json
NOTE2 = "bbf4cb59-c473-4fdc-870b-98a16a0868d5"     # notes.json
TODO = "ab7e7930-78cb-4d4c-b400-9ac04906a8fd"      # todos.json
REPORT = "7b3e9a14-2c5d-4f80-9a16-3d8e1f0a2b01"    # reports.json
CUTTER = "582f061d-311f-4ef0-adcd-bff13a86d71b"    # cutter.json comment
REVISION = "0dd67fac-9571-47cc-acf2-edb6429b6b23"  # revisions.json comment
EXAMPLE = "ee01"                                   # examples.json (a .tex-derived shadow)
NATIVE_ARCH = "ba034527-6a92-4324-a133-7ba069fb11b4"  # archive.json snippet


# ─────────────── 1. the reported defect: citation update refuses ───────────
print("\n=== update / citation — every shape refuses, sidecar byte-identical ===")
for label, payload in [
    ("the coupled command", {"cardId": CIT, "set": {"command": "\\citep{bringhurst2004}"}}),
    ("the coupled keys", {"cardId": CIT, "set": {"keys": ["fabricated2099"]}}),
    ("a benign field (blanket refusal — the doc promises the KIND is refused)",
     {"cardId": CIT, "set": {"margin": "left"}}),
    ("a plain --body", {"cardId": CIT, "body": "x"}),
]:
    sb = sandbox()
    before = digest(sb, "citations.json")
    r = op(sb, "update", payload)
    check(r.returncode != 0, f"refuses update on a citation — {label}")
    check(digest(sb, "citations.json") == before,
          f"citations.json byte-identical after the refusal — {label}")
    check(not (sb / "virgil/version.txt").exists(),
          f"no version bump (the refusal is before the transaction) — {label}")

sb = sandbox()
r = op(sb, "update", {"cardId": CIT, "set": {"command": "\\citep{x}"}})
err = r.stderr
check("find-citation" in err and "renameCitekey" in err,
      "the refusal names the correct routes (find-citation / renameCitekey), not just 'refused'")
check("references.bib" in err and ".tex" in err,
      "the refusal states WHY (the .tex marker + references.bib coupling)")

print("\n=== update / citation — an UNANCHORED citation refuses too (the durable case) ===")
# An anchored citation's sidecar command/keys is a .tex-derived shadow (EditorPane's
# once-per-mount syncFromEditor rebuilds it from the atoms), so a stray edit is
# overwritten on reload. An UNANCHORED one survives that rebuild verbatim and is
# read back by the re-anchor rebuild to plant the \cite — there the desync is
# durable and reaches the document. Same blanket refusal covers both.
sb = sandbox()
st = load(sb, "citations.json")
for c in st["citations"]:
    if c["id"] == CIT:
        c["unanchored"] = True
(sb / "virgil/citations.json").write_text(json.dumps(st, indent=2), encoding="utf-8")
before = digest(sb, "citations.json")
r = op(sb, "update", {"cardId": CIT, "set": {"keys": ["fabricated2099"]}})
check(r.returncode != 0, "refuses update on an unanchored citation")
check(digest(sb, "citations.json") == before, "unanchored citations.json byte-identical")


# ─────────── 2. the asymmetry: what the naive ATOM_BEARING fix would break ──
print("\n=== update / the guard is citation-specific, NOT atom-bearing-shaped ===")
check("footnotes" in AR.MUTATION_PANEL_POLICY["update"].allow,
      "footnotes stays on update's allow-list (a `panel in ATOM_BEARING_PANELS` guard "
      "would break footnote body editing — the naive sibling-copy fix)")
check("citations" in AR.MUTATION_PANEL_POLICY["update"].refuse,
      "citations is refused with a specific, actionable message")

sb = sandbox()
NEWFN = "Revised: the gloss is keyed to the lemma by a superscript letter."
r = op(sb, "update", {"cardId": FN, "body": NEWFN})
check(r.returncode == 0, f"footnote body edit still succeeds (stderr={r.stderr.strip()[:120]})")
check(text_of_content(by_id(sb, "footnotes.json", "footnotes", FN)) == NEWFN,
      "footnote sidecar content updated")
check(f"\\vfid{{{FN}}}\\footnote{{{NEWFN}}}" in tex_of(sb),
      "footnote .tex \\footnote{} body updated (the atom-coupled sync still runs)")

print("\n=== update / every other allowed panel still writable ===")
for label, cid, filename, list_key, field in [
    ("note", NOTE, "notes.json", "cards", "title"),
    ("todo", TODO, "todos.json", "items", "notes"),
    ("report", REPORT, "reports.json", "cards", "title"),
    ("cutter comment", CUTTER, "cutter.json", "cards", "title"),
    ("revisions comment", REVISION, "revisions.json", "cards", "title"),
]:
    sb = sandbox()
    r = op(sb, "update", {"cardId": cid, "set": {field: "task156"}})
    check(r.returncode == 0, f"{label} named-field edit still succeeds "
                             f"(stderr={r.stderr.strip()[:90]})")
    check((by_id(sb, filename, list_key, cid) or {}).get(field) == "task156",
          f"{label} field landed on disk")


# ─────────────── 3. the other ops' refusals kept their contract text ────────
print("\n=== the refusal messages moved into the table WITHOUT drifting ===")
sb = sandbox()
check("atom-bearing" in op(sb, "archive", {"cardId": FN}).stderr,
      "archive still refuses a footnote with the atom-bearing reason")
check("atom-bearing" in op(sb, "archive", {"cardId": CIT}).stderr,
      "archive still refuses a citation with the atom-bearing reason")
check("already archived" in op(sb, "archive", {"cardId": NATIVE_ARCH}).stderr,
      "archive still refuses an already-archived snippet")
check("atom-bearing" in op(sb, "move", {"cardId": FN, "newAnchor": "2201"}).stderr,
      "move still defers a footnote with the atom-bearing reason")
r = op(sb, "restore", {"cardId": NOTE})
check("not archived" in r.stderr and "notes" in r.stderr,
      "restore still refuses a live card, naming its panel")
check("archived" in op(sb, "update", {"cardId": NATIVE_ARCH, "body": "x"}).stderr,
      "update still refuses an archived card (restore it first)")
check("example" in op(sb, "update", {"cardId": EXAMPLE, "set": {"x": 1}}).stderr,
      "update still refuses an example (it lives in the .tex)")

print("\n=== link — the two exempt stores refuse (the same silent-lost-write class) ===")
sb = sandbox()
before_arch, before_notes = digest(sb, "archive.json"), digest(sb, "notes.json")
r = op(sb, "link", {"cardAId": NOTE, "cardBId": NATIVE_ARCH})
check(r.returncode != 0, "refuses linking an archived card (restore drops the envelope record)")
check(digest(sb, "archive.json") == before_arch and digest(sb, "notes.json") == before_notes,
      "neither side written — a refused link leaves no dangling one-sided reference")
r = op(sb, "link", {"cardAId": NOTE, "cardBId": EXAMPLE})
check(r.returncode != 0, "refuses linking an example (examples.json is a .tex-derived shadow)")

sb = sandbox()
r = op(sb, "link", {"cardAId": NOTE, "cardBId": CIT})
check(r.returncode == 0, f"link on a CITATION still succeeds — relatedCards needs nothing from "
                        f"the .tex (stderr={r.stderr.strip()[:90]})")
r = op(sb, "link", {"cardAId": NOTE, "cardBId": NOTE2})
check(r.returncode == 0, "link note↔note still succeeds")


# ─────────────── 4. the table: governed, exhaustive, fail-safe ──────────────
print("\n=== the applicability table itself ===")
check(set(AR.MUTATION_OPS) == set(AR.MUTATION_PANEL_POLICY) | AR.KIND_GATED_MUTATION_OPS,
      "every mutation op is governed — panel-gated (a policy row) or kind-gated "
      "(accept/reject, SUGGESTION_KINDS); a new op declaring neither fails on import")
check(AR.KIND_GATED_MUTATION_OPS == {"accept", "reject"},
      "the kind-gated set is exactly accept/reject (each asserts kind in SUGGESTION_KINDS)")

universe = set(AR.ALL_CARD_SIDECARS)
check(universe == set(CBID.ALL_CARD_SIDECARS),
      "ONE panel universe: card_by_id's search order IS apply_response's table "
      "(the exhaustiveness assertion is meaningless if half the universe lives elsewhere)")
check(universe == set(AR.PANEL_TO_SIDECAR) | {"archive", "examples"},
      "the universe is the writeback panels plus the two writeback-exempt card stores")
for name, pol in AR.MUTATION_PANEL_POLICY.items():
    check(not (universe - pol.allow - set(pol.refuse)),
          f"policy[{name}] classifies every panel in the universe (allow ∪ refuse)")
    check(not (pol.allow & set(pol.refuse)),
          f"policy[{name}] never both allows and refuses a panel")
    check(not ((pol.allow | set(pol.refuse)) - universe),
          f"policy[{name}] names no unknown panel")

print("\n=== fail-safe default: an UNCLASSIFIED panel refuses (allow-list, not deny-list) ===")


class _FakeHit:
    def __init__(self, panel):
        self.panel = panel
        self.card = {"id": "fake-1"}


try:
    AR._guard_panel("update", _FakeHit("figures"), "figure")
    check(False, "an unclassified panel refuses")
except SystemExit as e:
    check(e.code != 0, "an unclassified panel refuses (a future sidecar cannot inherit "
                       "'silently mutable' the way citations did)")

try:
    AR._guard_panel("update", _FakeHit("notes"), "note")
    check(True, "an allowed panel passes the guard silently")
except SystemExit:
    check(False, "an allowed panel passes the guard silently")

# An op with no policy row (accept/reject) is a no-op here, not an accidental
# refusal — their gate is kind, asserted in _resolve_proposal.
try:
    AR._guard_panel("accept", _FakeHit("cutter"), "cutter-suggestion")
    check(True, "a kind-gated op passes the panel guard (its gate is kind, not panel)")
except SystemExit:
    check(False, "a kind-gated op passes the panel guard (its gate is kind, not panel)")


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
