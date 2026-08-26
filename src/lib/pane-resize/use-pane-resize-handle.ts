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
//   - Escape restores the drag-start value and ends WITHOUT committing, and
//     the gesture CLAIMS that press (`claimGestureKey`): a live drag is the
//     innermost transient thing on screen, so one press ends exactly one
//     thing. Unclaimed, the same Escape also reached margin-edit's cancel
//     (discarding every unsaved margin) and the dialog stack (task 471).
//   - a captured handle REMOVED from the DOM mid-gesture (a conditionally
//     rendered handle whose branch flips while the owner stays mounted) fires
//     lostpointercapture at the DOCUMENT, not the detached element — so
//     gesture-scoped document/window failsafes route that case into the same
//     end path. Without them the element-scoped listeners could never fire
//     again and the input-blocking shield would wedge the whole app.
//   - geometry applies imperatively (CSS var / style write) RAF-coalesced
//     behind an equality bail — at most one `apply()` per frame, zero React
//     state per frame; any pending frame is flushed before commit.
//   - `commit()` runs EXACTLY once per completed gesture that CHANGED the
//     value, on the end edge. A gesture whose value never left its
//     `getValue()` snapshot — a plain click on the 6-10px gutter, or a drag
//     that wandered and came back to its exact start — has nothing to
//     persist, so the engine calls `restore()` instead and commits ZERO
//     times (task 470). That rule used to be hand-written at 7 of 10
//     consumers and absent at the 3 Library ones, where the committed value
//     is a CSS-CLAMPED rendered size: a click there wrote the clamped px
//     over the user's stored width, permanently. The engine holds both
//     halves (`startValue` and `spec.restore`), so it owns the rule.
//   - begin/end edges publish on the app-wide pane-drag bus; the end edge and
//     all chrome teardown run on EVERY end variant (finally-style).

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  beginLayoutGesture,
  endLayoutGesture,
  hasActiveLayoutGesture,
  type LayoutGestureInfo,
  type LayoutGestureKind,
} from "./layout-gesture-bus";
import { mountDragShield, unmountDragShield } from "./drag-shield";
// The start gate and the missed-release failsafe are shared with the bespoke
// gestures the engine's shape doesn't fit (the Outline FocusBand's snap-to-row
// selection) — one definition, one rationale (task 185).
import { claimGestureKey, isMissedRelease, isPrimaryDragStart } from "./pointer-invariants";

// The kinds a divider press must yield to, and the ONE place the reason is
// stated. The bus has two kinds of reader and they want opposite scopes:
//
//   FOLLOWERS (park / suppress — the geometry observers, the text-anchored
//   overlays, PaneFreeze) ask a KIND-BLIND question, because a gesture of ANY
//   kind can move content under them, so `isLayoutGestureActive()` is right
//   there.
//
//   The OWNER — this gate — asks a mutual-EXCLUSION question, and its scope is
//   exactly the kinds that contend for the singletons a second gesture would
//   clobber. Those are engine-owned and pane-only: the drag shield plus the
//   saved body cursor / user-select (`drag-shield.ts`), whose LIFETIME is a
//   singleton — a second divider drag ending first would unmount the shield
//   and restore the body styles out from under the one still in flight.
//
// A window reflow and a content drag move no divider and mount no shield, so
// refusing on them bought nothing and cost two things: a press inside the
// window publisher's 150 ms trailing-idle tail (`RESIZE_IDLE_MS`) was silently
// swallowed — grab a divider straight after dragging the OS window edge and
// the first press did nothing — and one wedged drop-mode session would have
// disabled every divider in the app until a reload (task 472).
//
// A POINT-IN-TIME read, not an edge subscription, so the bus's "kind-sensitive
// consumers use the SET channel" rule does not apply — that rule is about an
// `info.kind` filter inside an outermost-EDGE listener, which this is not.
const EXCLUSION_KINDS: readonly LayoutGestureKind[] = ["pane"];

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
   *  gesture with the final applied value — never per frame, and NEVER for a
   *  gesture whose value never left the getValue() snapshot (that end takes
   *  restore() instead; see the header). So a consumer must not re-implement
   *  a zero-move guard here — the census in `pane-drag-guardrail.test.ts`
   *  fails one that does. */
  commit(px: number): void;
  /** Escape-cancel geometry restore. Default: re-`apply()` the getValue()
   *  snapshot — correct when getValue() returns the source-of-truth value.
   *  When it returns RENDERED geometry that CSS can clamp below the stored
   *  value (an offsetWidth against a clamp() track), that default would pin
   *  the clamped px imperatively and diverge DOM from store until the next
   *  commit (React diffs style against previous props, not the DOM — it
   *  never rewrites the var while the store value is unchanged). Implement
   *  restore() to re-sync the DOM from the source of truth instead.
   *
   *  Runs on TWO end paths, both of which have nothing to persist and may
   *  have left an imperative write behind: Escape-cancel, and a completed
   *  gesture with zero net change. */
  restore?(): void;
  /** Pointer-delta sign → value sign (default 1; -1 for handles whose value
   *  grows when the pointer moves toward the axis origin). */
  direction?: 1 | -1;
  disabled?: boolean;
}

