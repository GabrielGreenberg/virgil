// @vitest-environment jsdom
//
// THE DEFECT LEG for task 470, in the silo where the damage was.
//
// Virgil's ten divider handles all run the shared pane-resize engine, and the
// rule "a completed gesture that changed NOTHING commits nothing" used to be
// hand-written at six of their `commit()`s. `LibraryView`'s three were not
// among them — and they are exactly the three whose `getValue()` returns a
// RENDERED track size (`offsetWidth` / `offsetHeight`), which the grid
// template's `clamp()` can render SMALLER than the value in the store. So one
// accidental click on the nav / list / papers divider on a narrow window wrote
// the CLAMPED size into `view-session-store` permanently: widening the window
// no longer restored the width, the stored value was gone, nothing threw, and
// the user could not tell the click had done anything. That is the exact
// invariant `library-grid-template.ts` opens by declaring — "the stored value
// is never rewritten by a mere viewport change" — and the exact gesture Gabriel
// named in task 457 ("grabbing and then dropping in the same place … should not
// change anything").
//
// WHY THIS FILE EXISTS AT ALL: no pre-470 suite could represent the defect.
// `use-pane-resize-handle.test.tsx` drives the engine against a harness whose
// getValue() and commit() are unrelated numbers, so "the committed value is a
// clamped rendering of a larger stored one" is unrepresentable there; and
// `pane-resize-adoption.test.tsx` — which states the zero-move law in its own
// header — never touches the Library silo, which is precisely why three
// unguarded handles shipped with CI green.
//
// WHAT IT PROVES, and what it does not. It drives the REAL `usePaneResizeHandle`
// against a spec built in LibraryView's exact shape (a clamped `offsetWidth`
// snapshot, a CSS-var `apply`, a bare `setLayout` `commit`, and the store-truth
// `restore`), which is where the BEHAVIOUR lives. That LibraryView really is
// wired that way — three handles, three unguarded `setLayout` commits, three
// `restore`s — is a source fact, pinned by the zero-move census in
// `src/lib/__tests__/pane-drag-guardrail.test.ts`. Mounting the whole
// LibraryView here would pull the catalog store, the FSA layer and both panels
// for no additional coverage of either half.
//
// jsdom has no pointer-capture plumbing (shimmed) and no layout engine — the
// clamp is therefore MODELLED by the harness rather than computed, which is
// honest: what is under test is the commit policy, not CSS.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type * as React from "react";

import { usePaneResizeHandle, type PaneResizeSpec } from "@/lib/pane-resize";
import { __resetLayoutGestureBusForTest } from "@/lib/pane-resize/layout-gesture-bus";
import { unmountDragShield } from "@/lib/pane-resize/drag-shield";
import { LIB_NAV_W_VAR } from "../library-grid-template";

// ── jsdom shims (same pair the engine's own suite installs) ─────────────────
const setPointerCapture = vi.fn();
const releasePointerCapture = vi.fn();
beforeAll(() => {
  Object.assign(Element.prototype, { setPointerCapture, releasePointerCapture });
});
afterAll(() => {
  delete (Element.prototype as Partial<Element>).setPointerCapture;
  delete (Element.prototype as Partial<Element>).releasePointerCapture;
});

let rafSeq = 0;
let rafCallbacks = new Map<number, FrameRequestCallback>();
const flushRaf = () => {
  const cbs = [...rafCallbacks.values()];
  rafCallbacks.clear();
  for (const cb of cbs) cb(0);
};

