// @vitest-environment jsdom
//
// BUG #55 — the anchored FootnoteCard renders the unified AiRequestCheckbox in
// its footer (same affordance as note/todo/comment cards), gated on:
//   - `onSetAiRequest` being supplied (surfaces with no flag source, e.g. the
//     Reader, omit it), AND
//   - the card being expanded (the footer renders only on the expanded body).
// Toggling the checkbox calls `onSetAiRequest(next)` with the flipped value.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { ComponentProps } from "react";
import { FootnoteCard } from "@/panels/Footnotes/FootnoteCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { FootnoteInfo } from "@/components/Editor";

afterEach(cleanup);

const REF = { kind: "footnote" as const, id: "fn1" };

const FN = {
  footnoteId: "fn1",
  number: 1,
  pos: 10,
  content: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "fn body" }] }],
  },
} as unknown as FootnoteInfo;

beforeEach(() => {
  cardStore.collapse(REF);
  cardStore.clearSelection();
});

type Props = ComponentProps<typeof FootnoteCard>;

function renderCard(overrides: Partial<Props> = {}) {
  const props: Props = {
    footnote: FN,
    isSelected: false,
    onSelect: vi.fn(),
    onJump: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<FootnoteCard {...props} />) };
}

describe("FootnoteCard AI-request checkbox (BUG #55)", () => {
  it("renders the AI-request checkbox when expanded AND onSetAiRequest is supplied", () => {
    renderCard({ onSetAiRequest: vi.fn() });
    // The header expand control flips the store axis and re-renders the body.
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(screen.getByText("AI request")).toBeTruthy();
  });

  it("does NOT render the checkbox while collapsed (footer is expanded-only)", () => {
    renderCard({ onSetAiRequest: vi.fn() });
    // Collapsed by default — no footer, no checkbox.
    expect(screen.queryByText("AI request")).toBeNull();
  });

  it("does NOT render the checkbox when onSetAiRequest is omitted (e.g. Reader)", () => {
    renderCard(); // no onSetAiRequest
    fireEvent.click(screen.getByLabelText("Expand card"));
    expect(screen.queryByText("AI request")).toBeNull();
  });

  it("reflects the current flag and toggles it (unchecked → calls onSetAiRequest(true))", () => {
    const onSetAiRequest = vi.fn();
    renderCard({ aiRequest: false, onSetAiRequest });
    fireEvent.click(screen.getByLabelText("Expand card"));
    fireEvent.click(screen.getByText("AI request"));
    expect(onSetAiRequest).toHaveBeenCalledWith(true);
  });

  it("toggles off when already checked (calls onSetAiRequest(false))", () => {
    const onSetAiRequest = vi.fn();
    renderCard({ aiRequest: true, onSetAiRequest });
    fireEvent.click(screen.getByLabelText("Expand card"));
    fireEvent.click(screen.getByText("AI request"));
    expect(onSetAiRequest).toHaveBeenCalledWith(false);
  });
});
