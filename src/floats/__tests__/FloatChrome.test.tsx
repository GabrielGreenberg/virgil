// @vitest-environment jsdom
//
// Pins the FloatChrome header-tint contract (pop-out continuity #20):
// a card float passes its kind's `theme.headerDefault` via
// `Floatable.headerTint` and the strip paints it; absent (text-object
// floats), the neutral `--surface-muted-strong` fallback is unchanged.
//
// Also pins the chip-D (re)anchor DROP BUTTON in the popped-float chrome:
//   1. Renders the button ONLY when `canDrop` (and a `dropCardKey`); absent /
//      false → no button (text-object floats + `droppable:false` kinds).
//   2. A mousedown invokes `beginCardDropGesture` with the float's
//      `dropCardKey` and the press origin.
//   3. A non-primary (right-click) press starts NO session.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// FloatChrome imports PopoutButton from panel-primitives, which
// transitively pulls `@/lib/storage` (the known barrel/storage gotcha).
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

// Mock the drop controller so the neutral drop button's gesture is observable
// without a live DropCtx / spec registry. `beginCardDropGesture` (which
// FloatChrome calls) imports `beginDropSession` + `commitDropSession` here.
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
import { FloatChrome } from "@/floats/FloatChrome";

beforeEach(() => {
  beginDropSession.mockClear();
  commitDropSession.mockClear();
  beginDropSession.mockReturnValue(true);
});
afterEach(cleanup);

function renderChrome(headerTint?: string) {
  const { container } = render(
    <FloatChrome
      title="Note"
      headerTint={headerTint}
      canJump={false}
      onJump={() => {}}
      onClose={() => {}}
    />,
  );
  const strip = container.firstElementChild as HTMLElement;
  return strip;
}

describe("FloatChrome header tint (#20)", () => {
  it("paints the supplied kind tint as the strip background", () => {
    const strip = renderChrome("rgb(10, 20, 30)");
    expect(strip.style.backgroundColor).toBe("rgb(10, 20, 30)");
  });

  it("falls back to the neutral strip when no tint is supplied", () => {
    const strip = renderChrome(undefined);
    expect(strip.style.backgroundColor).toBe("var(--surface-muted-strong)");
  });

  it("strip classes match the float-policy chrome constants (liftSpawnRect continuity)", async () => {
    // liftSpawnRect's chrome delta assumes a 24px border-box strip (h-6
    // including its border-b). If these classes change, the constant in
    // float-policy.ts must change with them - this is the tripwire.
    const { CARD_FLOAT_HEADER_H } = await import("../float-policy");
    const strip = renderChrome(undefined);
    expect(strip.className).toContain("h-6");
    expect(strip.className).toContain("border-b");
    expect(CARD_FLOAT_HEADER_H).toBe(24);
  });
});

describe("FloatChrome (re)anchor drop button (chip D)", () => {
  const DROP_LABEL = "Drop note into text";

  it("renders the drop button when canDrop + a dropCardKey are supplied", () => {
    render(
      <FloatChrome
        title="Note"
        canJump={false}
        onJump={() => {}}
        canDrop
        dropCardKey="float:card:note:n1"
        onClose={() => {}}
      />,
    );
    expect(screen.getByLabelText(DROP_LABEL)).toBeTruthy();
  });

  it("renders NO drop button when canDrop is false (text-object / droppable:false)", () => {
    render(
      <FloatChrome
        title="Note"
        canJump={false}
        onJump={() => {}}
        canDrop={false}
        dropCardKey="float:card:note:n1"
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText(DROP_LABEL)).toBeNull();
  });

  it("renders NO drop button when canDrop is omitted entirely (default)", () => {
    render(
      <FloatChrome
        title="Note"
        canJump={false}
        onJump={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText(DROP_LABEL)).toBeNull();
  });

  it("renders NO drop button when canDrop is true but no dropCardKey is supplied", () => {
    render(
      <FloatChrome
        title="Note"
        canJump={false}
        onJump={() => {}}
        canDrop
        onClose={() => {}}
      />,
    );
    expect(screen.queryByLabelText(DROP_LABEL)).toBeNull();
  });

  it("mousedown invokes beginCardDropGesture with the float's dropCardKey + press origin", () => {
    const key = "float:card:note:n9";
    render(
      <FloatChrome
        title="Note"
        canJump={false}
        onJump={() => {}}
        canDrop
        dropCardKey={key}
        onClose={() => {}}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText(DROP_LABEL), {
      button: 0,
      clientX: 50,
      clientY: 60,
    });
    // beginCardDropGesture → beginDropSession with the float's key + inPlace +
    // externalCommit (the shared neutral gesture contract).
    expect(beginDropSession).toHaveBeenCalledTimes(1);
    const arg = beginDropSession.mock.calls[0][0] as unknown as {
      cardKey: string;
      origin: { x: number; y: number };
      inPlace?: boolean;
      externalCommit?: boolean;
    };
    expect(arg.cardKey).toBe(key);
    expect(arg.origin).toEqual({ x: 50, y: 60 });
    expect(arg.inPlace).toBe(true);
    expect(arg.externalCommit).toBe(true);
    // Terminate the gesture so its one-shot window mouseup self-removes and
    // can't leak into a later test.
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
  });

  it("a NON-PRIMARY (right-click) press starts NO session", () => {
    render(
      <FloatChrome
        title="Note"
        canJump={false}
        onJump={() => {}}
        canDrop
        dropCardKey="float:card:note:n9"
        onClose={() => {}}
      />,
    );
    fireEvent.mouseDown(screen.getByLabelText(DROP_LABEL), {
      button: 2,
      clientX: 50,
      clientY: 60,
    });
    expect(beginDropSession).not.toHaveBeenCalled();
    // A primary press on the same button still starts one — the guard is
    // button-selective, not globally inert.
    fireEvent.mouseDown(screen.getByLabelText(DROP_LABEL), { button: 0 });
    expect(beginDropSession).toHaveBeenCalledTimes(1);
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
  });

  it("the drop button renders to the LEFT of the close X", () => {
    const { container } = render(
      <FloatChrome
        title="Note"
        canJump={false}
        onJump={() => {}}
        canDrop
        dropCardKey="float:card:note:n1"
        onClose={() => {}}
      />,
    );
    const buttons = Array.from(container.querySelectorAll("button"));
    const dropIdx = buttons.findIndex(
      (b) => b.getAttribute("aria-label") === DROP_LABEL,
    );
    // The close X is a `PopoutButton isPoppedOut variant="x"` → aria-label
    // `Dock ${labelNoun}` (labelNoun is the lowercased title, "note").
    const closeIdx = buttons.findIndex(
      (b) => b.getAttribute("aria-label") === "Dock note",
    );
    expect(dropIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(dropIdx).toBeLessThan(closeIdx);
  });
});
