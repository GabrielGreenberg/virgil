#!/usr/bin/env python3
r"""Every `virgil/*.json` sidecar that holds a CITEKEY, and how a rename re-keys it
(task 615).

The app has one owner for a citekey rename — `src/lib/identity/identity-cascade.ts`
— whose header names the bug class: a rename that forgets one citekey-keyed
surface strands the user's annotation (DATA-LOSS, BIB-A2-01) and their pending
bib reviews. The skill side's rename (`apply_response.py`'s `renameCitekey` op)
used to be a second writer with its own private idea of "which files hold a
citekey" — `.tex` + `citations.json` — so `answer-bib-review --library-sync`
swapped `smith99 → smith1999` and left the annotation under `smith99`, where the
panel no longer looks.

So the list is not this module's to state. `citekey_keyed_sidecars.json` (a
sibling data file, shipped with the bundle) declares it, and CI holds it total:

  * `rekey` ∪ `notCitekeyKeyed` must equal the app's sidecar SSOT
    (`SIDECAR_VALUE`) — `citekey-keyed-sidecars-census.test.ts`, so a NEW sidecar
    cannot ship without someone deciding whether a rename must touch it;
  * every `rekey` rule must have a re-keyer in `REKEYERS` below —
    `test_rename_citekey_cascade.py`, and `rekey_plan()` refuses at run time.

The annotations sidecar has TWO live shapes, and every reader/writer in this silo
goes through the helpers here rather than guessing (the old `_annotation_apply`
wrote the flat shape at the TOP of a V2 file, where the app never reads):

  * V1 flat `{ citekey: html }` — the identity-cascade flag OFF (the default);
    a `{ annotations: {…} }` wrapper is tolerated on read;
  * V2 `{ v: 2, byUid: { uid: html }, orphanByKey: { citekey: html } }` — the
    flag ON. `byUid` is rename-proof (the `\vbid{uid}` line before a `.bib`
    entry survives a `bibEdit replace`, which splices from the `@`); only the
    orphan bucket is citekey-keyed.

A rename never overwrites: if the new key already carries an annotation (a
library-sync onto a key the paper already uses), the two are CONCATENATED — both
are the user's writing, and which one to keep is theirs to decide.

NO I/O except reading the sibling manifest; the contract owns every write.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Callable

MANIFEST_PATH = Path(__file__).with_name("citekey_keyed_sidecars.json")


def load_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# `.bib` identity: which `\vbid{uid}` belongs to a citekey
# ---------------------------------------------------------------------------

_VBID_RE = re.compile(r"\\vbid\{([^}]+)\}")
# Mirrors `ENTRY_HEAD_RE` in src/lib/bib-uid.ts — the head the TS binder pairs.
_ENTRY_HEAD_RE = re.compile(r"@\w+\s*\{([^,\s}]+)\s*,")


def vbid_uid_for(bib_text: str, citekey: str) -> str | None:
    r"""The durable uid the app would give `citekey`'s entry, or None.

    A port of `orderedVbidBindings` (src/lib/bib-uid.ts): each marker binds to
    the first entry head at-or-after its end and before the next marker; each
    head is claimed once; the FIRST binding for a citekey wins (`parseVbidMarkers`).
    """
    markers = [(m.group(1).strip(), m.start(), m.end()) for m in _VBID_RE.finditer(bib_text)]
    if not markers:
        return None
    heads = [(m.group(1).strip(), m.start()) for m in _ENTRY_HEAD_RE.finditer(bib_text)]
    hi = 0
    for i, (uid, _at, end) in enumerate(markers):
        next_at = markers[i + 1][1] if i + 1 < len(markers) else float("inf")
        while hi < len(heads) and heads[hi][1] < end:
            hi += 1
        if hi < len(heads) and heads[hi][1] < next_at:
            if heads[hi][0] == citekey:
                return uid
            hi += 1
    return None


# ---------------------------------------------------------------------------
# annotations.json — the two shapes, read / write / re-key
# ---------------------------------------------------------------------------


def is_annotations_v2(state: Any) -> bool:
    """Mirrors `isAnnotationsV2` in src/lib/identity/sidecar-uid-migrate.ts."""
    return isinstance(state, dict) and state.get("v") == 2 and isinstance(state.get("byUid"), dict)


def _flat_target(state: dict) -> dict:
    """The citekey map of a V1 file: the top level, or a legacy wrapper."""
    wrapped = state.get("annotations")
    return wrapped if isinstance(wrapped, dict) else state


def _text_of(v: Any) -> str | None:
    if isinstance(v, str):
        return v
    if isinstance(v, dict) and isinstance(v.get("text"), str):
        return v["text"]
    return None


def get_annotation(state: Any, citekey: str, uid: str | None) -> str | None:
    """What the app's `getAnnotation` would show for `citekey`."""
    if not isinstance(state, dict):
        return None
    if is_annotations_v2(state):
        if uid and _text_of(state["byUid"].get(uid)) is not None:
            return _text_of(state["byUid"][uid])
        orphans = state.get("orphanByKey")
        return _text_of(orphans.get(citekey)) if isinstance(orphans, dict) else None
    return _text_of(_flat_target(state).get(citekey))


