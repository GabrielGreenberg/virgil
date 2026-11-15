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
  atomContentEquals,
  findAtomById,
  inlineAtomMoveSpec,
  type AtomLocation,
} from "../util/inline-atom-move";
import { readInlineAtomSource } from "../util/inline-atom-source";
import { atomMetaForNodeName } from "@/lib/tiptap/atom-registry";

/**
 * Resolve the grabbed atom from the source captured at mousedown — at its
 * FOLLOWED position, confirmed by IDENTITY.
 *
 * Nothing the gesture does mutates the document between mousedown and
 * mouseup, but a collab peer's edit, an agent writeback reloaded mid-drag or a
 * timed transaction is an async gap the gesture does not own: the atom may have
 * SHIFTED, and at its old offset sits whatever the edit put there — in the shape
 * that bites, a same-kind neighbour (`\cite{a}\cite{b}`, two footnote markers,
 * `\ref{b}` displaced by an inserted `\ref{c}`, a second identical `$x$`).
 *
 * So the capture's position is a `trackPos` handle (task 1635), mapped through
 * every transaction since mousedown; `null` means the spot itself was deleted.
 * The followed position is then CONFIRMED (task 648, the "addressing the live
 * document across an async gap" law): by `atomId` for the id-bearing kinds, by
 * CONTENT against the captured node for the id-less ones (`ref` /
 * `inline-math` / `dynamic`, `ATOM_REGISTRY.idAttr: null`, task 1574).
 *
 * When the confirmation fails, an id-bearing atom is re-found by its id (a
 * whole-document reload deletes every position, never the id). An id-less atom
 * has nothing durable to re-find it by: a nearest-content-match scan from the
 * stale hint is exactly the guess that moved sentence A's `$x$` when the
 * grabbed one in sentence B had shifted — so it REFUSES, and a refusal is a
 * silent no-op.
 */
function resolveCapturedSource(cardKey: string): AtomLocation | null {
  const sep = cardKey.indexOf(":");
  const token = sep > 0 ? cardKey.slice(sep + 1) : "";
  const src = readInlineAtomSource(token);
  if (!src) return null;
  const idAttr = atomMetaForNodeName(src.nodeName)?.idAttr ?? null;
  const byId = !!idAttr && !!src.atomId;
  const pos = src.at.get();
  const node = pos === null ? null : src.editor.state.doc.nodeAt(pos);
  if (pos !== null && node && node.type.name === src.nodeName) {
    const confirmed = byId
      ? node.attrs?.[idAttr!] === src.atomId
      : atomContentEquals(node, src.atomNode);
    if (confirmed) {
      return { editor: src.editor, node, from: pos, to: pos + node.nodeSize };
    }
  }
  if (byId) return findAtomById(src.editor, src.nodeName, idAttr!, src.atomId!);
  return null;
}

// Invariant: this spec's `classifyDrop` (via inlineAtomMoveSpec) must only
// ever return `no-op` / `apply`, never `confirm`. The inline-atom drag ghost
// (<DropGhost>) and the drag's `user-select:none` suppression are gated
// on the drop session being live; a `confirm` decision keeps the session open
// across an async modal (controller.commitDropSession), which would freeze the
// ghost and strand the selection-suppression until the user answered.
export const inTextAtomGrabSpec = inlineAtomMoveSpec({
  resolveSource: (cardKey) => resolveCapturedSource(cardKey),
  sameEditorOnly: true,
  select: "caret-after",
});
