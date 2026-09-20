// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __fontReadyPendingCount,
  __textWidthCacheSize,
  capBandCenterOffset,
  capHeight,
  capTopOffset,
  clearCapTopCache,
  computeCapTopOffset,
  measureTextWidth,
  onFontReady,
  opticalCenterY,
  resolveInlineContextElement,
  resolveLineHeightPx,
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

  it("descends list-title-wrapper to first li (bare li, no inner <p>)", () => {
    const anchor = build(`
      <div class="list-title-wrapper"><ul><li>Item</li></ul></div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("LI");
  });

  it("descends list-title-wrapper past the <li> to its inner <p> (task 217)", () => {
    const anchor = build(`
      <div class="list-title-wrapper"><ul><li><p>Item</p></li></ul></div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("P");
  });

  it("descends a bare <li> to its inner <p> — the metrics element owns the line box (task 217)", () => {
    const anchor = build(`<li><p>Item</p></li>`);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("P");
    expect(target.textContent).toBe("Item");
  });

  it("falls back to the <li> itself when it has no direct inner <p> (task 217)", () => {
    // Markerless / non-paragraph content — safe fallback, no throw.
    const anchor = build(`<li>Plain text</li>`);
    const target = resolveInlineContextElement(anchor);
    expect(target).toBe(anchor);
  });

  it("only descends a DIRECT-child <p>, not a nested one (task 217)", () => {
    // A `<p>` buried inside a nested list must not be mistaken for the item's
    // own first line — `:scope > p` keeps the descent to the direct child.
    const anchor = build(`<li><ul><li><p>Nested</p></li></ul></li>`);
    const target = resolveInlineContextElement(anchor);
    expect(target).toBe(anchor);
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

  it("descends <pre> to its inner <code> — the 10px float it exists to prevent", () => {
    // `<pre>` carries the code block's `padding-top`, so its border-box top is
    // NOT the first line box's top; the inline `<code>` inside it is. Without
    // this descent the handle floats a full padding above the cap-top, which is
    // the regression the branch was written for and which nothing asserted.
    const anchor = build(`<pre><code>const x = 1;</code></pre>`);
    const target = resolveInlineContextElement(anchor);
    expect(target.tagName).toBe("CODE");
  });

  it("falls back to the <pre> itself when it holds no <code>", () => {
    const anchor = build(`<pre>raw</pre>`);
    expect(resolveInlineContextElement(anchor)).toBe(anchor);
  });

  it("descends expex-item to .expex-item-body when the body has NO inner <p>", () => {
    // The reason the `.expex-item` descent is TWO passes rather than one
    // selector list: `querySelector(".expex-item-body p, .expex-item-body")`
    // resolves in DOCUMENT ORDER, so the shallower container always wins and
    // the inner `<p>` the first pass wants would never be reached. This leg is
    // the second pass — body present, no paragraph in it — and the leg above
    // ("descends expex-item to .expex-item-body inner paragraph") is the first.
    // Together they pin the ordering; either alone passes on one selector list.
    const anchor = build(`
      <div class="expex-item">
        <div class="expex-item-body">bare gloss text</div>
      </div>
    `);
    const target = resolveInlineContextElement(anchor);
    expect(target.classList.contains("expex-item-body")).toBe(true);
  });

  it("falls back to the expex-item itself when it has no body at all", () => {
    const anchor = build(`<div class="expex-item"><span>x</span></div>`);
    expect(resolveInlineContextElement(anchor)).toBe(anchor);
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

  it("misses cache on font-style — an italic element doesn't collide with a non-italic sibling", () => {
    // The cache key must include font-style: the `ctx.font` string prepends
    // "italic " for an italic element, so the measurement differs. Return
    // DISTINCT metrics per call to prove the italic element receives its OWN
    // metrics, not the normal element's cached ones.
    let call = 0;
    measureTextSpy.mockImplementation((_text: string) => {
      call += 1;
      return {
        actualBoundingBoxAscent: 10 + call, // capHeight 11 (normal), 12 (italic)
        fontBoundingBoxAscent: 13,
        fontBoundingBoxDescent: 3,
        width: 10,
      };
    });
    const normal = document.createElement("p");
    const italic = document.createElement("p");
    for (const el of [normal, italic]) {
      el.style.fontFamily = "Serif";
      el.style.fontSize = "16px";
      el.style.fontWeight = "400";
      el.style.lineHeight = "24px";
      document.body.appendChild(el);
    }
    italic.style.fontStyle = "italic"; // only difference
    try {
      // offset = (24 - 16)/2 + (ascent 13 - capHeight)
      //   normal: 4 + (13 - 11) = 6 ; italic: 4 + (13 - 12) = 5
      const normalOffset = capTopOffset(normal);
      const italicOffset = capTopOffset(italic);
      // Two measurements — the italic element MISSED the (normal) cache entry.
      expect(measureTextSpy).toHaveBeenCalledTimes(2);
      // And it got its OWN metrics, not the normal sibling's.
      expect(normalOffset).toBeCloseTo(6, 5);
      expect(italicOffset).toBeCloseTo(5, 5);
      expect(italicOffset).not.toBeCloseTo(normalOffset, 5);
    } finally {
      normal.remove();
      italic.remove();
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

describe("capBandCenterOffset + opticalCenterY (with stubbed canvas)", () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    clearCapTopCache();
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: "",
      measureText: vi.fn((_t: string) => ({
        actualBoundingBoxAscent: 11, // capHeight
        fontBoundingBoxAscent: 13,
        fontBoundingBoxDescent: 3,
        width: 10,
      })),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    clearCapTopCache();
  });

  function attach(): HTMLElement {
    const el = document.createElement("p");
    el.style.fontFamily = "Serif";
    el.style.fontSize = "16px";
    el.style.fontWeight = "400";
    el.style.lineHeight = "24px";
    document.body.appendChild(el);
    return el;
  }

  it("capBandCenterOffset = capTopOffset + capHeight/2 (the ONE vertical primitive)", () => {
    const el = attach();
    try {
      // capTopOffset = (24-16)/2 + (13-11) = 6 ; capHeight = 11 → 6 + 5.5 = 11.5
      expect(capBandCenterOffset(el)).toBeCloseTo(11.5, 5);
      // And it equals the two terms composed — the drift-proof guarantee.
      expect(capBandCenterOffset(el)).toBeCloseTo(
        capTopOffset(el) + capHeight(el) / 2,
        5,
      );
    } finally {
      el.remove();
    }
  });

  it("opticalCenterY(lineTop, el) = lineTop + capBandCenterOffset(el), space-invariant", () => {
    const el = attach();
    try {
      expect(opticalCenterY(100, el)).toBeCloseTo(100 + 11.5, 5);
      // Space-invariant: shifting the line top shifts the result by the same amount.
      expect(opticalCenterY(500, el) - opticalCenterY(100, el)).toBeCloseTo(400, 5);
    } finally {
      el.remove();
    }
  });

  it("both degrade to 0 / lineTop when metrics are unavailable (canvas null)", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const el = attach();
    try {
      expect(capBandCenterOffset(el)).toBe(0);
      expect(opticalCenterY(250, el)).toBe(250);
    } finally {
      el.remove();
    }
  });

  it("the `cs` parameter is `el`'s own style — a foreign one keys the cache on the wrong font", () => {
    // The documented hazard on the parameter, made observable (task 663). `cs`
    // exists so a caller that already read the style needn't read it twice
    // (task 336); its whole correctness condition is that the style belongs to
    // `el`. The metrics cache is keyed off `cs`, so handing over a DIFFERENT
    // element's style caches this element's metrics under that element's font —
    // silently, with a plausible number and no error.
    //
    // The evidence is the line-height, which a 2D-context stub cannot fake: an
    // 80px-leading foreign style must not change what `el`'s own 24px line box
    // measures. Stated as the CONTRACT (`capBandCenterOffset(el)` with no `cs`
    // is the truth, and passing `el`'s own style must agree with it), so the
    // hazard reads as "these two must be the same call" rather than as a
    // description of the bug.
    const el = attach();
    const foreign = document.createElement("p");
    foreign.style.fontFamily = "Serif";
    foreign.style.fontSize = "16px";
    foreign.style.fontWeight = "400";
    foreign.style.lineHeight = "80px";
    document.body.appendChild(foreign);
    try {
      const truth = capBandCenterOffset(el);
      clearCapTopCache();
      expect(capBandCenterOffset(el, getComputedStyle(el))).toBeCloseTo(truth, 5);
      clearCapTopCache();
      // The hazard itself: the foreign style yields a DIFFERENT answer, so the
      // parameter is load-bearing and not merely a performance hint.
      expect(
        capBandCenterOffset(el, getComputedStyle(foreign)),
      ).not.toBeCloseTo(truth, 1);
    } finally {
      el.remove();
      foreign.remove();
    }
  });
});

describe("measureTextWidth (the measured alternative to a hardcoded glyph width)", () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
  let measured: string[];
  let reportedWidth: number;

  beforeEach(() => {
    clearCapTopCache();
    measured = [];
    reportedWidth = 42;
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: "",
      measureText: (t: string) => {
        measured.push(t);
        return { width: reportedWidth } as TextMetrics;
      },
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    clearCapTopCache();
  });

  function styleOf(css: Partial<Record<"fontSize" | "fontFamily" | "fontWeight" | "fontStyle", string>>) {
    const el = document.createElement("p");
    el.style.fontFamily = css.fontFamily ?? "Serif";
    el.style.fontSize = css.fontSize ?? "16px";
    el.style.fontWeight = css.fontWeight ?? "400";
    if (css.fontStyle) el.style.fontStyle = css.fontStyle;
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    el.remove();
    return cs;
  }

  it("measures the string in the element's font", () => {
    expect(measureTextWidth("10.", styleOf({}))).toBe(42);
    expect(measured).toEqual(["10."]);
  });

  it("answers `null` — never a px guess — when the font-size is unreadable", () => {
    // Every caller reads `null` as "no opinion" and falls back to a GEOMETRIC
    // bound (the whole marker band), which is conservative; a guessed width
    // would not be. So the degrade has to be `null`, and no measurement may be
    // attempted against a font the spec can't be built from.
    expect(measureTextWidth("10.", styleOf({ fontSize: "medium" }))).toBeNull();
    expect(measureTextWidth("10.", styleOf({ fontSize: "0px" }))).toBeNull();
    expect(measured).toEqual([]);
  });

  it("answers `null` when there is no canvas at all (SSR / a jsdom stub)", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    expect(measureTextWidth("10.", styleOf({}))).toBeNull();
  });

  it("answers `null` for a non-finite or negative reported width, and caches neither", () => {
    const cs = styleOf({});
    reportedWidth = Number.NaN;
    expect(measureTextWidth("nan", cs)).toBeNull();
    reportedWidth = -5;
    expect(measureTextWidth("neg", cs)).toBeNull();
    expect(__textWidthCacheSize()).toBe(0);
    // ...and a later good measurement of the same string is not poisoned.
    reportedWidth = 7;
    expect(measureTextWidth("nan", cs)).toBe(7);
  });

  it("caches per (font, text): a repeat measures ONCE, a different string does not hit", () => {
    // The hover/placement path calls this per frame, so the cache is what keeps
    // it one measurement per distinct marker per font rather than one per frame.
    const cs = styleOf({});
    measureTextWidth("10.", cs);
    measureTextWidth("10.", cs);
    expect(measured).toEqual(["10."]);
    measureTextWidth("\u2022", cs);
    expect(measured).toEqual(["10.", "\u2022"]);
    expect(__textWidthCacheSize()).toBe(2);
  });

  it("keys the cache on the FONT too, so a resize re-measures the same string", () => {
    measureTextWidth("10.", styleOf({ fontSize: "16px" }));
    measureTextWidth("10.", styleOf({ fontSize: "24px" }));
    expect(measured).toEqual(["10.", "10."]);
    expect(__textWidthCacheSize()).toBe(2);
  });

  it("an italic element does not share a cache entry with its upright sibling", () => {
    // `canvasFontSpec` prepends "italic ", so the measured face differs.
    measureTextWidth("a.", styleOf({}));
    measureTextWidth("a.", styleOf({ fontStyle: "italic" }));
    expect(measured).toEqual(["a.", "a."]);
  });
});

describe("listItem optical center reads the inner <p>'s metrics, not the <li>'s (task 217)", () => {
  let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    clearCapTopCache();
    originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      font: "",
      measureText: vi.fn((_t: string) => ({
        actualBoundingBoxAscent: 11, // capHeight
        fontBoundingBoxAscent: 13,
        fontBoundingBoxDescent: 3,
        width: 10,
      })),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    clearCapTopCache();
  });

  it("resolves to the <p>, so the cap-band center uses the <p>'s line-height", () => {
    // The `<li>` inherits base leading (16px); its inner `<p>` carries prose
    // leading (32px). The two produce DIFFERENT optical centers — the bug was
    // measuring the `<li>`. capBandCenterOffset = capTopOffset + capHeight/2:
    //   on <li> (lh 16): (16-16)/2 + (13-11) = 2 ; + 5.5 = 7.5
    //   on <p>  (lh 32): (32-16)/2 + (13-11) = 10 ; + 5.5 = 15.5
    const li = document.createElement("li");
    li.style.fontFamily = "Serif";
    li.style.fontSize = "16px";
    li.style.fontWeight = "400";
    li.style.lineHeight = "16px";
    const p = document.createElement("p");
    p.style.fontFamily = "Serif";
    p.style.fontSize = "16px";
    p.style.fontWeight = "400";
    p.style.lineHeight = "32px";
    p.textContent = "Item";
    li.appendChild(p);
    document.body.appendChild(li);
    try {
      const target = resolveInlineContextElement(li);
      expect(target).toBe(p);
      // Anchors on the <p>'s optical center (15.5), NOT the <li>'s (7.5).
      expect(capBandCenterOffset(target)).toBeCloseTo(15.5, 5);
      expect(capBandCenterOffset(li)).toBeCloseTo(7.5, 5);
      expect(capBandCenterOffset(target)).not.toBeCloseTo(
        capBandCenterOffset(li),
        1,
      );
    } finally {
      li.remove();
    }
  });
});

