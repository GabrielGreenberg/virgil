// @vitest-environment jsdom
/**
 * Chip 2 — FloatWindow's drop-button DOMAIN DISPATCH.
 *
 * FloatWindow builds the FloatChrome `onDropPress` handler per domain:
 *   - textobject → `LiftHost.beginLift({terminalPolicy:"float", ref:{kind,id},
 *     cardKey:floatable.key, origin})` (the lifted-overlay ghost).
 *   - card → leaves `onDropPress` undefined so FloatChrome falls back to its
 *     own `beginCardDropGesture` (card behavior byte-unchanged).
 *
 * `useLiftHost` / `beginLift` are mocked (mirroring how FloatChrome.test mocks
 * `beginDropSession`/`beginCardDropGesture`), and `FloatingPanel` is a thin
 * passthrough so the test exercises the chrome wiring, not the panel internals.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode, Ref } from "react";

// FloatChrome → PopoutButton → panel-primitives → `@/lib/storage` (the barrel
// gotcha). No-op Proxy lets the graph load.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

// The shared neutral card gesture — observe that the CARD path still routes
// here while the textobject path does NOT.
const beginDropSession = vi.fn((..._args: unknown[]) => true);
const commitDropSession = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: (...args: unknown[]) => beginDropSession(...args),
  commitDropSession: (...args: unknown[]) => commitDropSession(...args),
}));

// Mock the lift host so `beginLift` is observable without mounting LiftHost.
const beginLift = vi.fn();
vi.mock("@/text-objects/LiftHost", () => ({
  useLiftHost: () => ({ beginLift }),
}));

// Thin FloatingPanel passthrough — render the children + expose a no-op handle
// so FloatWindow's `panelHandleRef.current?.beginDragAt()` mount effect is inert.
// React is pulled via `await import` INSIDE the (hoisted) factory so it never
// references an out-of-scope binding; the named function gives a display name.
vi.mock("@/components/FloatingPanel", async () => {
  const { forwardRef, useImperativeHandle, createElement } = await import(
    "react"
  );
  const FloatingPanelMock = forwardRef(function FloatingPanelMock(
    { children }: { children: ReactNode },
    ref: Ref<unknown>,
  ) {
    useImperativeHandle(ref, () => ({
      setRect: () => {},
      beginDragAt: () => {},
    }));
    return createElement("div", { "data-testid": "panel" }, children);
  });
  return { __esModule: true, default: FloatingPanelMock };
});

// card-lift handoff is irrelevant here; return null so the mount effect bails.
vi.mock("@/components/card-lift", () => ({
  consumeCardLiftHandoff: () => null,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import {
  PoppedCardsContext,
  type PoppedCardsValue,
} from "@/hooks/usePoppedCards";
import { FloatWindow } from "@/floats/FloatWindow";
import type { Floatable } from "@/floats/types";

beforeEach(() => {
  beginLift.mockClear();
  beginDropSession.mockClear();
  commitDropSession.mockClear();
  beginDropSession.mockReturnValue(true);
});
afterEach(cleanup);

const poppedStub: PoppedCardsValue = {
  poppedKeys: [],
  popOut: () => {},
  popOutAtRect: () => {},
  close: () => {},
  isPoppedOut: () => false,
  getFloatPosition: () => undefined,
  setFloatPosition: () => {},
} as unknown as PoppedCardsValue;

function renderWindow(floatable: Floatable, windowKey: string) {
  return render(
    <PoppedCardsContext.Provider value={poppedStub}>
      <FloatWindow floatable={floatable} windowKey={windowKey} />
    </PoppedCardsContext.Provider>,
  );
}

function textObjectFloatable(): Floatable {
  return {
    key: "float:textobject:paragraph:p7",
    domain: "textobject",
    kind: "paragraph",
    id: "p7",
    title: "Paragraph",
    surface: "card",
    canJump: true,
    canDrop: true,
    jumpToSource: () => {},
    snapshotForStack: () => null,
    renderBody: () => null,
  };
}

function cardFloatable(): Floatable {
  return {
    key: "float:card:note:n7",
    domain: "card",
    kind: "note",
    id: "n7",
    title: "Note",
    surface: "card",
    canJump: true,
    canDrop: true,
    jumpToSource: () => {},
    snapshotForStack: () => null,
    renderBody: () => null,
  };
}

describe("FloatWindow drop-button domain dispatch (Chip 2)", () => {
  it("TEXTOBJECT float: pressing the drop button calls beginLift with terminalPolicy:'float' + the float's ref/key/origin", () => {
    renderWindow(textObjectFloatable(), "float:textobject:paragraph:p7");
    fireEvent.mouseDown(screen.getByLabelText("Drop paragraph into text"), {
      button: 0,
      clientX: 33,
      clientY: 44,
    });
    expect(beginLift).toHaveBeenCalledTimes(1);
    expect(beginLift.mock.calls[0][0]).toEqual({
      terminalPolicy: "float",
      ref: { kind: "paragraph", id: "p7" },
      cardKey: "float:textobject:paragraph:p7",
      origin: { x: 33, y: 44 },
    });
    // The textobject path must NOT also fire the card gesture.
    expect(beginDropSession).not.toHaveBeenCalled();
  });

  it("TEXTOBJECT float: a non-primary press calls neither beginLift nor the card gesture", () => {
    renderWindow(textObjectFloatable(), "float:textobject:paragraph:p7");
    fireEvent.mouseDown(screen.getByLabelText("Drop paragraph into text"), {
      button: 2,
      clientX: 33,
      clientY: 44,
    });
    expect(beginLift).not.toHaveBeenCalled();
    expect(beginDropSession).not.toHaveBeenCalled();
  });

  it("CARD float: pressing the drop button routes to beginCardDropGesture (NOT beginLift) — regression guard", () => {
    renderWindow(cardFloatable(), "float:card:note:n7");
    fireEvent.mouseDown(screen.getByLabelText("Drop note into text"), {
      button: 0,
      clientX: 5,
      clientY: 6,
    });
    // Card floats keep the no-ghost gesture.
    expect(beginLift).not.toHaveBeenCalled();
    expect(beginDropSession).toHaveBeenCalledTimes(1);
    const arg = beginDropSession.mock.calls[0][0] as { cardKey: string };
    expect(arg.cardKey).toBe("float:card:note:n7");
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
  });
});
