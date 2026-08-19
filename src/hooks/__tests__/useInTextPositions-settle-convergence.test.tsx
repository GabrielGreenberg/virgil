// @vitest-environment jsdom
//
// Task 370 — the in-text card lane settles by CONVERGENCE, not by a proxy.
//
// THE DEFECT. The cold-start healer was a rAF loop that stopped the first frame
// the editor's `scrollHeight` was unchanged from the prior frame
// (`SETTLE_STABLE_FRAMES = 1`), or after a 30-frame cap. `scrollHeight` is a
// TOTAL, and inner layout moves inside an unchanged total routinely — a KaTeX
// span sizing, an expex example reflowing, a figure NodeView that reserves its
// final box on mount and lays its contents out over the next several frames.
// So on a card-dense page the loop declared victory while the geometry it was
// measuring was still moving, and after it stopped NOTHING re-measured until
// the user scrolled. Gabriel (2026-08-18, two screenshots): the lane renders
// every card packed contiguously from the top at minimum spacing, then SNAPS
// into place on the first scroll.
//
// WHY NO EXISTING SUITE COULD SEE IT. Every pre-370 suite drives the hook with
// a `pass()` helper that dispatches a window resize (or a scroll) and then
// asserts — i.e. each one supplies by hand exactly the external trigger whose
// ABSENCE is the defect. The scenario below dispatches NO scroll and NO resize:
// the only thing allowed to correct the deck is the hook's own settle.
//
// THE FIXTURE. Geometry ramps from compressed to real over SETTLE_MS while
// `scrollHeight` stays CONSTANT throughout — the "inner layout moving within an
// unchanged total" shape above, which is what makes the retired criterion
// terminate on frame 1. Measured by neutering: with the pre-370 loop restored
// the deck stays at the compressed tops forever.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { Editor } from "@tiptap/core";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  useInTextPositions,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import { KeepAliveVisibilityProvider } from "@/lib/keep-alive/visibility-context";
import { REPOSITION_EPSILON_PX } from "@/lib/reposition-policy";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

function mountDoc(paragraphs: number): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: Array.from({ length: paragraphs }, (_, i) => ({
        type: "paragraph",
        attrs: { uuid: `P${i}` },
        content: [{ type: "text", text: `Paragraph number ${i}.` }],
      })),
    },
  });
}

function makeRect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 800,
    width: 800,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

const VIEW_TOP = 0;
const VIEW_BOTTOM = 800;
function mountRowScroll(): HTMLElement {
  Object.defineProperty(window, "innerHeight", {
    value: VIEW_BOTTOM,
    configurable: true,
  });
  const el = document.createElement("div");
  el.setAttribute("data-virgil-row-scroll", "");
  el.getBoundingClientRect = () => makeRect(VIEW_TOP, VIEW_BOTTOM);
  Object.defineProperty(el, "offsetParent", { value: document.body });
  document.body.appendChild(el);
  return el;
}

/** Real card heights, spaced far enough apart in the document that the cascade
 *  never has to push one off its natural top — so a committed position IS its
 *  natural, and an assertion about position is an assertion about the measure. */
const REAL_HEIGHTS: Record<string, number> = { c0: 81, c1: 95, c2: 127 };

/** Linear geometry: `top = pos * scale`. COLD is the un-laid-out read (every
 *  anchor crammed near the top); REAL is the settled one. */
const COLD_SCALE = 0.3;
const REAL_SCALE = 3;
/** How long the (synthetic) async layout settle takes. Longer than one frame
 *  and shorter than the convergence budget — a web-font swap plus the NodeView
 *  mounts it triggers. */
const SETTLE_MS = 180;

type HookOut = ReturnType<typeof useInTextPositions>;

