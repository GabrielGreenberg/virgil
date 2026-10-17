/**
 * The Archive RESTORE door's write gate (task 1169).
 *
 * Restore has two routes (`useArchive.restoreSnippet`), and only one of them
 * passes through ProseMirror:
 *
 *  - an EXCERPT lands back in the prose — a PM insert the `readOnlyEnforcer`
 *    already drops while the partner holds the pen, so nothing was lost; but
 *    the refusal came back as a bare "didn't land", and the toast then blamed
 *    the caret ("click in an ordinary paragraph…") — an instruction the user
 *    would follow and fail again;
 *  - a whole CARD (task 712, an origin record) is handed back to its own
 *    panel — React state plus a SIDECAR write — and the snippet is removed from
 *    `archive.json`. Neither half is a PM transaction, so the enforcer never
 *    saw it: under a pen hold the user could move a card between two sidecars
 *    the partner may be writing. That is task 638's "card registration" leg,
 *    reached by a path its gate never covered.
 *
 * So the door asks `surfaceEditableNow` — LIVE, at the press, never a value
 * captured when the card rendered — BEFORE either route, and a refusal names
 * its cause through task 968's channel (`readOnlyRefusal` → `refusalPhrase`):
 * "Your co-author has the pen" / "This paper is open read-only".
 *
 * [cost: O(1) — `surfaceEditableNow` is a DOM property read and two booleans.]
 */

import type { Editor } from "@tiptap/core";
import { readOnlyRefusal } from "@/lib/actions/action-registry";
import { refusalPhrase } from "@/lib/actions/refusal";
import { surfaceEditableNow } from "@/lib/tiptap/surface-editable";

/** `null` when Restore may proceed on `editor`; otherwise the message the
 *  refusal notifies with. A `null` editor answers `null` (no over-gating —
 *  "no surface" is not "read-only surface", `surfaceEditableNow`'s default). */
export function archiveRestoreRefusal(editor: Editor | null | undefined): string | null {
  if (surfaceEditableNow(editor)) return null;
  return `${refusalPhrase(readOnlyRefusal(editor))}, so nothing can be restored right now. ` +
    "Nothing was removed from the Archive.";
}
