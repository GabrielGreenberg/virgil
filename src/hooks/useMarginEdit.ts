import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";

import type { ViewPrefs } from "./useViewPrefs";

/**
 * Margin-edit state machine for the editor pod's reading viewport.
 *
 * ── ReadingMargins: the axes model ─────────────────────────────────
 * Pod margins live as TWO axes (X = left/right, Y = top/bottom), each
 * either `symmetric` (a single value applied to both sides) or
 * `asymmetric` (two independent side values). This replaces the older
 * "four loose scalars + derived symmetricX/Y" model so symmetry is
 * sticky by construction:
 *
 *   - A symmetric axis stays symmetric across drags — moving one side
 *     moves the other in lockstep.
 *   - An asymmetric axis lets each side move on its own, BUT the
 *     opposite-side value acts as a snap target (8px sticky zone).
 *     Releasing the drag inside the snap promotes the axis to
 *     symmetric.
 *
 * ── CSS-var contract: the "ReadingViewport" ────────────────────────
 * The four pixel-valued vars `--editor-pl/pr/pt/pb` plus two
 * binary-valued vars `--editor-sym-x/y` (1 when symmetric, 0 when
 * asymmetric) constitute the rendering interface, set declaratively
 * on `[data-editor-col]`. Prose padding, masks, sensors, and the
 * margin-edit guide overlay all consume them. There is no parallel
 * TS object: the CSS-var contract IS the viewport.
 *
 * ── Persistence ─────────────────────────────────────────────────────
 * The four scalar prefs (`editor{Left,Right,Top,Bottom}Margin`) stay
 * on disk for zero-migration safety. The axes model is reconstructed
 * on read (`symmetric` iff l === r / t === b) and re-flattened to
 * four scalars on save. Reader's hardcoded 88/72/40/40 fallbacks are
 * unaffected.
 *
 * ── Keystroke sanctity ──────────────────────────────────────────────
 * This hook adds zero per-keystroke work. The Escape listener is
 * gated on `marginEditMode`. The drag handler is attached on
 * mousedown, detached on mouseup. The rAF flush writes ONLY to CSS
 * vars (no React state per frame), so the editor's 5000-line
 * subtree never re-renders during a drag — the single React state
 * update is on commit or cancel.
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

// Symmetry CSS vars. 1 when the axis is symmetric (sides equal), 0
// when asymmetric. The guide overlay reads these as opacity for the
// per-axis symmetry markers — always rendered, faded in/out by CSS,
// so the marker reacts at DOM speed during drag without any React
// re-render.
export const MARGIN_SYM_CSS_VAR: Record<"x" | "y", string> = {
  x: "--editor-sym-x",
  y: "--editor-sym-y",
};

// ── ReadingMargins types ──────────────────────────────────────────

export type AxisX =
  | { kind: "symmetric"; value: number }
  | { kind: "asymmetric"; left: number; right: number };

export type AxisY =
  | { kind: "symmetric"; value: number }
  | { kind: "asymmetric"; top: number; bottom: number };

export interface ReadingMargins {
  axisX: AxisX;
  axisY: AxisY;
}

/**
 * Derive the axes model from the persisted four scalars. An axis is
 * symmetric iff both sides on it carry the same value.
 */
export function marginsFromScalars(
  left: number,
  right: number,
  top: number,
  bottom: number,
): ReadingMargins {
  return {
    axisX:
      left === right
        ? { kind: "symmetric", value: left }
        : { kind: "asymmetric", left, right },
    axisY:
      top === bottom
        ? { kind: "symmetric", value: top }
        : { kind: "asymmetric", top, bottom },
  };
}

/**
 * Flatten the axes model back to the four scalar shape for
 * persistence and for consumers (e.g., EditorPane.tsx) that still
 * read pixel values per side.
 */
export function scalarsFromMargins(m: ReadingMargins): Margins {
  const left = m.axisX.kind === "symmetric" ? m.axisX.value : m.axisX.left;
  const right = m.axisX.kind === "symmetric" ? m.axisX.value : m.axisX.right;
  const top = m.axisY.kind === "symmetric" ? m.axisY.value : m.axisY.top;
  const bottom = m.axisY.kind === "symmetric" ? m.axisY.value : m.axisY.bottom;
  return { left, right, top, bottom };
}

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
  /** Live axes model — exposed in case a consumer wants to render
   *  axis-aware UI affordances (the editing chip, e.g.). */
  margins: ReadingMargins;
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

// 8px sticky zone for the snap-to-symmetric pull (the drag has to
// move 8px past the opposite-side value before the snap breaks).
const SNAP_PX = 8;

