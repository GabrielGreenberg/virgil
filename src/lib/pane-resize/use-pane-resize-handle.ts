"use client";

// The pane-resize gesture engine — the ONE divider implementation every
// resizable gutter in the app uses (plan MEMO_LIBRARY_UI_REFACTOR_2026_07_11
// P1). It OWNS the pointer instead of watching it:
//
//   - `setPointerCapture` on the handle; move/up/cancel/lostpointercapture
//     listeners live ON THE CAPTURED ELEMENT, not window — capture retargets
//     the whole stream to the handle regardless of what the pointer is over,
//     killing the iframe-swallow / ghost-resume / wedged-flag class. Capture
//     is load-bearing: if it doesn't take, the gesture is REFUSED (see the
//     pointerdown body) rather than started without its event guarantee.
//   - starts only on primary-button (`e.button === 0`) primary pointers.
//   - a mid-move with the PRIMARY button up (`(e.buttons & 1) === 0`) is a
//     missed release: end THERE, before incorporating that event's
//     coordinate (no ghost movement). The bit test — not `buttons === 0` —
//     because releasing the drag button while another is chorded fires only
//     a pointermove with an updated mask, never a pointerup.
//   - Escape restores the drag-start value and ends WITHOUT committing.
//   - a captured handle REMOVED from the DOM mid-gesture (a conditionally
//     rendered handle whose branch flips while the owner stays mounted) fires
//     lostpointercapture at the DOCUMENT, not the detached element — so
//     gesture-scoped document/window failsafes route that case into the same
//     end path. Without them the element-scoped listeners could never fire
//     again and the input-blocking shield would wedge the whole app.
//   - geometry applies imperatively (CSS var / style write) RAF-coalesced
//     behind an equality bail — at most one `apply()` per frame, zero React
//     state per frame; any pending frame is flushed before commit.
//   - `commit()` runs EXACTLY once per completed gesture, on the end edge.
//   - begin/end edges publish on the app-wide pane-drag bus; the end edge and
//     all chrome teardown run on EVERY end variant (finally-style).

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  beginPaneDrag,
  endPaneDrag,
  isPaneDragging,
  type PaneDragInfo,
} from "./pane-drag-bus";
import { mountDragShield, unmountDragShield } from "./drag-shield";
// The start gate and the missed-release failsafe are shared with the bespoke
// gestures the engine's shape doesn't fit (the Outline FocusBand's snap-to-row
// selection) — one definition, one rationale (task 185).
import { isMissedRelease, isPrimaryDragStart } from "./pointer-invariants";

export interface PaneResizeSpec {
  /** Stable, unique gesture id — carried on the bus info + probe data attrs. */
  id: string;
  axis: "x" | "y";
  /** Current value in px. Called EXACTLY once per gesture, on the start
   *  edge — the safe place for per-gesture snapshots (consumers park clamp
   *  bounds / start-width records here; unit-pinned). */
  getValue(): number;
  /** UX clamp for the pointer math only — HARD constraints belong in the CSS
   *  grid template (`minmax()`/`clamp()`), so layout owns them (R8). */
  clamp?(px: number): number;
  /** Imperative geometry write (CSS var / style). RAF-coalesced, equality-
   *  bailed — never call React state from here. */
  apply(px: number): void;
  /** Persistence (store/localStorage). Called exactly once per completed
   *  gesture with the final applied value — never per frame. */
  commit(px: number): void;
  /** Escape-cancel geometry restore. Default: re-`apply()` the getValue()
   *  snapshot — correct when getValue() returns the source-of-truth value.
   *  When it returns RENDERED geometry that CSS can clamp below the stored
   *  value (an offsetWidth against a clamp() track), that default would pin
   *  the clamped px imperatively and diverge DOM from store until the next
   *  commit (React diffs style against previous props, not the DOM — it
   *  never rewrites the var while the store value is unchanged). Implement
   *  restore() to re-sync the DOM from the source of truth instead. */
  restore?(): void;
  /** Pointer-delta sign → value sign (default 1; -1 for handles whose value
   *  grows when the pointer moves toward the axis origin). */
  direction?: 1 | -1;
  disabled?: boolean;
}

