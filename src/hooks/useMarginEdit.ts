import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

import type { ViewPrefs } from "./useViewPrefs";

/**
 * Margin-edit state machine, generalized over all four sides.
 *
 * Carved out of EditorPane.tsx so the page padding interaction is a
 * single self-contained module: one state shape (`Margins` is a record
 * keyed by side, not four parallel scalars), one drag handler driven
 * by axis-lookup tables, one symmetric-snap rule that works on either
 * axis. Adding a fifth side would be a single entry in each table.
 *
 * EditorPane.tsx is already 5000+ lines; pulling this out keeps the
 * margin code reviewable on its own and makes the state machine
 * testable without spinning up the full editor.
 */

export type MarginSide = "left" | "right" | "top" | "bottom";
export type Margins = Record<MarginSide, number>;

export const MARGIN_SIDES: readonly MarginSide[] = ["left", "right", "top", "bottom"] as const;

// Axis a side belongs to. Decides clientX vs clientY math and the
// resize cursor (ew vs ns).
export const MARGIN_AXIS: Record<MarginSide, "x" | "y"> = {
  left: "x",
  right: "x",
  top: "y",
  bottom: "y",
};

// Opposite side on the same axis. Used for symmetric snap + marker.
export const MARGIN_OPPOSITE: Record<MarginSide, MarginSide> = {
  left: "right",
  right: "left",
  top: "bottom",
  bottom: "top",
};

// Per-side minimum padding. Left must clear the 72px marginalia
// gutter (plus heading fold-chevron breathing strip). The other
// three floor at 24px so the prose has air without bumping into the
// pod border. All four cap at MARGIN_MAX so an extreme drag can't
// collapse the column.
export const MARGIN_MIN: Record<MarginSide, number> = {
  left: 72,
  right: 24,
  top: 24,
  bottom: 24,
};
export const MARGIN_MAX = 240;

// CSS custom property each side writes through. The editor column
// reads these to set its prose padding (see EditorPane's column
// inline style and Editor.tsx's prose class).
export const MARGIN_CSS_VAR: Record<MarginSide, string> = {
  left: "--editor-pl",
  right: "--editor-pr",
  top: "--editor-pt",
  bottom: "--editor-pb",
};

/**
 * Structural type of the view-prefs surface this hook actually
 * touches. Deliberately narrow so callers can pass either the full
 * `useViewPrefs` bundle or EditorPane's narrower `EditorPaneViewPrefs`
 * wrapper — as long as the four read fields and four setters are
 * present, the hook doesn't care about the surrounding shape.
 */
export interface MarginEditViewPrefs {
  prefs: Pick<
    ViewPrefs,
    | "editorLeftMargin"
    | "editorRightMargin"
    | "editorTopMargin"
    | "editorBottomMargin"
  >;
  setEditorLeftMargin: (px: number) => void;
  setEditorRightMargin: (px: number) => void;
  setEditorTopMargin: (px: number) => void;
  setEditorBottomMargin: (px: number) => void;
}

interface UseMarginEditOpts {
  viewPrefs: MarginEditViewPrefs | null | undefined;
}

export interface UseMarginEditResult {
  /** True while the user is in the margins-editing UI mode. */
  marginEditMode: boolean;
  /** Live values during the edit session, or null when not editing. */
  liveMargins: Margins | null;
  /** Values to render with — live during edit, persisted otherwise. */
  effective: Margins;
  /** True when left and right are equal (drives the L/R symmetry dot). */
  symmetricX: boolean;
  /** True when top and bottom are equal (drives the T/B symmetry dot). */
  symmetricY: boolean;
  /** Enter edit mode — snapshots current prefs into liveMargins. */
  enter: () => void;
  /** Commit liveMargins back to viewPrefs. */
  save: () => void;
  /** Discard liveMargins and exit edit mode. */
  cancel: () => void;
  /** Mouse-down handler for a side's drag guide. */
  beginDrag: (e: React.MouseEvent<HTMLElement>, side: MarginSide) => void;
}

