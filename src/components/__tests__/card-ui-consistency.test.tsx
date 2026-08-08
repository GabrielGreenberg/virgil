// @vitest-environment jsdom
//
// Pins for the UI-consistency sweep (Session-17 backlog #22/#23):
//   1. PanelCard stamps `--link-anchor-color` from `theme.accent` on the
//      card root (G3) — the kind color for the hover/selected outline
//      rules derives from CARD_THEMES, replacing the deleted
//      `[data-card-key^="float:card:<kind>:"]` CSS prefix block. Every
//      kind is covered because every card passes `theme`.
//   2. CardMetaLabel renders the ratified META tier (10px
//      `.card-meta-label`); mono-in-card uses the `.card-mono` class token
//      directly (the unused CardMono wrapper was deleted).
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
  CARD_THEMES,
  PANEL,
  cardTitleStyle,
} from "@/components/panel-primitives";
import * as panelPrimitives from "@/components/panel-primitives";

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

describe("Omni 'dim at rest': PanelCard selection marker + CSS contract", () => {
  it("PanelCard stamps `data-selected` on the card root ONLY when selected", () => {
    const theme = CARD_THEMES.note;
    const sel = render(
      <PanelCard theme={theme} selected kind="note" cardKey="float:card:note:s1">
        <div>body</div>
      </PanelCard>,
    );
    const selRoot = sel.container.querySelector("[data-card]") as HTMLElement;
    // Present (empty value) when selected → the omni-dim CSS exempts it via
    // `[data-omni-entry]:not([data-selected])`, preserving the selected look.
    expect(selRoot.hasAttribute("data-selected")).toBe(true);
    cleanup();

    const unsel = render(
      <PanelCard theme={theme} selected={false} kind="note" cardKey="float:card:note:u1">
        <div>body</div>
      </PanelCard>,
    );
    const unselRoot = unsel.container.querySelector("[data-card]") as HTMLElement;
    expect(unselRoot.hasAttribute("data-selected")).toBe(false);
  });

  it("globals.css inverts omni cards under data-omni-dim, exempting selected", () => {
    const css = readFileSync(
      resolve(__dirname, "../../app/globals.css"),
      "utf8",
    );
    // Resting recede + hover brighten, both scoped to omni cards only and
    // skipping the selected card. (jsdom can't compute stylesheet styles, so
    // this pins the rule shape at the source level.)
    expect(css).toMatch(
      /\[data-omni-dim="true"\]\s+\[data-omni-entry\]:not\(\[data-selected\]\)\s*\{/,
    );
    expect(css).toMatch(
      /\[data-omni-dim="true"\]\s+\[data-omni-entry\]:not\(\[data-selected\]\):hover\s*\{/,
    );
  });
});

describe("T2: in-card tier primitives", () => {
  it("CardMetaLabel renders the .card-meta-label token", () => {
    const { container } = render(<CardMetaLabel>Type</CardMetaLabel>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.classList.contains("card-meta-label")).toBe(true);
    expect(el.textContent).toBe("Type");
  });

  it("CardMono is gone — `.card-mono` is the in-card mono token (backlog #28)", () => {
    // The unused CardMono wrapper was deleted (its two-size API couldn't
    // express the bare/inherit call sites). Mono-in-card sits on the
    // `.card-mono` class, set directly at each call site.
    expect(
      (panelPrimitives as Record<string, unknown>).CardMono,
    ).toBeUndefined();
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

describe("T2 (typography drift): no stray 11px label in the Word Count panel", () => {
  // The ratified META tier is 10px/500 (`.card-meta-label`); the STYLE_GUIDE
  // calls anything at 10.5/11/11.5px a stray. WordCountPanel's uppercase unit
  // captions ("words"/"chars"/"Words"/"Characters") drifted to text-[11px]
  // hand-rolled soup (task 312) — pin them to the CardMetaLabel primitive so
  // the previously-unguarded stray-size class can't regress. Source-read pin
  // (like the T4 fontStack pin) to avoid mounting the panel.
  it("WordCountPanel.tsx routes unit captions through CardMetaLabel, no text-[11px]", () => {
    const src = readFileSync(
      resolve(__dirname, "../../panels/WordCount/WordCountPanel.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/text-\[11px\]/);
    expect(src).toMatch(/CardMetaLabel/);
  });
});

describe("T4: preview-chrome sites have no local fontStack helper", () => {
  const SITES = [
    "../FontsDialog.tsx",
    "../FontPicker.tsx",
    "../SmartPreferences.tsx",
  ];
  for (const rel of SITES) {
    it(`${rel.replace("../", "")} routes through a shared resolver and defines no local helper`, () => {
      const src = readFileSync(resolve(__dirname, rel), "utf8");
      expect(src).not.toMatch(/function fontStack\s*\(/);
      // Either the applied-style resolver or the preview-only resolver from
      // panel-typography (backlog #28 added resolvePreviewFontStack for the
      // option previews) — never a bespoke local stack.
      expect(src).toMatch(/resolve(Preview)?FontStack/);
    });
  }
});
