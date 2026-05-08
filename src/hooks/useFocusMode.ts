"use client";

import { useCallback } from "react";
import { usePersistentState } from "./usePersistentState";

export interface FocusState {
  active: boolean;
  locked: boolean;
  startBlockIndex: number;
  endBlockIndex: number;
}

const INITIAL: FocusState = {
  active: false,
  locked: false,
  startBlockIndex: 0,
  endBlockIndex: 0,
};

// Block indices are doc-specific, so focus state lives in a per-doc
// sidecar. If the doc is edited externally between sessions, the
// restored range may point at different content; that's an acceptable
// edge case — the user can re-pick a section from the outline.
function migrateFocusState(raw: unknown): FocusState {
  const s = (raw ?? {}) as Partial<FocusState>;
  return {
    active: typeof s.active === "boolean" ? s.active : false,
    locked: typeof s.locked === "boolean" ? s.locked : false,
    startBlockIndex: Number.isFinite(s.startBlockIndex) ? Number(s.startBlockIndex) : 0,
    endBlockIndex: Number.isFinite(s.endBlockIndex) ? Number(s.endBlockIndex) : 0,
  };
}

/**
 * Compute the block range a heading "owns" — from its own index to the
 * block just before the next heading of same-or-higher level (or totalBlocks - 1).
 */
export function sectionRange(
  blockIndex: number,
  headings: { index: number; level: number }[],
  totalBlocks: number,
): [number, number] {
  // Exact heading match — range from this heading to the next of same-or-higher level
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

  // Not a heading — find the region this block belongs to.
  // Before the first heading: preamble region [0, firstHeading - 1]
  if (headings.length === 0) return [0, totalBlocks - 1];
  if (blockIndex < headings[0].index) {
    return [0, headings[0].index - 1];
  }

  // Between headings: find the enclosing heading and return its range
  for (let i = headings.length - 1; i >= 0; i--) {
    if (headings[i].index <= blockIndex) {
      return sectionRange(headings[i].index, headings, totalBlocks);
    }
  }

  return [blockIndex, blockIndex];
}

export function useFocusMode(docId: string | null) {
  const { state, update } = usePersistentState<FocusState>(
    docId,
    "focus.json",
    INITIAL,
    { migrate: migrateFocusState, errorLabel: "focus" },
  );

  const activate = useCallback(
    (headings: { index: number; level: number }[], totalBlocks: number) => {
      update(() => {
        if (headings.length === 0) {
          // No headings — focus entire document
          return { active: true, locked: false, startBlockIndex: 0, endBlockIndex: totalBlocks - 1 };
        }
        const [start, end] = sectionRange(headings[0].index, headings, totalBlocks);
        return { active: true, locked: false, startBlockIndex: start, endBlockIndex: end };
      });
    },
    [update],
  );

  const deactivate = useCallback(() => {
    update(() => INITIAL);
  }, [update]);

  const toggleLock = useCallback(() => {
    update((s) => (s.active ? { ...s, locked: !s.locked } : s));
  }, [update]);

  const setRange = useCallback((startBlockIndex: number, endBlockIndex: number) => {
    update((s) => (s.active ? { ...s, startBlockIndex, endBlockIndex } : s));
  }, [update]);

  /**
   * Click a section — move the band to exactly that section.
   */
  const moveTo = useCallback(
    (blockIndex: number, headings: { index: number; level: number }[], totalBlocks: number) => {
      const [start, end] = sectionRange(blockIndex, headings, totalBlocks);
      update((s) => (s.active ? { ...s, startBlockIndex: start, endBlockIndex: end } : s));
    },
    [update],
  );

  /**
   * Shift-click — extend the band to cover the range from the existing
   * start/end to the clicked section, whichever direction.
   */
  const expandTo = useCallback(
    (blockIndex: number, headings: { index: number; level: number }[], totalBlocks: number) => {
      const [clickStart, clickEnd] = sectionRange(blockIndex, headings, totalBlocks);
      update((s) => {
        if (!s.active) return s;
        const newStart = Math.min(s.startBlockIndex, clickStart);
        const newEnd = Math.max(s.endBlockIndex, clickEnd);
        return { ...s, startBlockIndex: newStart, endBlockIndex: newEnd };
      });
    },
    [update],
  );

  /**
   * Nudge a boundary (top or bottom handle) by one outline row.
   * `edge` is "top" or "bottom", `direction` is -1 (up) or +1 (down).
   * Returns the block indices that the outline rows correspond to,
   * so caller passes ordered block indices from the outline.
   */
  const nudgeBoundary = useCallback(
    (
      edge: "top" | "bottom",
      direction: -1 | 1,
      /** Sorted array of all outline row block indices (headings + parTitles). */
      allRowIndices: number[],
      headings: { index: number; level: number }[],
      totalBlocks: number,
    ) => {
      update((s) => {
        if (!s.active || s.locked) return s;

        if (edge === "top") {
          // Find current start in allRowIndices, step by direction
          const curIdx = allRowIndices.findIndex((ri) => ri >= s.startBlockIndex);
          const nextIdx = curIdx + direction;
          if (nextIdx < 0 || nextIdx >= allRowIndices.length) return s;
          const newBlockIdx = allRowIndices[nextIdx];
          if (newBlockIdx > s.endBlockIndex) return s; // can't cross
          return { ...s, startBlockIndex: newBlockIdx };
        } else {
          // bottom edge
          const curIdx = allRowIndices.findIndex((ri) => ri >= s.endBlockIndex);
          const nextIdx = curIdx + direction;
          // When moving bottom down, we need the section end, not just the row index
          if (nextIdx < 0 || nextIdx >= allRowIndices.length) return s;
          const newRowBlockIdx = allRowIndices[nextIdx];
          if (newRowBlockIdx < s.startBlockIndex) return s; // can't cross
          // The end is the last block of the section that newRowBlockIdx belongs to
          const [, newEnd] = sectionRange(newRowBlockIdx, headings, totalBlocks);
          return { ...s, endBlockIndex: newEnd };
        }
      });
    },
    [update],
  );

  /**
   * Snap a boundary directly to a specific outline row (for drag).
   */
  const snapBoundary = useCallback(
    (
      edge: "top" | "bottom",
      blockIndex: number,
      headings: { index: number; level: number }[],
      totalBlocks: number,
    ) => {
      update((s) => {
        if (!s.active || s.locked) return s;
        if (edge === "top") {
          if (blockIndex > s.endBlockIndex) return s;
          return { ...s, startBlockIndex: blockIndex };
        } else {
          if (blockIndex < s.startBlockIndex) return s;
          const [, newEnd] = sectionRange(blockIndex, headings, totalBlocks);
          return { ...s, endBlockIndex: newEnd };
        }
      });
    },
    [update],
  );

  return { state, activate, deactivate, toggleLock, setRange, moveTo, expandTo, nudgeBoundary, snapBoundary };
}