export function useMarginEdit({ viewPrefs }: UseMarginEditOpts): UseMarginEditResult {
  const [marginEditMode, setMarginEditMode] = useState(false);
  // Single React state slot for live values. Updated ONCE per
  // gesture (at enter/save/cancel and at mouseup), never per rAF.
  const [liveMargins, setLiveMargins] = useState<Margins | null>(null);

  // `committedRef` mirrors the React `liveMargins` state — written
  // ONLY here, on every render. The drag handler reads it once at
  // drag-start for its starting values, and `save()` would never use
  // it (it reads the committed React state directly). Crucially, the
  // drag's per-frame writes go to a drag-LOCAL snapshot, NOT this
  // ref, so an unrelated EditorPane re-render mid-drag (autosave,
  // activity bumper, etc.) can't clobber the in-flight drag value.
  const committedRef = useRef<Margins | null>(null);
  committedRef.current = liveMargins;
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
  const margins: ReadingMargins = useMemo(
    () => marginsFromScalars(effective.left, effective.right, effective.top, effective.bottom),
    [effective.left, effective.right, effective.top, effective.bottom],
  );
  const symmetricX = margins.axisX.kind === "symmetric";
  const symmetricY = margins.axisY.kind === "symmetric";

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
    // Read the committed React state. By the time the user clicks
    // Save, any drag has ended and `onUp` has committed the final
    // value into `liveMargins`, so this is always the freshest
    // value — no ref needed, no race with mid-drag re-renders.
    const m = liveMargins ?? snapshotRef.current;
    if (viewPrefs && m) {
      viewPrefs.setEditorLeftMargin(m.left);
      viewPrefs.setEditorRightMargin(m.right);
      viewPrefs.setEditorTopMargin(m.top);
      viewPrefs.setEditorBottomMargin(m.bottom);
    }
    snapshotRef.current = null;
    setLiveMargins(null);
    setMarginEditMode(false);
  }, [viewPrefs, liveMargins]);

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

  // Single 4-sided drag handler.
  //
  // Branches on `MARGIN_AXIS[side]` for clientX/clientY math; the
  // rest (snap target via `MARGIN_OPPOSITE`, CSS-var name via
  // `MARGIN_CSS_VAR`, clamp via `MARGIN_MIN`) is a table lookup.
  // rAF coalesces multiple mousemoves per frame. Per tick we write
  // ONLY to the column's CSS vars — including the symmetry flag —
  // and mutate the drag-LOCAL `working` snapshot. React state stays
  // put until mouseup commits in a single update, so the editor's
  // 5000-line subtree never re-renders during the drag.
  //
  // Drag behavior: every drag moves ONE side at a time. The
  // opposite-side value acts as a sticky snap target — when the
  // dragged value lands within ±SNAP_PX it locks onto the opposite
  // value (until the cursor exits the snap zone). Releasing in-snap
  // leaves the axis with L === R / T === B, so the symmetry flag
  // stays on for the next render. The axes model derives symmetric
  // vs asymmetric from value equality each render — there's no
  // separate "locked symmetric" mode that would require a modifier
  // key to break.
  const beginDrag = useCallback(
    (e: React.MouseEvent<HTMLElement>, side: MarginSide) => {
      e.preventDefault();
      e.stopPropagation();
      // Measure the drag against the GUIDE OVERLAY (`data-margin-frame`),
      // not the page. The page (`data-editor-page`) is full-document
      // height, so its top/bottom diverge from the viewport-sticky
      // overlay the moment the doc is scrolled — which made the Y-axis
      // (top/bottom) drag add the scroll offset and instantly clamp to
      // MARGIN_MAX. The overlay spans the page width (so left/right math
      // is unchanged: frame.left/right === page.left/right) AND the
      // visible viewport height (so frame.top/bottom are the sticky
      // viewport edges the guide lines actually sit against). Using it
      // for all four sides makes every guide track the cursor 1:1 at
      // any scroll position.
      const frame = e.currentTarget.closest("[data-margin-frame]") as HTMLElement | null;
      if (!frame) return;
      const col = frame.closest("[data-editor-col]") as HTMLElement | null;
      const rect = frame.getBoundingClientRect();
      const axis = MARGIN_AXIS[side];
      const cursor = axis === "x" ? "ew-resize" : "ns-resize";
      const prevCursor = document.body.style.cursor;
      document.body.style.cursor = cursor;

      const startMargins =
        committedRef.current ?? { ...persistedRef.current };
      const oppositeSide = MARGIN_OPPOSITE[side];

      const min = MARGIN_MIN[side];
      const cssVar = MARGIN_CSS_VAR[side];
      const symCssVar = MARGIN_SYM_CSS_VAR[axis];

      // Working snapshot the rAF flush mutates. Initialized from
      // start values; the rAF writes successive values back to the
      // column.
      const working: Margins = { ...startMargins };

      let pendingNext: number | null = null;
      let rafId: number | null = null;

      const flush = () => {
        rafId = null;
        if (pendingNext == null) return;
        let next = pendingNext;
        // Snap target — the opposite-side value AS IT STANDS RIGHT
        // NOW in the working snapshot, not as captured at drag
        // start. This fixes the subtle bug where dragging L then R
        // wouldn't let R snap to L's new value.
        const oppositeVal = working[oppositeSide];
        next = Math.max(min, Math.min(MARGIN_MAX, next));
        if (oppositeVal >= min && Math.abs(next - oppositeVal) <= SNAP_PX) {
          next = oppositeVal;
        }
        working[side] = next;
        col?.style.setProperty(cssVar, `${next}px`);
        // Update the symmetry flag based on whether the snap is
        // currently engaged. This drives the symmetry marker's
        // opacity at DOM speed.
        col?.style.setProperty(
          symCssVar,
          working[side] === working[oppositeSide] ? "1" : "0",
        );
        // NOTE: we deliberately do NOT write `working` back into
        // `committedRef` here. That ref mirrors React state and is
        // overwritten on every render; writing the in-flight value
        // there would race with unrelated re-renders. `working` is
        // the sole owner of the live drag value and is committed to
        // React in `onUp`.
      };

      const onMove = (mv: MouseEvent) => {
        let raw: number;
        if (axis === "x") {
          raw =
            side === "left"
              ? mv.clientX - rect.left - 1
              : rect.right - mv.clientX - 1;
        } else {
          raw =
            side === "top"
              ? mv.clientY - rect.top - 1
              : rect.bottom - mv.clientY - 1;
        }
        pendingNext = raw;
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
        // Single React state update for the whole gesture, from the
        // drag-local `working` snapshot (the sole owner of the live
        // value). This re-renders EditorPane ONCE, reconciling the
        // dragged values back into the React tree so `save()` and
        // subsequent renders see them.
        setLiveMargins({ ...working });
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
    margins,
    symmetricX,
    symmetricY,
    enter,
    save,
    cancel,
    beginDrag,
  };
}
