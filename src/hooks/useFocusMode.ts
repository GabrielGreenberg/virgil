"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { usePersistentState } from "./usePersistentState";
import { useStructuralRevisions } from "./useStructuralRevisions";
import {
  type FocusBand,
  INACTIVE_BAND,
  resolveFocusBand,
} from "@/lib/focus-view";

/**
 * The index-based view of the focus band, kept for the OUTLINE's positional
 * interaction model and for every existing consumer (cursor coercion,
 * section-path, word count, omni-host filter, OutlinePanel band). It is now a
 * LIVE PROJECTION of the UUID-anchored truth (`FocusBand`), re-resolved against
 * the current doc on every structural change — so the indices never drift when
 * the document is edited above the band. The persisted truth is the UUID band.
 */
export interface FocusState {
  active: boolean;
  locked: boolean;
  startBlockIndex: number;
  endBlockIndex: number;
}

/**
 * The canonical inactive `FocusState` — a single frozen reference reused
 * everywhere an "unfocused" state is needed (this hook's degrade-to-show-all
 * paths, and the Reader's OutlineHost mount, which supplies `focusState: null`).
 * Sharing ONE const keeps callers from minting a fresh per-render literal that
 * would silently defeat a downstream `memo()` boundary.
 */
export const INACTIVE_FOCUS_STATE: FocusState = {
  active: false,
  locked: false,
  startBlockIndex: 0,
  endBlockIndex: 0,
};

/**
 * What is persisted to `focus.json`: the UUID band, plus transitional
 * `_legacy*` indices carried only while migrating an old index-based file
 * (cleared by Phase B once the doc is available to resolve them).
 */
type StoredBand = FocusBand & {
  _legacyStart?: number;
  _legacyEnd?: number;
};

const INITIAL_STORED: StoredBand = {
  active: false,
  locked: false,
  startUuid: null,
  endUuid: null,
};

/**
 * Phase A migration (synchronous, no doc access): accept both the new UUID
 * shape and the legacy `{startBlockIndex,endBlockIndex}` shape. A legacy file
 * is preserved as transitional `_legacy*` indices; Phase B (an effect, below)
 * resolves them to UUIDs once the editor is mounted and rewrites the file.
 */
function migrateFocusState(raw: unknown): StoredBand {
  const s = (raw ?? {}) as Record<string, unknown>;
  const active = typeof s.active === "boolean" ? s.active : false;
  const locked = typeof s.locked === "boolean" ? s.locked : false;
  if ("startUuid" in s || "endUuid" in s) {
    return {
      active,
      locked,
      startUuid: typeof s.startUuid === "string" ? s.startUuid : null,
      endUuid: typeof s.endUuid === "string" ? s.endUuid : null,
    };
  }
  if (Number.isFinite(s.startBlockIndex) || Number.isFinite(s.endBlockIndex)) {
    return {
      active,
      locked,
      startUuid: null,
      endUuid: null,
      _legacyStart: Number.isFinite(s.startBlockIndex) ? Number(s.startBlockIndex) : 0,
      _legacyEnd: Number.isFinite(s.endBlockIndex) ? Number(s.endBlockIndex) : 0,
    };
  }
  return { active, locked, startUuid: null, endUuid: null };
}

function uuidOfIndex(doc: PMNode, i: number): string | null {
  const last = doc.childCount - 1;
  if (i < 0 || i > last) return null;
  return (doc.child(i).attrs?.uuid as string | null | undefined) ?? null;
}

function blockIndexOfUuid(doc: PMNode, uuid: string): number {
  let idx = -1;
  doc.forEach((node, _offset, index) => {
    if ((node.attrs?.uuid as string | undefined) === uuid) idx = index;
  });
  return idx;
}

/** Build a UUID band from an inclusive index range; doc-edge → null sentinel. */
function bandFromIndices(
  doc: PMNode,
  startIdx: number,
  endIdx: number,
  active: boolean,
  locked: boolean,
): FocusBand {
  const last = doc.childCount - 1;
  return {
    active,
    locked,
    startUuid: startIdx <= 0 ? null : uuidOfIndex(doc, startIdx),
    endUuid: endIdx >= last ? null : uuidOfIndex(doc, endIdx),
  };
}

