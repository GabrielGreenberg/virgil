// @vitest-environment jsdom
//
// Task 082 (cluster member) — the Footnotes panel shares the two keyboard-nav
// defects fixed for Citations, retired via the same shared primitives:
//
//   • M1 (useArchiveVisibleItems): the cycle iterated the UNFILTERED union while
//     CardListPanel renders only the archive-view-filtered set, so ArrowUp/Down
//     could step onto an archived (Active-view-hidden) atomless ref card. The
//     cycle now iterates the same visible set.
//   • M2 (useListNavKeys): arrows inside a card's inputs no longer hijack the
//     card cycle (shared editable-target guard).

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

vi.mock("@/panels/Footnotes/FootnoteCard", () => ({
  FootnoteCard: ({ footnote }: { footnote: { footnoteId: string } }) => (
    <div data-testid="anchored-card" data-id={footnote.footnoteId} />
  ),
  OrphanedFootnoteCard: ({ orphan }: { orphan: { footnoteId: string } }) => (
    <div data-testid="orphan-card" data-id={orphan.footnoteId} />
  ),
  UnanchoredFootnoteCard: ({ footnote }: { footnote: { id: string } }) => (
    <div data-testid="ref-card" data-id={footnote.id} />
  ),
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, fireEvent, cleanup } from "@testing-library/react";
import { type ComponentProps } from "react";
import FootnotePanel from "@/panels/Footnotes/FootnotePanel";
import type { FootnoteInfo } from "@/components/Editor";
import type { FootnoteRef } from "@/lib/types";

afterEach(cleanup);

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const ANCHORED: FootnoteInfo[] = [
  { footnoteId: "a1", content: body("anchored 1"), number: 1, pos: 10 },
];

// One archived + one active atomless ref.
const REFS: FootnoteRef[] = [
  {
    id: "r-arch",
    content: body("archived ref"),
    createdAt: "2026-01-01",
    archived: true,
    unanchored: true,
  },
  {
    id: "r-live",
    content: body("live ref"),
    createdAt: "2026-01-01",
    unanchored: true,
  },
];

type PanelProps = ComponentProps<typeof FootnotePanel>;
function renderPanel(overrides: Partial<PanelProps> = {}) {
  const props: PanelProps = {
    footnotes: ANCHORED,
    selectedId: null,
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onScrollToMarker: vi.fn(),
    orphanedFootnotes: [],
    onDeleteOrphan: vi.fn(),
    onEditOrphan: vi.fn(),
    unanchoredFootnotes: REFS,
    ...overrides,
  };
  return { props, ...render(<FootnotePanel {...props} />) };
}

function keyTarget(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!el) throw new Error("scroll container (tabindex=0) not found");
  return el;
}

describe("Task 082 M1 — Footnotes cycle skips the archived ref", () => {
  it("ArrowUp/Down never activates the Active-view-hidden archived ref", () => {
    const { props, container } = renderPanel();

    // Only the live ref + anchored footnote render (archived ref is hidden).
    expect(
      Array.from(container.querySelectorAll<HTMLElement>("[data-testid=ref-card]")).map(
        (el) => el.dataset.id,
      ),
    ).toEqual(["r-live"]);

    const target = keyTarget(container);
    fireEvent.keyDown(target, { key: "ArrowDown" });
    fireEvent.keyDown(target, { key: "ArrowDown" });
    fireEvent.keyDown(target, { key: "ArrowUp" });
    fireEvent.keyDown(target, { key: "ArrowUp" });

    const selected = (props.onSelect as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0],
    );
    expect(selected.length).toBeGreaterThan(0);
    expect(selected).not.toContain("r-arch");
    // Only the two visible items are ever activated.
    expect(new Set(selected)).toEqual(new Set(["r-live", "a1"]));
  });
});