function Harness({
  editor,
  items,
  sinkRef,
  installPod,
}: {
  editor: Editor;
  items: PositionItem[];
  sinkRef: { current: HookOut | null };
  installPod: (el: HTMLDivElement) => void;
}) {
  const out = useInTextPositions(editor, items, true, "data-omni-entry-wrapper");
  React.useLayoutEffect(() => {
    sinkRef.current = out;
  });
  return React.createElement(
    "div",
    { ref: out.panelScrollRef },
    React.createElement("span", {
      key: "__pod-geometry__",
      ref: (el: HTMLSpanElement | null) => {
        if (el?.parentElement) installPod(el.parentElement as HTMLDivElement);
      },
    }),
    items.map((it) =>
      React.createElement(
        "div",
        {
          key: it.id,
          "data-omni-entry-wrapper": it.id,
          ref: (el: HTMLElement | null) => {
            if (!el) return;
            const h = REAL_HEIGHTS[it.id] ?? 60;
            el.getBoundingClientRect = () => makeRect(0, h);
          },
        },
        `card ${it.id}`,
      ),
    ),
  );
}

/** jsdom ships no ResizeObserver, and without one the hook's per-card observer
 *  effect returns before binding its `focusout` listener — which is the real
 *  trigger the storm leg below drives. A no-op stub is honest here: nothing in
 *  this file tests RO delivery, it just needs the effect to run its body. */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
