// @vitest-environment jsdom
//
// Task 328, example 1 — "scrolling down with a card stack going off the top
// of the window, the cards reset several times to stay visible."
//
// MECHANISM. The C5 scroll-idle refinement re-runs the whole measure pass on
// every 150ms scroll pause while approximated items exist. Each pass
// re-reads geometry and COMMITTED whatever it found, however small the
// difference — so a scroll with any residual measurement noise in it produced
// one visible re-pack per pause. Task 327 removed the LARGE deltas (a
// permanently-approximated card healing by thousands of px); this is the
// residual, and it is the half a user actually feels while reading, because
// small-but-visible is still visible.
//
// THE FIX. Hysteresis at the ONE place a card's top is committed: a pass that
// would move a card by less than `REPOSITION_EPSILON_PX` keeps the previously
// committed value, so `measureVersion` never bumps and the deck does not
// re-render at all. Heights get a tighter epsilon because they feed the
// cascade — every card packed below an unchanged card inherits its wobble.
//
// This matters more since the same task gave the omni wrapper a `transform`
// transition: without the hold, sub-threshold jitter would be promoted from a
// teleport the eye can miss into a visible 180ms glide it cannot.

import { describe, it, expect, vi, afterEach } from "vitest";

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

const VIEW_BOTTOM = 800;

type HookOut = ReturnType<typeof useInTextPositions>;

function Harness({
  editor,
  items,
  sinkRef,
  installPod,
  heightOf,
}: {
  editor: Editor;
  items: PositionItem[];
  sinkRef: { current: HookOut | null };
  installPod: (el: HTMLDivElement) => void;
  heightOf: (id: string) => number;
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
            el.getBoundingClientRect = () => makeRect(0, heightOf(it.id));
          },
        },
        `card ${it.id}`,
      ),
    ),
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

/**
 * A short, uniform, fully in-band document — deliberately the OPPOSITE of the
 * task-327 harness. Everything here is exact-read on every pass, so the only
 * thing that can move a card is the geometry `nudge` injects: no
 * approximation, no classification, nothing else to attribute a change to.
 */
function setupScenario({ baseHeight = 60 }: { baseHeight?: number } = {}) {
  vi.useFakeTimers();
  Object.defineProperty(window, "innerHeight", {
    value: VIEW_BOTTOM,
    configurable: true,
  });
  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  row.getBoundingClientRect = () => makeRect(0, VIEW_BOTTOM);
  Object.defineProperty(row, "offsetParent", { value: document.body });
  document.body.appendChild(row);

  const element = document.createElement("div");
  row.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: Array.from({ length: 12 }, (_, i) => ({
        type: "paragraph",
        attrs: { uuid: `P${i}` },
        content: [{ type: "text", text: `Paragraph number ${i}.` }],
      })),
    },
  });

  // Anchors 40px apart from the pod's top; `nudge` shifts every anchor, which
  // is exactly the shape a re-measure after a scroll pause produces.
  let nudge = 0;
  let extraHeight = 0;
  const editorDom = editor.view.dom as HTMLElement;
  editorDom.getBoundingClientRect = () => makeRect(0, 700);
  Object.defineProperty(editorDom, "scrollHeight", {
    get: () => 700,
    configurable: true,
  });
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => {
    const top = 20 + pos * 4 + nudge;
    return { top, bottom: top + 20, left: 0, right: 0 };
  });
  vi.spyOn(editor.view, "posAtCoords").mockImplementation(
    ({ top }: { left: number; top: number }) => ({
      pos: Math.max(
        0,
        Math.min(editor.state.doc.content.size, Math.round((top - 20) / 4)),
      ),
      inside: -1,
    }),
  );

  const items: PositionItem[] = [
    { id: "a", pos: 3 },
    { id: "b", pos: 20 },
    { id: "c", pos: 40 },
  ];
  const sinkRef: { current: HookOut | null } = { current: null };
  const view = render(
    <KeepAliveVisibilityProvider isVisible={true}>
      <Harness
        editor={editor}
        items={items}
        sinkRef={sinkRef}
        installPod={(el) => {
          el.getBoundingClientRect = () => makeRect(0, 700);
        }}
        heightOf={() => baseHeight + extraHeight}
      />
    </KeepAliveVisibilityProvider>,
  );

  return {
    sinkRef,
    snapshot: () => new Map(sinkRef.current!.positions),
    nudgeBy: (px: number) => {
      nudge += px;
    },
    growCardsBy: (px: number) => {
      extraHeight += px;
    },
    async pass() {
      await act(async () => {
        window.dispatchEvent(new Event("resize"));
        vi.advanceTimersByTime(250);
      });
    },
    unmount: () => {
      view.unmount();
      editor.destroy();
    },
  };
}

