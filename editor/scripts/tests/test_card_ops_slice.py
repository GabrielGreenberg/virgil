#!/usr/bin/env python3
r"""End-to-end test of the five existing-card mutation ops (edit / archive /
restore / move / link) on the apply_response contract — the sibling of
test_card_kinds_slice.py (create-card), modeled on it. Runs the real CLIs
(card_by_id.py + apply_response.py mutation subcommands) against fresh copies of
samples/annotation-history (never mutating the sample), and re-confirms
back-compat (create-card + a legacy default-apply still land).

Run from anywhere:  python3 editor/scripts/tests/test_card_ops_slice.py
"""
import copy
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
CREATE = str(SCRIPTS / "create_card.py")
CBID = str(SCRIPTS / "card_by_id.py")

# Released-ness is ONE predicate (task 496): the release REWRITES the pen
# record (`holder: null`) instead of deleting it, so a delete-blocked mount
# cannot roll the collab restore back and report exit 2 on a landed write.
from _pen_state import pen_released  # noqa: E402

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
    d = Path(tempfile.mkdtemp(prefix="chip9-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def run(*args, env=None):
    e = dict(os.environ)
    if env:
        e.update(env)
    return subprocess.run([sys.executable, *args], capture_output=True, text=True, env=e)


def op(sb, sub, payload, env=None):
    return run(APPLY, str(sb), sub, json.dumps(payload), env=env)


def load(doc, name):
    p = doc / "virgil" / name
    return json.loads(p.read_text()) if p.exists() else None


def tex_of(doc):
    texs = list(doc.glob("*.tex"))
    return texs[0].read_text(encoding="utf-8") if texs else ""


def by_id(doc, name, key, cid):
    st = load(doc, name) or {}
    return next((c for c in st.get(key, []) if c.get("id") == cid), None)


def out_of(r):
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else {}


LIST = str(SCRIPTS / "list_requests.py")


def open_requests(doc):
    """Run the real drain (list_requests.py) and return its open-request rows
    (one JSON object per stdout line)."""
    r = run(LIST, str(doc))
    return [json.loads(ln) for ln in r.stdout.splitlines()
            if ln.strip().startswith("{")]


def surfaces(rows, card_id, panel):
    """True iff any drain row references (panel, card_id) — on EITHER leg: the
    bridged `linkedTo` row (Leg A) or the `virtual:<panel>:<cardId>` unbridged
    card-flag fallback (Leg B)."""
    for row in rows:
        lk = row.get("linkedTo") or {}
        if lk.get("cardId") == card_id:
            return True
        if row.get("id") == f"virtual:{panel}:{card_id}":
            return True
    return False


def text_of_content(card):
    """Pull the first text run out of a JSONContent body."""
    return (card.get("content", {}).get("content", [{}])[0]
            .get("content", [{}])[0].get("text"))


# In-sample card ids (discovered from samples/annotation-history/virgil/*.json).
NOTE = "ea4d5253-406d-499e-85b6-8055956c9f95"   # notes.json, anchor 2201, Mode A
NOTE2 = "bbf4cb59-c473-4fdc-870b-98a16a0868d5"  # notes.json, anchor 3302
TODO = "ab7e7930-78cb-4d4c-b400-9ac04906a8fd"   # todos.json, anchor 3301, Mode A
REPORT = "7b3e9a14-2c5d-4f80-9a16-3d8e1f0a2b01"  # reports.json, anchor 1101, Mode A
FN = "f001"                                      # footnotes.json (a real \footnote)
CIT = "cc01"                                     # citations.json (atom-bearing)
CUTTER_B = "fe55c27a-5c73-42f2-aed6-c81329f2655f"  # cutter.json suggestion, Mode B (5505)
NATIVE_ARCH = "ba034527-6a92-4324-a133-7ba069fb11b4"  # archive.json snippet (no origin)
FLAGGED_TODO = "ea401798-8d6b-4b4e-9b58-c48ae02437e2"  # todos.json aiRequest:true + an OPEN bridged ai-requests row


# ───────────────────────────────── card_by_id (the shared §13 lookup) ─────
print("\n=== card_by_id.py — locate cards across panel sidecars + archive ===")
sb = sandbox()
r = run(CBID, str(sb), NOTE)
o = out_of(r)
check(r.returncode == 0 and o.get("found"), "found the note")
check(o.get("panel") == "notes" and o.get("cardKind") == "note" and o.get("archived") is False,
      "reports panel=notes, cardKind=note, archived=false")
r = run(CBID, str(sb), FN)
check(out_of(r).get("cardKind") == "footnote" and out_of(r).get("panel") == "footnotes",
      "footnote resolves to panel=footnotes, cardKind=footnote")
r = run(CBID, str(sb), NATIVE_ARCH)
check(out_of(r).get("archived") is True and out_of(r).get("panel") == "archive",
      "an archived snippet resolves with archived=true")
r = run(CBID, str(sb), "totally-not-a-real-id")
check(r.returncode == 1 and out_of(r).get("found") is False, "unknown id → found:false, exit 1")


# ───────────────────────────────── edit-card (update op) ──────────────────
print("\n=== update / note — body + a named field (sidecar-only) ===")
sb = sandbox()
r = op(sb, "update", {"cardId": NOTE, "body": "McKenzie widens Genette's paratext.",
                      "set": {"title": "Sociology of texts"}})
check(r.returncode == 0, f"update exited 0 (stderr={r.stderr.strip()[:120]})")
n = by_id(sb, "notes.json", "cards", NOTE)
check(text_of_content(n) == "McKenzie widens Genette's paratext.", "note content body replaced")
check(n.get("title") == "Sociology of texts", "note named field (title) set")
check((sb / "virgil/version.txt").read_text().strip() == "1", "version bumped")
check(pen_released(sb), "pen released")
notif = load(sb, "notifications.json")["items"][-1]
check(notif["kind"] == "ai-request-complete" and NOTE in notif["summary"], "audit notification appended")

print("\n=== update / todo — named fields (done + notes), no body ===")
sb = sandbox()
r = op(sb, "update", {"cardId": TODO, "set": {"done": True, "notes": "checked against Bayle"}})
check(r.returncode == 0, f"update exited 0 (stderr={r.stderr.strip()[:120]})")
t = by_id(sb, "todos.json", "items", TODO)
check(t.get("done") is True and t.get("notes") == "checked against Bayle", "todo done=true + notes set")

print("\n=== update / footnote — body edits BOTH the sidecar content and the .tex \\footnote{} ===")
sb = sandbox()
NEWFN = "Revised: the gloss is keyed to the lemma by a superscript letter."
r = op(sb, "update", {"cardId": FN, "body": NEWFN})
check(r.returncode == 0, f"update exited 0 (stderr={r.stderr.strip()[:120]})")
fn = by_id(sb, "footnotes.json", "footnotes", FN)
check(text_of_content(fn) == NEWFN, "footnote sidecar content updated")
check(f"\\vfid{{{FN}}}\\footnote{{{NEWFN}}}" in tex_of(sb), "footnote .tex \\footnote{} body updated (atom-coupled, in sync)")

print("\n=== update / refusals ===")
sb = sandbox()
r = op(sb, "update", {"cardId": NOTE})
check(r.returncode != 0 and "no-op" in r.stderr, "refuses an empty update (no body, no set)")
r = op(sb, "update", {"cardId": CIT, "body": "x"})
check(r.returncode != 0, "refuses --body on a citation (atom+bib-coupled)")
r = op(sb, "update", {"cardId": "missing-id", "body": "x"})
check(r.returncode != 0 and "not found" in r.stderr, "refuses an unknown cardId")


# ───────────────────────────────── archive → restore (round-trip) ─────────
print("\n=== archive → restore / note — round-trip, origin preserved, lossless ===")
sb = sandbox()
before = copy.deepcopy(by_id(sb, "notes.json", "cards", NOTE))
orig_notes = len(load(sb, "notes.json")["cards"])
orig_arch = len(load(sb, "archive.json")["snippets"])
r = op(sb, "archive", {"cardId": NOTE})
check(r.returncode == 0, f"archive exited 0 (stderr={r.stderr.strip()[:120]})")
check(by_id(sb, "notes.json", "cards", NOTE) is None, "note removed from notes.json")
check(len(load(sb, "notes.json")["cards"]) == orig_notes - 1, "notes count -1")
snip = by_id(sb, "archive.json", "snippets", NOTE)
check(snip is not None and len(load(sb, "archive.json")["snippets"]) == orig_arch + 1, "snippet added to archive.json")
check(snip.get("originalPanel") == "notes", "snippet records originalPanel=notes")
check(snip.get("originalCard") == before, "snippet preserves the verbatim original card (lossless)")
check(snip.get("title") and "content" in snip and "links" in snip, "snippet is also a renderable ArchivedSnippet (title/content/links)")
r = op(sb, "restore", {"cardId": NOTE})
check(r.returncode == 0, f"restore exited 0 (stderr={r.stderr.strip()[:120]})")
restored = by_id(sb, "notes.json", "cards", NOTE)
check(restored == before, "restored note is byte-for-byte the original (lossless round-trip)")
check(by_id(sb, "archive.json", "snippets", NOTE) is None, "snippet removed from archive.json")
check(len(load(sb, "notes.json")["cards"]) == orig_notes, "notes count back to original")

print("\n=== archive → restore / todo — lossless for a card with no title/content (text/notes/done) ===")
sb = sandbox()
before = copy.deepcopy(by_id(sb, "todos.json", "items", TODO))
r = op(sb, "archive", {"cardId": TODO})
check(r.returncode == 0, "archive todo exited 0")
snip = by_id(sb, "archive.json", "snippets", TODO)
check(snip.get("originalPanel") == "todos" and snip["originalCard"]["text"] == before["text"], "todo origin preserved (text/notes/done)")
r = op(sb, "restore", {"cardId": TODO})
check(r.returncode == 0, "restore todo exited 0")
check(by_id(sb, "todos.json", "items", TODO) == before, "todo restored byte-for-byte")

print("\n=== archive / refusals ===")
sb = sandbox()
r = op(sb, "archive", {"cardId": FN})
check(r.returncode != 0 and "atom-bearing" in r.stderr, "refuses archiving a footnote (atom-bearing)")
r = op(sb, "archive", {"cardId": CIT})
check(r.returncode != 0 and "atom-bearing" in r.stderr, "refuses archiving a citation (atom-bearing)")
r = op(sb, "archive", {"cardId": NATIVE_ARCH})
check(r.returncode != 0 and "already archived" in r.stderr, "refuses re-archiving an archived snippet")

print("\n=== restore / refuses a native snippet with no recorded origin ===")
sb = sandbox()
r = op(sb, "restore", {"cardId": NATIVE_ARCH})
check(r.returncode != 0 and ("origin" in r.stderr or "originalPanel" in r.stderr),
      "refuses restoring a snippet we didn't archive (no originalPanel/originalCard)")
check(by_id(sb, "archive.json", "snippets", NATIVE_ARCH) is not None, "the native snippet is left untouched")


# ─────────────────────── archive RESOLVES the AI request (task 049) ────────
# Archiving a flagged card is the missing terminal transition alongside answer
# (019) and delete: it must close BOTH drain legs — the bridged ai-requests row
# (Leg A) AND the unbridged card-flag fallback (Leg B) — and stay resolved
# through a restore. FLAGGED_TODO carries aiRequest:true + an OPEN bridged row.
print("\n=== archive resolves the AI request — both drain legs closed ===")
sb = sandbox()
check(surfaces(open_requests(sb), FLAGGED_TODO, "todos"),
      "precondition: the flagged todo surfaces as an OPEN request before archive")
r = op(sb, "archive", {"cardId": FLAGGED_TODO})
check(r.returncode == 0, f"archive flagged todo exited 0 (stderr={r.stderr.strip()[:120]})")
check(not surfaces(open_requests(sb), FLAGGED_TODO, "todos"),
      "archived todo surfaces on NEITHER drain leg (request resolved)")
row = next((x for x in load(sb, "ai-requests.json")["requests"]
            if (x.get("linkedTo") or {}).get("cardId") == FLAGGED_TODO), None)
check(row is not None and row.get("status") == "complete",
      "bridged row flipped terminal (status=complete), not deleted (Leg A closed)")
snip = by_id(sb, "archive.json", "snippets", FLAGGED_TODO)
check(snip is not None and snip["originalCard"].get("aiRequest") is False,
      "archived snapshot lowered aiRequest so restore stays resolved (Leg B)")

print("\n=== restore stays resolved — un-archiving does NOT re-open the request ===")
r = op(sb, "restore", {"cardId": FLAGGED_TODO})
check(r.returncode == 0, f"restore flagged todo exited 0 (stderr={r.stderr.strip()[:120]})")
check(by_id(sb, "todos.json", "items", FLAGGED_TODO).get("aiRequest") is False,
      "restored todo comes back UNflagged")
check(not surfaces(open_requests(sb), FLAGGED_TODO, "todos"),
      "a re-drain after restore does not re-surface the request")

print("\n=== guard: archiving an UNflagged card writes no spurious terminal row ===")
sb = sandbox()
before = load(sb, "ai-requests.json")["requests"]
before_done = sum(1 for x in before if x.get("status") == "complete")
r = op(sb, "archive", {"cardId": NOTE})  # NOTE is not aiRequest-flagged
check(r.returncode == 0, "archive unflagged note exited 0")
after = load(sb, "ai-requests.json")["requests"]
check(len(after) == len(before), "ai-requests row count unchanged (no new row)")
check(sum(1 for x in after if x.get("status") == "complete") == before_done,
      "no request flipped terminal by an unflagged archive (guarded no-op)")


# ───────────────────────────────── move (re-anchor) ───────────────────────
print("\n=== move / todo — re-anchor a Mode-A card to a new paragraph ===")
sb = sandbox()
check(by_id(sb, "todos.json", "items", TODO)["links"][0]["anchor"]["textObjectIds"] == ["3301"], "todo starts anchored to 3301")
r = op(sb, "move", {"cardId": TODO, "newAnchor": "1101"})
check(r.returncode == 0, f"move exited 0 (stderr={r.stderr.strip()[:120]})")
anc = by_id(sb, "todos.json", "items", TODO)["links"][0]["anchor"]
check(anc["textObjectIds"] == ["1101"], "todo re-anchored to 1101")
check(anc["type"] == "textObject" and anc.get("targetKind") != "linkedRange", "anchor stays a Mode-A textObject link")
check(out_of(r).get("anchorsMoved") == 1, "result reports anchorsMoved=1")

print("\n=== move / note — re-anchor, and refusals ===")
sb = sandbox()
r = op(sb, "move", {"cardId": NOTE, "newAnchor": "5503"})
check(r.returncode == 0 and by_id(sb, "notes.json", "cards", NOTE)["links"][0]["anchor"]["textObjectIds"] == ["5503"], "note re-anchored to 5503")
r = op(sb, "move", {"cardId": NOTE, "newAnchor": "9999"})
check(r.returncode != 0 and "not found in .tex" in r.stderr, "refuses an anchor not present in the .tex")
r = op(sb, "move", {"cardId": FN, "newAnchor": "1101"})
check(r.returncode != 0 and "atom-bearing" in r.stderr, "refuses moving a footnote (atom-bearing → defer)")
r = op(sb, "move", {"cardId": CIT, "newAnchor": "1101"})
check(r.returncode != 0 and "atom-bearing" in r.stderr, "refuses moving a citation (atom-bearing → defer)")
r = op(sb, "move", {"cardId": CUTTER_B, "newAnchor": "1101"})
check(r.returncode != 0 and ("Mode-B" in r.stderr or "range" in r.stderr), "refuses moving a Mode-B (text-range) anchor → defer")


# ───────────────────────────────── link (bidirectional) ───────────────────
print("\n=== link / note ↔ todo — bidirectional relatedCards on both sidecars ===")
sb = sandbox()
r = op(sb, "link", {"cardAId": NOTE, "cardBId": TODO, "kind": "followup"})
check(r.returncode == 0, f"link exited 0 (stderr={r.stderr.strip()[:120]})")
n = by_id(sb, "notes.json", "cards", NOTE)
t = by_id(sb, "todos.json", "items", TODO)
na = (n.get("relatedCards") or [{}])[0]
ta = (t.get("relatedCards") or [{}])[0]
check(na.get("target", {}).get("ref", {}).get("id") == TODO, "note.relatedCards → the todo")
check(na.get("target", {}).get("ref", {}).get("kind") == "todo" and na.get("kind") == "followup", "note's record names the todo kind + relationship kind")
check(ta.get("target", {}).get("ref", {}).get("id") == NOTE and ta.get("target", {}).get("ref", {}).get("kind") == "note", "todo.relatedCards → the note (bidirectional)")
check(ta.get("kind") == "followup", "the reciprocal record carries the same relationship kind")

print("\n=== link / idempotent + cross-kind (note ↔ footnote, atom-bearing) + self-link refusal ===")
sb = sandbox()
op(sb, "link", {"cardAId": NOTE, "cardBId": TODO})
op(sb, "link", {"cardAId": NOTE, "cardBId": TODO})  # re-link same pair/kind
check(len(by_id(sb, "notes.json", "cards", NOTE)["relatedCards"]) == 1, "re-linking the same pair is idempotent (no duplicate)")
r = op(sb, "link", {"cardAId": NOTE, "cardBId": FN, "kind": "evidence"})
check(r.returncode == 0, "links a note to a footnote (atom-bearing — uses relatedCards, not links)")
fn = by_id(sb, "footnotes.json", "footnotes", FN)
check((fn.get("relatedCards") or [{}])[0].get("target", {}).get("ref", {}).get("id") == NOTE, "footnote gained a relatedCards record (no `links` array added)")
check("links" not in fn, "footnote still has no `links` array (atom-link rule preserved)")
r = op(sb, "link", {"cardAId": NOTE, "cardBId": NOTE})
check(r.returncode != 0 and "itself" in r.stderr, "refuses linking a card to itself")
r = op(sb, "link", {"cardAId": NOTE, "cardBId": "missing"})
check(r.returncode != 0 and "not found" in r.stderr, "refuses an unknown link target")

print("\n=== link / two cards in the SAME sidecar file (note ↔ note) — both edits in one write ===")
sb = sandbox()
r = op(sb, "link", {"cardAId": NOTE, "cardBId": NOTE2, "kind": "seealso"})
check(r.returncode == 0, f"link exited 0 (stderr={r.stderr.strip()[:120]})")
cards = load(sb, "notes.json")["cards"]
a = next(c for c in cards if c["id"] == NOTE)
b = next(c for c in cards if c["id"] == NOTE2)
check((a.get("relatedCards") or [{}])[0].get("target", {}).get("ref", {}).get("id") == NOTE2, "note A → note B (same file)")
check((b.get("relatedCards") or [{}])[0].get("target", {}).get("ref", {}).get("id") == NOTE, "note B → note A (same file — both edits survived the single write)")


# ───────────────────────────────── atomicity (mutation rolls back fully) ──
print("\n=== atomicity: injected mid-write failure rolls a mutation back (archive) ===")
sb = sandbox()


def snapshot(doc):
    snap = {}
    for name in ["notes.json", "archive.json", "ai-requests.json", "notifications.json", "version.txt", "collab.json"]:
        p = doc / "virgil" / name
        snap[name] = hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
    snap["__tex__"] = hashlib.sha256(next(doc.glob("*.tex")).read_bytes()).hexdigest()
    return snap


before_snap = snapshot(sb)
r = op(sb, "archive", {"cardId": NOTE}, env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "2"})
check(r.returncode != 0, "archive exited non-zero on injected failure")
check(before_snap == snapshot(sb), "every target file byte-identical (full rollback of the cross-sidecar move)")
check(not (sb / "virgil/version.txt").exists(), "version.txt NOT created (rolled back)")
check(pen_released(sb), "pen released even though the write failed")

print("\n=== atomicity: injected failure rolls a link back (both sidecars) ===")
sb = sandbox()
before_snap = snapshot(sb)
r = op(sb, "link", {"cardAId": NOTE, "cardBId": TODO}, env={"VIRGIL_TEST_FAIL_AFTER_WRITES": "1"})
check(r.returncode != 0, "link exited non-zero on injected failure")
check(before_snap == snapshot(sb), "both card sidecars byte-identical (no half-written relationship)")


# ───────────────────────────────── audit-Task discipline ──────────────────
print("\n=== audit: a mechanical op synthesizes NO ai-requests.json Task (no undefined-kind leak) ===")
sb = sandbox()
orig_reqs = len(load(sb, "ai-requests.json")["requests"])
orig_notifs = len((load(sb, "notifications.json") or {"items": []}).get("items", []))
op(sb, "update", {"cardId": NOTE, "body": "x"})
op(sb, "archive", {"cardId": TODO})
ar = load(sb, "ai-requests.json")["requests"]
check(len(ar) == orig_reqs, "ai-requests.json request count unchanged (no synthesized card-op Task)")
check(len(load(sb, "notifications.json")["items"]) == orig_notifs + 2, "each op left exactly one audit notification (the durable audit surface)")

print("\n=== audit: an op CAN complete a real Task the user filed (requestId) ===")
sb = sandbox()
# Reuse a real in-sample request id as a stand-in 'please edit this' Task. The
# sample's open requests use legacy open statuses (draft/submitted), which read
# as open; fall back to any request if none parse as open.
ar = load(sb, "ai-requests.json")["requests"]
real_req = next((x["id"] for x in ar
                 if x.get("status") in ("pending", "in-progress", "draft", "submitted", None)),
                ar[0]["id"] if ar else None)
check(real_req is not None, "sample has a request id to drive the requestId path")
r = op(sb, "update", {"cardId": NOTE, "body": "y", "requestId": real_req})
check(r.returncode == 0, "update with a real requestId exits 0")
req = next(x for x in load(sb, "ai-requests.json")["requests"] if x["id"] == real_req)
check(req["status"] == "complete" and req.get("result") == "auto-applied", "the real Task is completed (status/result set)")


# ───────────────────────────────── back-compat (create + legacy apply) ────
print("\n=== back-compat: create-card still lands a card through the contract ===")
sb = sandbox()
orig_notes = len(load(sb, "notes.json")["cards"])
r = run(CREATE, str(sb), "--kind=note", "--body", "A fresh note via create-card.",
        "--anchor", "4402", "--safety-level", "1")
check(r.returncode == 0, f"create_card exited 0 (stderr={r.stderr.strip()[:120]})")
check(len(load(sb, "notes.json")["cards"]) == orig_notes + 1, "create-card appended a note (create path intact)")

print("\n=== back-compat: a legacy default-apply op (un-migrated skill path) still lands ===")
sb = sandbox()
orig_notes = len(load(sb, "notes.json")["cards"])
new_id = "deadbeef-0000-0000-0000-legacyapply01"
legacy_op = {
    "requestId": f"virtual:notes:{new_id}",  # virtual → no ai-requests.json dependency
    "panel": "notes",
    "card": {"kind": "note", "id": new_id, "title": "Legacy apply",
             "content": {"type": "doc", "content": [{"type": "paragraph",
                         "content": [{"type": "text", "text": "via the legacy surface"}]}]},
             "createdAt": "2026-06-03T00:00:00.000Z", "aiRequest": False, "links": []},
    "summary": "legacy default-apply",
    "clearSourceFlag": False,
}
r = run(APPLY, str(sb), json.dumps(legacy_op))  # NOTE: no subcommand → the legacy surface
check(r.returncode == 0, f"legacy apply exited 0 (stderr={r.stderr.strip()[:120]})")
check(by_id(sb, "notes.json", "cards", new_id) is not None, "legacy default-apply landed the card (cmd_write unchanged)")


print(f"\n===== {PASS} passed, {FAIL} failed =====")
sys.exit(1 if FAIL else 0)
