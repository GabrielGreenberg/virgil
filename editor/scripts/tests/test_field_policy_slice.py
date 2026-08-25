#!/usr/bin/env python3
r"""Contract test for the per-op FIELD ownership SSOT (task 2026-08-25-467).

`apply_response.MUTATION_PANEL_POLICY` (task 156) answers "may <op> write a card
living in <panel>?" — the STORE question — and is exhaustive-by-construction over
the card-store universe. NOTHING answered "may <op> write this FIELD?", and
`cmd_update`'s `set` loop is `for k, v in sets.items(): card[k] = v`: arbitrary
key, arbitrary value, no allow-list, no deny-list, no coupling check.

The reported shape — and it was TAUGHT, which is why it was HIGH:

    apply_response.py <doc> update '{"cardId":"<sug>","set":{"status":"accepted"}}'

does step 5 of `cmd_accept` and NOTHING else. `accept` (1) asserts the card is a
suggestion, (2) refuses a contradictory terminal state, (3) refuses a card with no
original_text/suggested_text/anchor, (4) SPLICES original_text → suggested_text
into the .tex through replace-span, whose stale-guard die()s before commit if the
paragraph drifted, (5) flips status → accepted, (6) completes the originating Task
with result=accepted. The `update` shortcut leaves the paper byte-unchanged and
the Task open while the panel reads *accepted* — a visible feature doing the wrong
thing, silently, exit 0. And `edit-card.md` named `status` as an editable
suggestion field while `accept-suggestion.md` routed field edits back to
edit-card: two routing copies composing into a loop that lands on the unsafe door.

Legs, in the order they'd catch a regression:

1. **The taught leg** — `status` on a real suggestion refuses, at every value in
   the union, on BOTH suggestion kinds; the .tex, the sidecar and ai-requests.json
   come out byte-identical and no version is bumped; the message NAMES the accept
   op (an agent reading it is routed, not merely stopped).
2. **The accepting controls** (so no leg passes vacuously) — `accept` on the same
   card still works end to end; `suggested_text`/`user_text`/`explanation`/
   `instructions` still land on the same card; `status` on a NON-suggestion still
   lands; `aiRequest` still lands, because `draft-footnote`'s virtual-request
   branch clears a flag with exactly that op and a blanket refusal would break a
   shipped feature (the lesson 156 itself earned).
3. **The latent legs** — `id` on a footnote (its sidecar id IS its \vfid marker
   id), `links` on a note (the anchor `cmd_move` validates), `appliedChange` on a
   suggestion (a live blue range in the .tex), `aiOriginRequestId` (the
   back-pointer accept/reject read to pick which Task to complete).
4. **The table itself** — derived, not hand-listed: every declared owner name is a
   real MUTATION_OPS key or a declared non-op door, every message spells its route
   and its $field, no two rows claim one field for overlapping kinds — and the
   import-time assertion has a leg of its own (a bogus table raises), which its
   panel twin does not, because the twin's assertions are inline.
5. **The guard's own semantics** — a row is skipped for the op that OWNS it, and
   `kinds=` really scopes (the property that keeps a non-suggestion `status`
   writable).

Run from anywhere:  python3 editor/scripts/tests/test_field_policy_slice.py
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
    d = Path(tempfile.mkdtemp(prefix="task467-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def op(sb, sub, payload, *extra):
    return subprocess.run([sys.executable, APPLY, str(sb), sub, json.dumps(payload), *extra],
                          capture_output=True, text=True, env=dict(os.environ))


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def digest(doc, name):
    p = doc / "virgil" / name
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None


def tex_digest(doc):
    texs = sorted(doc.glob("*.tex"))
    return hashlib.sha256(texs[0].read_bytes()).hexdigest() if texs else None


def tex_of(doc):
    texs = sorted(doc.glob("*.tex"))
    return texs[0].read_text(encoding="utf-8") if texs else ""


def by_id(doc, name, key, cid):
    st = load(doc, name) or {}
    return next((c for c in st.get(key, []) if c.get("id") == cid), None)


def req_by_id(doc, rid):
    ar = load(doc, "ai-requests.json") or {}
    return next((r for r in ar.get("requests", []) if r.get("id") == rid), None)


# In-sample card ids (samples/annotation-history/virgil/*.json).
REV_SUG = "374060f9-5710-49cd-8d60-696e85182709"   # revisions.json, kind=suggestion, pending
CUT_SUG = "fe55c27a-5c73-42f2-aed6-c81329f2655f"   # cutter.json,    kind=suggestion, pending
NOTE = "ea4d5253-406d-499e-85b6-8055956c9f95"      # notes.json
TODO = "ab7e7930-78cb-4d4c-b400-9ac04906a8fd"      # todos.json
FN = "f001"                                        # footnotes.json — a real \footnote
REVISION_COMMENT = "0dd67fac-9571-47cc-acf2-edb6429b6b23"   # revisions.json, kind=comment

# The lifecycle used by leg 1's end-to-end control: a proposal drafted through the
# real v1 propose path, so the .tex + the Task are in their true pre-accept state.
REV_ORIGINAL = ("The fact that this notation has survived from the late nineteenth century "
                "into the present is not an accident of typography.")
REV_SUGGESTED = ("That this notation has endured from the late nineteenth century into the "
                 "present is no typographic accident.")


def propose(doc, *, card_id, task_id, anchor):
    card = {
        "kind": "suggestion", "id": card_id, "createdAt": "2026-06-05T00:00:00.000Z",
        "author": "ai", "original_text": REV_ORIGINAL, "suggested_text": REV_SUGGESTED,
        "explanation": "test proposal", "user_text": "", "instructions": "test",
        "status": "pending", "selectedText": REV_ORIGINAL,
        "links": [{
            "id": f"link-{card_id}", "kind": "anchor",
            "anchor": {"type": "textObject", "targetKind": "paragraph",
                       "textObjectIds": [anchor], "margin": {"side": "right"}},
            "target": {"type": "card", "ref": {"kind": "revision-suggestion", "id": card_id}},
            "createdAt": "2026-06-05T00:00:00.000Z",
        }],
        "aiOriginRequestId": task_id,
    }
    return subprocess.run(
        [sys.executable, APPLY, str(doc), "complete-task", json.dumps({
            "requestId": task_id, "panel": "revisions", "card": card, "kind": "suggestion",
            "text": "please revise", "paragraphIds": [anchor], "safetyLevel": 3,
            "summary": "Drafted a suggestion", "clearSourceFlag": False,
        }), "--propose", "--synthesize-task"],
        capture_output=True, text=True, env=dict(os.environ))


# ══════════ 1. the taught leg: `status` on a suggestion refuses ══════════════
print("\n=== the TAUGHT leg — update {\"set\":{\"status\":…}} on a suggestion refuses ===")
for kind_label, cid, filename in [
    ("revision-suggestion", REV_SUG, "revisions.json"),
    ("cutter-suggestion", CUT_SUG, "cutter.json"),
]:
    for value in ["accepted", "rejected", "applied", "stale", "pending"]:
        sb = sandbox()
        before_side, before_tex = digest(sb, filename), tex_digest(sb)
        before_req = digest(sb, "ai-requests.json")
        r = op(sb, "update", {"cardId": cid, "set": {"status": value}})
        check(r.returncode != 0, f"refuses status={value} on a {kind_label}")
        check(digest(sb, filename) == before_side,
              f"{filename} byte-identical after the refusal (status={value}, {kind_label})")
        check(tex_digest(sb) == before_tex,
              f"the .tex byte-identical after the refusal (status={value}, {kind_label})")
        check(digest(sb, "ai-requests.json") == before_req,
              f"ai-requests.json byte-identical — the Task stays exactly as it was "
              f"(status={value}, {kind_label})")
        check(not (sb / "virgil/version.txt").exists(),
              f"no version bump — the refusal is before the transaction (status={value}, "
              f"{kind_label})")

sb = sandbox()
err = op(sb, "update", {"cardId": REV_SUG, "set": {"status": "accepted"}}).stderr
check("accept" in err, "the refusal NAMES the accept op (an agent is routed, not just stopped)")
check("/editor/accept-suggestion" in err and "/editor/reject-suggestion" in err,
      "the refusal names BOTH owning skills by their slash-command names")
check("`status`" in err, "the refusal names the offending field")
check("stale-guard" in err and "Task" in err,
      "the refusal states WHAT the shortcut skipped (the splice's stale-guard + the Task)")
check("applied" in err and "stale" in err,
      "the refusal states that the browser's own pending-change states are not writable here")

print("\n=== a MIXED set refuses WHOLE — no partial write ===")
sb = sandbox()
before = digest(sb, "revisions.json")
r = op(sb, "update", {"cardId": REV_SUG, "set": {"user_text": "landed?", "status": "accepted"}})
check(r.returncode != 0, "a set mixing a legal field with a reserved one refuses")
check(digest(sb, "revisions.json") == before,
      "the LEGAL half did not land either — the guard runs before the transaction opens")


# ══════════ 2. the accepting controls (no leg may pass vacuously) ════════════
print("\n=== the ACCEPTING controls — the ops the guard must NOT break ===")
sb = sandbox()
r = propose(sb, card_id="rev-467-1", task_id="task-467-1", anchor="6607")
check(r.returncode == 0, f"propose exited 0 (stderr={r.stderr.strip()[:140]})")
r = op(sb, "accept", {"cardId": "rev-467-1"})
check(r.returncode == 0, f"accept still works END TO END after the guard "
                         f"(stderr={r.stderr.strip()[:140]})")
check(REV_SUGGESTED in tex_of(sb) and REV_ORIGINAL not in tex_of(sb),
      "accept still splices the .tex (the thing the update shortcut never did)")
check(by_id(sb, "revisions.json", "cards", "rev-467-1")["status"] == "accepted",
      "accept still flips status → accepted")
task = req_by_id(sb, "task-467-1")
check(task and task.get("result") == "accepted",
      "accept still completes the originating Task (result=accepted)")

for label, cid, filename, list_key, field, value in [
    ("suggestion suggested_text", REV_SUG, "revisions.json", "cards", "suggested_text", "t467"),
    ("suggestion user_text", REV_SUG, "revisions.json", "cards", "user_text", "t467"),
    ("suggestion explanation", REV_SUG, "revisions.json", "cards", "explanation", "t467"),
    ("suggestion instructions", REV_SUG, "revisions.json", "cards", "instructions", "t467"),
    ("suggestion author", REV_SUG, "revisions.json", "cards", "author", "human"),
    ("note title", NOTE, "notes.json", "cards", "title", "t467"),
    ("todo done", TODO, "todos.json", "items", "done", True),
    # `aiRequest` is deliberately NOT reserved: draft-footnote's virtual-request
    # branch clears a footnote's flag with exactly this op, and the unbridged
    # -flag fallback makes the raised direction a first-class state too. A blanket
    # refusal here is the naive fix that breaks a shipped feature (the 156 lesson).
    ("note aiRequest (the shipped virtual-request clear)", NOTE, "notes.json", "cards",
     "aiRequest", False),
    ("footnote aiRequest (draft-footnote's own line)", FN, "footnotes.json", "footnotes",
     "aiRequest", False),
]:
    sb = sandbox()
    r = op(sb, "update", {"cardId": cid, "set": {field: value}})
    check(r.returncode == 0, f"{label} still lands (stderr={r.stderr.strip()[:110]})")
    check((by_id(sb, filename, list_key, cid) or {}).get(field) == value,
          f"{label} is on disk")

print("\n=== `kinds=` really scopes — status on a NON-suggestion still lands ===")
sb = sandbox()
r = op(sb, "update", {"cardId": REVISION_COMMENT, "set": {"status": "complete"}})
check(r.returncode == 0, f"status on a `comment` card in the SAME panel still lands "
                         f"(stderr={r.stderr.strip()[:110]})")
check((by_id(sb, "revisions.json", "cards", REVISION_COMMENT) or {}).get("status") == "complete",
      "the non-suggestion status is on disk — the reservation is per-KIND, not per-panel")


# ══════════ 3. the latent legs ═══════════════════════════════════════════════
print("\n=== the LATENT legs — a field another op owns, one each ===")
for label, cid, filename, list_key, field, value, needle in [
    ("`id` on a footnote (its sidecar id IS its \\vfid marker id)",
     FN, "footnotes.json", "footnotes", "id", "zzzz", "create_card.py"),
    ("`aiOriginRequestId` (the back-pointer accept/reject read)",
     NOTE, "notes.json", "cards", "aiOriginRequestId", "someone-elses-task", "create_card.py"),
    ("`links` on a note (the anchor cmd_move validates)",
     NOTE, "notes.json", "cards", "links", [], "move"),
    ("`appliedChange` on a suggestion (a LIVE blue range in the .tex)",
     REV_SUG, "revisions.json", "cards", "appliedChange", {"anchorUuid": "6607"},
     "Keep / Revert"),
]:
    sb = sandbox()
    before_side, before_tex = digest(sb, filename), tex_digest(sb)
    r = op(sb, "update", {"cardId": cid, "set": {field: value}})
    check(r.returncode != 0, f"refuses {label}")
    check(digest(sb, filename) == before_side and tex_digest(sb) == before_tex,
          f"sidecar + .tex byte-identical after the refusal — {label}")
    check(needle in r.stderr, f"the refusal routes to `{needle}` — {label}")


# ══════════ 4. the table: derived, not hand-listed ═══════════════════════════
print("\n=== the field-ownership table itself ===")
check(AR.RESERVED_FIELDS == frozenset().union(*(o.fields for o in AR.OP_OWNED_FIELDS.values())),
      "RESERVED_FIELDS is the DERIVED union of the rows (the census reads it; a hand list "
      "there would be the second copy this table exists to retire)")
for name, own in AR.OP_OWNED_FIELDS.items():
    check(not (own.ops - set(AR.MUTATION_OPS)),
          f"OP_OWNED_FIELDS[{name!r}] names only real mutation ops "
          f"(a renamed op cannot leave a refusal pointing at a door that's gone)")
    check(bool(own.ops) or name in AR._NON_OP_FIELD_OWNERS,
          f"OP_OWNED_FIELDS[{name!r}] is an op-owner or a DECLARED non-op door")
    check("$route" in own.why and bool(own.route),
          f"OP_OWNED_FIELDS[{name!r}]'s message spells its route — the refusal ROUTES")
    check("$field" in own.why,
          f"OP_OWNED_FIELDS[{name!r}]'s message names the offending field")
    check(bool(own.skills),
          f"OP_OWNED_FIELDS[{name!r}] names the owning skill(s) — the markdown census reads "
          f"this column")
    for skill in own.skills:
        check((ROOT / "editor/skills" / f"{skill}.md").is_file(),
              f"OP_OWNED_FIELDS[{name!r}] names a skill that exists: {skill}.md")

check("status" in AR.OP_OWNED_FIELDS["accept"].fields
      and AR.OP_OWNED_FIELDS["accept"].kinds == frozenset(AR.SUGGESTION_KINDS),
      "`status` is reserved for the SUGGESTION kinds only — the kinds= qualifier is what "
      "keeps a benign status writable, exactly as `footnotes` had to stay on update's "
      "panel allow-list")
check("aiRequest" not in AR.RESERVED_FIELDS,
      "`aiRequest` is NOT reserved — draft-footnote's virtual-request branch clears a "
      "footnote's flag with `update {\"set\":{\"aiRequest\":false}}`, and a blanket refusal "
      "would break that shipped, taught feature")

print("\n=== the import-time assertion has a LEG of its own ===")
_Row = AR._FieldOwnership


def raises(table, label):
    try:
        AR._assert_field_ownership(table)
        check(False, label)
    except RuntimeError:
        check(True, label)


raises({"bogus": _Row(fields=frozenset({"x"}), why="$field $route", route="r",
                      ops=frozenset({"nosuchop"}), skills=("edit-card",))},
       "a row naming a non-existent op raises (the dangling-route guard)")
raises({"_typo": _Row(fields=frozenset({"x"}), why="$field $route", route="r",
                      ops=frozenset(), skills=("edit-card",))},
       "an undeclared non-op owner raises (a typo'd pseudo-owner cannot pass)")
raises({"move": _Row(fields=frozenset({"x"}), why="no route here", route="r",
                     ops=frozenset({"move"}), skills=("move-card",))},
       "a message that never spells its $route raises (a refusal must ROUTE)")
raises({"move": _Row(fields=frozenset({"x"}), why="$route only", route="r",
                     ops=frozenset({"move"}), skills=("move-card",))},
       "a message that never names the $field raises")
raises({"move": _Row(fields=frozenset(), why="$field $route", route="r",
                     ops=frozenset({"move"}), skills=("move-card",))},
       "a row reserving nothing raises")
raises({"move": _Row(fields=frozenset({"x"}), why="$field $route", route="r",
                     ops=frozenset({"move"}), skills=())},
       "a row naming no owning skill raises (the census reads that column)")
raises({"move": _Row(fields=frozenset({"links"}), why="$field $route", route="r",
                     ops=frozenset({"move"}), skills=("move-card",)),
        "archive": _Row(fields=frozenset({"links"}), why="$field $route", route="r",
                        ops=frozenset({"archive"}), skills=("archive-card",))},
       "two rows claiming ONE field for overlapping kinds raises (which message an agent "
       "sees would be arbitrary)")
try:
    AR._assert_field_ownership({
        "move": _Row(fields=frozenset({"links"}), why="$field $route", route="r",
                     ops=frozenset({"move"}), skills=("move-card",),
                     kinds=frozenset({"note"})),
        "accept": _Row(fields=frozenset({"links"}), why="$field $route", route="r",
                       ops=frozenset({"accept"}), skills=("accept-suggestion",),
                       kinds=frozenset({"revision-suggestion"})),
    })
    check(True, "two rows claiming one field for DISJOINT kinds is fine "
                "(the accepting control — the disjointness guard is not a blanket ban)")
except RuntimeError as e:
    check(False, f"two rows claiming one field for DISJOINT kinds is fine ({e})")

check(AR._assert_field_ownership(AR.OP_OWNED_FIELDS) is None,
      "the SHIPPED table passes its own assertions")


# ══════════ 5. the guard's own semantics ═════════════════════════════════════
print("\n=== _guard_fields — the owner may write what it owns ===")


class _FakeHit:
    def __init__(self, panel):
        self.panel = panel
        self.card = {"id": "fake-1"}


try:
    AR._guard_fields("accept", _FakeHit("revisions"), "revision-suggestion",
                     {"status": "accepted"})
    check(True, "the OWNING op passes the field guard (a row is skipped for its own op)")
except SystemExit:
    check(False, "the OWNING op passes the field guard (a row is skipped for its own op)")

try:
    AR._guard_fields("update", _FakeHit("revisions"), "revision-suggestion",
                     {"status": "accepted"})
    check(False, "update is refused for the same field on the same card")
except SystemExit as e:
    check(e.code != 0, "update is refused for the same field on the same card")

try:
    AR._guard_fields("update", _FakeHit("notes"), "note", {})
    check(True, "an empty set is a no-op for the guard")
except SystemExit:
    check(False, "an empty set is a no-op for the guard")

try:
    AR._guard_fields("update", _FakeHit("notes"), "note", {"title": "x", "done": True})
    check(True, "a set of ordinary fields passes silently")
except SystemExit:
    check(False, "a set of ordinary fields passes silently")


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
