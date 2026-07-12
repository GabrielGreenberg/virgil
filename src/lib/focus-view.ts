/**
 * Focus view — the UUID-anchored "visible band" subsystem.
 *
 * Peer of `section-folding.ts`. "Focus view" confines the editor (and the
 * outline + on-view cards + word count + section path) to a contiguous band
 * of top-level blocks for distraction-free writing.
 *
 * Architecture (see MEMO_FOCUS_VIEW_REWORK.md):
 *  - The band is anchored to two top-level block UUIDs (`startUuid`/`endUuid`),
 *    NOT raw block indices — so it survives edits earlier in the document, the
 *    way section-folding survives them. `null` anchors are doc-start / doc-end
 *    sentinels.
 *  - ONE shared resolver, `resolveFocusBand(doc, band)`, converts the band to a
 *    live `{startIdx, endIdx}` top-level index range. Every surface (this
 *    plugin + the React consumers) calls it; nobody re-implements
 *    `i < start || i > end`. It reads the LIVE doc, so it is staleness-free
 *    (it does not depend on the structure-index snapshot's positions).
 *  - The main-editor hide is a ProseMirror plugin (`focusViewPlugin`) that owns
 *    a `DecorationSet` of `.focus-hidden` node decorations over the out-of-band
 *    top-level children. It is registered ONLY in the main/float editor's
 *    extension list — never in a card `RichTextField` — so it is structurally
 *    incapable of hiding a card editor. There is no global stylesheet.
 *
 * Keystroke sanctity: the plugin's `apply` carries the decoration set forward
 * with `DecorationSet.map(tr.mapping)` on a plain keystroke (the explicit
 * departure from section-folding, which rebuilds in `decorations()` on every
 * call). It REBUILDS the set only when a transaction could have changed which
 * blocks are hidden or REPLACED a top-level node (which drops its node
 * decoration under `.map()`). `props.decorations` returns the cached set — no
 * doc walk. A plain in-block keystroke does no band work beyond an O(set-size)
 * position remap.
 *
 * Note on rebuild detection: this plugin is registered in the heading
 * extension, which runs BEFORE `DocStructureObserver`, so `readPendingDiff` is
 * not yet populated in this plugin's `apply` (same constraint section-folding
 * lives with). We therefore discriminate map-vs-rebuild from the transaction's
 * STEPS directly (O(edit-size)), not from the structure diff.
 */

import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { txPreservesTopLevelNodeDecorations } from "@/lib/pm-map-safety";

// ---------------------------------------------------------------------------
// The band.
// ---------------------------------------------------------------------------

/**
 * The persisted, UUID-anchored focus band. `startUuid`/`endUuid` are the
 * `attrs.uuid` of the top-level anchorable blocks at the band's first and last
 * block (paragraph OR heading — a boundary drag can land on a parTitle row, so
 * heading-only anchoring would lose precision). `null` = document start /
 * document end, so a band running to the literal doc edge survives edge
 * insertions.
 */
export interface FocusBand {
  active: boolean;
  locked: boolean;
  startUuid: string | null;
  endUuid: string | null;
}

export const INACTIVE_BAND: FocusBand = {
  active: false,
  locked: false,
  startUuid: null,
  endUuid: null,
};

/** A resolved band: live top-level child indices, inclusive. */
export interface ResolvedBand {
  startIdx: number;
  endIdx: number;
}

// ---------------------------------------------------------------------------
// The single resolver + predicate trio. Doc-based, staleness-free.
// ---------------------------------------------------------------------------

/**
 * Resolve a UUID-anchored band to a live `{startIdx, endIdx}` top-level index
 * range, or `null` when there is no band to apply:
 *   - the band is inactive, or the doc is empty, OR
 *   - a NAMED anchor UUID is no longer in the document (it was deleted) — in
 *     which case every consumer degrades to "no band → show everything" rather
 *     than honouring a phantom range. (`useFocusMode` separately detects the
 *     death and re-anchors / deactivates, then pushes a corrected band.)
 *
 * `null` anchors are sentinels: `startUuid === null` → index 0,
 * `endUuid === null` → last index. Walks top-level children once
 * (O(top-level-count)); only ever called on a structural change (memo-gated in
 * React) or a plugin rebuild — never per keystroke.
 */
