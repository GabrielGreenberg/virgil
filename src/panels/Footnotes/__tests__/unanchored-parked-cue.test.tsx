// @vitest-environment jsdom
//
// Task 278 pin — the UnanchoredFootnoteCard wears the twin-consistent
// "deliberately parked, drag to anchor" cue (dashed border + reduced opacity +
// tooltip), mirroring the Citation twin's unanchored treatment, and does NOT
// adopt the `orphaned` ERROR badge. Its omni state is neutral `free`, not
// `orphaned` (Footnotes/omni.tsx:125-131), so the chrome must distinguish it
// from BOTH the anchored (numbered) and orphaned (BadgeOrphaned dot) siblings.

import { describe, it, expect, vi, afterEach } from "vitest";

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

import { render, cleanup } from "@testing-library/react";
import {
  UnanchoredFootnoteCard,
  OrphanedFootnoteCard,
} from "@/panels/Footnotes/FootnoteCard";
import { unanchoredCardTitle } from "@/components/panel-primitives";
import type { FootnoteRef, OrphanedFootnote } from "@/lib/types";

afterEach(cleanup);

const BODY = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "parked body" }] }],
};

const UNANCHORED = {
  id: "un1",
  unanchored: true,
  content: BODY,
  createdAt: "2026-08-02T00:00:00.000Z",
} as unknown as FootnoteRef;

const ORPHAN = {
  footnoteId: "orph1",
  content: BODY,
} as unknown as OrphanedFootnote;

function cardRoot(container: HTMLElement): HTMLElement {
  const el = container.querySelector("[data-card]") as HTMLElement | null;
  expect(el).toBeTruthy();
  return el!;
}

describe("UnanchoredFootnoteCard parked cue (task 278)", () => {
  it("wears the shared dashed/opacity parked cue + drag-to-anchor tooltip", () => {
    const { container } = render(
      <UnanchoredFootnoteCard
        footnote={UNANCHORED}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    const root = cardRoot(container);
    // Same idiom the Citation twin uses (UNANCHORED_CARD_CLASS).
    expect(root.className).toContain("border-dashed");
    expect(root.className).toContain("opacity-80");
    // The tooltip comes from the shared SSOT, footnote noun.
    expect(root.getAttribute("title")).toBe(unanchoredCardTitle("footnote"));
  });

  it("does NOT adopt the orphaned ERROR badge (its state is neutral `free`)", () => {
    const { container } = render(
      <UnanchoredFootnoteCard
        footnote={UNANCHORED}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[aria-label="No anchor in document"]'),
    ).toBeNull();
  });

  it("is visually distinct from the orphaned twin: orphan shows the error badge and NOT the parked cue", () => {
    const { container } = render(
      <OrphanedFootnoteCard orphan={ORPHAN} onEdit={vi.fn()} onDelete={vi.fn()} />,
    );
    // Orphan = error state: the BadgeOrphaned "no anchor" dot is present…
    expect(
      container.querySelector('[aria-label="No anchor in document"]'),
    ).toBeTruthy();
    // …and it must NOT wear the neutral parked cue (that would conflate the
    // deliberately-parked `free` state with the `orphaned` error state).
    const root = cardRoot(container);
    expect(root.className).not.toContain("border-dashed");
    expect(root.getAttribute("title")).not.toBe(unanchoredCardTitle("footnote"));
  });
});
