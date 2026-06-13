// @vitest-environment jsdom
//
// Backlog #35: cutter comment cards must share the canonical revision-comment
// layout — they render through `EditableCard` (rich-text RichTextField body,
// automatic collab claim, morph chevron, AI-request footer) instead of the old
// raw `<textarea>` + DIY collab wiring. The one element unique to cutter — the
// excised "Original" cut excerpt (`selectedText`) — is kept as a section ABOVE
// the body via EditableCard's additive `aboveBody` slot. This suite pins that
// structure so a regression to the textarea chrome can't slip back in.

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

// The rich-text body mounts a real TipTap editor — stub it. The point of this
// suite is that the body IS a RichTextField (not a textarea), so a recognisable
// marker stand-in is all we need.
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

import { render, screen, cleanup } from "@testing-library/react";
import { CutterCommentCard } from "@/panels/Cutter/CutterCommentCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import type { CutterCommentCard as CutterCommentCardData } from "@/lib/types";

afterEach(() => {
  cleanup();
  // Reset the expansion axis so each test starts collapsed.
  cardStore.collapse({ kind: "cutter-comment", id: "cc1" });
});

function makeCard(
  over: Partial<CutterCommentCardData> = {},
): CutterCommentCardData {
  return {
    kind: "comment",
    id: "cc1",
    createdAt: "2026-06-12T00:00:00.000Z",
    text: "needs trimming",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "needs trimming" }] },
      ],
    },
    aiRequest: false,
    selectedText: "The quick brown fox jumped over the lazy dog.",
    links: [],
    ...over,
  };
}

function renderExpanded(card: CutterCommentCardData, props: Record<string, unknown> = {}) {
  // Expand the body so the rich-text field + excerpt render (collapsed cards
  // show only the one-line summary).
  cardStore.expand({ kind: "cutter-comment", id: card.id });
  return render(
    <CutterCommentCard
      card={card}
      selected={false}
      onUpdateContent={() => {}}
      onConvert={() => {}}
      onSetAiRequest={() => {}}
      onDelete={() => {}}
      onSelect={() => {}}
      {...props}
    />,
  );
}

describe("CutterCommentCard layout parity (#35)", () => {
  it("renders through EditableCard — a RichTextField body, NOT a raw textarea", () => {
    const { container } = renderExpanded(makeCard());
    expect(container.querySelector("[data-card]")).not.toBeNull();
    // The canonical rich-text body is present…
    expect(screen.getByTestId("rtf")).toBeTruthy();
    // …and the old DIY chrome (a raw <textarea>) is gone.
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("keeps the cut excerpt (selectedText) as an 'Original' section", () => {
    renderExpanded(makeCard());
    // The unique cutter element survives the migration: the "Original" label
    // and the excised text both render above the body.
    expect(screen.getByText("Original")).toBeTruthy();
    expect(
      screen.getByText("The quick brown fox jumped over the lazy dog."),
    ).toBeTruthy();
  });

  it("omits the excerpt section when there is no selectedText", () => {
    renderExpanded(makeCard({ selectedText: undefined }));
    expect(screen.queryByText("Original")).toBeNull();
  });

  it("exposes the morph affordance (kind dropdown) and the AI-request toggle", () => {
    renderExpanded(makeCard());
    // Morph chevron: the kind label ("Comment") is rendered as a dropdown
    // button because kindOptions has >1 entry and onConvert is wired.
    expect(screen.getByText("Comment")).toBeTruthy();
    // AI-request checkbox lives in EditableCard's footer slot.
    expect(screen.getByText("AI request")).toBeTruthy();
  });
});
