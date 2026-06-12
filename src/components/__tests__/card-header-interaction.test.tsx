// @vitest-environment jsdom
//
// Pins for the ratified card-header interaction contract (2026-06-11,
// Session-17 backlog #14/#15/#17/#18 + the suppress-click guard):
//   1. A docked header click fires `onHeaderActivate` (the select+toggle
//      composition) and NEVER the card root's onClick (the body's
//      select+expand+jump contract).
//   2. Without `onHeaderActivate`, the header falls back to the axis-pure
//      `onToggleExpanded` (toggle-only).
//   3. Keyboard a11y: Enter / Space on the focused header activate it;
//      `aria-expanded` + the stateful aria-label track `isCollapsed`.
//   4. A completed lift gesture swallows the browser's trailing click
//      (suppress-click ref), re-armed by the next mousedown.
//   5. No docked pop-out button — drag-lift is the only pop-out path; the
//      popped-state re-dock X remains.
//   6. EditableCard: a collapsed card renders its bodyTitle (static title
//      dialect); a collapsed titleless card renders NO title row; an
//      expanded titleless card keeps the compact hover +T.

import { describe, it, expect, vi, afterEach } from "vitest";

// panel-primitives transitively pulls `@/lib/storage` (the known barrel/
// storage gotcha) — stub it; nothing here touches a sidecar.
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

// Keep the suite light: the rich-text body and the borrowed read-only body
// both mount real TipTap editors — irrelevant to header-chrome wiring.
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

// jsdom has no ResizeObserver; the unified header measures itself with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { PanelCard, EditableCard, CARD_THEMES } from "@/components/panel-primitives";

afterEach(cleanup);

const theme = CARD_THEMES.note;

type PanelCardProps = ComponentProps<typeof PanelCard>;

function renderPanelCard(overrides: Partial<PanelCardProps> = {}) {
  const props: PanelCardProps = {
    theme,
    selected: false,
    kind: "note",
    isCollapsed: true,
    onToggleExpanded: vi.fn(),
    onHeaderActivate: vi.fn(),
    onClick: vi.fn(),
    children: <div data-testid="body">body content</div>,
    ...overrides,
  };
  const utils = render(<PanelCard {...props} />);
  return { props, ...utils };
}

describe("docked header click = toggle + select (backlog #14)", () => {
  it("fires onHeaderActivate, not the root onClick (no body contract)", () => {
    const { props } = renderPanelCard();
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(props.onHeaderActivate).toHaveBeenCalledTimes(1);
    expect(props.onToggleExpanded).not.toHaveBeenCalled();
    expect(props.onClick).not.toHaveBeenCalled();
  });

  it("falls back to the axis-pure onToggleExpanded when no composition is threaded", () => {
    const { props } = renderPanelCard({ onHeaderActivate: undefined });
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(props.onToggleExpanded).toHaveBeenCalledTimes(1);
    expect(props.onClick).not.toHaveBeenCalled();
  });

  it("a body click keeps the root onClick contract (bubbles past the header)", () => {
    const { props } = renderPanelCard();
    fireEvent.click(screen.getByTestId("body"));
    expect(props.onClick).toHaveBeenCalledTimes(1);
    expect(props.onHeaderActivate).not.toHaveBeenCalled();
  });

  it("Enter and Space on the focused header activate; aria tracks state", () => {
    const { props, rerender } = renderPanelCard();
    const header = screen.getByLabelText("Expand card");
    expect(header.getAttribute("role")).toBe("button");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.keyDown(header, { key: "Enter" });
    fireEvent.keyDown(header, { key: " " });
    expect(props.onHeaderActivate).toHaveBeenCalledTimes(2);
    // Expanded: stateful label + aria-expanded flip.
    rerender(<PanelCard {...props} isCollapsed={false} />);
    expect(screen.getByLabelText("Collapse card").getAttribute("aria-expanded")).toBe("true");
  });

  it("a popped card's header is inert (no expansion axis when floating)", () => {
    renderPanelCard({ isPoppedOut: true, onTogglePopout: vi.fn() });
    expect(screen.queryByLabelText("Expand card")).toBeNull();
    expect(screen.queryByLabelText("Collapse card")).toBeNull();
  });
});

describe("no docked pop-out button — drag-lift only (backlog #18)", () => {
  it("docked: renders no pop-out button", () => {
    renderPanelCard({ cardKey: "note:n1", onTogglePopout: vi.fn() });
    expect(screen.queryByLabelText("Pop out card")).toBeNull();
  });

  it("popped: keeps the re-dock X", () => {
    renderPanelCard({ isPoppedOut: true, onTogglePopout: vi.fn() });
    expect(screen.getByLabelText("Dock card")).toBeTruthy();
  });
});

describe("suppress-click guard after a lift gesture", () => {
  it("the trailing click of a completed lift fires neither header toggle nor root onClick", () => {
    const onTogglePopout = vi.fn();
    const { props } = renderPanelCard({ cardKey: "note:n1", onTogglePopout });
    const header = screen.getByLabelText("Expand card");

    // Press on the header, drag past the 5px threshold → lift triggers.
    fireEvent.mouseDown(header, { button: 0, clientX: 10, clientY: 10 });
    fireEvent(window, new MouseEvent("mousemove", { bubbles: true, clientX: 40, clientY: 40 }));
    expect(onTogglePopout).toHaveBeenCalledTimes(1);
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));

    // The browser still synthesizes a click for the press — swallowed.
    fireEvent.click(header);
    expect(props.onHeaderActivate).not.toHaveBeenCalled();
    expect(props.onClick).not.toHaveBeenCalled();

    // The next plain press re-arms the click path.
    fireEvent.mouseDown(header, { button: 0, clientX: 10, clientY: 10 });
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    fireEvent.click(header);
    expect(props.onHeaderActivate).toHaveBeenCalledTimes(1);
  });
});

describe("EditableCard collapsed title (backlog #15/#17)", () => {
  const base = {
    id: "n1",
    selected: false,
    theme,
    kind: "note" as const,
    value: { type: "doc", content: [] },
    onChange: vi.fn(),
  };

  it("a collapsed card with a title renders it as a static title row", () => {
    const { container } = render(
      <EditableCard
        {...base}
        bodyTitle="My collapsed title"
        onBodyTitleChange={vi.fn()}
        compressed
        compressedSummary="summary text"
      />,
    );
    const title = container.querySelector(".card-title-collapsed");
    expect(title?.textContent).toBe("My collapsed title");
    // Static — not the editable input.
    expect(container.querySelector(".card-title-input")).toBeNull();
  });

  it("a collapsed titleless card renders NO title row (and no +T)", () => {
    const { container } = render(
      <EditableCard
        {...base}
        bodyTitle=""
        onBodyTitleChange={vi.fn()}
        compressed
        compressedSummary="summary text"
      />,
    );
    expect(container.querySelector(".card-title-collapsed")).toBeNull();
    expect(container.querySelector(".card-title-wrapper")).toBeNull();
    expect(container.querySelector(".card-title-add")).toBeNull();
  });

  it("an expanded titleless card keeps the compact hover +T affordance", () => {
    const { container } = render(
      <EditableCard {...base} bodyTitle="" onBodyTitleChange={vi.fn()} />,
    );
    const wrapper = container.querySelector(".card-title-wrapper.card-title-add-only");
    expect(wrapper).toBeTruthy();
    expect(container.querySelector(".card-title-add")?.textContent).toBe("+T");
  });
});
