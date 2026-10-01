#!/usr/bin/env python3
r"""A card's self-link `target.ref.kind` is the CONTRACT's, not the skill's
(task 2026-09-26-783).

Four responder skills told the agent to write a suggestion card's self-link as
`"ref": {"kind": "suggestion", …}` — the panel-local record discriminant, not a
spine `CardKind`. The anchor finds its card by `linkCardSelector(ref.kind, id)`,
so every AI-drafted suggestion's anchor → card jump matched nothing. The write
door (`apply_response._Txn.append_card`) now derives the token from (panel,
record kind) and overwrites whatever the op carried; links to OTHER cards keep
their token. Driven end-to-end through the real CLI.

Run from anywhere:  python3 editor/scripts/tests/test_self_link_kind.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SAMPLE = ROOT / "samples/annotation-history"
SCRIPTS = ROOT / "editor/scripts"
APPLY = str(SCRIPTS / "apply_response.py")

sys.path.insert(0, str(SCRIPTS))
from card_by_id import ALL_CARD_SIDECARS, CardHit, card_kind, spine_card_kind  # noqa: E402

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
    d = Path(tempfile.mkdtemp(prefix="self-link-kind-"))
    dst = d / "paper"
    shutil.copytree(SAMPLE, dst)
    return dst


def load(doc, name):
    return json.loads((doc / "virgil" / name).read_text())


def link(card_id, ref_kind, ref_id):
    return {
        "id": f"{card_id}@p1",
        "kind": "anchor",
        "anchor": {"type": "textObject", "targetKind": "paragraph", "textObjectIds": ["p1"]},
        "target": {"type": "card", "ref": {"kind": ref_kind, "id": ref_id}},
        "createdAt": "2026-09-26T00:00:00.000Z",
    }


print("\n=== card_kind / spine_card_kind over the shared corpus (task 885) ===")
# The same rows src/cards/__tests__/card-tables-manifest.test.ts runs through
# TS `cardKindFromRecord` — one corpus, both languages.
_CASES = json.loads((Path(__file__).with_name("card_kind_cases.json")).read_text())["cases"]
check(len(_CASES) >= 15, f"corpus carries {len(_CASES)} rows")
for row in _CASES:
    panel, rec = row["panel"], row["record"]
    hit = CardHit(card=rec, panel=panel, filename="", list_key="", index=-1)
    got = card_kind(hit)
    check(got == row["cardKind"], f"card_kind {panel} {rec} → {got} (want {row['cardKind']})")
    got = spine_card_kind(panel, rec)
    check(got == row["spineKind"], f"spine_card_kind {panel} {rec} → {got} (want {row['spineKind']})")
covered = {row["panel"] for row in _CASES}
check(covered == set(ALL_CARD_SIDECARS), f"corpus covers every card sidecar panel (missing {sorted(set(ALL_CARD_SIDECARS) - covered)})")


print("\n=== append_card stamps the self-link's spine kind ===")
for panel, filename, want in [
    ("cutter", "cutter.json", "cutter-suggestion"),
    ("revisions", "revisions.json", "revision-suggestion"),
]:
    doc = sandbox()
    cid = str(uuid.uuid4())
    card = {
        "id": cid,
        "kind": "suggestion",
        "author": "ai",
        "status": "pending",
        "original_text": "x",
        "suggested_text": "y",
        "createdAt": "2026-09-26T00:00:00.000Z",
        "links": [link(cid, "suggestion", cid), link(cid, "note", "some-other-card")],
    }
    op = {"panel": panel, "card": card, "kind": "suggestion", "text": "t",
          "paragraphIds": [], "safetyLevel": 3, "summary": "test"}
    r = subprocess.run([sys.executable, APPLY, str(doc), "complete-task", json.dumps(op), "--propose", "--synthesize-task"],
                       capture_output=True, text=True, env=dict(os.environ))
    check(r.returncode == 0, f"{panel}: apply_response succeeded ({r.stderr.strip()[-200:]})")
    if r.returncode != 0:
        continue
    landed = next(c for c in load(doc, filename)["cards"] if c["id"] == cid)
    refs = [l["target"]["ref"] for l in landed["links"]]
    check(refs[0] == {"kind": want, "id": cid}, f"{panel}: self-link ref.kind → {refs[0]['kind']}")
    check(refs[1] == {"kind": "note", "id": "some-other-card"},
          f"{panel}: a link to ANOTHER card keeps its token")
    shutil.rmtree(doc.parent)

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