beforeAll(() => {
  (globalThis as Record<string, unknown>).ResizeObserver = NoopResizeObserver;
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).ResizeObserver;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/**
 * @param scaleAt maps elapsed-ms → the geometry scale in force at that moment.
 *   This is the ONLY thing that moves; `scrollHeight` is pinned to the settled
 *   content height from the first frame, which is what makes the retired
 *   scrollHeight criterion fire immediately.
 */
function setupScenario(scaleAt: (elapsedMs: number) => number) {
  vi.useFakeTimers();
  mountRowScroll();
  const editor = mountDoc(400);
  const docSize = editor.state.doc.content.size;
  const t0 = performance.now();
  const scale = () => scaleAt(performance.now() - t0);

  // CONSTANT: the box is the settled size from frame 1; only the line
  // positions inside it move.
  const CONTENT_H = docSize * REAL_SCALE;
  const editorDom = editor.view.dom as HTMLElement;
  editorDom.getBoundingClientRect = () => makeRect(0, CONTENT_H);
  Object.defineProperty(editorDom, "scrollHeight", {
    get: () => CONTENT_H,
    configurable: true,
  });

  const coordsSpy = vi
    .spyOn(editor.view, "coordsAtPos")
    .mockImplementation((pos: number) => {
      const top = pos * scale();
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
  vi.spyOn(editor.view, "posAtCoords").mockImplementation(
    ({ top }: { left: number; top: number }) => ({
      pos: Math.round(Math.max(0, Math.min(docSize, top / scale()))),
      inside: -1,
    }),
  );

  const items: PositionItem[] = [
    { id: "c0", pos: 30 },
    { id: "c1", pos: 150 },
    { id: "c2", pos: 260 },
  ];

  const sinkRef: { current: HookOut | null } = { current: null };
  const view = render(
    <KeepAliveVisibilityProvider isVisible={true}>
      <Harness
        editor={editor}
        items={items}
        sinkRef={sinkRef}
        installPod={(el) => {
          el.getBoundingClientRect = () => makeRect(0, 200);
        }}
      />
    </KeepAliveVisibilityProvider>,
  );

  return {
    editor,
    items,
    sinkRef,
    coordsSpy,
    tops: () =>
      items.map((it) => sinkRef.current?.positions.get(it.id) ?? null),
    /** Let wall-clock + rAF time pass. Dispatches NOTHING — no scroll, no
     *  resize, no transaction. Only the hook's own settle may act. */
    async idle(ms: number) {
      await act(async () => {
        vi.advanceTimersByTime(ms);
      });
    },
    unmount: () => {
      view.unmount();
      editor.destroy();
    },
  };
}

const EXPECTED_SETTLED = [30, 150, 260].map((p) => p * REAL_SCALE); // 90 / 450 / 780

describe("useInTextPositions — settle by convergence (task 370)", () => {
  it("converges to exact positions with NO scroll and NO resize event", async () => {
    // Ramp COLD → REAL over SETTLE_MS. `scrollHeight` never moves, so the
    // retired criterion ("one frame of unchanged scrollHeight") is satisfied on
    // the very first settle frame and the pre-370 loop stops there.
    const s = setupScenario((ms) => {
      const p = Math.min(1, ms / SETTLE_MS);
      return COLD_SCALE + (REAL_SCALE - COLD_SCALE) * p;
    });

    // The first commit races layout, exactly as production does: the degeneracy
    // guard prefers a wrong deck to a blank column, so the lane starts packed.
    const cold = s.tops();
    expect(cold.every((t) => t !== null)).toBe(true);
    expect(cold[2]!).toBeLessThan(300); // c2 belongs at 780, not ~193

    // Nothing but time.
    await s.idle(1500);

    const settled = s.tops();
    settled.forEach((top, i) => {
      expect(top).not.toBeNull();
      expect(Math.abs(top! - EXPECTED_SETTLED[i])).toBeLessThanOrEqual(
        REPOSITION_EPSILON_PX,
      );
    });
    s.unmount();
  });

  it("a pane that mounted with an EMPTY deck still settles when re-shown", async () => {
    // The second reachable symptom of the same criterion (confirmed at source
    // by a read-only sweep of the keep-alive host during this task): a paper
    // opens, the editor is ready but the sidecar cards have NOT arrived, so the
    // first measure returns with `naturalRef` empty. The user tabs to the
    // Library; the cards arrive WHILE HIDDEN (the companion one-shot is gated
    // on `canMeasureNow`, so it is skipped); the user tabs back.
    //
    // Pre-370 nothing measured, ever: the settle loop had already died on its
    // first hidden frame (`if (!canMeasureNow()) return;` with no reschedule),
    // the wiring effect does not re-run on a visibility flip, and the re-show
    // effect returned early on an empty cache — "cold mount, the wiring effect
    // handles it" — handing off to an effect that cannot run. The deck stayed
    // blank until some unrelated trigger happened by.
    //
    // This is why the COLD branch of the re-show effect arms convergence, and
    // why a hidden pass reports `inert` (park) rather than spinning the budget.
    vi.useFakeTimers();
    mountRowScroll();
    const editor = mountDoc(400);
    const docSize = editor.state.doc.content.size;
    const CONTENT_H = docSize * REAL_SCALE;
    const editorDom = editor.view.dom as HTMLElement;
    editorDom.getBoundingClientRect = () => makeRect(0, CONTENT_H);
    Object.defineProperty(editorDom, "scrollHeight", {
      get: () => CONTENT_H,
      configurable: true,
    });
    vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => {
      const top = pos * REAL_SCALE;
      return { top, bottom: top + 20, left: 0, right: 0 };
    });
    vi.spyOn(editor.view, "posAtCoords").mockImplementation(
      ({ top }: { left: number; top: number }) => ({
        pos: Math.round(Math.max(0, Math.min(docSize, top / REAL_SCALE))),
        inside: -1,
      }),
    );

    const late: PositionItem[] = [
      { id: "c0", pos: 30 },
      { id: "c1", pos: 150 },
      { id: "c2", pos: 260 },
    ];
    const sinkRef: { current: HookOut | null } = { current: null };
    let items: PositionItem[] = [];
    let visible = true;
    const Tree = () => (
      <KeepAliveVisibilityProvider isVisible={visible}>
        <Harness
          editor={editor}
          items={items}
          sinkRef={sinkRef}
          installPod={(el) => {
            el.getBoundingClientRect = () => makeRect(0, 200);
          }}
        />
      </KeepAliveVisibilityProvider>
    );
    const r = render(<Tree />);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(sinkRef.current?.positions.size ?? 0).toBe(0); // nothing to measure yet

    await act(async () => {
      visible = false;
      r.rerender(<Tree />);
    });
    await act(async () => {
      items = late; // sidecar cards land while the pane is hidden
      r.rerender(<Tree />);
      vi.advanceTimersByTime(400);
    });
    expect(sinkRef.current?.positions.size ?? 0).toBe(0); // still nothing (hidden)

    await act(async () => {
      visible = true;
      r.rerender(<Tree />);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    const tops = late.map((it) => sinkRef.current?.positions.get(it.id) ?? null);
    tops.forEach((top, i) => {
      expect(top).not.toBeNull();
      expect(Math.abs(top! - EXPECTED_SETTLED[i])).toBeLessThanOrEqual(
        REPOSITION_EPSILON_PX,
      );
    });

    r.unmount();
    editor.destroy();
  });

  // The two legs below are TERMINATION pins, not defect legs, and they cannot
  // fail on the pre-370 code by construction — that loop terminated too (far
  // too eagerly, which is leg 1's subject). They exist because the fix replaces
  // an over-eager stop with a criterion that must still be provably bounded in
  // both the benign and the hostile direction.
  it("terminates: sub-epsilon jitter converges and stops re-measuring", async () => {
    // Geometry that never stops moving, but only by less than the task-328
    // hysteresis epsilon. Every pass therefore commits nothing and reports
    // agreement — the fixed point is real even though the raw numbers wobble,
    // which is exactly why the criterion is the hysteresis and not raw equality.
    const JITTER_PX = REPOSITION_EPSILON_PX - 2;
    const s = setupScenario((ms) => {
      const wobble = (Math.floor(ms / 16) % 2 === 0 ? 0 : JITTER_PX) / 260;
      return REAL_SCALE + wobble;
    });

    await s.idle(1000);
    const afterConvergence = s.coordsSpy.mock.calls.length;
    await s.idle(4000);
    // Zero further reads: the chain terminated, and nothing re-arms it.
    expect(s.coordsSpy.mock.calls.length).toBe(afterConvergence);
    // …and it did so cheaply — a settled deck is a handful of passes, not a
    // frame-rate poll. 3 items ⇒ 3 coordsAtPos per pass.
    expect(afterConvergence / s.items.length).toBeLessThanOrEqual(6);

    s.unmount();
  });

  it("a trigger STORM costs one pass, not one pass per trigger", async () => {
    // The cost claim the fix rests on, pinned rather than asserted in prose:
    // every trigger now enters `request()` instead of firing its own rAF pass,
    // so the per-fire cost has to be unchanged from the pre-370 rAF-coalesced
    // `schedule()`. A re-arm while a pass is already pending must ADD NO PASS —
    // one pending pass is the whole rate limit. This matters most on the
    // keystroke-adjacent path (the editor ResizeObserver fires on every
    // wrap-changing keystroke) and on the keep-alive re-show reflow storm.
    //
    // Driven through a REAL trigger (`focusout` on the pod, which the per-card
    // observer effect binds straight to the door) rather than against the
    // controller in isolation.
    const s = setupScenario(() => REAL_SCALE);
    await s.idle(1000); // converge and go quiet
    const before = s.coordsSpy.mock.calls.length;

    const pod = s.sinkRef.current!.panelScrollRef.current!;
    await act(async () => {
      for (let i = 0; i < 8; i++) {
        pod.dispatchEvent(new Event("focusout", { bubbles: false }));
      }
      vi.advanceTimersByTime(20); // exactly one frame
    });
    // ONE pass for eight triggers.
    expect(s.coordsSpy.mock.calls.length - before).toBe(s.items.length);

    // …and the chain then closes on its two confirmations and stops.
    await s.idle(2000);
    const total = (s.coordsSpy.mock.calls.length - before) / s.items.length;
    expect(total).toBeLessThanOrEqual(3);

    s.unmount();
  });

  it("caps: geometry that never settles stops at the wall-clock budget", async () => {
    // The hostile direction — a document that keeps moving past every epsilon.
    // The loop must give up on a WALL-CLOCK budget (a frame cap is a lie on a
    // busy main thread) rather than poll forever.
    const s = setupScenario((ms) =>
      Math.floor(ms / 16) % 2 === 0 ? REAL_SCALE : REAL_SCALE * 1.4,
    );

    await s.idle(9000); // well past the budget
    const afterCap = s.coordsSpy.mock.calls.length;
    await s.idle(9000);
    expect(s.coordsSpy.mock.calls.length).toBe(afterCap);

    s.unmount();
  });
});
