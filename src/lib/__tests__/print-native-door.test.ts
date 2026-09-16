// @vitest-environment jsdom
/**
 * Task 608 — THE SECOND PRINT DOOR enters the same posture as the first.
 *
 * The browser's own File → Print (and the PWA window menu's Print) reaches
 * only the `beforeprint` listener in `src/lib/print.ts`. Before 608 that
 * listener stamped nothing, so every `html[data-print-e-X="false"]` rule in
 * globals.css was inert: a writer's `%` comments, the marginalia and the
 * anchor underlines all printed (the ALL-ON posture — nobody's setting); the
 * user's saved appendix set was replaced by the shipped defaults; the page was
 * not isolated; the font size fell back to the CSS default.
 *
 * Contract: both doors apply the SAVED options synchronously — this door reads
 * them from the slot EditorLayout publishes, and falls back to the shipped
 * defaults only when nothing is published.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from "@/lib/print";
import {
  getPrintIntent,
  setSavedPrintOptions,
  clearSavedPrintOptions,
  getSavedPrintOptions,
} from "@/lib/print-intent";

const html = document.documentElement;

const SAVED: PrintOptions = {
  elements: {
    ...DEFAULT_PRINT_OPTIONS.elements,
    latexComments: false,
    marginalia: false,
    linkedAnchorUnderlines: false,
    title: false,
  },
  panels: {
    ...DEFAULT_PRINT_OPTIONS.panels,
    footnotes: false,
    bibliography: false,
    notes: true,
  },
  fontSizeRem: 1.25,
};

function buildVisiblePage() {
  const shell = document.createElement("div");
  const rail = document.createElement("div");
  const pane = document.createElement("div");
  const page = document.createElement("div");
  page.setAttribute("data-editor-page", "true");
  for (const el of [page, pane]) {
    Object.defineProperty(el, "offsetParent", { configurable: true, get: () => document.body });
    Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 100 });
  }
  pane.appendChild(page);
  shell.append(rail, pane);
  document.body.appendChild(shell);
  return { shell, rail, pane, page };
}

const printAttrs = () =>
  html.getAttributeNames().filter((n) => n.startsWith("data-print"));

beforeEach(() => {
  document.body.innerHTML = "";
  const current = getSavedPrintOptions();
  if (current) clearSavedPrintOptions(current);
});

afterEach(() => {
  window.dispatchEvent(new Event("afterprint"));
  const current = getSavedPrintOptions();
  if (current) clearSavedPrintOptions(current);
});

describe("File → Print (the `beforeprint` door)", () => {
  it("stamps the user's SAVED element posture, font size and appendix set", () => {
    setSavedPrintOptions(SAVED);
    window.dispatchEvent(new Event("beforeprint"));

    expect(html.dataset.printing).toBe("true");
    expect(html.getAttribute("data-print-e-latex-comments")).toBe("false");
    expect(html.getAttribute("data-print-e-marginalia")).toBe("false");
    expect(html.getAttribute("data-print-e-linked-anchor-underlines")).toBe("false");
    expect(html.getAttribute("data-print-e-title")).toBe("false");
    expect(html.getAttribute("data-print-e-citations")).toBe("true");
    expect(html.style.getPropertyValue("--print-font-size")).toBe("1.25rem");

    // The appendix tree mounts with the SAVED set, not the shipped defaults —
    // EditorPane renders `printIntent.options ?? prefs`, so a non-null default
    // here would override the user's choice.
    expect(getPrintIntent().active).toBe(true);
    expect(getPrintIntent().options).toBe(SAVED);
  });

  it("isolates the visible page exactly as Cmd+P does", () => {
    setSavedPrintOptions(SAVED);
    const { shell, rail, pane } = buildVisiblePage();
    window.dispatchEvent(new Event("beforeprint"));

    expect(pane.dataset.printAncestor).toBe("true");
    expect(shell.dataset.printAncestor).toBe("true");
    expect(rail.dataset.printHide).toBe("true");
  });

  it("afterprint removes every stamp and releases the appendices", () => {
    setSavedPrintOptions(SAVED);
    const { shell, rail, pane } = buildVisiblePage();
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("afterprint"));

    expect(printAttrs()).toEqual([]);
    expect(html.style.getPropertyValue("--print-font-size")).toBe("");
    expect(pane.dataset.printAncestor).toBeUndefined();
    expect(shell.dataset.printAncestor).toBeUndefined();
    expect(rail.dataset.printHide).toBeUndefined();
    expect(getPrintIntent()).toEqual({ active: false, options: null });
  });

  it("with nothing published (no editor mounted) prints the shipped defaults", () => {
    window.dispatchEvent(new Event("beforeprint"));

    expect(getPrintIntent().options).toBe(DEFAULT_PRINT_OPTIONS);
    for (const [k, v] of Object.entries(DEFAULT_PRINT_OPTIONS.elements)) {
      const attr = `data-print-e-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
      expect(html.getAttribute(attr), attr).toBe(v ? "true" : "false");
    }
  });

  it("a second beforeprint inside one cycle does not stack a second posture", () => {
    setSavedPrintOptions(SAVED);
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("afterprint"));
    expect(printAttrs()).toEqual([]);
    expect(getPrintIntent().active).toBe(false);
  });
});

describe("the saved-options slot", () => {
  it("a departing owner clears only its own value", () => {
    const newer: PrintOptions = { ...SAVED, fontSizeRem: 0.85 };
    setSavedPrintOptions(SAVED);
    setSavedPrintOptions(newer);
    clearSavedPrintOptions(SAVED); // the stale owner's cleanup
    expect(getSavedPrintOptions()).toBe(newer);
    clearSavedPrintOptions(newer);
    expect(getSavedPrintOptions()).toBeNull();
  });
});