function legacyToBand(stored: StoredBand, doc: PMNode): FocusBand {
  const last = doc.childCount - 1;
  const clamp = (n: number) => Math.max(0, Math.min(n, Math.max(0, last)));
  const s = clamp(stored._legacyStart ?? 0);
  const e = clamp(stored._legacyEnd ?? last);
  return bandFromIndices(doc, s, e, stored.active, stored.locked);
}

/**
 * Compute the block range a heading "owns" — from its own index to the
 * block just before the next heading of same-or-higher level (or totalBlocks - 1).
 * Index-based: the outline is positional. Exported for OutlinePanel.
 */
export function sectionRange(
  blockIndex: number,
  headings: { index: number; level: number }[],
  totalBlocks: number,
): [number, number] {
  const hi = headings.findIndex((h) => h.index === blockIndex);
  if (hi !== -1) {
    const heading = headings[hi];
    for (let i = hi + 1; i < headings.length; i++) {
      if (headings[i].level <= heading.level) {
        return [blockIndex, headings[i].index - 1];
      }
    }
    return [blockIndex, totalBlocks - 1];
  }

  if (headings.length === 0) return [0, totalBlocks - 1];
  if (blockIndex < headings[0].index) {
    return [0, headings[0].index - 1];
  }

  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].index <= blockIndex) {
      return sectionRange(headings[i].index, headings, totalBlocks);
    }
  }

  return [blockIndex, blockIndex];
}

/** The block range a clicked outline NODE owns: a heading → its subtree
 *  (sectionRange); any non-heading block (paragraph/parTitle/doc-start) → just
 *  that block. The band edges and clicks both resolve through THIS so the
 *  highlighted row and the confined region always agree. */
export function regionForNode(
  blockIndex: number,
  headings: { index: number; level: number }[],
  totalBlocks: number,
): [number, number] {
  const isHeading = headings.some((h) => h.index === blockIndex);
  if (isHeading) return sectionRange(blockIndex, headings, totalBlocks);
  return [blockIndex, blockIndex];
}

