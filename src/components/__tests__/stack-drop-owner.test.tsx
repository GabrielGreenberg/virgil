// @vitest-environment jsdom
//
// Task 1453 — **a float→Stack drop is answered by the pane that owns the float.**
//
// `FloatingPanel` fires `virgil-stack-drop` on `window`, and every mounted
// `EditorPane` listens. Task 329 gated the listener on visibility, which was
// ownership only while one pane could be shown at a time. The Library shows
// TWO Reader panes at once (task 1393): both visible, and a per-doc key (a
// footnote / citation id) can resolve in both docs — so both panes captured
// the item and both closed a popout, one in the doc the user never touched.
//
// The fix names the owner. The float is mounted by exactly one pane's
// `FloatHost`, inside that pane's `PaneRootContext`; `FloatingPanel` reads it
// and puts it in the detail, and the pane answers only a drop naming itself.
//
// Two halves, because `EditorPane` is a component no unit test mounts:
//   1. PRODUCER (driven for real): two floats under two pane providers, the
//      SAME card key — dragging one onto the icon dispatches exactly one drop,
//      naming ITS pane. A listener per pane, gated the way the host gates,
//      captures once. Fails on the old code: the detail carried no owner, so
//      both pane listeners accepted it.
//   2. CONSUMER (source census): the host's handler bails on a foreign owner
//      BEFORE it enters the capture terminal or closes a popout.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import FloatingPanel from "@/components/FloatingPanel";
import { PaneRootContext } from "@/components/editor-layout/pane-dom";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import {
  setStackIconRect,
  __resetStackIconRect,
  setStackDropTarget,
} from "@/lib/stack/stack-drop-target";

const RECT_OWNER = {};
const ICON = { left: 12, top: 700, right: 68, bottom: 756 };
const ICON_CENTER = { clientX: 40, clientY: 728 };
const HELD = { buttons: 1 };

afterEach(() => {
  cleanup();
  __resetStackIconRect();
  setStackDropTarget(false);
  document.body.style.userSelect = "";
  document.body.style.cursor = "";
});

type Drop = { cardKey: string; ownerPane: string | null };

function floatIn(pane: string, x: number) {
  return (
    <PaneRootContext.Provider value={pane}>
      <FloatingPanel
        cardKey="footnote:fn1"
        mode="floating"
        surface="card"
        initialX={x}
        initialY={200}
        initialWidth={320}
        initialHeight={240}
        zIndex={1200}
        onChange={vi.fn()}
      >
        <div data-testid={`body-${pane}`}>float body</div>
      </FloatingPanel>
    </PaneRootContext.Provider>
  );
}

describe("two visible panes, one card key", () => {
  it("the drop names the dragged float's pane, and only that pane captures", () => {
    render(
      <>
        {floatIn("pane-A", 300)}
        {floatIn("pane-B", 700)}
      </>,
    );
    setStackIconRect(RECT_OWNER, ICON);

    // One listener per pane, gated exactly as `EditorPane`'s handler gates
    // (both panes visible — the visibility gate passes for each).
    const captures: Record<string, string[]> = { "pane-A": [], "pane-B": [] };
    const listeners = (["pane-A", "pane-B"] as const).map((pane) => {
      const on = (e: Event) => {
        const d = (e as CustomEvent<Drop>).detail;
        if (d.ownerPane !== pane) return;
        captures[pane].push(d.cardKey);
      };
      window.addEventListener("virgil-stack-drop", on);
      return on;
    });
    const drops: Drop[] = [];
    const onAny = (e: Event) => drops.push((e as CustomEvent<Drop>).detail);
    window.addEventListener("virgil-stack-drop", onAny);
    try {
      const header = document.querySelector<HTMLDivElement>('[data-testid="body-pane-A"]')!;
      fireEvent.mouseDown(header, { clientX: 400, clientY: 300 });
      act(() => {
        fireEvent.mouseMove(window, { ...ICON_CENTER, ...HELD });
      });
      act(() => {
        fireEvent.mouseUp(window, ICON_CENTER);
      });
    } finally {
      for (const on of listeners) window.removeEventListener("virgil-stack-drop", on);
      window.removeEventListener("virgil-stack-drop", onAny);
    }

    expect(drops).toHaveLength(1);
    expect(drops[0].ownerPane).toBe("pane-A");
    expect(captures["pane-A"]).toEqual(["footnote:fn1"]);
    expect(captures["pane-B"], "the other visible pane must not capture").toEqual([]);
  });
});

describe("EditorPane answers only a drop naming itself", () => {
  const src = commentsStripped(readFileSync(resolve(__dirname, "../EditorPane.tsx"), "utf8"));

  it("the owner gate precedes the capture and the close", () => {
    const reg = src.indexOf('window.addEventListener("virgil-stack-drop"');
    expect(reg, "the stack-drop listener moved — re-aim this census").toBeGreaterThan(0);
    const bodyStart = src.lastIndexOf("const onDrop = ", reg);
    const body = src.slice(bodyStart, reg);
    const gate = body.indexOf("if (detail.ownerPane !== paneRootId) return;");
    expect(gate, "the handler must bail on a drop owned by another pane").toBeGreaterThan(-1);
    expect(body.indexOf("captureKeyToStack(")).toBeGreaterThan(gate);
    expect(body.indexOf("closeCardPopout(")).toBeGreaterThan(gate);
  });

  it("and the pane that answers is the pane that mounts the float", () => {
    // The owner the handler compares against is the SAME id the pane provides
    // to its subtree — the context `FloatingPanel` reads.
    expect(src.includes("<PaneRootContext.Provider value={paneRootId}>")).toBe(true);
    const panel = commentsStripped(
      readFileSync(resolve(__dirname, "../FloatingPanel.tsx"), "utf8"),
    );
    expect(panel.includes("useContext(PaneRootContext)")).toBe(true);
    expect(panel.includes("ownerPane: handlersRef.current.ownerPane")).toBe(true);
  });
});
