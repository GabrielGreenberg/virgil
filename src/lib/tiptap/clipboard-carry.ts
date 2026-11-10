/**
 * CLIPBOARD CARRY (task 1557) — Cut is "archive to the clipboard".
 *
 * Gabriel: "When text is cut — but not copied — all of its notes should go
 * with it. When it is pasted, they reanchor with it." Until this, a cut was an
 * ordinary delete: the anchor guard resurrected an EMPTY same-uuid paragraph
 * at the cut site (Mode-A cards stayed on a blank line), the mark guard
 * stripped every span card's link for good (Mode B), and the paste minted
 * fresh uuids and stripped every `linkedAnchor` mark — nothing re-attached.
 *
 * The answer is the ARCHIVE's carry, with the clipboard as the holding:
 *
 *   1. CUT. As the cut begins (`handleDOMEvents.cut`, before ProseMirror's own
 *      handler serializes and deletes), the selection's slice is HELD — with
 *      its block uuids and `linkedAnchor` marks intact — and its ids are
 *      published into the one holdings registry (`archive-holdings.ts`) under
 *      `scope: "clipboard"`. ProseMirror's cut transaction says what it is
 *      (`uiEvent: "cut"`), so `holdingsScopeOf` answers "clipboard" for it and
 *      every guard gives the archive-replay answer: no empty placeholder is
 *      resurrected, and the departed ids go dormant in the holding
 *      (`virgil-anchors-archived` → each card store's `markDormant`) instead of
 *      orphaning. Nothing new on the card side — the same door Redo-of-Archive
 *      uses.
 *   2. PASTE. When the pasted slice is the held cut's own text (its text
 *      signature matches) in the SAME document, the HELD slice lands instead of
 *      the parsed one, so the very same uuids and marks come back — and the
 *      dormant links revive by liveness (`useDormantRevival`), exactly as a
 *      Restore's do. The holding is then retired: a second paste is a copy.
 *
 * Identity at landing — "a move conserves identity; a copy mints it" (the
 * atom clipboard's law, `atom-clipboard.ts`): a held id that is LIVE again (an
 * Undo of the cut put the source back) means the source is back, and the
 * holding is stale — it retires and the paste falls through to the ordinary
 * copy path. A partial cut's open-edge block keeps its uuid in the document,
 * so a live uuid / anchorId inside the landing slice is cleared per id rather
 * than duplicated.
 *
 * Multi-pane: the holding is per editor (the plugin instance is the registry
 * owner) and names its docId — a paste into another paper is never a match and
 * behaves as a copy (sidecars are per-doc). Main editor only.
 *
 * Cost: gesture-scoped. The cut walks the cut slice; the paste walks the held
 * slice and, only on a signature match, collects the document's atom ids
 * (O(doc), once per paste — `atom-clipboard.ts` does the same). Nothing runs
 * per keystroke: there is no `appendTransaction` and no state field.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { RefObject } from "react";
import {
  publishClipboardHoldings,
  retractArchiveHoldings,
} from "@/lib/tiptap/archive-holdings";
import { hasLiveAnchor, hasLiveBlock } from "@/lib/tiptap/doc-structure";
import { collectAtomIds } from "@/lib/tiptap/node-identity";
import { generateShortId } from "@/lib/uuid";

/** The prefix every clipboard holding's id carries — the `archivedWith` a
 *  dormant link names while its text is on the clipboard. Never an archive
 *  snippet id, so the load reconcile settles a link still dormant in one
 *  (never pasted) as MISSING: released, reads unanchored (task 1329). */
export const CLIPBOARD_HOLDING_PREFIX = "clip:";

export function isClipboardHoldingId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(CLIPBOARD_HOLDING_PREFIX);
}

/** What a cut took to the clipboard. */
interface HeldCut {
  id: string;
  docId: string;
  slice: Slice;
  signature: string;
  /** Block uuids the cut removed WHOLE — off the slice's open edges. */
  wholeUuids: string[];
  atomIds: Set<string>;
}

/** The text a paste is matched on — whitespace-normalised, atoms as one
 *  placeholder each, so the parsed-from-HTML slice and the held one agree. */
export function sliceSignature(slice: Slice): string {
  return slice.content
    .textBetween(0, slice.content.size, "\n", "￼")
    .replace(/\s+/g, " ")
    .trim();
}

/** The block uuids of every node wholly inside `slice` — a node on the open
 *  start / end chain is only PART of its block, which stays in the document. */
export function wholeBlockUuids(slice: Slice): string[] {
  const out: string[] = [];
  const walk = (frag: Fragment, depth: number, openL: boolean, openR: boolean) => {
    const last = frag.childCount - 1;
    frag.forEach((node, _offset, i) => {
      const l = openL && i === 0 && depth < slice.openStart;
      const r = openR && i === last && depth < slice.openEnd;
      const uuid = node.attrs?.uuid;
      if (!l && !r && typeof uuid === "string" && uuid) out.push(uuid);
      if (!node.isLeaf) walk(node.content, depth + 1, l, r);
    });
  };
  walk(slice.content, 0, true, true);
  return out;
}