export function useFocusMode(docId: string | null, editor: Editor | null) {
  const { state: stored, update } = usePersistentState<StoredBand>(
    docId,
    "focus.json",
    INITIAL_STORED,
    // Debounce the focus.json DISK write (CHIP B). React state (stored → band /
    // state) still updates synchronously inside update() — only the write to
    // disk coalesces — so the editor confine on lock and the band overlay stay
    // immediate. This is a safety net for any residual rapid update() bursts
    // (e.g. click-then-lock, or an in-flight-write race); the per-snap drag
    // write storm is already eliminated by the commit-on-mouseup change in
    // FocusBand. Pending writes are FLUSHED synchronously on unmount and on
    // docId change (usePersistentState's cleanup effect → flushPending), so the
    // band is never lost on navigation.
    { migrate: migrateFocusState, errorLabel: "focus", debounceMs: 150 },
  );
  // Re-resolve trigger: rev.blocks bumps on block add/remove/reorder (CHIP 0),
  // never on a plain keystroke — so the derived indices below recompute exactly
  // when the document order could have shifted, and stay stable while typing.
  const rev = useStructuralRevisions(editor);
  const editorRef = useRef<Editor | null>(editor);
  editorRef.current = editor;

  const isLegacy = stored._legacyStart !== undefined || stored._legacyEnd !== undefined;

  // The UUID band, with any legacy indices resolved against the live doc. This
  // is what the focusViewPlugin consumes (via EditorLayout's meta dispatch).
  const band: FocusBand = useMemo(() => {
    if (!isLegacy) {
      return {
        active: stored.active,
        locked: stored.locked,
        startUuid: stored.startUuid,
        endUuid: stored.endUuid,
      };
    }
    const doc = editor?.state?.doc;
    if (!doc) return INACTIVE_BAND; // legacy + doc not ready: nothing renders focus yet
    return legacyToBand(stored, doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, editor, rev.blocks, isLegacy]);

  // Backward-compatible index projection — LIVE-resolved, so it never drifts.
  const state: FocusState = useMemo(() => {
    const doc = editor?.state?.doc;
    if (!doc) return INACTIVE_FOCUS_STATE;
    const resolved = resolveFocusBand(doc, band);
    if (!resolved) return INACTIVE_FOCUS_STATE; // inactive or a dead anchor → degrade to "show all"
    return {
      active: true,
      locked: band.locked,
      startBlockIndex: resolved.startIdx,
      endBlockIndex: resolved.endIdx,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, editor, rev.blocks]);

  // Remember the last good resolved range so a dead-anchor re-anchor can land on
  // the nearest surviving block rather than jumping to a doc edge.
  const lastResolvedRef = useRef<{ startIdx: number; endIdx: number } | null>(null);
  useEffect(() => {
    if (state.active) {
      lastResolvedRef.current = { startIdx: state.startBlockIndex, endIdx: state.endBlockIndex };
    }
  }, [state]);

  // Phase B migration: once the editor is mounted, resolve the legacy indices
  // to UUID anchors and rewrite focus.json (clearing _legacy). Runs once — the
  // guard short-circuits after the upgrade lands. Depends on the reactive
  // `editor` (NOT editorRef) so it re-runs when the editor mounts — gating on a
  // ref + a load-silent counter would read the not-yet-ready doc once and stop.
  useEffect(() => {
    if (!isLegacy) return;
    const doc = editor?.state?.doc;
    if (!doc || doc.childCount === 0) return;
    update(() => legacyToBand(stored, doc));
  }, [isLegacy, stored, editor, rev.blocks, update]);

  // Re-anchor policy: if a band anchor's block was deleted, re-anchor that edge
  // to the nearest surviving block (using the last good index as a hint), or
  // deactivate if BOTH anchors died. Never silently shifts to wrong content.
  useEffect(() => {
    if (isLegacy || !band.active) return;
    const doc = editor?.state?.doc;
    if (!doc) return;
    const startAlive = band.startUuid == null || blockIndexOfUuid(doc, band.startUuid) !== -1;
    const endAlive = band.endUuid == null || blockIndexOfUuid(doc, band.endUuid) !== -1;
    if (startAlive && endAlive) return;
    if (!startAlive && !endAlive) {
      update(() => INACTIVE_BAND);
      return;
    }
    const last = doc.childCount - 1;
    const hint = lastResolvedRef.current;
    update((s) => {
      let startUuid = s.startUuid;
      let endUuid = s.endUuid;
      if (!startAlive) {
        const i = Math.max(0, Math.min(hint ? hint.startIdx : 0, last));
        startUuid = i <= 0 ? null : uuidOfIndex(doc, i);
      }
      if (!endAlive) {
        const i = Math.max(0, Math.min(hint ? hint.endIdx : last, last));
        endUuid = i >= last ? null : uuidOfIndex(doc, i);
      }
      return { ...s, startUuid, endUuid };
    });
  }, [band, isLegacy, editor, rev.blocks, update]);

  const activate = useCallback(
    // `seedBlockIndex` (optional) is the top-level block the CURRENT section
    // scope should grow from — the innermost active heading, or the doc-start
    // par-title region (threaded by the caller from the live section-path). When
    // omitted / unresolvable we fall back to the FIRST section, the historical
    // default. It resolves through `sectionRange`, NOT `regionForNode`, so a
    // mid-section caret (a non-heading block) seeds the ENCLOSING section rather
    // than the bare block, and a doc-start par-title seeds the whole pre-heading
    // region — matching "focus the section I'm in, one section at a time."
    (
      headings: { index: number; level: number }[],
      totalBlocks: number,
      seedBlockIndex?: number | null,
    ) => {
      const doc = editorRef.current?.state?.doc;
      if (!doc) return;
      let start: number;
      let end: number;
      if (headings.length === 0) {
        start = 0;
        end = totalBlocks - 1;
      } else {
        const seed =
          seedBlockIndex != null && seedBlockIndex >= 0
            ? seedBlockIndex
            : headings[0].index;
        [start, end] = sectionRange(seed, headings, totalBlocks);
      }
      update(() => bandFromIndices(doc, start, end, true, false));
    },
    [update],
  );

  const deactivate = useCallback(() => {
    update(() => INACTIVE_BAND);
  }, [update]);

  const toggleLock = useCallback(() => {
    update((s) => (s.active ? { ...s, locked: !s.locked } : s));
  }, [update]);

  const moveTo = useCallback(
    (blockIndex: number, headings: { index: number; level: number }[], totalBlocks: number) => {
      const doc = editorRef.current?.state?.doc;
      if (!doc) return;
      const [start, end] = regionForNode(blockIndex, headings, totalBlocks);
      update((s) => (s.active ? bandFromIndices(doc, start, end, true, s.locked) : s));
    },
    [update],
  );

  const expandTo = useCallback(
    (blockIndex: number, headings: { index: number; level: number }[], totalBlocks: number) => {
      const doc = editorRef.current?.state?.doc;
      if (!doc) return;
      const [clickStart, clickEnd] = regionForNode(blockIndex, headings, totalBlocks);
      update((s) => {
        if (!s.active) return s;
        const cur = resolveFocusBand(doc, s) ?? { startIdx: 0, endIdx: doc.childCount - 1 };
        const newStart = Math.min(cur.startIdx, clickStart);
        const newEnd = Math.max(cur.endIdx, clickEnd);
        return bandFromIndices(doc, newStart, newEnd, true, s.locked);
      });
    },
    [update],
  );

  // Drag-handle reposition. SECTION-AWARE + edge-asymmetric: the snapped outline
  // row is resolved through `regionForNode` (the SAME resolver click/shift-click
  // use), so dragging an edge onto a section HEADING confines to the whole
  // section, not the bare header row. The TOP edge takes the region START, the
  // BOTTOM edge the region END — so a bottom drag onto a heading ends at the
  // section's last body block (the reported bug: it used to stop at the header).
  // A non-heading row resolves to itself (`[i, i]`), preserving parTitle/
  // paragraph precision. Both edges CLAMP past the opposite edge to a 1-row
  // minimum so the handle keeps tracking the cursor across a crossover. The
  // visual band rect (OutlinePanel `measure()`) already lands botEl on the last
  // visible row ≤ endBlockIndex, so the committed range paints with no jump.
  const snapBoundary = useCallback(
    (
      edge: "top" | "bottom",
      blockIndex: number,
      headings: { index: number; level: number }[],
      totalBlocks: number,
    ) => {
      const doc = editorRef.current?.state?.doc;
      if (!doc) return;
      update((s) => {
        if (!s.active || s.locked) return s;
        const cur = resolveFocusBand(doc, s) ?? { startIdx: 0, endIdx: doc.childCount - 1 };
        const [regionStart, regionEnd] = regionForNode(blockIndex, headings, totalBlocks);
        if (edge === "top") {
          const newStart = Math.min(regionStart, cur.endIdx);
          return bandFromIndices(doc, newStart, cur.endIdx, true, s.locked);
        }
        const newEnd = Math.max(regionEnd, cur.startIdx);
        return bandFromIndices(doc, cur.startIdx, newEnd, true, s.locked);
      });
    },
    [update],
  );

  // Memoized so the returned object has a STABLE identity across renders — it
  // re-identifies only when `state`/`band` change (both rare), never on a plain
  // re-render. Consumers (useFocusActions' handlers → editorMutationHandlers)
  // depend on this object; an unmemoized fresh-every-render literal made those
  // handlers churn every render, defeating React.memo(EditorPane) in the
  // multi-doc keep-alive cascade (Phase 5). All members are individually stable
  // (band = useMemo; the six actions = useCallback; state = useState).
  return useMemo(
    () => ({
      state,
      band,
      activate,
      deactivate,
      toggleLock,
      moveTo,
      expandTo,
      snapBoundary,
    }),
    [state, band, activate, deactivate, toggleLock, moveTo, expandTo, snapBoundary],
  );
}