def set_annotation(state: dict, citekey: str, uid: str | None, text: str) -> None:
    """Write `text` where the app's `setAnnotation` would, IN PLACE. An empty
    text deletes, as the app does."""
    if is_annotations_v2(state):
        orphans = state.setdefault("orphanByKey", {})
        if uid:
            if text:
                state["byUid"][uid] = text
            else:
                state["byUid"].pop(uid, None)
            orphans.pop(citekey, None)
        elif text:
            orphans[citekey] = text
        else:
            orphans.pop(citekey, None)
        return
    target = _flat_target(state)
    if text:
        target[citekey] = text
    else:
        target.pop(citekey, None)


def _move_key(bucket: dict, old: str, new: str) -> int:
    """Move `bucket[old]` to `bucket[new]`, concatenating onto an existing
    value rather than overwriting it. Returns 1 when something moved."""
    if old not in bucket:
        return 0
    moved, have = bucket[old], bucket.get(new)
    moved_text, have_text = _text_of(moved), _text_of(have)
    if have is None or have_text == "":
        bucket[new] = moved
    elif moved_text is None or have_text is None:
        return 0  # an unreadable value on either side: leave both where they are
    elif moved_text and moved_text != have_text:
        bucket[new] = f"{have_text}\n\n{moved_text}"
    del bucket[old]
    return 1


def rekey_annotations(state: Any, old: str, new: str) -> int:
    """Re-key `old → new` in either annotations shape. V2's `byUid` needs
    nothing (the uid survives the rename); its orphan bucket does."""
    if not isinstance(state, dict):
        return 0
    if is_annotations_v2(state):
        orphans = state.get("orphanByKey")
        return _move_key(orphans, old, new) if isinstance(orphans, dict) else 0
    return _move_key(_flat_target(state), old, new)


# ---------------------------------------------------------------------------
# bib-review-requests.json
# ---------------------------------------------------------------------------


def rekey_bib_review(state: Any, old: str, new: str) -> int:
    """Re-point every review row whose `bibKey` is `old`. A row with an
    `entryUid` already survives by uid; its `bibKey` is the readable mirror the
    skill side (and the flag-OFF app) still matches on, so it moves too."""
    rows = state.get("requests") if isinstance(state, dict) else None
    if not isinstance(rows, list):
        return 0
    n = 0
    for row in rows:
        if isinstance(row, dict) and row.get("bibKey") == old:
            row["bibKey"] = new
            n += 1
    return n


# ---------------------------------------------------------------------------
# The registry the manifest's rules resolve against
# ---------------------------------------------------------------------------


def _rekey_citation_refs(state: Any, old: str, new: str) -> int:
    import rename_citekey as RC  # lazy: RC is the .tex rewriter's home

    if not isinstance(state, dict):
        return 0
    _, n = RC.rewrite_citations_json(state, old, new)
    return n


#: rule → in-place re-keyer `(state, old, new) -> n_changed`.
REKEYERS: dict[str, Callable[[Any, str, str], int]] = {
    "citation-refs": _rekey_citation_refs,
    "annotations": rekey_annotations,
    "bib-review": rekey_bib_review,
}

#: The empty state a missing file loads as (never written unless marked dirty).
EMPTY_STATE: dict[str, Callable[[], Any]] = {
    "citation-refs": lambda: {"citations": []},
    "annotations": dict,
    "bib-review": lambda: {"requests": []},
}


def rekey_plan() -> list[tuple[str, str]]:
    """`[(sidecar filename, rule)]` for every citekey-keyed sidecar, in manifest
    order. Raises when the manifest names a rule this silo cannot apply — a
    rename that silently skipped a declared surface is the bug this exists for."""
    plan = [(row["file"], row["rule"]) for row in load_manifest()["rekey"]]
    missing = sorted({rule for _, rule in plan if rule not in REKEYERS or rule not in EMPTY_STATE})
    if missing:
        raise RuntimeError(
            f"citekey_keyed_sidecars.json names rule(s) with no re-keyer: {missing}"
        )
    return plan
