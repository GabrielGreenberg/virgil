// @vitest-environment jsdom
//
// Pins the FloatChrome header-tint contract (pop-out continuity #20):
// a card float passes its kind's `theme.headerDefault` via
// `Floatable.headerTint` and the strip paints it; absent (text-object
// floats), the neutral `--surface-muted-strong` fallback is unchanged.

import { describe, it, expect, vi, afterEach } from "vitest";

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup } from "@testing-library/react";
import { FloatChrome } from "@/floats/FloatChrome";

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
