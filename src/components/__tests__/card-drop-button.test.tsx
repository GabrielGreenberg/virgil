// @vitest-environment jsdom
//
// Pins for the card DROP BUTTON (chip B/C) — the (re)anchor gesture mounted
// in the unified card header:
//   1. Registry gating: the button renders ONLY for `isDroppable(kind)` —
//      present on note/footnote/citation, absent on bib/ai/error/example.
//   2. Empty-draft disable: an inline-kind card (citation) with no producible
//      atom passes `dropDisabled` → the button is `disabled`.
//   3. Gesture start: a mousedown begins a drop session with
//      `inPlace:true, externalCommit:true` (the shared `beginCardDropGesture`
//      contract), and a disabled button starts NO session.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the barrel/storage
// gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

// Mock the controller so the gesture is observable without a live DropCtx /
// spec registry. `beginCardDropGesture` imports `beginDropSession` +
// `commitDropSession` from here.
const beginDropSession = vi.fn((..._args: unknown[]) => true);
const commitDropSession = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: (...args: unknown[]) => beginDropSession(...args),
  commitDropSession: (...args: unknown[]) => commitDropSession(...args),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PanelCard, CardDropButton, CARD_THEMES } from "@/components/panel-primitives";
// `theme` below is the only CARD_THEMES use (a fixed note theme for all kinds).
import { buildFloatKey } from "@/floats/float-key";
import type { CardKind } from "@/panels/_shared/types";

beforeEach(() => {
  beginDropSession.mockClear();
  commitDropSession.mockClear();
  beginDropSession.mockReturnValue(true);
});
afterEach(cleanup);

const theme = CARD_THEMES.note;
type PanelCardProps = ComponentProps<typeof PanelCard>;

function renderCard(kind: CardKind, overrides: Partial<PanelCardProps> = {}) {
  const id = "c1";
  const props: PanelCardProps = {
    // Theme is irrelevant to the drop button — use a fixed theme for all kinds.
    theme,
    selected: false,
    kind,
    cardKey: buildFloatKey({ domain: "card", kind, id }),
    isCollapsed: true,
    onToggleExpanded: vi.fn(),
    onHeaderActivate: vi.fn(),
    onClick: vi.fn(),
    children: <div data-testid="body">body</div>,
    ...overrides,
  };
  return render(<PanelCard {...props} />);
}

describe("CardDropButton registry gating (isDroppable)", () => {
  const droppable: CardKind[] = ["note", "footnote", "citation", "todo", "report"];
  const notDroppable: CardKind[] = ["bib", "ai", "error", "example"];

  for (const kind of droppable) {
    it(`renders the drop button for droppable kind "${kind}"`, () => {
      renderCard(kind);
      expect(screen.getByLabelText("Drop into text")).toBeTruthy();
    });
  }

  for (const kind of notDroppable) {
    it(`renders NO drop button for non-droppable kind "${kind}"`, () => {
      renderCard(kind);
      expect(screen.queryByLabelText("Drop into text")).toBeNull();
    });
  }
});

describe("CardDropButton empty-draft disable", () => {
  it("an empty-draft citation (dropDisabled) renders the button DISABLED", () => {
    renderCard("citation", { dropDisabled: true });
    const btn = screen.getByLabelText("Drop into text") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("a keyed citation (dropDisabled=false) renders the button ENABLED", () => {
    renderCard("citation", { dropDisabled: false });
    const btn = screen.getByLabelText("Drop into text") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("a footnote is always enabled (no dropDisabled threaded)", () => {
    renderCard("footnote");
    const btn = screen.getByLabelText("Drop into text") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

describe("CardDropButton gesture start (inPlace + externalCommit)", () => {
  it("mousedown begins a drop session with the cardKey, inPlace:true, externalCommit:true", () => {
    const key = buildFloatKey({ domain: "card", kind: "note", id: "n9" });
    render(<CardDropButton cardKey={key} />);
    fireEvent.mouseDown(screen.getByLabelText("Drop into text"), {
      button: 0, clientX: 50, clientY: 60,
    });
    expect(beginDropSession).toHaveBeenCalledTimes(1);
    const arg = beginDropSession.mock.calls[0][0] as unknown as {
      cardKey: string; origin: { x: number; y: number }; inPlace?: boolean; externalCommit?: boolean;
    };
    expect(arg.cardKey).toBe(key);
    expect(arg.inPlace).toBe(true);
    expect(arg.externalCommit).toBe(true);
    expect(arg.origin).toEqual({ x: 50, y: 60 });
    // Terminate the gesture so its window mouseup listener self-removes and
    // can't leak into a later test (the one-shot commit is asserted below).
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
  });

  it("a disabled button starts NO session on mousedown", () => {
    const key = buildFloatKey({ domain: "card", kind: "citation", id: "c7" });
    render(<CardDropButton cardKey={key} disabled />);
    // A disabled <button> swallows synthetic events in jsdom, but assert the
    // handler is inert regardless (the early `if (disabled) return`).
    fireEvent.mouseDown(screen.getByLabelText("Drop into text"), { button: 0 });
    expect(beginDropSession).not.toHaveBeenCalled();
  });

  it("a NON-PRIMARY (right-click) press starts NO session", () => {
    // The `if (e.button !== 0) return` guard at the very top of the handler
    // (matching inline-atom-grab + the header lift) means a right/middle press
    // can't open a phantom drop session — it passes through to native behavior.
    const key = buildFloatKey({ domain: "card", kind: "note", id: "n9" });
    render(<CardDropButton cardKey={key} />);
    fireEvent.mouseDown(screen.getByLabelText("Drop into text"), {
      button: 2, clientX: 50, clientY: 60,
    });
    expect(beginDropSession).not.toHaveBeenCalled();
    // And a primary press on the SAME button still does start one, proving the
    // guard is button-selective rather than globally inert.
    fireEvent.mouseDown(screen.getByLabelText("Drop into text"), { button: 0 });
    expect(beginDropSession).toHaveBeenCalledTimes(1);
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
  });

  it("arms a one-shot commit on the next window mouseup, then self-removes", () => {
    const key = buildFloatKey({ domain: "card", kind: "note", id: "n9" });
    render(<CardDropButton cardKey={key} />);
    fireEvent.mouseDown(screen.getByLabelText("Drop into text"), { button: 0 });
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    expect(commitDropSession).toHaveBeenCalledTimes(1);
    // One-shot: a second mouseup does NOT re-commit.
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    expect(commitDropSession).toHaveBeenCalledTimes(1);
  });
});