beforeEach(() => {
  rafCallbacks = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafCallbacks.set(rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => rafCallbacks.delete(id));
  __resetLayoutGestureBusForTest();
  unmountDragShield();
  setPointerCapture.mockClear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const pe = (type: string, init: PointerEventInit = {}) =>
  new PointerEvent(type, { pointerId: 1, bubbles: true, ...init });
const down = (
  props: { onPointerDown: (e: React.PointerEvent<HTMLElement>) => void },
  el: HTMLElement,
  clientX = 100,
) =>
  props.onPointerDown({
    button: 0,
    isPrimary: true,
    pointerId: 1,
    clientX,
    clientY: 100,
    currentTarget: el,
    preventDefault: () => undefined,
  } as unknown as React.PointerEvent<HTMLElement>);
const move = (el: HTMLElement, clientX: number) =>
  el.dispatchEvent(pe("pointermove", { buttons: 1, clientX, clientY: 100 }));
const up = (el: HTMLElement) => el.dispatchEvent(pe("pointerup", { buttons: 0 }));

// ── The narrow-window Library divider, in LibraryView's exact shape ─────────

/** What the user has stored on their wide monitor. */
const STORED_NAV_WIDTH = 320;
/** What the grid template's clamp() renders it as on a narrow window — the
 *  value `navColumnRef.current?.offsetWidth` reports, and the one the pre-470
 *  commit persisted over the stored one. */
const CLAMPED_NAV_WIDTH = 240;

function makeNavDivider() {
  const grid = document.createElement("div");
  document.body.appendChild(grid);
  const setLayout = vi.fn<(patch: { navWidth: number }) => void>();

  const spec: PaneResizeSpec = {
    id: "library-nav",
    axis: "x",
    // LibraryView reads the RESOLVED track, not the store.
    getValue: () => CLAMPED_NAV_WIDTH,
    clamp: (px) => px,
    apply: (px) => grid.style.setProperty(LIB_NAV_W_VAR, `${px}px`),
    // Bare, unguarded — the shape the census pins at the source.
    commit: (px) => setLayout({ navWidth: Math.round(px) }),
    // Re-sync from the STORE, never from the rendered snapshot.
    restore: () => grid.style.setProperty(LIB_NAV_W_VAR, `${STORED_NAV_WIDTH}px`),
  };

  const hook = renderHook(() => usePaneResizeHandle(spec));
  const el = document.createElement("div");
  document.body.appendChild(el);
  return {
    el,
    grid,
    setLayout,
    props: () => hook.result.current,
    navVar: () => grid.style.getPropertyValue(LIB_NAV_W_VAR),
  };
}

describe("Library dividers — a zero-move gesture never rewrites the stored width (task 470)", () => {
  it("a plain click on the nav divider writes NOTHING to the store", () => {
    const h = makeNavDivider();
    down(h.props(), h.el);
    up(h.el);

    // Pre-470 this was `setLayout({ navWidth: 240 })` — the clamped rendering
    // of a 320px stored width, persisted permanently by a click the user could
    // not tell had happened.
    expect(h.setLayout).not.toHaveBeenCalled();
  });

  it("…and re-syncs the imperative var from the STORE, so the track still re-expands when the window grows", () => {
    const h = makeNavDivider();
    down(h.props(), h.el);
    up(h.el);

    // The other half of the damage: pinning the clamped px into the var would
    // forfeit the template's re-expand guarantee even with the store intact,
    // because React never rewrites the style while the store value is
    // unchanged (it diffs against previous props, not the DOM).
    expect(h.navVar()).toBe(`${STORED_NAV_WIDTH}px`);
  });

  it("a drag that WANDERS AND RETURNS to the clamped start writes nothing either", () => {
    // The subtler half of the same gesture, and the one that proves the rule is
    // zero NET change rather than zero movement: the divider really moved, the
    // var really holds an imperative write, and there is still nothing to
    // persist.
    const h = makeNavDivider();
    down(h.props(), h.el);
    move(h.el, 180);
    flushRaf();
    expect(h.navVar()).toBe("320px"); // 240 + (180 − 100), an imperative write
    move(h.el, 100); // back to the start coordinate
    flushRaf();
    up(h.el);

    expect(h.setLayout).not.toHaveBeenCalled();
    expect(h.navVar()).toBe(`${STORED_NAV_WIDTH}px`);
  });

  it("a REAL drag still commits exactly once, with the value the user dragged to", () => {
    // The accepting control. Without it every leg above passes on an engine
    // that never commits at all.
    const h = makeNavDivider();
    down(h.props(), h.el);
    move(h.el, 160);
    up(h.el);

    expect(h.setLayout).toHaveBeenCalledTimes(1);
    expect(h.setLayout).toHaveBeenCalledWith({ navWidth: 300 }); // 240 + 60
    expect(h.navVar()).toBe("300px");
  });
});