export function resolveFocusBand(
  doc: PMNode,
  band: FocusBand,
): ResolvedBand | null {
  if (!band.active) return null;
  const lastIdx = doc.childCount - 1;
  if (lastIdx < 0) return null;

  let startIdx = band.startUuid == null ? 0 : -1;
  let endIdx = band.endUuid == null ? lastIdx : -1;

  if (startIdx === -1 || endIdx === -1) {
    doc.forEach((node, _offset, index) => {
      const uuid = (node.attrs?.uuid as string | null | undefined) ?? null;
      if (uuid == null) return;
      if (startIdx === -1 && uuid === band.startUuid) startIdx = index;
      if (endIdx === -1 && uuid === band.endUuid) endIdx = index;
    });
  }

  // A named anchor wasn't found → it died. Degrade to no band.
  if (startIdx === -1 || endIdx === -1) return null;
  // Inverted (anchors crossed by an edit) → degrade gracefully by swapping.
  if (startIdx > endIdx) return { startIdx: endIdx, endIdx: startIdx };
  return { startIdx, endIdx };
}

/** True iff the band should CONFINE the text viewer (hide out-of-band content).
 *  Selection (active) is a mere preference; only LOCK confines. Every hide /
 *  breadcrumb-skip / omni-bin / cursor-coerce surface keys off THIS, not `active`. */
export function bandConfines(band: FocusBand): boolean {
  return band.active && band.locked;
}

/**
 * True iff there is an active, resolvable band AND `pos` falls within it.
 * False when there is no band (so "outside the band, hide/dim it" is exactly
 * `band.active && resolveFocusBand(...) && !isPosInFocusBand(...)` — but a
 * loop over many items should call `resolveFocusBand` ONCE and test indices
 * inline rather than re-resolving per item).
 */
export function isPosInFocusBand(
  doc: PMNode,
  band: FocusBand,
  pos: number,
): boolean {
  const resolved = resolveFocusBand(doc, band);
  if (!resolved) return false;
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const idx = doc.resolve(clamped).index(0);
  return idx >= resolved.startIdx && idx <= resolved.endIdx;
}

/** True iff `uuid` names a top-level block inside the active resolved band. */
export function isUuidInFocusBand(
  doc: PMNode,
  band: FocusBand,
  uuid: string,
): boolean {
  const resolved = resolveFocusBand(doc, band);
  if (!resolved) return false;
  let idx = -1;
  doc.forEach((node, _offset, index) => {
    if ((node.attrs?.uuid as string | undefined) === uuid) idx = index;
  });
  if (idx === -1) return false;
  return idx >= resolved.startIdx && idx <= resolved.endIdx;
}

// ---------------------------------------------------------------------------
// The plugin.
// ---------------------------------------------------------------------------

export interface FocusViewState {
  band: FocusBand;
  decoSet: DecorationSet;
}

type FocusViewMeta = { band: FocusBand };

export const focusViewPluginKey = new PluginKey<FocusViewState>("focusView");

/**
 * Keystroke-sanctity gate (twin of `transactionTouchesFold`): can this
 * transaction have changed the focus decorations? Only via (1) a focus-meta on
 * this plugin (band set / cleared) or (2) a docChanged tx (positions map; the
 * set rebuilds only when the block set/order changed).
 */
export function transactionTouchesFocus(tr: Transaction): boolean {
  return tr.getMeta(focusViewPluginKey) !== undefined || tr.docChanged;
}

/** Stamp a band change onto a transaction for the plugin to consume. */
export function setFocusBandMeta(tr: Transaction, band: FocusBand): Transaction {
  return tr.setMeta(focusViewPluginKey, { band } satisfies FocusViewMeta);
}

