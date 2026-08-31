"""What "the pen is released" MEANS, for the editor-side python suites.

Not a test module (the CI loop and the vitest wrapper both glob `test_*.py`) —
the one place the released-ness predicate lives, so a suite cannot re-fork the
notion the fix retired.

Before task 496 the answer was "the pen-context file is GONE", and nine suites
spelled that by hand. `release_pen` no longer deletes: on a mount that refuses
deletion (the reported cloud/Dropbox one) the raise fired after the collab
restore had committed, rolling it back to Claude-held and wedging the paper
read-only, and it escaped `commit_under_pen`'s finally to report exit 2 on an
already-landed write. The release is a REWRITE now — a `holder: null` record,
which the app's own ladder (`coworkPenFromContext`, src/lib/cowork-pen.ts) reads
as released INSTANTLY rather than after the 60 s TTL.

So released-ness is: the record is absent, OR it says nobody holds the pen.
"""
from __future__ import annotations

import json
from pathlib import Path

PEN_CONTEXT_REL = ".virgil/pen-context.json"


def pen_released(doc) -> bool:
    """True iff nothing holds this document's pen — the file is gone, or the
    record on disk names no holder (an unparseable record is NOT released: we
    cannot say, and the safe answer for a test is to notice)."""
    p = Path(doc) / PEN_CONTEXT_REL
    if not p.exists():
        return True
    try:
        rec = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return False
    return isinstance(rec, dict) and rec.get("holder") is None
