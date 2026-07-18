// @vitest-environment jsdom
//
// task 175 member A — the docked Todo card must re-tint LIVE when the user
// changes "Todo color".
//
// `TodoRow` was the single theme-blind card family in the app: it bound
// `const theme = CARD_THEMES.todo` at MODULE scope, and `CARD_THEMES` is a
// one-time fold over the SHIPPED `DEFAULT_PANEL_COLORS` — override-blind by
// construction, so no re-render could ever pick up a user color. Meanwhile the
// todo margin marker, the in-text anchor, and the POPPED-OUT float all resolve
// through the override-aware `getPanelColor` path. Setting Todo → Purple
// therefore split the kind against itself inside one window: pop a todo out and
// the float and the docked list disagreed about what color a todo is.
//
// The fix routes TodoRow through `useCardTheme("todo")`, which is
// `useSyncExternalStore`-subscribed to the panel-color version counter. These
// tests pin the LIVE re-tint (no reload, no remount) at the render seam.

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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, act } from "@testing-library/react";
import { TodoRow } from "@/panels/Todo/TodoRow";
import { defaultCardStore as cardStore } from "@/links/_shared/anchored-card-store";
import {
  setPanelColor,
  clearPanelColor,
  getPanelColor,
  themeFromAccent,
  DEFAULT_PANEL_COLORS,
} from "@/lib/panel-theme";
import type { TodoItem } from "@/lib/types";

const REF = { kind: "todo" as const, id: "t1" };
const PURPLE = "#7c3aed";

afterEach(() => {
  cleanup();
  act(() => {
    clearPanelColor("todo");
  });
});

function makeTodo(): TodoItem {
  return {
    id: "t1",
    text: "Write the discussion section",
    titleAuto: true,
    notes: "",
    done: false,
    aiRequest: false,
    createdAt: "2026-07-06T00:00:00.000Z",
    links: [],
  } as unknown as TodoItem;
}

function renderRow() {
  cardStore.expand(REF);
  return render(
    <TodoRow
      item={makeTodo()}
      selected /* selected so the accent-derived border is painted */
      onToggle={vi.fn()}
      onUpdate={vi.fn()}
      onUpdateNotes={vi.fn()}
      onSetAiRequest={vi.fn()}
      onDelete={vi.fn()}
      onSelect={vi.fn()}
      isAnchored={false}
    />,
  );
}

/** Every inline `style` attribute in the subtree, concatenated. The accent
 *  reaches the DOM as inline style (header tint, selected border, separator),
 *  so this is the render-seam view of "what color is this card". */
function inlineStyles(container: HTMLElement): string {
  return [...container.querySelectorAll<HTMLElement>("[style]")]
    .map((el) => el.getAttribute("style") ?? "")
    .join(" | ");
}

/** jsdom serializes inline colors as `rgb(r, g, b)`. */
function rgbOf(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

describe("Todo color override re-tints the docked card live (task 175)", () => {
  it("paints the SHIPPED todo accent before any override", () => {
    const { container } = renderRow();
    const shipped = themeFromAccent(DEFAULT_PANEL_COLORS.todo);
    expect(inlineStyles(container)).toContain(rgbOf(shipped.borderSelected));
  });

  it("re-tints to the overridden accent WITHOUT a remount", () => {
    const { container } = renderRow();
    const shipped = themeFromAccent(DEFAULT_PANEL_COLORS.todo);
    const before = inlineStyles(container);
    expect(before).toContain(rgbOf(shipped.borderSelected));

    // The same call the "Todo color" picker makes.
    act(() => {
      setPanelColor("todo", PURPLE);
    });

    const after = inlineStyles(container);
    const overridden = themeFromAccent(PURPLE);

    expect(getPanelColor("todo")).toBe(PURPLE);
    expect(after, "docked Todo card ignored the color override").toContain(
      rgbOf(overridden.borderSelected),
    );
    expect(after).not.toContain(rgbOf(shipped.borderSelected));
    expect(after).not.toBe(before);
  });

  it("agrees with the popped-out float, which already derived live", () => {
    // The float builder reads `themeFromAccent(getPanelColor(themeKey))`
    // (cards/floats/index.tsx). After the fix BOTH sides resolve to the same
    // accent — that agreement is the actual user-visible contract.
    const { container } = renderRow();
    act(() => {
      setPanelColor("todo", PURPLE);
    });
    const floatAccent = themeFromAccent(getPanelColor("todo"));
    expect(inlineStyles(container)).toContain(rgbOf(floatAccent.borderSelected));
  });

  it("returns to the shipped accent when the override is cleared", () => {
    const { container } = renderRow();
    act(() => {
      setPanelColor("todo", PURPLE);
    });
    act(() => {
      clearPanelColor("todo");
    });
    const shipped = themeFromAccent(DEFAULT_PANEL_COLORS.todo);
    expect(inlineStyles(container)).toContain(rgbOf(shipped.borderSelected));
  });
});
