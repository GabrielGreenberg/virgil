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
  findAtomById,
  inlineAtomMoveSpec,
  type AtomLocation,
} from "../util/inline-atom-move";
import { readInlineAtomSource } from "../util/inline-atom-source";
import { atomMetaForNodeName } from "@/lib/tiptap/atom-registry";

/**
 * Resolve the grabbed atom from the source captured at mousedown — by
 * IDENTITY where the kind has one, by position otherwise.
 *
 * The captured `pos` is the FAST path and is right for every ordinary gesture
 * (nothing mutates the document between mousedown and mouseup). It is not right
 * across a collab peer's edit, which is an async gap the gesture does not own:
 * the atom may have SHIFTED, and at the old position sits whatever the edit put
 * there — including, in the shape that bites, a same-kind neighbour
 * (`\cite{a}\cite{b}`, two footnote markers). A kind check alone accepts that
 * neighbour and the commit moves the wrong atom.
 *
 * So the position is treated as a HINT and confirmed against the captured id;
 * when it fails, the atom is re-found by that id (task 648 — the "addressing
 * the live document across an async gap" law: name the target by durable
 * identity, resolve it against the LIVE document at apply time). Only when the
 * atom is genuinely gone does this refuse, and a refusal is a silent no-op.
 *
 * `ref` / `inline-math` carry no id (`ATOM_REGISTRY.idAttr: null`), so for them
 * the position + kind check IS the whole answer — the asymmetry is the
 * registry's, and it is why this cannot be an unconditional id lookup.
 */
function resolveCapturedSource(cardKey: string): AtomLocation | null {
  const sep = cardKey.indexOf(":");
  const token = sep > 0 ? cardKey.slice(sep + 1) : "";
  const src = readInlineAtomSource(token);
  if (!src) return null;
  const idAttr = atomMetaForNodeName(src.nodeName)?.idAttr ?? null;
  const node = src.editor.state.doc.nodeAt(src.pos);
  if (node && node.type.name === src.nodeName) {
    // The hint holds unless identity says otherwise.
    if (!idAttr || !src.atomId || node.attrs?.[idAttr] === src.atomId) {
      return {
        editor: src.editor,
        node,
        from: src.pos,
        to: src.pos + node.nodeSize,
      };
    }
  }
  if (!idAttr || !src.atomId) return null;
  return findAtomById(src.editor, src.nodeName, idAttr, src.atomId);
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