describe("useInTextPositions — sub-threshold corrections do not commit", () => {
  it("a pass that would move every card by less than the epsilon changes nothing", async () => {
    const s = setupScenario();
    await s.pass();
    const before = s.snapshot();
    expect(before.size).toBe(3);

    // Three consecutive scroll-pause-shaped re-measures whose CUMULATIVE
    // drift still sits inside the epsilon (the comparison is against the
    // committed value, so what matters is the total, not each step). On the
    // pre-328 commit every one of these re-packed the deck.
    for (let i = 0; i < 3; i++) {
      s.nudgeBy(REPOSITION_EPSILON_PX / 3);
      await s.pass();
      expect([...s.snapshot().entries()]).toEqual([...before.entries()]);
    }
    s.unmount();
  });

  it("…and the held error stays bounded: a real drift still commits, in BATCHES", async () => {
    const s = setupScenario();
    await s.pass();
    const before = s.snapshot();

    // The comparison is against the COMMITTED value, never the last measured
    // one, so identical sub-epsilon steps accumulate until they cross the
    // threshold and then land together. Asserting only the FINAL value would
    // pass with the hold deleted (a deck that commits every pass ends up in
    // the same place); what distinguishes the two is that the deck is still
    // for two passes and moves on the third.
    const stillMoving: boolean[] = [];
    let last = before;
    for (let i = 0; i < 3; i++) {
      s.nudgeBy(3);
      await s.pass();
      const now = s.snapshot();
      stillMoving.push([...now.entries()].some(([id, t]) => t !== last.get(id)));
      last = now;
    }
    expect(stillMoving).toEqual([false, false, true]);
    // Error bounded by one epsilon, never integrating.
    for (const [id, top] of last) {
      expect(Math.abs(top - (before.get(id)! + 9))).toBeLessThanOrEqual(
        REPOSITION_EPSILON_PX,
      );
    }
    s.unmount();
  });

  it("a real anchor move — one line box — tracks immediately", async () => {
    const s = setupScenario();
    await s.pass();
    const before = s.snapshot();
    s.nudgeBy(24);
    await s.pass();
    for (const [id, top] of s.snapshot()) {
      expect(top).toBe(before.get(id)! + 24);
    }
    s.unmount();
  });

  it("sub-pixel HEIGHT jitter does not ripple down a packed deck", async () => {
    // Cards TALL enough that the cascade actually packs them (each card's
    // natural top is inside its predecessor's height + gap) — a loose deck
    // ignores heights entirely and the leg would pass vacuously.
    const s = setupScenario({ baseHeight: 90 });
    await s.pass();
    const before = s.snapshot();
    // Heights feed the cascade, so without the tighter height epsilon a
    // fraction of a pixel on one card shifts every card packed below it.
    s.growCardsBy(0.4);
    await s.pass();
    expect([...s.snapshot().entries()]).toEqual([...before.entries()]);
    // A real height change still lands.
    s.growCardsBy(20);
    await s.pass();
    expect([...s.snapshot().entries()]).not.toEqual([...before.entries()]);
    s.unmount();
  });
});
