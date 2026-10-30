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

import type { MarkType } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { resolveLinkedAnchorRange } from "@/lib/linked-anchor-range";
import { generateShortId } from "@/lib/uuid";
import type { TextObjectRef } from "./types";

/**
 * Stamp a fresh `linkedAnchor` mark over `[from, to)` and return a
 * `linkedRange` TextObjectRef. The mark may span multiple paragraphs
 * (ProseMirror's mark spec already declares `spanning: true` per
 * linked-anchor.ts:14).
 *
 * Reuses an existing `linkedAnchor` anchorId only when the selection IS
 * that anchor's range — avoids minting duplicate ids when the user re-pops
 * an already-hydrated selection. Other cards anchored to that range
 * continue to point at the same id. Reuse is an EXTENT question, never a
 * PRESENCE one (task 1373): every downstream reader (ghost source rect, the
 * text-range-move drop) resolves the returned id to the anchor's FULL span,
 * so reusing a note's id for a few words strictly inside it lifted — and
 * since task 1023 MOVED — the whole annotated passage.
 *
 * NEVER overwrites an existing anchor (task 1001). `linkedAnchor` excludes
 * its own type (one anchor per character), so `addMark` over text that
 * already carries an anchor would REPLACE that note's / highlight's mark
 * with the new one — and a transient handle is stripped on popout close,
 * taking the overwritten slice of the annotation with it. So a selection
 * that touches any anchor whose range it does not EXACTLY equal — a partial
 * overlap, a superset, or a strict sub-range — is REFUSED (null):
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
 * `linkedAnchor` mark (defensive — shouldn't happen in practice), the range
 * touches an existing anchor it does not exactly equal (see above), the view
 * is not editable (the pen axis), or the mark did not LAND — a transaction
 * filter refused it (task 1375: never an id for an absent mark).
 */
export function hydrateSelectionToTextObject(
  view: EditorView,
  from: number,
  to: number,
  opts?: { transient?: boolean },
): TextObjectRef | null {
  if (from >= to) return null;
  // The PEN axis (`view.editable` — a collab pen held elsewhere, a read-only
  // float): no write of any kind, transient or not (task 1375). The same
  // predicate the grab handle's `schedule()` gates placements on.
  if (!view.editable) return null;
  const markType = view.state.schema.marks.linkedAnchor;
  if (!markType) return null;

  const coverage = readAnchorCoverage(view.state, from, to, markType);
  // The selection IS an existing anchor's range: reuse its id so multiple
  // cards / popouts over the same range share identity.
  if (coverage.kind === "exact") {
    return { kind: "linkedRange", id: coverage.id };
  }
  // Some text carries an anchor whose range is not the selection: a new mark
  // would overwrite it there, and its id would name the wrong extent. Refuse
  // rather than damage (or move) the annotation.
  if (coverage.kind === "conflicts") return null;

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
  const tr = view.state.tr.addMark(from, to, mark);
  // A transient handle is a lifecycle write, not a user edit: it is admitted
  // past the SURFACE axis (the `readOnlyEnforcer` over `editableRef` — the
  // Library Reader, whose bundle never persists, task 556) exactly as its
  // strip is (`removeTransientAnchor`), so a reader can still lift text OUT.
  // The PEN axis was refused above; a real (non-transient) anchor stays
  // subject to every filter.
  if (opts?.transient) tr.setMeta("ignoreReadOnly", true);
  view.dispatch(tr);

  // A write is real only once it is ADMITTED (task 1375): `dispatch` returns
  // nothing and a filtered transaction is dropped silently, so MEASURE — an id
  // for a mark that never landed would spawn a `missing` float.
  if (!resolveLinkedAnchorRange(view.state, anchorId)) return null;
  return { kind: "linkedRange", id: anchorId };
}

/**
 * How the text in `[from, to)` stands to the `linkedAnchor`s it carries — a
 * three-way answer so no caller can read presence as identity (task 1373):
 *
 *   - `none`      — no text node in the range carries an anchor;
 *   - `exact`     — one anchor is on EVERY text node AND its resolved range
 *                   equals the range's text extent (the reusable case);
 *   - `conflicts` — anything else: a partial overlap, a selection that
 *                   contains an anchor plus more, or a strict sub-range of one.
 *
 * Boundary normalisation: the range is compared by its TEXT extent (first
 * text character to last, clipped to `[from, to)`), so a selection whose
 * edges sit on non-text positions (a paragraph boundary) still matches the
 * anchor it spans. Coverage is read from every text node, never from
 * `resolve(from).marks()` (the `inclusive: false` start-boundary blind spot,
 * task 1001).
 */
function readAnchorCoverage(
  state: EditorState,
  from: number,
  to: number,
  markType: MarkType,
):
  | { kind: "none" }
  | { kind: "exact"; id: string }
  | { kind: "conflicts" } {
  let common = null as string[] | null;
  let touchesAnchor = false;
  let textFrom = Infinity;
  let textTo = -Infinity;
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    textFrom = Math.min(textFrom, Math.max(pos, from));
    textTo = Math.max(textTo, Math.min(pos + node.nodeSize, to));
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
  if (!touchesAnchor) return { kind: "none" };
  const id = common?.[0];
  if (!id) return { kind: "conflicts" };
  const range = resolveLinkedAnchorRange(state, id);
  return range && range.from === textFrom && range.to === textTo
    ? { kind: "exact", id }
    : { kind: "conflicts" };
}
