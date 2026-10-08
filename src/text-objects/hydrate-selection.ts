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

import type { MarkType, Node as PMNode } from "@tiptap/pm/model";
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
 * NEVER overwrites an existing anchor (task 1001). `linkedAnchor` excludes
 * its own type (one anchor per character), so `addMark` over text that
 * already carries an anchor would REPLACE that note's / highlight's mark
 * with the new one — and a transient handle is stripped on popout close,
 * taking the overwritten slice of the annotation with it. So a selection
 * that touches an anchor it is not wholly covered by is REFUSED (null):
 * the grab does not lift, and the annotation is untouched. Coverage is read
 * from every text node in `[from, to)` (the intersection of the anchor ids
 * each carries), never from `doc.resolve(from).marks()` — the mark is
 * `inclusive: false`, so at an anchor's START boundary `marks()` reports
 * the text BEFORE `from` and the covering anchor was invisible.
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
 * Returns null if the range is empty, the schema doesn't have the
 * `linkedAnchor` mark (defensive — shouldn't happen in practice), or the
 * range partly overlaps an existing anchor (see above).
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

  const coverage = readAnchorCoverage(view.state.doc, from, to, markType);
  // An anchor on EVERY text node of the range: reuse its id so multiple
  // cards / popouts over the same range share identity.
  if (coverage.covering) {
    return { kind: "linkedRange", id: coverage.covering };
  }
  // Some text carries an anchor that does not cover the whole range: a new
  // mark would overwrite it there. Refuse rather than damage the annotation.
  if (coverage.touchesAnchor) return null;

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

/**
 * What `linkedAnchor`s the text in `[from, to)` carries: `covering` is an
 * anchor id present on EVERY text node of the range (null if none), and
 * `touchesAnchor` whether ANY text node carries one.
 */
function readAnchorCoverage(
  doc: PMNode,
  from: number,
  to: number,
  markType: MarkType,
): { covering: string | null; touchesAnchor: boolean } {
  let common = null as string[] | null;
  let touchesAnchor = false;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return true;
    const ids: string[] = [];
    for (const m of node.marks) {
      if (m.type !== markType) continue;
      const id = m.attrs.anchorId as string | undefined;
      if (id) ids.push(id);
    }
    if (ids.length > 0) touchesAnchor = true;
    common = common === null ? ids : common.filter((id) => ids.includes(id));
    return true;
  });
  return { covering: common?.[0] ?? null, touchesAnchor };
}
