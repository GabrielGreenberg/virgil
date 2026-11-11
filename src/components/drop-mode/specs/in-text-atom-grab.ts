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
  findAtomByContent,
  findAtomById,
  inlineAtomMoveSpec,
  type AtomLocation,
} from "../util/inline-atom-move";
import { readInlineAtomSource } from "../util/inline-atom-source";
import { atomMetaForNodeName } from "@/lib/tiptap/atom-registry";

/**
 * Resolve the grabbed atom from the source captured at mousedown — by
 * IDENTITY: the id where the kind has one, the content fingerprint otherwise.
 *
 * The captured `pos` is the FAST path and is right for every ordinary gesture
 * (nothing mutates the document between mousedown and mouseup). It is not right
 * across a collab peer's edit (or an agent writeback landing mid-drag), which is
 * an async gap the gesture does not own: the atom may have SHIFTED, and at the
 * old position sits whatever the edit put there — including, in the shape that
 * bites, a same-kind neighbour (`\cite{a}\cite{b}`, two footnote markers,
 * `\ref{b}` displaced by an inserted `\ref{c}`). A kind check alone accepts
 * that neighbour and the commit moves the wrong atom.
 *
 * So the position is treated as a HINT and confirmed against the captured
 * identity; when it fails, the atom is re-found by that identity (task 648, the
 * "addressing the live document across an async gap" law). The id-bearing kinds
 * confirm by `atomId`; the id-less kinds (`ref` / `inline-math` / `dynamic`,
 * `ATOM_REGISTRY.idAttr: null`) confirm by CONTENT against the captured node and
 * re-find the nearest content-equal one (task 1574) — content-equal id-less
 * atoms are interchangeable, so content is exactly the identity they have. Only
 * when the atom is genuinely gone does this refuse, and a refusal is a silent
 * no-op.
 */
function resolveCapturedSource(cardKey: string): AtomLocation | null {
  const sep = cardKey.indexOf(":");
  const token = sep > 0 ? cardKey.slice(sep + 1) : "";
  const src = readInlineAtomSource(token);
  if (!src) return null;
  const idAttr = atomMetaForNodeName(src.nodeName)?.idAttr ?? null;
  const byId = !!idAttr && !!src.atomId;
  const node = src.editor.state.doc.nodeAt(src.pos);
  if (node && node.type.name === src.nodeName) {
    // The hint holds unless identity says otherwise.
    const confirmed = byId
      ? node.attrs?.[idAttr!] === src.atomId
      : atomContentEquals(node, src.atomNode);
    if (confirmed) {
      return {
        editor: src.editor,
        node,
        from: src.pos,
        to: src.pos + node.nodeSize,
      };
    }
  }
  if (byId) return findAtomById(src.editor, src.nodeName, idAttr!, src.atomId!);
  return findAtomByContent(src.editor, src.atomNode, src.pos);
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