describe("resolveLineHeightPx", () => {
  function cs(lineHeight: string): CSSStyleDeclaration {
    return { lineHeight } as unknown as CSSStyleDeclaration;
  }
  it("parses an explicit px line-height", () => {
    expect(resolveLineHeightPx(cs("24px"), 16)).toBeCloseTo(24, 5);
  });
  it("falls back to fontSize * 1.2 for 'normal'", () => {
    expect(resolveLineHeightPx(cs("normal"), 16)).toBeCloseTo(19.2, 5);
  });
  it("falls back to fontSize * 1.2 for an empty / unparseable value", () => {
    expect(resolveLineHeightPx(cs(""), 20)).toBeCloseTo(24, 5);
  });
});

describe("optical-center SSOT — no inlined copy of the primitive (task 2026-07-22-215)", () => {
  // The vertical cap-band-center math lives in ONE place (text-metrics.ts). No
  // consumer may re-inline `capTopOffset(...) + capHeight(...) / 2` — that is the
  // drift the primitive extraction retired. Grep the three former copy sites.
  const INLINED = /capTopOffset\([^)]*\)\s*\+\s*capHeight\([^)]*\)\s*\/\s*2/;
  const consumers = [
    "../../text-objects/block-frame.ts",
    "../../hooks/useMarginaliaRegistry.ts",
    "../../text-objects/TextObjectGrabHandle.tsx",
  ];
  for (const rel of consumers) {
    it(`${rel} composes the primitive, no inlined capTopOffset + capHeight/2`, () => {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
      expect(INLINED.test(src)).toBe(false);
    });
  }
});

