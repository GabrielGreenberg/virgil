// @vitest-environment jsdom
//
// C25 (FN-C1-01 / FN-F1-03 / FN-F2-02) — the Footnotes panel header count AND
// the keyboard cycle must reflect the RENDERED union (orphans + anchored), not
// the anchored sub-array.
//
//   • FN-C1-01 / FN-F1-03: the badge used `footnotes.length`, so a panel with
//     orphans undercounted (and showed no badge at all when only orphans were
//     present). Fixed to `items.length`.
//   • FN-F2-02: `useCycle(footnotes, …)` cycled only the anchored sub-array, so
//     ArrowUp/Down keyboard nav skipped the orphan cards that render at the
//     TOP. Fixed by cycling `items` (orphans-first union); the activate selects
//     every item and only scroll-to-marker's the anchored ones (orphans have no
//     in-text callout).
//
// panel-primitives transitively pulls `@/lib/storage` — stub it. The card
// components mount real editors — stub them to light divs so the test pins the
// panel's count/cycle wiring, not card internals.

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
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import FootnotePanel from "@/panels/Footnotes/FootnotePanel";
import type { FootnoteInfo } from "@/components/Editor";
import type { OrphanedFootnote } from "@/lib/types";

afterEach(cleanup);

const body = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const ANCHORED: FootnoteInfo[] = [
  { footnoteId: "a1", content: body("anchored 1"), number: 1, pos: 10 },
  { footnoteId: "a2", content: body("anchored 2"), number: 2, pos: 20 },
];
const ORPHANS: OrphanedFootnote[] = [
  { footnoteId: "o1", content: body("orphan 1"), orphanedAt: "2026-01-01" },
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
    orphanedFootnotes: ORPHANS,
    onDeleteOrphan: vi.fn(),
    onEditOrphan: vi.fn(),
    ...overrides,
  };
  const utils = render(<FootnotePanel {...props} />);
  return { props, ...utils };
}

function keyTarget(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!el) throw new Error("scroll container (tabindex=0) not found");
  return el;
}

// Selection is controlled by the host in the real app — the cycle's
// `selectedId → cycleIdx` sync effect depends on the prop updating. Wrap the
// panel so `onSelect` actually drives `selectedId`, mirroring the host.
function ControlledPanel({
  onSelectSpy,
  onScrollSpy,
  footnotes = ANCHORED,
}: {
  onSelectSpy: (id: string | null) => void;
  onScrollSpy: (id: string) => void;
  footnotes?: FootnoteInfo[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <FootnotePanel
      footnotes={footnotes}
      selectedId={selectedId}
      onSelect={(id) => {
        onSelectSpy(id);
        setSelectedId(id);
      }}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onScrollToMarker={(id) => onScrollSpy(id)}
      orphanedFootnotes={ORPHANS}
      onDeleteOrphan={vi.fn()}
      onEditOrphan={vi.fn()}
    />
  );
}

describe("C25 — Footnotes badge counts the rendered union (FN-C1-01 / FN-F1-03)", () => {
  it("badge == anchored + orphan count, matching the rendered card count", () => {
    const { container } = renderPanel();
    const badge = container.querySelector(".panel-header-count");
    // 2 anchored + 1 orphan.
    expect(badge?.textContent).toBe("3");
    expect(screen.getAllByTestId("anchored-card").length).toBe(2);
    expect(screen.getAllByTestId("orphan-card").length).toBe(1);
  });

  it("an orphans-only panel still shows a badge (>0), not a blank header", () => {
    const { container } = renderPanel({ footnotes: [] });
    const badge = container.querySelector(".panel-header-count");
    expect(badge?.textContent).toBe("1");
    expect(screen.getAllByTestId("orphan-card").length).toBe(1);
    expect(screen.queryAllByTestId("anchored-card").length).toBe(0);
  });
});

describe("C25 — keyboard cycle visits orphans (FN-F2-02)", () => {
  it("ArrowDown from a clean panel lands on the FIRST item — the orphan (rendered at the top)", () => {
    const { props, container } = renderPanel();
    fireEvent.keyDown(keyTarget(container), { key: "ArrowDown" });
    // items order is [orphan o1, anchored a1, a2] → first cycle target is o1.
    expect(props.onSelect).toHaveBeenCalledWith("o1");
    // Orphans have no in-text marker — the jump must NOT fire for them.
    expect(props.onScrollToMarker).not.toHaveBeenCalled();
  });

  it("ArrowUp from a clean panel wraps to the LAST anchored item and DOES jump", () => {
    const { props, container } = renderPanel();
    fireEvent.keyDown(keyTarget(container), { key: "ArrowUp" });
    // Last item is anchored a2 → selects AND scrolls to its marker.
    expect(props.onSelect).toHaveBeenCalledWith("a2");
    expect(props.onScrollToMarker).toHaveBeenCalledWith("a2");
  });

  it("ArrowDown twice steps orphan → first anchored (the union is one continuous cycle)", () => {
    const onSelectSpy = vi.fn();
    const onScrollSpy = vi.fn();
    const { container } = render(
      <ControlledPanel onSelectSpy={onSelectSpy} onScrollSpy={onScrollSpy} />,
    );
    const target = keyTarget(container);
    fireEvent.keyDown(target, { key: "ArrowDown" }); // o1 (orphan, no jump)
    fireEvent.keyDown(target, { key: "ArrowDown" }); // a1 (anchored, jumps)
    expect(onSelectSpy).toHaveBeenNthCalledWith(1, "o1");
    expect(onSelectSpy).toHaveBeenNthCalledWith(2, "a1");
    expect(onScrollSpy).toHaveBeenCalledWith("a1");
    // The orphan step never jumped (no in-text marker).
    expect(onScrollSpy).not.toHaveBeenCalledWith("o1");
  });
});