export interface PaneResizeHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  style: React.CSSProperties;
  "data-pane-resize-id": string;
  "data-pane-resize-axis": "x" | "y";
}

// One shared style object: the handle must own its touch gesture outright
// (no browser pan/zoom stealing the pointer mid-drag → pointercancel).
const HANDLE_STYLE: React.CSSProperties = { touchAction: "none" };

type EndMode =
  // pointerup / pointercancel / lostpointercapture / buttons===0 failsafe —
  // flush the pending frame, then commit the final value.
  | "commit"
  // Escape — restore the drag-start value, no commit.
  | "cancel"
  // owner unmounted mid-gesture — no commit, no restore (the pane keeps the
  // last applied geometry); exists so the bus/shield can never wedge.
  | "detach";

/**
 * Gesture engine hook. Spread the returned props onto the handle element
 * (`<div {...handleProps} className="drag-gap drag-gap-v band-grip" />`); the
 * engine toggles a `.dragging` class on it for the grip chrome.
 */
export function usePaneResizeHandle(spec: PaneResizeSpec): PaneResizeHandleProps {
  // Latest spec by ref so the pointerdown closure never goes stale while the
  // returned handler identity stays stable across renders.
  const specRef = useRef(spec);
  specRef.current = spec;

  // The active gesture's finish fn, so unmount can end it (detach). Null when
  // no gesture is in flight.
  const finishRef = useRef<((mode: EndMode) => void) | null>(null);
  useEffect(
    () => () => {
      finishRef.current?.("detach");
    },
    [],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const { id, axis, direction = 1, disabled } = specRef.current;
    if (disabled) return;
    // Primary button, primary pointer only — a right-click must not start a
    // gesture whose end edge the context menu then eats.
    if (!isPrimaryDragStart(e)) return;
    // One pane gesture app-wide at a time.
    if (isPaneDragging()) return;
    const el = e.currentTarget;
    if (!el) return;

    const pointerId = e.pointerId;
    // Own the gesture BEFORE building it: capture is THE event-stream
    // guarantee — the captured handle receives every pointer event no matter
    // what's under the cursor, which is what lets the full-viewport shield
    // block app input without also eating the gesture's own stream. If
    // capture doesn't take (detached/inactive pointer edge), REFUSE the
    // gesture outright: proceeding would mount an input-blocking shield that
    // hit-tests every subsequent event to ITSELF, so the element-scoped
    // listeners (and the buttons failsafe that rides them) could never fire
    // — the wedged-gesture class this engine exists to kill. Nothing is
    // attached yet, so there is nothing to tear down.
    try {
      el.setPointerCapture(pointerId);
    } catch {
      return;
    }
    e.preventDefault();

    const info: PaneDragInfo = { id, axis };
    const startCoord = axis === "x" ? e.clientX : e.clientY;
    const startValue = specRef.current.getValue();

    // Drag-local state — never React state (keystroke-sanctity discipline
    // applied to pointer frames).
    let lastApplied = startValue; // the layout already shows startValue
    let pending: number | null = null;
    let rafId: number | null = null;
    let ended = false;

    const applyPending = () => {
      if (pending !== null && pending !== lastApplied) {
        lastApplied = pending;
        specRef.current.apply(pending);
      }
      pending = null;
    };

    const cancelPending = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pending = null;
    };

    const scheduleApply = (px: number) => {
      pending = px;
      if (rafId !== null) return; // one frame max already queued
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (ended) return;
        applyPending();
      });
    };

    const finish = (mode: EndMode) => {
      if (ended) return; // pointerup auto-releases capture → a trailing
      ended = true; //        lostpointercapture must not double-end
      try {
        if (mode === "commit") {
          // Flush the pending frame first so apply() and commit() agree on
          // the final value.
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          applyPending();
          specRef.current.commit(lastApplied);
        } else if (mode === "cancel") {
          cancelPending();
          const restore = specRef.current.restore;
          // restore() runs unconditionally (not equality-bailed): a drag
          // that wandered and returned to exactly startValue has still
          // OVERWRITTEN the style with the snapshot px, which may be a
          // CSS-clamped rendering of a larger stored value — only the
          // consumer can re-sync from the source of truth.
          if (restore) restore();
          else if (lastApplied !== startValue) specRef.current.apply(startValue);
        } else {
          cancelPending();
        }
      } finally {
        // Chrome + bus teardown runs on EVERY end variant.
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onEnd);
        el.removeEventListener("pointercancel", onEnd);
        el.removeEventListener("lostpointercapture", onEnd);
        document.removeEventListener("lostpointercapture", onEnd, true);
        window.removeEventListener("pointerup", onEnd, true);
        window.removeEventListener("pointercancel", onEnd, true);
        window.removeEventListener("keydown", onKeyDown, true);
        try {
          el.releasePointerCapture(pointerId);
        } catch {
          // already released (pointerup) or capture never took (jsdom)
        }
        el.classList.remove("dragging");
        unmountDragShield();
        finishRef.current = null;
        endPaneDrag(info);
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // Missed-release failsafe: the PRIMARY button is up, so this movement
      // happened AFTER a release we never saw — end with the last live value
      // and do NOT incorporate this event's coordinate (that would be ghost
      // drag). Bit-test rationale lives with the predicate.
      if (isMissedRelease(ev)) {
        finish("commit");
        return;
      }
      const coord = axis === "x" ? ev.clientX : ev.clientY;
      const raw = startValue + direction * (coord - startCoord);
      const next = specRef.current.clamp?.(raw) ?? raw;
      scheduleApply(next);
    };

    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      finish("commit");
    };

    // Keyboard is the one stream capture can't retarget to the (unfocused,
    // non-focusable) handle, so Escape is observed window-level — attached on
    // the start edge, removed on every end path, never per-frame. Capture
    // phase so an open popup's own Escape handling can't shadow the drag.
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish("cancel");
    };

    // Capture already succeeded above — attach the element-scoped listeners
    // the captured stream retargets to.
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
    el.addEventListener("lostpointercapture", onEnd);
    window.addEventListener("keydown", onKeyDown, true);
    // The one hole element-scoped listeners can't cover: the captured handle
    // being REMOVED from the DOM mid-gesture (a conditionally rendered handle
    // — SplitWithCode's `{open && …}` branch — flipping while the owner stays
    // mounted; the unmount detach failsafe only covers OWNER unmount). Per
    // Pointer Events implicit release, removal fires lostpointercapture at
    // the DOCUMENT, not the detached element, and every later pointer event
    // hit-tests to the shield — which has no listeners — so no element-scoped
    // end path could ever run and the input-blocking shield would wedge ALL
    // app input until Escape. These failsafes route that case into the same
    // idempotent finish(); pointerId-gated, attached on the start edge and
    // removed on every end path (the Escape-keydown lifecycle — gesture-
    // scoped, never per-frame). Capture phase so no mid-tree handler can
    // stop them; on a healthy end they lose the race to `ended` harmlessly.
    document.addEventListener("lostpointercapture", onEnd, true);
    window.addEventListener("pointerup", onEnd, true);
    window.addEventListener("pointercancel", onEnd, true);
    el.classList.add("dragging");
    mountDragShield(axis === "x" ? "col-resize" : "row-resize");
    finishRef.current = finish;
    beginPaneDrag(info);
  }, []);

  return useMemo<PaneResizeHandleProps>(
    () => ({
      onPointerDown,
      style: HANDLE_STYLE,
      "data-pane-resize-id": spec.id,
      "data-pane-resize-axis": spec.axis,
    }),
    [onPointerDown, spec.id, spec.axis],
  );
}