/** Every `linkedAnchor` id a mark in `slice` names. A mark only partly inside
 *  stays live in the document, so its id never departs and the registry entry
 *  for it is never consulted. */
export function sliceAnchorIds(slice: Slice): string[] {
  const out = new Set<string>();
  slice.content.descendants((node) => {
    for (const m of node.marks) {
      const id = m.type.name === "linkedAnchor" ? m.attrs.anchorId : null;
      if (typeof id === "string" && id) out.add(id);
    }
  });
  return [...out];
}

function sliceAtomIds(slice: Slice, schemaDoc: (content: Fragment) => PMNode | null): Set<string> {
  const doc = schemaDoc(slice.content);
  return doc ? collectAtomIds(doc) : new Set();
}

/** The held slice, made safe to land in `state`: a uuid / anchorId that is
 *  live there (a partial cut's surviving block or mark) is cleared, so the
 *  landing never duplicates an identity; every free one is KEPT. */
export function landingSlice(held: Slice, state: EditorState): Slice {
  const land = (frag: Fragment): Fragment => {
    const out: PMNode[] = [];
    frag.forEach((n) => {
      if (n.isText) {
        const keep = n.marks.filter((m) => {
          if (m.type.name !== "linkedAnchor") return true;
          const id = m.attrs.anchorId;
          return typeof id === "string" && id !== "" && !hasLiveAnchor(state, id);
        });
        out.push(keep.length === n.marks.length ? n : n.mark(keep));
        return;
      }
      const uuid = n.attrs?.uuid;
      const attrs =
        typeof uuid === "string" && uuid && hasLiveBlock(state, uuid)
          ? { ...n.attrs, uuid: null }
          : n.attrs;
      out.push(n.isLeaf && attrs === n.attrs ? n : n.type.create(attrs, land(n.content), n.marks));
    });
    return Fragment.fromArray(out);
  };
  return new Slice(land(held.content), held.openStart, held.openEnd);
}

export interface ClipboardCarryOptions {
  docIdRef: RefObject<string | null> | null;
}

export const ClipboardCarry = Extension.create<ClipboardCarryOptions>({
  name: "clipboardCarry",

  addOptions() {
    return { docIdRef: null };
  },

  addProseMirrorPlugins() {
    const { docIdRef } = this.options;
    // The registry OWNER — one per editor, so a pane's cut never replaces
    // another pane's holding (per-doc services under multi-pane keep-alive).
    const owner = {};
    let held: HeldCut | null = null;
    const retire = () => {
      if (held) retractArchiveHoldings(held.docId, owner);
      held = null;
    };
    return [
      new Plugin({
        key: new PluginKey("clipboardCarry"),
        view() {
          return { destroy: retire };
        },
        props: {
          handleDOMEvents: {
            // A copy replaces the clipboard: the held cut can no longer be the
            // thing a paste brings back. (Its cards stay dormant until the
            // load reconcile releases them — task 1557 progress log.)
            copy() {
              retire();
              return false;
            },
            // Runs BEFORE ProseMirror's own cut handler, which then serializes
            // the clipboard and dispatches the `uiEvent: "cut"` delete the
            // guards read the holding for. Never handles the event itself.
            cut(view) {
              retire();
              const docId = docIdRef?.current ?? null;
              const sel = view.state.selection;
              if (!docId || sel.empty) return false;
              const slice = sel.content();
              const id = `${CLIPBOARD_HOLDING_PREFIX}${generateShortId()}`;
              const wholeUuids = wholeBlockUuids(slice);
              const anchorIds = sliceAnchorIds(slice);
              const schema = view.state.schema;
              held = {
                id,
                docId,
                slice,
                signature: sliceSignature(slice),
                wholeUuids,
                atomIds: sliceAtomIds(slice, (content) => {
                  try {
                    return schema.topNodeType.create(null, content);
                  } catch {
                    return null;
                  }
                }),
              };
              if (wholeUuids.length > 0 || anchorIds.length > 0) {
                publishClipboardHoldings(docId, owner, {
                  uuids: new Map(wholeUuids.map((u) => [u, id])),
                  anchorIds: new Map(anchorIds.map((a) => [a, id])),
                });
              }
              return false;
            },
          },
          handlePaste(view, _event, slice) {
            const cut = held;
            if (!cut) return false;
            if (cut.docId !== (docIdRef?.current ?? null)) return false;
            if (sliceSignature(slice) !== cut.signature) return false;
            const state = view.state;
            // The source is back (an Undo of the cut): this is a copy now.
            const stale =
              cut.wholeUuids.some((u) => hasLiveBlock(state, u)) ||
              (cut.atomIds.size > 0 &&
                [...collectAtomIds(state.doc)].some((a) => cut.atomIds.has(a)));
            retire();
            if (stale) return false;
            view.dispatch(
              state.tr
                .replaceSelection(landingSlice(cut.slice, state))
                .scrollIntoView()
                .setMeta("paste", true)
                .setMeta("uiEvent", "paste"),
            );
            return true;
          },
        },
      }),
    ];
  },
});
