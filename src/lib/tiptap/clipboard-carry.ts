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
 *      uses. A TEXT selection over every character of the blocks it touches
 *      is cut as those whole blocks (`wholeBlockCutRange`), so a dragged or
 *      triple-clicked paragraph moves with its uuid rather than leaving an
 *      emptied line holding its cards.
 *   2. PASTE. When the pasted slice is the held cut's own text (its text
 *      signature matches) in the SAME document, the HELD slice lands instead of
 *      the parsed one, so the very same uuids and marks come back — and the
 *      dormant links revive by liveness (`useDormantRevival`), exactly as a
 *      Restore's do. A second paste finds the ids live again and is a copy;
 *      the holding is kept, because the history can take them back off the
 *      page — an Undo of the paste (or a Redo of the cut) re-carries them
 *      into it (`archiveReplayTracker`), and the next paste carries again.
 *
 * Identity at landing — "a move conserves identity; a copy mints it" (the
 * atom clipboard's law, `atom-clipboard.ts`): a held id that is LIVE (an
 * Undo of the cut put the source back, or a paste already landed it) makes
 * the paste fall through to the ordinary copy path. A partial cut's open-edge block keeps its uuid in the document,
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
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model";
import type { RefObject } from "react";
import {
  CLIPBOARD_LANDING_META,
  publishClipboardHoldings,
  retractArchiveHoldings,
} from "@/lib/tiptap/archive-holdings";
import { hasLiveAnchor, hasLiveBlock } from "@/lib/tiptap/doc-structure";
import { collectAtomIds } from "@/lib/tiptap/node-identity";
import { dispatchHoldingReleased } from "@/lib/tiptap/orphan-events";
import { generateShortId } from "@/lib/uuid";
import { expandCascadeRange } from "@/text-objects/delete-range";

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

/** The whole-block range a text cut MEANS, or null. A writer who selects a
 *  paragraph's every character (drag, triple-click, Shift-↓ to the next line's
 *  start) is moving the PARAGRAPH — but ProseMirror's slice of that selection is
 *  OPEN, so its uuid stays on the emptied line left behind and its cards with
 *  it. When the selection covers every textblock it touches entirely, the cut
 *  takes the blocks themselves (and any wrapper the removal would leave empty —
 *  the archive's `expandCascadeRange`), so the slice is closed and the block
 *  ids travel. A selection that starts or ends mid-block is a passage cut:
 *  null, the default cut runs. */
export function wholeBlockCutRange(state: EditorState): { from: number; to: number } | null {
  const sel = state.selection;
  if (!(sel instanceof TextSelection) || sel.empty) return null;
  const { $from } = sel;
  let { $to } = sel;
  if (!$from.parent.isTextblock || $from.parentOffset !== 0) return null;
  // Ending at the very start of the NEXT textblock (Shift-↓, a drag past the
  // line end) covers the previous block to its end.
  if ($to.parent.isTextblock && $to.parentOffset === 0 && $to.pos > $from.pos) {
    const back = TextSelection.findFrom(state.doc.resolve($to.before()), -1, true);
    if (!back || back.$from.pos < $from.pos) return null;
    $to = back.$from;
  }
  if (!$to.parent.isTextblock || $to.parentOffset !== $to.parent.content.size) return null;
  const from = $from.before();
  const to = $to.after();
  if (to <= from) return null;
  return expandCascadeRange(state.doc, { from, to });
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
    // Superseded (a copy, a new cut, the editor closing): the holding is
    // dropped, and whatever cards are still parked in it — the cut was never
    // pasted, or its paste was undone — come back out of the archive, parked,
    // their links still dormant so an Undo of the cut revives them
    // (`HOLDING_RELEASED_EVENT`). A no-op for cards a landed paste revived.
    const retire = () => {
      if (!held) return;
      retractArchiveHoldings(held.docId, owner);
      dispatchHoldingReleased({ docId: held.docId, snippetId: held.id });
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
            // thing a paste brings back, so its cards are let go (`retire`).
            copy() {
              retire();
              return false;
            },
            // Runs BEFORE ProseMirror's own cut handler, which then serializes
            // the clipboard and dispatches the `uiEvent: "cut"` delete the
            // guards read the holding for. Never handles the event itself.
            cut(view, event) {
              retire();
              const docId = docIdRef?.current ?? null;
              const sel = view.state.selection;
              if (!docId || sel.empty) return false;
              // A whole-block cut is performed HERE (ProseMirror's handler
              // would cut the open slice): same clipboard payload, same
              // `uiEvent: "cut"` delete, over the closed block range.
              const data = (event as ClipboardEvent).clipboardData;
              const range = data ? wholeBlockCutRange(view.state) : null;
              const slice = range ? view.state.doc.slice(range.from, range.to) : sel.content();
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
              if (!range || !data) return false;
              const { dom, text } = view.serializeForClipboard(slice);
              event.preventDefault();
              data.clearData();
              data.setData("text/html", dom.innerHTML);
              data.setData("text/plain", text);
              view.dispatch(
                view.state.tr
                  .delete(range.from, range.to)
                  .scrollIntoView()
                  .setMeta("uiEvent", "cut"),
              );
              return true;
            },
          },
          handlePaste(view, _event, slice) {
            const cut = held;
            if (!cut) return false;
            if (cut.docId !== (docIdRef?.current ?? null)) return false;
            if (sliceSignature(slice) !== cut.signature) return false;
            const state = view.state;
            // The held ids are on the page — an Undo of the cut put the source
            // back, or an earlier paste already landed them: this is a copy.
            // The holding is NOT retired by either: an Undo of that landing (or
            // a Redo of the cut) takes the ids back off the page, and the next
            // paste carries them again — liveness is the whole answer.
            const live =
              cut.wholeUuids.some((u) => hasLiveBlock(state, u)) ||
              (cut.atomIds.size > 0 &&
                [...collectAtomIds(state.doc)].some((a) => cut.atomIds.has(a)));
            if (live) return false;
            view.dispatch(
              state.tr
                .replaceSelection(landingSlice(cut.slice, state))
                .scrollIntoView()
                .setMeta("paste", true)
                .setMeta("uiEvent", "paste")
                .setMeta(CLIPBOARD_LANDING_META, true),
            );
            return true;
          },
        },
      }),
    ];
  },
});
