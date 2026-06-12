// @vitest-environment jsdom
//
// Pins for the UI-consistency sweep (Session-17 backlog #22/#23):
//   1. PanelCard stamps `--link-anchor-color` from `theme.accent` on the
//      card root (G3) — the kind color for the hover/selected outline
//      rules derives from CARD_THEMES, replacing the deleted
//      `[data-card-key^="float:card:<kind>:"]` CSS prefix block. Every
//      kind is covered because every card passes `theme`.
//   2. CardMetaLabel / CardMono render the ratified in-card tiers (T2):
//      meta = 10px `.card-meta-label`, mono = `.card-mono` override-first
//      stack at meta (10px) or content (12px).
//   3. PANEL.cardBody is the single ratified body-padding token (G1).
//   4. The three preview-chrome font emitters (FontsDialog / FontPicker /
//      SmartPreferences) carry no local `fontStack` helper and route
//      through `resolveFontStack` (T4) — source-level pin.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

import { render, cleanup } from "@testing-library/react";
import {
  PanelCard,
  CardMetaLabel,
  CardMono,
  CARD_THEMES,
  PANEL,
  cardTitleStyle,
} from "@/components/panel-primitives";

afterEach(cleanup);

describe("G3: PanelCard stamps --link-anchor-color from theme.accent", () => {
  it("docked card root carries the theme accent as --link-anchor-color", () => {
    const theme = CARD_THEMES.note;
    const { container } = render(
      <PanelCard theme={theme} selected={false} kind="note" cardKey="float:card:note:n1">
        <div>body</div>
      </PanelCard>,
    );
    const root = container.querySelector("[data-card]") as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.style.getPropertyValue("--link-anchor-color")).toBe(theme.accent);
  });

  it("covers the kinds the old CSS prefix block omitted (bib / ai / example / error)", () => {
    for (const key of ["bib", "aiRequest", "example", "error"] as const) {
      const theme = CARD_THEMES[key];
      const { container } = render(
        <PanelCard theme={theme} selected={false}>
          <div>body</div>
        </PanelCard>,
      );
      const root = container.querySelector("[data-card]") as HTMLElement;
      expect(root.style.getPropertyValue("--link-anchor-color"), key).toBe(theme.accent);
      cleanup();
    }
  });

  it("popped (chromeless) cards keep the stamp too", () => {
    const theme = CARD_THEMES.todo;
    const { container } = render(
      <PanelCard theme={theme} selected={false} isPoppedOut chromeless kind="todo">
        <div>body</div>
      </PanelCard>,
    );
    const root = container.querySelector("[data-card]") as HTMLElement;
    expect(root.style.getPropertyValue("--link-anchor-color")).toBe(theme.accent);
  });

  it("the hand-mirrored CSS prefix block is gone from globals.css", () => {
    const css = readFileSync(
      resolve(__dirname, "../../app/globals.css"),
      "utf8",
    );
    expect(css).not.toMatch(/\[data-card-key\^="float:card:[a-z-]+:"\]\s*\{/);
  });
});

describe("T2: in-card tier primitives", () => {
  it("CardMetaLabel renders the .card-meta-label token", () => {
    const { container } = render(<CardMetaLabel>Type</CardMetaLabel>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.classList.contains("card-meta-label")).toBe(true);
    expect(el.textContent).toBe("Type");
  });

  it("CardMono routes through .card-mono at the two ratified sizes", () => {
    const { container: meta } = render(<CardMono>\cite{"{x}"}</CardMono>);
    const metaEl = meta.firstElementChild as HTMLElement;
    expect(metaEl.classList.contains("card-mono")).toBe(true);
    expect(metaEl.classList.contains("text-[10px]")).toBe(true);

    const { container: content } = render(<CardMono size="content">key2026</CardMono>);
    const contentEl = content.firstElementChild as HTMLElement;
    expect(contentEl.classList.contains("card-mono")).toBe(true);
    expect(contentEl.classList.contains("text-[12px]")).toBe(true);
  });

  it("cardTitleStyle is the par-title TITLE dialect, themed via titleColor", () => {
    const theme = CARD_THEMES.citation;
    const style = cardTitleStyle(theme);
    expect(style.fontSize).toBe("var(--par-title-size, 0.78rem)");
    expect(style.fontWeight).toBe(500);
    expect(style.color).toBe(theme.titleColor);
    // Unthemed fallback keeps the par-title color var.
    expect(cardTitleStyle().color).toBe("var(--par-title-color, #c45a5a)");
  });
});

describe("G1: the ratified body-padding token", () => {
  it("PANEL.cardBody is px-3 pt-1.5 pb-2", () => {
    expect(PANEL.cardBody).toBe("px-3 pt-1.5 pb-2");
  });
});

describe("T4: preview-chrome sites have no local fontStack helper", () => {
  const SITES = [
    "../FontsDialog.tsx",
    "../FontPicker.tsx",
    "../SmartPreferences.tsx",
  ];
  for (const rel of SITES) {
    it(`${rel.replace("../", "")} imports resolveFontStack and defines no local helper`, () => {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src).not.toMatch(/function fontStack\s*\(/);
      expect(src).toContain("resolveFontStack");
    });
  }
});