export function useMarginEdit({ viewPrefs }: UseMarginEditOpts): UseMarginEditResult {
  const [marginEditMode, setMarginEditMode] = useState(false);
  const [liveMargins, setLiveMargins] = useState<Margins | null>(null);

  // Refs mirror the live state so the drag handler — which closes over
  // the live values once at drag-start — can read the freshest snap
  // target without re-creating itself on every state change.
  const liveRef = useRef<Margins | null>(null);
  liveRef.current = liveMargins;
  const snapshotRef = useRef<Margins | null>(null);

  const persisted: Margins = useMemo(
    () => ({
      left: viewPrefs?.prefs.editorLeftMargin ?? 88,
      right: viewPrefs?.prefs.editorRightMargin ?? 72,
      top: viewPrefs?.prefs.editorTopMargin ?? 40,
      bottom: viewPrefs?.prefs.editorBottomMargin ?? 40,
    }),
    [
      viewPrefs?.prefs.editorLeftMargin,
      viewPrefs?.prefs.editorRightMargin,
      viewPrefs?.prefs.editorTopMargin,
      viewPrefs?.prefs.editorBottomMargin,
    ],
  );
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;

  const effective: Margins =
    marginEditMode && liveMargins ? liveMargins : persisted;
  const symmetricX = effective.left === effective.right;
  const symmetricY = effective.top === effective.bottom;

  const enter = useCallback(() => {
    if (!viewPrefs) return;
    const snap: Margins = {
      left: viewPrefs.prefs.editorLeftMargin,
      right: viewPrefs.prefs.editorRightMargin,
      top: viewPrefs.prefs.editorTopMargin,
      bottom: viewPrefs.prefs.editorBottomMargin,
    };
    snapshotRef.current = snap;
    setLiveMargins(snap);
    setMarginEditMode(true);
  }, [viewPrefs]);

  const cancel = useCallback(() => {
    snapshotRef.current = null;
    setLiveMargins(null);
    setMarginEditMode(false);
  }, []);

  const save = useCallback(() => {
    if (viewPrefs && liveMargins) {
      viewPrefs.setEditorLeftMargin(liveMargins.left);
      viewPrefs.setEditorRightMargin(liveMargins.right);
      viewPrefs.setEditorTopMargin(liveMargins.top);
      viewPrefs.setEditorBottomMargin(liveMargins.bottom);
    }
    snapshotRef.current = null;
    setLiveMargins(null);
    setMarginEditMode(false);
  }, [liveMargins, viewPrefs]);

  // Escape mirrors the Cancel button.
  useEffect(() => {
    if (!marginEditMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [marginEditMode, cancel]);

  // Single 4-sided drag handler. Branches on `MARGIN_AXIS[side]` for
  // clientX/clientY math; everything else (snap target via
  // `MARGIN_OPPOSITE`, CSS-var name via `MARGIN_CSS_VAR`, clamp via
  // `MARGIN_MIN`) is a table lookup. rAF coalesces multiple mousemoves
  // per frame; we write the CSS var directly (DOM-fast) and React
  // state (closure-fresh) per tick.
  const beginDrag = useCallback(
    (e: React.MouseEvent<HTMLElement>, side: MarginSide) => {
      e.preventDefault();
      e.stopPropagation();
      const page = e.currentTarget.closest("[data-editor-page]") as HTMLElement | null;
      if (!page) return;
      const col = page.closest("[data-editor-col]") as HTMLElement | null;
      const rect = page.getBoundingClientRect();
      const axis = MARGIN_AXIS[side];
      const cursor = axis === "x" ? "ew-resize" : "ns-resize";
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = cursor;
      const cssVar = MARGIN_CSS_VAR[side];
      const SNAP_PX = 10;
      const oppositeSide = MARGIN_OPPOSITE[side];
      // Snap target captured at drag-start — matches the original L/R
      // behavior: while dragging one side, the snap target is the
      // opposite side's value at the moment the drag began.
      const oppositeVal =
        liveRef.current?.[oppositeSide] ?? persistedRef.current[oppositeSide];
      const min = MARGIN_MIN[side];
      let pendingNext: number | null = null;
      let rafId: number | null = null;
      const flush = () => {
        rafId = null;
        if (pendingNext == null) return;
        const next = pendingNext;
        col?.style.setProperty(cssVar, `${next}px`);
        setLiveMargins((prev) => (prev ? { ...prev, [side]: next } : prev));
      };
      const onMove = (mv: MouseEvent) => {
        let next: number;
        if (axis === "x") {
          next =
            side === "left"
              ? Math.max(min, Math.min(MARGIN_MAX, mv.clientX - rect.left - 1))
              : Math.max(min, Math.min(MARGIN_MAX, rect.right - mv.clientX - 1));
        } else {
          next =
            side === "top"
              ? Math.max(min, Math.min(MARGIN_MAX, mv.clientY - rect.top - 1))
              : Math.max(min, Math.min(MARGIN_MAX, rect.bottom - mv.clientY - 1));
        }
        // Symmetric snap. Guard with the drag side's min so snapping
        // toward an opposite-side value that would violate this side's
        // floor never happens (e.g., dragging left can't snap to
        // right=30 because left's floor is 72).
        if (oppositeVal >= min && Math.abs(next - oppositeVal) <= SNAP_PX) {
          next = oppositeVal;
        }
        pendingNext = next;
        if (rafId == null) rafId = requestAnimationFrame(flush);
      };
      const onUp = () => {
        document.body.style.cursor = prevCursor;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (rafId != null) {
          cancelAnimationFrame(rafId);
          flush();
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [],
  );

  return {
    marginEditMode,
    liveMargins,
    effective,
    symmetricX,
    symmetricY,
    enter,
    save,
    cancel,
    beginDrag,
  };
}
