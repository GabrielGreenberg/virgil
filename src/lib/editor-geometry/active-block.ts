/**
 * Active-block resolution — "which paragraph is the user AT?" (perf Wave 2b,
 * C6). Feeds the paragraph back/forward navigation history (EditorLayout +
 * the Reader's `useParaNavHistory`) and collab cursor presence.
 *
 * The legacy shape (the `getActiveParagraphId` body in Editor.tsx) ran up to
 * THREE full `doc.descendants` walks with a `coordsAtPos` forced-layout read
 * per anchorable node — on a wall-clock 2s poll per pane, ~3 × blocks layout
 * reads per tick at doc_perfhuge scale. Same inversion as the breadcrumb
 * (`computeSectionPathAt`): instead of asking every block "is your top
 * visible?", ask the VIEW what sits at the viewport's top edge (ONE
 * `posAtCoords`) and answer everything else from the DocStructureBus
 * snapshot as data. O(1) DOM reads + O(log blocks) arithmetic per call.
 *
 * Decision ladder (the legacy contract, preserved):
 *   0. Hidden pane (offsetHeight 0) → null; scrolled to very top →
 *      `__DOC_TOP__` sentinel.
 *   1. The cursor's OUTERMOST anchorable-uuid block, if its top edge is
 *      inside the viewport → that uuid.
 *   2. Else the topmost block whose top edge is inside the viewport.
 *   3. Else the block overlapping the viewport's top edge.
 *   4. Else the cursor's block (or, when the cursor isn't in a uuid block,
 *      the nearest uuid block by position).
 *
 * Fidelity deviations vs the walk (deliberate, sub-perceptual): rule-4's
 * "nearest by pos" compares only the two pos-neighbors of the cursor
 * (legacy compared node-midpoints across every nested node); rule-2 trusts
 * pos-order ≈ Y-order for block tops (normal flow — the same monotonicity
 * `computeSectionPathAt` documents).
 *
 * Kill-switch: `localStorage["virgil:geom-active-block"] = "off"` reverts to
 * the legacy walk, which also remains the automatic fallback whenever the
 * fast path cannot answer (no bus, empty snapshot, hit-test miss).
 */

import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { getBus } from "@/lib/tiptap/doc-structure";
import { isAnchorableNode } from "@/lib/marginalia";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";
import { coordsAtPosCached } from "./registry";
import { posAtViewportY } from "./viewport-probe";

/** Sentinel for "scrolled to the very top (title area visible)". */
export const DOC_TOP_SENTINEL = "__DOC_TOP__";

export function geomActiveBlockEnabled(): boolean {
  try {
    return (
      typeof localStorage === "undefined" ||
      localStorage.getItem("virgil:geom-active-block") !== "off"
    );
  } catch {
    return true;
  }
}

// Anchorable vocabulary cache — uuids in doc order, rebuilt only when the
// structure VERSION moves. Positions are deliberately NOT cached (a plain
// keystroke shifts pos without bumping version) — probes read
// `structure.blocks.get(uuid).pos` fresh. Same pattern as section-path's
// par-title vocab.
interface BlockVocab {
  version: number;
  uuids: string[];
}
const vocabCache = new WeakMap<Editor, BlockVocab>();

function blockVocab(
  editor: Editor,
  structure: NonNullable<ReturnType<typeof getBus>>["structure"],
): string[] {
  const cached = vocabCache.get(editor);
  if (cached && cached.version === structure.version) return cached.uuids;
  const entries: { uuid: string; pos: number }[] = [];
  for (const b of structure.blocks.values()) {
    entries.push({ uuid: b.uuid, pos: b.pos });
  }
  entries.sort((a, b) => a.pos - b.pos);
  const vocab = {
    version: structure.version,
    uuids: entries.map((e) => e.uuid),
  };
  vocabCache.set(editor, vocab);
  return vocab.uuids;
}

