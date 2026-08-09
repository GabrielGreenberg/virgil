// @vitest-environment jsdom
//
// Task 106 — the un-archive AFFORDANCE exists and is reachable.
//
// The defect this pins was invisible to every other kind of check: the handler
// chain was live end-to-end and terminated in a panel that never destructured
// its props, so the app shipped for a year with no way to put archived text
// back into the document. `dead-panel-prop-guardrail` catches the *shape*;
// this catches the *behavior* — the control renders on an excerpt-bodied card,
// only on an excerpt-bodied card, only when a real provider is mounted, and
// pressing it calls the api with the card's own kind and id.
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

// Keep the suite light: both body surfaces mount real TipTap editors.
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
import { EditableCard, CARD_THEMES } from "@/components/panel-primitives";
import { CardRestoreActionsProvider } from "@/panels/_shared/card-restore-actions";
import { excerptCardKinds, isExcerptCardKind } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";

afterEach(cleanup);

const LABEL = "Restore to document";

function renderCard(kind: CardKind, restore?: (k: CardKind, id: string) => void) {
  const card = (
    <EditableCard
      id="c1"
      cardKind={kind}
      kind={kind}
      selected={false}
      theme={CARD_THEMES.archive}
      hideToolbar
      inlineDelete
      value={{ type: "doc", content: [] }}
      onChange={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  return render(
    restore
      ? (
        <CardRestoreActionsProvider value={{ enabled: true, restore }}>
          {card}
        </CardRestoreActionsProvider>
      )
      : card,
  );
}

describe("restore-to-document affordance", () => {
  it("the archive kind IS the excerpt kind — the affordance's membership source", () => {
    expect(excerptCardKinds()).toEqual(["archive"]);
    expect(isExcerptCardKind("archive")).toBe(true);
  });

  it("an excerpt card renders the control and calls the api with its kind + id", () => {
    const restore = vi.fn();
    renderCard("archive", restore);
    const btn = screen.getByLabelText(LABEL);
    fireEvent.click(btn);
    expect(restore).toHaveBeenCalledWith("archive", "c1");
  });

  it("a non-excerpt card renders no control (a note body is authored prose)", () => {
    renderCard("note", vi.fn());
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  it("with no provider mounted (or a restricted chrome) the control is hidden, not dead", () => {
    renderCard("archive");
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  it("a COLLAPSED card shows no overlay controls — parity with trash/archive", () => {
    // Stated rather than assumed: the whole bottom-right cluster is gated on
    // `!isCollapsed`, and archive cards render compressed until the user opens
    // one. So the flow is click-to-expand, then hover — identical to how the
    // same user would delete the card, and deliberately not a fourth glyph
    // painted over a two-line summary. Recorded here so a future reader knows
    // the expanded-only tests above are not the whole story.
    const restore = vi.fn();
    render(
      <CardRestoreActionsProvider value={{ enabled: true, restore }}>
        <EditableCard
          id="c1"
          cardKind="archive"
          kind="archive"
          selected={false}
          theme={CARD_THEMES.archive}
          hideToolbar
          inlineDelete
          compressed
          compressedSummary="some archived prose"
          value={{ type: "doc", content: [] }}
          onChange={vi.fn()}
          onDelete={vi.fn()}
        />
      </CardRestoreActionsProvider>,
    );
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    expect(screen.queryByLabelText("Delete")).toBeNull();
  });
});
