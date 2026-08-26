// @vitest-environment jsdom
//
// Task 200: a selection-anchored revision comment captures the selected span
// (`createRevisionRequest` → `addRevisionComment` stores `selectedText`), but
// `RevisionRequestCard` never surfaced it — it was the lone excerpt-capturing
// panel card that rendered NO cue about which passage it targeted, while its
// `CutterCommentCard` twin renders an "Original" excerpt section. The excerpt
// cue is now the shared `useExcerptCue` SSOT both comment cards consume; this
// suite pins that the revision card renders it (expanded excerpt + compressed
// cue) so the twins can't drift again.

import { describe, it, expect, afterEach } from "vitest";
import { vi } from "vitest";

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

// The rich-text body mounts a real TipTap editor — stub it. A recognisable
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
import { RevisionRequestCard } from "@/panels/Revisions/RevisionRequestCard";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import type { RevisionRequestCard as RevisionRequestCardData } from "@/lib/types";

afterEach(() => {
  cleanup();
  cardStore.collapse({ kind: "revision-comment", id: "rc1" });
});

function makeCard(
  over: Partial<RevisionRequestCardData> = {},
): RevisionRequestCardData {
  return {
    kind: "comment",
    id: "rc1",
    createdAt: "2026-07-21T00:00:00.000Z",
    text: "tighten this claim",
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "tighten this claim" }] },
      ],
    },
    aiRequest: false,
    selectedText: "The quick brown fox jumped over the lazy dog.",
    links: [],
    ...over,
  };
}

function renderCard(
  card: RevisionRequestCardData,
  { expanded = true }: { expanded?: boolean } = {},
) {
  if (expanded) cardStore.expand({ kind: "revision-comment", id: card.id });
  else cardStore.collapse({ kind: "revision-comment", id: card.id });
  return render(
    <RevisionRequestCard
      card={card}
      selected={false}
      onUpdateContent={() => {}}
      onSetAiRequest={() => {}}
      onConvert={() => {}}
      onDelete={() => {}}
      onSelect={() => {}}
    />,
  );
}

describe("RevisionRequestCard selection excerpt (task 200)", () => {
  it("renders the captured selection as an 'Original' excerpt section when expanded", () => {
    renderCard(makeCard());
    // Twin of CutterCommentCard: the "Original" label + the excised span both
    // render above the body.
    expect(screen.getByText("Original")).toBeTruthy();
    expect(
      screen.getByText("The quick brown fox jumped over the lazy dog."),
    ).toBeTruthy();
  });

  it("omits the excerpt section when there is no selectedText", () => {
    renderCard(makeCard({ selectedText: undefined }));
    expect(screen.queryByText("Original")).toBeNull();
  });

  it("shows the excerpt as the compressed cue (in place of the body summary)", () => {
    renderCard(makeCard(), { expanded: false });
    // Collapsed card: the red-italic quoted excerpt is the one-line cue.
    expect(
      screen.getByText(/The quick brown fox jumped over the lazy dog\./),
    ).toBeTruthy();
  });

  // ── task 488 ────────────────────────────────────────────────────────────
  // Gabriel: *"the original is rendered as plain text without formatting —
  // should be more like an archive card."* The excerpt now goes through the
  // shared `captured-passage` door, so it reads as the paper does. These legs
  // drive the REAL static borrowed surface (only `BorrowedMainText` is stubbed
  // above), which is the whole point: a leg that stubbed the renderer would be
  // blind to exactly the thing that was wrong.
  it("renders the RICH capture with its marks (the capture rung)", () => {
    renderCard(
      makeCard({
        selectedText: "plain stressed",
        selectedContent: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "plain " },
                { type: "text", marks: [{ type: "italic" }], text: "stressed" },
              ],
            },
          ],
        },
      }),
    );
    const em = document.querySelector(".captured-passage em");
    expect(em?.textContent).toBe("stressed");
  });

  it("parses the BYTES when there is no rich capture (every pre-488 card)", () => {
    renderCard(makeCard({ selectedText: "an \\emph{emphasised} word" }));
    const em = document.querySelector(".captured-passage em");
    expect(em?.textContent).toBe("emphasised");
    // …and the command itself is not shown as source — the reported defect.
    expect(
      document.querySelector(".captured-passage")?.textContent,
    ).not.toContain("emph{");
  });
});
