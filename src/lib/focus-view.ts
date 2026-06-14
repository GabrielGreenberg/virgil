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
 * call). It REBUILDS the set only on a focus-meta or a real block
 * add/remove/reorder (read from the DocStructure diff). `props.decorations`
 * returns the cached set — no doc walk. A structurally-null keystroke does no
 * band work at all.
 */

import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { readPendingDiff } from "@/lib/tiptap/doc-structure";

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
// bumps on a focus move / block add-remove-reorder). Read via the window hook
// wired in EditorLayout.
let __focusRebuildCount = 0;
export function __getFocusRebuildCount(): number {
  return __focusRebuildCount;
}

/** Build the decoration set hiding every out-of-band top-level child. */
function buildFocusDecoSet(doc: PMNode, band: FocusBand): DecorationSet {
  __focusRebuildCount++;
  const resolved = resolveFocusBand(doc, band);
  if (!resolved) return DecorationSet.empty;
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
      apply(tr, value, _oldState, newState): FocusViewState {
        const meta = tr.getMeta(focusViewPluginKey) as FocusViewMeta | undefined;
        if (meta) {
          // Band changed (user activate / move / lock / deactivate, or a
          // re-anchor pushed from useFocusMode) → rebuild from scratch.
          return { band: meta.band, decoSet: buildFocusDecoSet(newState.doc, meta.band) };
        }
        if (!tr.docChanged) return value;
        if (!value.band.active) return value; // nothing hidden; set stays empty

        // docChanged with an active band. A plain in-paragraph keystroke is
        // structurally null → the observer leaves pendingDiff null → MAP the
        // existing set forward (cheap, O(set size)), never rebuild. Rebuild
        // only when the top-level block SET or ORDER changed (a new out-of-band
        // block needs a decoration; mapping alone can't add one) or an anchor
        // died (removedBlocks → resolveFocusBand may now return null).
        const diff = readPendingDiff(newState);
        const blockStructureChanged =
          diff != null &&
          (diff.addedBlocks.length > 0 ||
            diff.removedBlocks.length > 0 ||
            diff.blockOrderChanged);
        if (blockStructureChanged) {
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
