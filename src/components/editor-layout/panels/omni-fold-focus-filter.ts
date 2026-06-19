import type { Node as PMNode } from "@tiptap/pm/model";
import type { OmniItem } from "@/panels/_shared/types";
import type { FocusState } from "@/hooks/useFocusMode";

/** The minimal live-position resolver the filter needs (Pillar A). Returns the
 *  entity's LIVE pos for the entity-anchored kinds, `undefined` otherwise. */
export type ResolveOmniPos = (id: string) => number | undefined;

/**
 * Two-pass fold/focus binning for the omni mirror, extracted as a PURE function
 * (T5 Pillar A) so the live-position binning is unit-testable without the host
 * component's context web.
 *
 * Both passes classify an item by the top-level block index of its anchor. The
 * binning reads the LIVE position (`resolvePos(item.id) ?? item.pos`) — NOT the
 * baked `item.pos`, which goes stale as a plain-typing edit shifts later content
 * and mis-bins an entity-anchored card across a fold/focus boundary
 * (OMNI-F1-02). The entity-anchored kinds (footnote / citation / example) carry
 * a live pos from the DocStructureObserver snapshot; paragraph-anchored kinds
 * (and the multi-anchor `@N` rows) fall back to the structurally-rebuilt
 * `item.pos`.
 *
 *   Pass 1 (fold): DROP an item whose anchor lives in a collapsed section
 *     (the section-folding plugin hides the prose; mirror it on the omni side).
 *   Pass 2 (focus): STAMP `outsideFocus` (never drop — that would read as data
 *     loss) on an item whose anchor falls outside the focused band — but ONLY
 *     when the band is LOCKED (the only mode that hides the in-text anchor).
 *     A mere focus selection (active && !locked) confines nothing, so Pass 2
 *     is a no-op there (CHIP A).
 *
 * `doc` is the live ProseMirror doc (for `resolve(pos).index(0)`); `null` (editor
 * not mounted) short-circuits both passes to the identity.
 */
export function filterOmniItemsByFoldAndFocus(
  items: OmniItem[],
  doc: PMNode | null,
  hiddenTopLevel: ReadonlySet<number>,
  focusState: FocusState | null | undefined,
  resolvePos: ResolveOmniPos,
): OmniItem[] {
  // Pass 1: fold filter.
  let foldFiltered: OmniItem[];
  if (hiddenTopLevel.size === 0 || !doc) {
    foldFiltered = items;
  } else {
    foldFiltered = [];
    for (const item of items) {
      const pos = resolvePos(item.id) ?? item.pos;
      if (pos == null) { foldFiltered.push(item); continue; }
      let bi: number | null = null;
      try { bi = doc.resolve(pos).index(0); } catch { /* stale */ }
      if (bi == null || !hiddenTopLevel.has(bi)) {
        foldFiltered.push(item);
      }
      // else: drop — card lives in a collapsed section
    }
  }

  // Pass 2: focus filter — stamp `outsideFocus` instead of dropping. Only a
  // LOCKED band confines: it display:none's the out-of-band in-text anchors, so
  // their cards can't cascade inline and must route to the "outside focus" bin.
  // A mere focus SELECTION (active && !locked) hides nothing (CHIP A) — every
  // anchor stays visible in-text, so NO card is stamped `outsideFocus`.
  if (!focusState?.active || !focusState.locked || !doc) return foldFiltered;
  const { startBlockIndex, endBlockIndex } = focusState;
  const out: OmniItem[] = [];
  for (const item of foldFiltered) {
    const pos = resolvePos(item.id) ?? item.pos;
    if (pos == null) { out.push(item); continue; }
    let bi: number | null = null;
    try { bi = doc.resolve(pos).index(0); } catch { /* stale */ }
    if (bi == null) { out.push(item); continue; }
    const outside = bi < startBlockIndex || bi > endBlockIndex;
    out.push(outside ? { ...item, outsideFocus: true } : item);
  }
  return out;
}