describe("onFontReady", () => {
  it("returns a disposer even when document.fonts is absent (jsdom default); the callback never fires", () => {
    const cb = vi.fn();
    const dispose = onFontReady(cb);
    expect(typeof dispose).toBe("function");
    // No `fonts` field exists in jsdom by default → never armed, never fires.
    expect(cb).not.toHaveBeenCalled();
    // Disposer is idempotent and safe.
    expect(() => {
      dispose();
      dispose();
    }).not.toThrow();
  });

  it("the disposer unregisters the callback (before ready) so fresh closures can't accumulate", () => {
    const before = __fontReadyPendingCount();
    const cb = vi.fn();
    const dispose = onFontReady(cb);
    expect(__fontReadyPendingCount()).toBe(before + 1);
    dispose();
    expect(__fontReadyPendingCount()).toBe(before);
  });

  it("clears the cache and re-runs callbacks on EVERY loadingdone wave (not just the first), and stops after the disposer", async () => {
    // The `fontReadyArmed` latch is module-global, so exercise the persistent
    // listener on a FRESH module instance with a controllable `FontFaceSet`.
    // jsdom ships neither `loadingdone` nor a real `FontFaceSet`, so stub a
    // minimal EventTarget with a `status` field (mirrors the 216 stub shape).
    vi.resetModules();
    const listeners = new Set<() => void>();
    const fontsStub = {
      // "loading" at arm time → no immediate catch-up; `loadingdone` drives.
      status: "loading" as "loading" | "loaded",
      addEventListener: (_type: "loadingdone", listener: () => void) => {
        listeners.add(listener);
      },
    };
    const dispatchLoadingDone = () => {
      for (const l of Array.from(listeners)) l();
    };
    const originalFonts = (document as unknown as { fonts?: unknown }).fonts;
    (document as unknown as { fonts?: unknown }).fonts = fontsStub;
    try {
      const mod = await import("../text-metrics");
      const fired: string[] = [];
      const disposeA = mod.onFontReady(() => fired.push("a"));
      mod.onFontReady(() => fired.push("b"));
      expect(mod.__fontReadyPendingCount()).toBe(2);
      expect(listeners.size).toBe(1); // armed exactly once

      // Prime BOTH caches so we can observe the invalidation. The width cache
      // is dropped on the same wave and for the same reason — a width measured
      // against a FOUT fallback face is wrong once the real face arrives — but
      // until task 663 only the metrics half was observable, so the legs below
      // could prove half of a two-line invalidation (`__textWidthCacheSize`).
      mod.__primeFontMetricsCache();
      const widthCs = (() => {
        const el = document.createElement("p");
        el.style.fontFamily = "Serif";
        el.style.fontSize = "16px";
        el.style.fontWeight = "400";
        document.body.appendChild(el);
        const cs = getComputedStyle(el);
        el.remove();
        return cs;
      })();
      const primeWidthCache = () => {
        HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
          font: "",
          measureText: () => ({ width: 11 }) as TextMetrics,
        })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
        mod.measureTextWidth("\u2022", widthCs);
      };
      primeWidthCache();
      expect(mod.__fontMetricsCacheSize()).toBe(1);
      expect(mod.__textWidthCacheSize()).toBe(1);

      // WAVE 1 (the initial FOUT wave): BOTH caches cleared, both callbacks
      // fire, and — unlike the old one-shot — the Set is NOT emptied.
      dispatchLoadingDone();
      expect(mod.__fontMetricsCacheSize()).toBe(0);
      expect(mod.__textWidthCacheSize()).toBe(0);
      expect(fired).toEqual(["a", "b"]);
      expect(mod.__fontReadyPendingCount()).toBe(2);

      // Re-prime, then WAVE 2 (a runtime font switch): the still-registered
      // callbacks fire AGAIN and both caches clear AGAIN.
      mod.__primeFontMetricsCache();
      primeWidthCache();
      expect(mod.__fontMetricsCacheSize()).toBe(1);
      expect(mod.__textWidthCacheSize()).toBe(1);
      dispatchLoadingDone();
      expect(mod.__fontMetricsCacheSize()).toBe(0);
      expect(mod.__textWidthCacheSize()).toBe(0);
      expect(fired).toEqual(["a", "b", "a", "b"]);

      // Disposer unregisters A; a THIRD wave fires only B → leak-safety kept.
      disposeA();
      expect(mod.__fontReadyPendingCount()).toBe(1);
      dispatchLoadingDone();
      expect(fired).toEqual(["a", "b", "a", "b", "b"]);
    } finally {
      if (originalFonts === undefined) {
        delete (document as unknown as { fonts?: unknown }).fonts;
      } else {
        (document as unknown as { fonts?: unknown }).fonts = originalFonts;
      }
      vi.resetModules();
    }
  });

  it("catches up an already-settled boot wave (status 'loaded' at arm time) via a microtask, without a loadingdone event", async () => {
    vi.resetModules();
    const fontsStub = {
      status: "loaded" as "loading" | "loaded",
      addEventListener: () => {
        // Boot wave already complete; no future `loadingdone` will fire.
      },
    };
    const originalFonts = (document as unknown as { fonts?: unknown }).fonts;
    (document as unknown as { fonts?: unknown }).fonts = fontsStub;
    try {
      const mod = await import("../text-metrics");
      const cb = vi.fn();
      mod.onFontReady(cb);
      mod.__primeFontMetricsCache();
      expect(mod.__fontMetricsCacheSize()).toBe(1);

      expect(cb).not.toHaveBeenCalled(); // catch-up is deferred to a microtask
      await Promise.resolve();
      expect(cb).toHaveBeenCalledTimes(1);
      expect(mod.__fontMetricsCacheSize()).toBe(0);
    } finally {
      if (originalFonts === undefined) {
        delete (document as unknown as { fonts?: unknown }).fonts;
      } else {
        (document as unknown as { fonts?: unknown }).fonts = originalFonts;
      }
      vi.resetModules();
    }
  });
});