export interface PaneResizeHandleProps {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  style: React.CSSProperties;
  /** The divider's SEMANTIC surface — owned HERE, not improvised per consumer
   *  (task 189). A gutter is a pointer-only affordance today: the engine emits
   *  no `tabIndex` and no arrow-key handler, so nothing about it is reachable
   *  without a mouse. `aria-hidden` states that once, for all ten consumers,
   *  instead of four of them hand-rolling `role="separator"` + `aria-label`
   *  ("Resize My Papers pod") — a NAMED, valueless, non-operable splitter that
   *  promises an AT user an interaction the app cannot honor. Not a stub for
   *  the real pattern: making these operable means focusability + arrow-key
   *  resize + `aria-valuenow/min/max` wired from each consumer's clamp, a
   *  product decision recorded as deferred in STYLE_GUIDE "Resize gutters".
   *  Safe on every consumer because a handle's subtree is decorative — the
   *  widened hit-target children are bare divs, and no gutter contains a
   *  focusable node (SplitWithCode's sync-arrow buttons are SIBLINGS of the
   *  handle, deliberately outside it so a click there never starts a drag). */
  "aria-hidden": true;
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
 *
 * The engine owns the gesture, the `.dragging` chrome HOOK, and (since task
 * 189) the handle's a11y semantics — see `PaneResizeHandleProps["aria-hidden"]`.
 * It does NOT own the divider's LOOK: put `drag-gap drag-gap-{h,v} band-grip`
 * on the element yourself (STYLE_GUIDE "Resize gutters"). A consumer that
 * genuinely isn't a pane gutter and wears different chrome must say so on
 * `PERMITTED_UNCHROMED_RESIZERS` in `pane-drag-guardrail.test.ts` (keyed per
 * handle, not per file) — and still take its colors from the gutter family
 * (`--drag-highlight` on hover, an escalated drag state under `.dragging`), so
 * a divider can never paint a one-off accent.
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
    // One PANE gesture app-wide at a time. The scope is `["pane"]` on
    // purpose — see EXCLUSION_KINDS.
    if (hasActiveLayoutGesture(EXCLUSION_KINDS)) return;
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

    const info: LayoutGestureInfo = { kind: "pane", id, axis };
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
          if (lastApplied === startValue) {
            // Zero NET change — nothing to persist. Committing here is what
            // wrote a CSS-clamped rendered size over a user's stored one on
            // a plain click (task 470), and what seven consumers each
            // hand-wrote the identical four-line guard against.
            //
            // restore(), not apply(startValue): a wander-and-return has
            // already OVERWRITTEN the style with the snapshot px, which may
            // be a clamped rendering of a larger stored value, and mid-drag
            // React may have rendered a different flex string than the
            // resting one — only the consumer can re-sync from the source of
            // truth. Unconditional (not gated on "did an apply run") for the
            // same reason the cancel path is: the consumers that take this
            // branch today already run restore() on every zero-move click,
            // so this is byte-identical to their private guards.
            specRef.current.restore?.();
          } else {
            specRef.current.commit(lastApplied);
          }
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
        endLayoutGesture(info);
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
    //
    // …and the gesture CLAIMS the press (task 471). Capture-phase-first is
    // only half of "the innermost thing answers the key": without the claim
    // the same press kept travelling to every other Escape owner, so
    // cancelling a gutter drag while margin-edit mode was on also discarded
    // every unsaved margin the user had dragged. The claim is the shared
    // invariant, not a local preventDefault pair — its docblock carries the
    // full rationale and the stated limit.
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      claimGestureKey(ev);
      finish("cancel");
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
    beginLayoutGesture(info);
  }, []);

  return useMemo<PaneResizeHandleProps>(
    () => ({
      onPointerDown,
      style: HANDLE_STYLE,
      "aria-hidden": true as const,
      "data-pane-resize-id": spec.id,
      "data-pane-resize-axis": spec.axis,
    }),
    [onPointerDown, spec.id, spec.axis],
  );
}
