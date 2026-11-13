// @vitest-environment jsdom
// Task 1611 — a card title is sized in its REAL font, and shows its focus
// underline.
//
// `autoSizeInput` used to measure on one first frame and then only on `input`
// events. That frame usually lands before the web fonts do, so the width was
// a fallback-font width and `TITLE_CLASS`'s `text-ellipsis` clipped the title
// until the user typed. It now re-measures on every completed font wave via
// the app's ONE font-ready signal (`onFontReady`), and its cleanup unregisters.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

class FakeFontFaceSet extends EventTarget {
  status: "loading" | "loaded" = "loading";
}

let fonts: FakeFontFaceSet;

beforeEach(() => {
  vi.resetModules();
  fonts = new FakeFontFaceSet();
  Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function load() {
  const sizer = await import("@/lib/autoSizeInput");
  const metrics = await import("@/lib/text-metrics");
  return { ...sizer, ...metrics };
}

/** Stub the shared sizer span's width so a "font load" is observable. */
function stubSpanWidth(get: () => number) {
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.tagName === "SPAN" ? get() : 0;
  });
}

describe("autoSizeInput — re-measures when fonts arrive (task 1611)", () => {
  it("a completed font wave re-sizes the input; cleanup unregisters the callback", async () => {
    const { autoSizeInput, __fontReadyPendingCount } = await load();
    let width = 40; // fallback-font width
    stubSpanWidth(() => width);
    const input = document.createElement("input");
    input.value = "A title in the par-title font";
    document.body.appendChild(input);

    const before = __fontReadyPendingCount();
    const cleanup = autoSizeInput(input);
    expect(__fontReadyPendingCount()).toBe(before + 1);

    width = 120; // the real font finished loading
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(input.style.width).toBe("122px");

    cleanup();
    expect(__fontReadyPendingCount()).toBe(before);
    width = 300;
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(input.style.width).toBe("122px");
  });

  it("a detached input is not measured by a late font wave", async () => {
    const { autoSizeInput } = await load();
    stubSpanWidth(() => 77);
    const input = document.createElement("input");
    input.value = "x";
    const cleanup = autoSizeInput(input);
    fonts.dispatchEvent(new Event("loadingdone"));
    expect(input.style.width).toBe("");
    cleanup();
  });

  it("the floor is a real `ch` min-width, not a hard-coded 8px per character", async () => {
    const { syncInputWidth } = await load();
    stubSpanWidth(() => 0);
    const input = document.createElement("input");
    document.body.appendChild(input);
    syncInputWidth(input, 3);
    expect(input.style.minWidth).toBe("3ch");
    expect(input.style.width).toBe("2px");
  });
});

describe("card title focus underline (task 1611)", () => {
  const ROOT = process.cwd();
  it("globals.css draws the guide's underline on both title fields' :focus-visible", () => {
    const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
    const rule = /\.card-title-input:focus-visible,\s*\.card-title-focus:focus-visible\s*\{([^}]*)\}/.exec(css);
    expect(rule, "the card-title focus rule is missing").not.toBeNull();
    expect(rule![1]).toMatch(/box-shadow:\s*inset 0 -1px 0 var\(--ink-strong\)/);
  });

  it("CardTitleInput's TITLE_CLASS carries the class the rule targets", () => {
    const src = readFileSync(join(ROOT, "src/components/panel-primitives.tsx"), "utf8");
    const m = /const TITLE_CLASS = "([^"]*)"/.exec(src);
    expect(m?.[1].split(/\s+/)).toContain("card-title-focus");
  });
});