export function getFocusViewState(state: EditorState): FocusViewState | null {
  return focusViewPluginKey.getState(state) ?? null;
}

export function getFocusBand(state: EditorState): FocusBand {
  return getFocusViewState(state)?.band ?? INACTIVE_BAND;
}

// Dev-only rebuild counter — proves keystroke sanctity (flat on plain typing,
// bumps on a focus move / block add-remove-reorder).
let __focusRebuildCount = 0;
export function __getFocusRebuildCount(): number {
  return __focusRebuildCount;
}
if (typeof window !== "undefined") {
  (window as unknown as { __virgilFocusRebuilds?: () => number }).__virgilFocusRebuilds =
    () => __focusRebuildCount;
}

/** Build the decoration set hiding every out-of-band top-level child. */
function buildFocusDecoSet(doc: PMNode, band: FocusBand): DecorationSet {
  // A mere focus SELECTION (active && !locked) is a preference — it hides
  // nothing. Only a LOCKED band confines the viewer. Bail before any doc walk
  // so an unlocked band does zero work and hides no block.
  if (!bandConfines(band)) return DecorationSet.empty;
  const resolved = resolveFocusBand(doc, band);
  if (!resolved) return DecorationSet.empty;
  // Count only REAL decoration builds (past the confinement + resolvability
  // guards) so __virgilFocusRebuilds() means "the hidden set was rebuilt" —
  // flat on an unlocked select/drag, bumps once per locked-band change.
  __focusRebuildCount++;
  const { startIdx, endIdx } = resolved;
  const decos: Decoration[] = [];
  let offset = 0;
  doc.forEach((node, _o, index) => {
    if (index < startIdx || index > endIdx) {
      decos.push(
        Decoration.node(offset, offset + node.nodeSize, {
          class: "focus-hidden",
        }),
      );
    }
    offset += node.nodeSize;
  });
  if (decos.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decos);
}

export function focusViewPlugin(): Plugin<FocusViewState> {
  return new Plugin<FocusViewState>({
    key: focusViewPluginKey,
    state: {
      init: () => ({ band: INACTIVE_BAND, decoSet: DecorationSet.empty }),
      apply(tr, value, oldState, newState): FocusViewState {
        const meta = tr.getMeta(focusViewPluginKey) as FocusViewMeta | undefined;
        if (meta) {
          // Band changed (user activate / move / lock / deactivate, or a
          // re-anchor pushed from useFocusMode) → rebuild from scratch.
          return { band: meta.band, decoSet: buildFocusDecoSet(newState.doc, meta.band) };
        }
        if (!tr.docChanged) return value;
        if (!bandConfines(value.band)) return value; // nothing hidden; set stays empty

        // docChanged with an active band. Carry the cached node-decoration set
        // forward with DecorationSet.map() ONLY for a pure in-block content edit
        // (typing / inline formatting). REBUILD when a top-level block is
        // added/removed (childCount change) or a top-level node boundary is
        // replaced (ReplaceAroundStep, split/merge, cross-block replace) — all
        // of which DROP a node decoration under .map(), silently un-hiding an
        // out-of-band block. Detected from the STEPS (readPendingDiff is not yet
        // populated here — see the file header). Rebuild is O(top-level blocks)
        // but never fires on a plain keystroke.
        if (!txPreservesTopLevelNodeDecorations(tr, oldState.doc, newState.doc)) {
          return { band: value.band, decoSet: buildFocusDecoSet(newState.doc, value.band) };
        }
        return {
          band: value.band,
          decoSet: value.decoSet.map(tr.mapping, newState.doc),
        };
      },
    },
    props: {
      decorations(state) {
        // O(1): return the cached set. (The explicit departure from
        // section-folding, which rebuilds here on every call.)
        return this.getState(state)?.decoSet ?? DecorationSet.empty;
      },
    },
  });
}