/** First index in `uuids` whose live pos is >= `p`, or -1. */
function firstAtOrAfter(
  uuids: readonly string[],
  p: number,
  posOf: (uuid: string) => number | undefined,
): number {
  let lo = 0;
  let hi = uuids.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const pos = posOf(uuids[mid]);
    if (pos === undefined) {
      lo = mid + 1;
      continue;
    }
    if (pos >= p) {
      ans = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return ans;
}

/** The cursor's outermost anchorable-uuid block: `{uuid, pos}` or null.
 *  O(depth) — never walks the doc. Includes the NodeSelection-on-atom case
 *  (`nodeAfter`), which the legacy inclusive-bounds walk also matched. */
function cursorBlock(
  editor: Editor,
): { uuid: string; pos: number } | null {
  const $a = editor.state.selection.$anchor;
  for (let d = 1; d <= $a.depth; d++) {
    const node = $a.node(d);
    const uuid = node.attrs?.uuid as string | null | undefined;
    if (isAnchorableNode(node.type) && uuid) {
      return { uuid, pos: $a.before(d) };
    }
  }
  const after = $a.nodeAfter;
  const afterUuid = after?.attrs?.uuid as string | null | undefined;
  if (after && afterUuid && isAnchorableNode(after.type)) {
    return { uuid: afterUuid, pos: $a.pos };
  }
  return null;
}

/**
 * The snapshot-driven fast path. Returns the active uuid, or null when it
 * cannot answer (caller falls back to the legacy walk). `scrollEl` is the
 * pane's scroll container; the caller has already handled the hidden bail
 * and the DOC_TOP sentinel.
 */
export function computeActiveBlockId(
  editor: Editor,
  scrollEl: HTMLElement,
): string | null {
  const bus = getBus(editor);
  if (!bus) return null;
  const structure = bus.structure;
  if (structure.blocks.size === 0) return null;
  const view = editor.view;
  const doc = view.state.doc;

  const scrollRect = scrollEl.getBoundingClientRect();
  const viewTopY = scrollRect.top;
  const viewBottomY = scrollRect.top + scrollEl.clientHeight;

  // ── Rule 1: cursor's block, if its top is on-screen. ──
  const cursor = cursorBlock(editor);
  if (cursor) {
    const c = coordsAtPosCached(editor, cursor.pos);
    if (c && c.top >= viewTopY && c.top < viewBottomY) return cursor.uuid;
  }

  // ── One hit-test at the viewport's top edge (the reference the topmost/
  //    overlap rules both pivot on), clamped into the content box. ──
  const domRect = view.dom.getBoundingClientRect();
  if (domRect.height <= 0) return null;
  const pTop = posAtViewportY(view, viewTopY + 1, domRect);
  if (pTop === null) return null;

  const vocab = blockVocab(editor, structure);
  const posOf = (uuid: string) => structure.blocks.get(uuid)?.pos;

  // ── Rule 2: topmost block whose TOP edge is inside the viewport — the
  //    first block (pos order ≈ top order in normal flow) starting at/after
  //    the top-edge position, verified visible with one coords read. ──
  const idx = firstAtOrAfter(vocab, pTop, posOf);
  if (idx >= 0) {
    const pos = posOf(vocab[idx]);
    if (pos !== undefined) {
      const c = coordsAtPosCached(editor, pos);
      if (c && c.top >= viewTopY && c.top < viewBottomY) return vocab[idx];
    }
  }

  // ── Rule 3: the block OVERLAPPING the top edge — the outermost anchorable
  //    ancestor at the hit-test position (or the atom right after it). ──
  try {
    const $p = doc.resolve(Math.min(pTop, doc.content.size));
    for (let d = 1; d <= $p.depth; d++) {
      const node = $p.node(d);
      const uuid = node.attrs?.uuid as string | null | undefined;
      if (isAnchorableNode(node.type) && uuid) return uuid;
    }
    const after = $p.nodeAfter as PMNode | null;
    const afterUuid = after?.attrs?.uuid as string | null | undefined;
    if (after && afterUuid && isAnchorableNode(after.type)) return afterUuid;
  } catch {
    /* fall through */
  }

  // ── Rule 4: the cursor's block; or nearest-by-pos when the cursor isn't
  //    in a uuid block (two pos-neighbor candidates). ──
  if (cursor) return cursor.uuid;
  const cursorPos = editor.state.selection.$anchor.pos;
  const iAfter = firstAtOrAfter(vocab, cursorPos, posOf);
  const candidates: string[] = [];
  if (iAfter >= 0) candidates.push(vocab[iAfter]);
  if (iAfter - 1 >= 0) candidates.push(vocab[iAfter - 1]);
  else if (iAfter === -1 && vocab.length > 0) candidates.push(vocab[vocab.length - 1]);
  let best: string | null = null;
  let bestDist = Infinity;
  for (const uuid of candidates) {
    const pos = posOf(uuid);
    if (pos === undefined) continue;
    const size = doc.nodeAt(pos)?.nodeSize ?? 1;
    const dist = Math.abs(pos + size / 2 - cursorPos);
    if (dist < bestDist) {
      bestDist = dist;
      best = uuid;
    }
  }
  return best;
}

/**
 * The legacy walk — moved VERBATIM from Editor.tsx's `getActiveParagraphId`
 * (rules 1–3 + nearest fallback; up to three full doc walks × coordsAtPos).
 * Retained as the automatic fallback for editors without the observer and
 * as the `virgil:geom-active-block = "off"` kill-switch path.
 */
export function legacyActiveBlockWalk(
  editor: Editor,
  scrollEl: HTMLElement,
): string | null {
  const viewTop = scrollEl.scrollTop;
  const viewBottom = viewTop + scrollEl.clientHeight;
  const scrollRect = scrollEl.getBoundingClientRect();

  const getUuid = (node: PMNode): string | null =>
    (node.attrs?.uuid as string | null) || null;
  const hasParagraphUuid = (node: PMNode): boolean =>
    isAnchorableNode(node.type) && !!node.attrs?.uuid;

  // Rule 1: Find the paragraph the cursor is in
  const cursorPos = editor.state.selection.$anchor.pos;
  let cursorUuid: string | null = null;
  let cursorNodeTop: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (cursorUuid) return false;
    if (hasParagraphUuid(node)) {
      const end = pos + node.nodeSize;
      if (cursorPos >= pos && cursorPos <= end) {
        cursorUuid = getUuid(node);
        try {
          const coords = editor.view.coordsAtPos(pos);
          cursorNodeTop = coords.top - scrollRect.top + scrollEl.scrollTop;
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // If cursor is in a UUID paragraph and its top is visible, use it
  if (cursorUuid && cursorNodeTop !== null) {
    if (cursorNodeTop >= viewTop && cursorNodeTop < viewBottom) {
      return cursorUuid;
    }
  }

  // If cursor wasn't in a UUID paragraph, scan nearest forward/backward
  if (!cursorUuid) {
    let bestUuid: string | null = null;
    let bestDist = Infinity;
    editor.state.doc.descendants((node, pos) => {
      if (hasParagraphUuid(node)) {
        const mid = pos + node.nodeSize / 2;
        const dist = Math.abs(mid - cursorPos);
        if (dist < bestDist) {
          bestDist = dist;
          bestUuid = getUuid(node);
        }
      }
      return true;
    });
    if (bestUuid) {
      // Fall through to rule 2's visibility check with this candidate.
      cursorUuid = bestUuid;
    }
  }

  // Rule 2: Cursor's paragraph (or nearest) is off-screen.
  // Find topmost paragraph whose opening lines are visible.
  let topmostUuid: string | null = null;
  let topmostY = Infinity;
  editor.state.doc.descendants((node, pos) => {
    if (hasParagraphUuid(node)) {
      try {
        const coords = editor.view.coordsAtPos(pos);
        const nodeTop = coords.top - scrollRect.top + scrollEl.scrollTop;
        // "Opening lines visible" = the top of the paragraph is in the viewport
        if (nodeTop >= viewTop && nodeTop < viewBottom && nodeTop < topmostY) {
          topmostY = nodeTop;
          topmostUuid = getUuid(node);
        }
      } catch {
        /* ignore */
      }
    }
    return true;
  });
  if (topmostUuid) return topmostUuid;

  // Rule 3: No paragraph has opening lines visible (e.g., middle of a long
  // paragraph). Find any paragraph that overlaps the viewport.
  let overlappingUuid: string | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (overlappingUuid) return false;
    if (hasParagraphUuid(node)) {
      try {
        const startCoords = editor.view.coordsAtPos(pos);
        const endCoords = editor.view.coordsAtPos(pos + node.nodeSize - 1);
        const nodeTop = startCoords.top - scrollRect.top + scrollEl.scrollTop;
        const nodeBottom =
          endCoords.bottom - scrollRect.top + scrollEl.scrollTop;
        if (nodeBottom > viewTop && nodeTop < viewBottom) {
          overlappingUuid = getUuid(node);
        }
      } catch {
        /* ignore */
      }
    }
    return true;
  });
  return overlappingUuid ?? cursorUuid;
}

/**
 * The full `getActiveParagraphId` contract — hidden bail, DOC_TOP sentinel,
 * fast path behind the kill-switch, legacy walk as automatic fallback.
 * Editor.tsx's imperative handle delegates here.
 */
export function computeActiveParagraphId(editor: Editor): string | null {
  let editorEl: HTMLElement | null = null;
  try {
    editorEl = editor.view.dom as HTMLElement;
  } catch {
    return null;
  }
  // Hidden keep-alive pane: every coordinate reads 0 — answering from
  // garbage would corrupt the nav history (and the legacy walk would pay
  // 3 full walks per poll tick for a pane nobody can see). Answer nothing.
  if (!editorEl || editorEl.offsetHeight === 0) return null;
  const scrollEl = findEditorScrollFor(editorEl) as HTMLElement | null;
  if (!scrollEl) return null;
  if (scrollEl.scrollTop < 10) return DOC_TOP_SENTINEL;
  if (geomActiveBlockEnabled()) {
    const id = computeActiveBlockId(editor, scrollEl);
    if (id) return id;
  }
  return legacyActiveBlockWalk(editor, scrollEl);
}
