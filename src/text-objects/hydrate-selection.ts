/**
 * Selection → `linkedRange` hydration.
 *
 * Selections in Virgil are gesture-input, NOT TextObjects. They have no
 * id, no registry entry, no persistence. When a gesture commits that
 * requires the selection to persist (popout, card anchor, drop), the
 * gesture hydrates the selection into a `linkedRange` text-object by
 * stamping a `linkedAnchor` mark with a fresh `anchorId` over the range.
 *
 * Call sites:
 *   - TextObjectGrabHandle lift commit on a SelectionRef (the plain grab —
 *     passes `{ transient: true }`; this is the ONLY caller today).
 * Planned (Phase E — not yet wired): card-anchor commit (DragHandleMenu /
 * ActionsMenuPanel) and drop-mode commit on a selection source. Those must
 * leave `transient` unset so they mint a real, colourable annotation;
 * card-anchor commits currently use `createLinkedAnchor` (src/links/links.ts)
 * instead, which sets `kind`/`linkCard`/`tintColor` directly.
 *
 * Paste policy: `LinkedAnchorGuard.transformPasted` strips the mark on
 * paste to prevent id collisions. AnchorIds are minted exactly once at
 * hydration; copies do not propagate identity.
 *
 * See TEXT-OBJECT-REFACTOR.md §9.
 */

import type { EditorView } from "@tiptap/pm/view";
import { generateShortId } from "@/lib/uuid";
import type { TextObjectRef } from "./types";

/**
 * Stamp a fresh `linkedAnchor` mark over `[from, to)` and return a
 * `linkedRange` TextObjectRef. The mark may span multiple paragraphs
 * (ProseMirror's mark spec already declares `spanning: true` per
 * linked-anchor.ts:14).
 *
 * Reuses an existing `linkedAnchor` anchorId if one fully covers the
 * range — avoids minting duplicate ids when the user re-pops an
 * already-hydrated selection. Other cards anchored to that range
 * continue to point at the same id.
 *
 * `opts.transient` (the plain selection grab — see TextObjectGrabHandle):
 * stamp the freshly-minted mark with `kind:"transient"` so it renders as a
 * cardless, invisible range handle (no card, no highlight; renderHTML omits
 * data-link-card). It is opt-in and OFF by default: a card-anchor commit
 * (note / highlight / cut / revision) that hydrates a selection must still
 * produce a real, coloured annotation, so it leaves `transient` unset. When
 * an existing anchor already covers the range, the mode is irrelevant — the
 * existing kind is preserved (so re-grabbing over a real note never demotes
 * it to transient, and its cleanup never deletes the note).
 *
 * Returns null if the range is empty or the schema doesn't have the
 * `linkedAnchor` mark (defensive — shouldn't happen in practice).
 */
export function hydrateSelectionToTextObject(
  view: EditorView,
  from: number,
  to: number,
  opts?: { transient?: boolean },
): TextObjectRef | null {
  if (from >= to) return null;
  const markType = view.state.schema.marks.linkedAnchor;
  if (!markType) return null;

  // Look for an existing linkedAnchor that already fully covers the
  // range. If found, reuse its anchorId so multiple cards over the same
  // range share identity.
  let existingId: string | null = null;
  const startMarks = view.state.doc.resolve(from).marks();
  const startAnchor = startMarks.find((m) => m.type === markType);
  if (startAnchor) {
    // Verify the mark extends at least to `to`.
    const id = startAnchor.attrs.anchorId as string | undefined;
    if (id) {
      let coversTo = true;
      view.state.doc.nodesBetween(from, to, (node) => {
        if (!node.isText) return true;
        const has = node.marks.some(
          (m) => m.type === markType && m.attrs.anchorId === id,
        );
        if (!has) coversTo = false;
        return true;
      });
      if (coversTo) existingId = id;
    }
  }

  if (existingId) {
    return { kind: "linkedRange", id: existingId };
  }

  // Collect existing anchorIds in the doc so the new one doesn't collide.
  const existing = new Set<string>();
  view.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type === markType) {
        const id = mark.attrs.anchorId as string | undefined;
        if (id) existing.add(id);
      }
    }
    return true;
  });

  const anchorId = generateShortId(existing);
  // Plain grab → cardless `kind:"transient"` handle (invisible, no card);
  // any other commit → a default anchor that a card path later colours.
  const mark = markType.create(
    opts?.transient ? { anchorId, kind: "transient" } : { anchorId },
  );
  view.dispatch(view.state.tr.addMark(from, to, mark));

  return { kind: "linkedRange", id: anchorId };
}
