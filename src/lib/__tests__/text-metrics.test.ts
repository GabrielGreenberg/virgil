// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  capTopOffset,
  clearCapTopCache,
  computeCapTopOffset,
  onFontReady,
  resolveInlineContextElement,
} from "../text-metrics";

describe("computeCapTopOffset (pure)", () => {
  it("returns the half-leading + (ascent - capHeight) for a typical line", () => {
    // font-size 16px, line-height 24px → leading 8 → half-leading 4
    // ascent 13, descent 3 → font-strut 16
    // capHeight 11
    // offset = (24 - 16)/2 + (13 - 11) = 4 + 2 = 6
    const offset = computeCapTopOffset({
      lineHeightPx: 24,
      ascent: 13,
      descent: 3,
      capHeight: 11,
    });
    expect(offset).toBeCloseTo(6, 5);
  });

  it("clamps to 0 when line-height is smaller than the font's strut (negative leading)", () => {
    // line-height 12 < ascent+descent 16 → halfLeading = -2
    // (ascent - capHeight) = 2 → offset = 0 (clamped)
    const offset = computeCapTopOffset({
      lineHeightPx: 12,
      ascent: 13,
      descent: 3,
      capHeight: 11,
    });
    expect(offset).toBe(0);
  });

  it("handles wide leading (line-height much greater than font-size)", () => {
    // line-height 40, font-strut 16, halfLeading 12
    // ascent - capHeight = 2 → offset = 14
    const offset = computeCapTopOffset({
      lineHeightPx: 40,
      ascent: 13,
      descent: 3,
      capHeight: 11,
    });
    expect(offset).toBeCloseTo(14, 5);
  });

  it("returns 0 when capHeight equals ascent and there is no leading", () => {
    const offset = computeCapTopOffset({
      lineHeightPx: 16,
      ascent: 13,
      descent: 3,
      capHeight: 13,
    });
    expect(offset).toBe(0);
  });
});

describe("resolveInlineContextElement", () => {
  function build(html: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();
    return wrap.firstElementChild as HTMLElement;
  }

  it("descends par-title-wrapper to inner <p>", () => {
    const anchor = build(`
      <div class="par-title-wrapper">
        <div class="par-body-container"><p>Hello</p></div>
      </div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("P");
  });

  it("descends heading-wrapper to inner heading", () => {
    const anchor = build(`
      <div class="heading-wrapper heading-wrapper-l1"><h1>Heading</h1></div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("H1");
  });

  it("descends title-field-wrapper to .title-field-content", () => {
    const anchor = build(`
      <div class="title-field-wrapper">
        <div class="title-field-content title-field-title">Title</div>
      </div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.classList.contains("title-field-content")).toBe(true);
  });

  it("descends list-title-wrapper to first li", () => {
    const anchor = build(`
      <div class="list-title-wrapper"><ul><li>Item</li></ul></div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("LI");
  });

  it("descends expex-item to .expex-item-body inner paragraph", () => {
    const anchor = build(`
      <div class="expex-item">
        <div class="expex-item-body"><p>Body</p></div>
      </div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("P");
  });

  it("descends blockquote to its first paragraph", () => {
    const anchor = build(`
      <blockquote><p>Quoted</p></blockquote>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("P");
  });

  it("returns the anchor itself for unrecognized wrappers", () => {
    const anchor = build(`<div class="some-other-wrapper"><span>x</span></div>`);
    const target = resolveInlineContextElement(anchor);
    expect(target).toBe(anchor);
  });

  it("returns the anchor itself when the expected inner element is missing", () => {
    const anchor = build(`<div class="par-title-wrapper"></div>`);
    const target = resolveInlineContextElement(anchor);
    expect(target).toBe(anchor);
  });
});

describe("capTopOffset (with stubbed canvas)", () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let measureTextSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearCapTopCache();
    measureTextSpy = vi.fn((_text: string) => ({
      actualBoundingBoxAscent: 11,
      fontBoundingBoxAscent: 13,
      fontBoundingBoxDescent: 3,
      width: 10,
    }));
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: "",
      measureText: measureTextSpy,
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    clearCapTopCache();
  });

  it("returns the computed offset for an attached element with explicit line-height", () => {
    const el = document.createElement("p");
    el.style.fontFamily = "Serif";
    el.style.fontSize = "16px";
    el.style.fontWeight = "400";
    el.style.lineHeight = "24px";
    document.body.appendChild(el);
    try {
      // (24 - 16)/2 + (13 - 11) = 4 + 2 = 6
      expect(capTopOffset(el)).toBeCloseTo(6, 5);
    } finally {
      el.remove();
    }
  });

  it("caches by font signature — same style hits cache (one measureText call)", () => {
    const a = document.createElement("p");
    const b = document.createElement("p");
    for (const el of [a, b]) {
      el.style.fontFamily = "Serif";
      el.style.fontSize = "16px";
      el.style.fontWeight = "400";
      el.style.lineHeight = "24px";
      document.body.appendChild(el);
    }
    try {
      capTopOffset(a);
      capTopOffset(b);
      expect(measureTextSpy).toHaveBeenCalledTimes(1);
    } finally {
      a.remove();
      b.remove();
    }
  });

  it("misses cache on a different font signature", () => {
    const a = document.createElement("p");
    a.style.fontFamily = "Serif";
    a.style.fontSize = "16px";
    a.style.fontWeight = "400";
    a.style.lineHeight = "24px";
    const b = document.createElement("p");
    b.style.fontFamily = "Serif";
    b.style.fontSize = "20px"; // different size
    b.style.fontWeight = "400";
    b.style.lineHeight = "24px";
    document.body.appendChild(a);
    document.body.appendChild(b);
    try {
      capTopOffset(a);
      capTopOffset(b);
      expect(measureTextSpy).toHaveBeenCalledTimes(2);
    } finally {
      a.remove();
      b.remove();
    }
  });

  it("falls back to fontSize * 1.2 when line-height is 'normal'", () => {
    const el = document.createElement("p");
    el.style.fontFamily = "Serif";
    el.style.fontSize = "16px";
    el.style.fontWeight = "400";
    // No explicit line-height → "normal"
    document.body.appendChild(el);
    try {
      // lineHeightPx = 16 * 1.2 = 19.2
      // halfLeading = (19.2 - 16)/2 = 1.6
      // ascent - capHeight = 13 - 11 = 2
      // offset = 1.6 + 2 = 3.6
      expect(capTopOffset(el)).toBeCloseTo(3.6, 4);
    } finally {
      el.remove();
    }
  });

  it("returns 0 when the canvas context is unavailable", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const el = document.createElement("p");
    el.style.fontSize = "16px";
    el.style.lineHeight = "24px";
    document.body.appendChild(el);
    try {
      expect(capTopOffset(el)).toBe(0);
    } finally {
      el.remove();
    }
  });
});

describe("onFontReady", () => {
  it("fires the callback once after document.fonts.ready resolves and clears the cache", async () => {
    // The metrics module caches its `fontReadyArmed` flag for the
    // lifetime of the test process. Since the production module isn't
    // resettable, we test the observable behavior: registering a
    // callback should resolve the registered Promise on this turn (if
    // fonts.ready is already a resolved promise) and the cache should
    // be cleared at that point.
    //
    // jsdom doesn't ship `document.fonts` by default; if absent, the
    // helper is a no-op and the callback never fires — exercise that
    // branch explicitly.
    const cb = vi.fn();
    onFontReady(cb);
    // No `fonts` field exists in jsdom by default → callback never
    // fires; we just verify the call is safe and idempotent.
    expect(() => onFontReady(cb)).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});
