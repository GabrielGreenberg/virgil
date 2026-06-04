/**
 * `inTextAtomGrab` — the drop spec for the direct in-text Atom grab.
 *
 * One spec for all four canonical Atoms (footnote, citation, ref, inline
 * math). The `InlineAtomGrab` plugin grabs an atom in the prose, captures
 * its source position (inline-atom-source.ts), and begins a drop session
 * with cardKey `atom-grab:<token>`. This spec resolves the source from
 * that capture and moves the atom to the inline-cursor target via the
 * shared `inlineAtomMoveSpec` machinery — same-editor only, caret-after.
 *
 * The Card float-header path keeps its own by-id specs (footnote/citation
 * drop-spec.ts); this is the in-text path, uniform across Card-bearing
 * and id-less kinds alike.
 */

import {
  inlineAtomMoveSpec,
  type AtomLocation,
} from "../util/inline-atom-move";
import { readInlineAtomSource } from "../util/inline-atom-source";

/**
 * Resolve the grabbed atom from the source captured at mousedown.
 * Re-reads the node at the captured position and verifies its kind, so a
 * concurrent (collab) edit that shifted the atom degrades to a silent
 * no-op instead of moving the wrong node.
 */
function resolveCapturedSource(cardKey: string): AtomLocation | null {
  const sep = cardKey.indexOf(":");
  const token = sep > 0 ? cardKey.slice(sep + 1) : "";
  const src = readInlineAtomSource(token);
  if (!src) return null;
  const node = src.editor.state.doc.nodeAt(src.pos);
  if (!node || node.type.name !== src.nodeName) return null;
  return { editor: src.editor, node, from: src.pos, to: src.pos + node.nodeSize };
}

// Invariant: this spec's `classifyDrop` (via inlineAtomMoveSpec) must only
// ever return `no-op` / `apply`, never `confirm`. The inline-atom drag ghost
// (<InlineAtomGhost>) and the drag's `user-select:none` suppression are gated
// on the drop session being live; a `confirm` decision keeps the session open
// across an async modal (controller.commitDropSession), which would freeze the
// ghost and strand the selection-suppression until the user answered.
export const inTextAtomGrabSpec = inlineAtomMoveSpec({
  resolveSource: (cardKey) => resolveCapturedSource(cardKey),
  sameEditorOnly: true,
  select: "caret-after",
});
