// @vitest-environment jsdom
//
// Pop residue contract (Session-17 backlog #21): a popped card's DOCKED
// render stays fully live in its panel — the float is a SECOND presence,
// not a relocation. ExampleCard was the last card still self-suppressing
// (`if (popped?.isPopped(cardKey) && !isPoppedOut) return null;` —
// reintroduced in 4ef533c after ba90bd9 removed the pattern everywhere).
// This suite pins the fixed behavior so the drift can't return.

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

// Keep the suite light: both rich-text bodies mount real TipTap editors —
// irrelevant to the render-while-popped contract.
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
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import {
  PoppedCardsContext,
  type PoppedCardsValue,
} from "@/hooks/usePoppedCards";
import { popKey } from "@/panels/panel-registry";
import type { ExampleInfo } from "@/components/Editor";

afterEach(cleanup);

const example = {
  exampleId: "ex1",
  number: "1",
  bodyText: "Colorless green ideas sleep furiously.",
  items: [],
  latex: "\\ex Colorless green ideas sleep furiously. \\xe",
} as unknown as ExampleInfo;

const cardKey = popKey("examples", "ex1");

function poppedCtx(poppedKeys: string[]): PoppedCardsValue {
  return {
    poppedKeys,
    isPopped: (k) => poppedKeys.includes(k),
    toggle: () => {},
    toggleAtAnchor: () => {},
    popOutAtRect: () => {},
    close: () => {},
    getFloatPosition: () => undefined,
    setFloatPosition: () => {},
  };
}

function renderDocked(poppedKeys: string[]) {
  return render(
    <PoppedCardsContext.Provider value={poppedCtx(poppedKeys)}>
      <ExampleCard
        example={example}
        isSelected={false}
        onSelect={() => {}}
        onJump={() => {}}
      />
    </PoppedCardsContext.Provider>,
  );
}

describe("ExampleCard pop residue (#21)", () => {
  it("the docked card RENDERS while its pop key is active", () => {
    const { container } = renderDocked([cardKey]);
    // The regression returned null here, vanishing the docked card.
    expect(container.querySelector("[data-card]")).not.toBeNull();
    expect(
      screen.getByText(/Colorless green ideas sleep furiously\./),
    ).toBeTruthy();
  });

  it("control: renders identically when not popped", () => {
    const { container } = renderDocked([]);
    expect(container.querySelector("[data-card]")).not.toBeNull();
  });
});
