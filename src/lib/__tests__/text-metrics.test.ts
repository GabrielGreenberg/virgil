// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __fontReadyPendingCount,
  capBandCenterOffset,
  capHeight,
  capTopOffset,
  clearCapTopCache,
  computeCapTopOffset,
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

      // Prime the cache so we can observe the invalidation.
      mod.__primeFontMetricsCache();
      expect(mod.__fontMetricsCacheSize()).toBe(1);

      // WAVE 1 (the initial FOUT wave): cache cleared, both callbacks fire,
      // and — unlike the old one-shot — the Set is NOT emptied.
      dispatchLoadingDone();
      expect(mod.__fontMetricsCacheSize()).toBe(0);
      expect(fired).toEqual(["a", "b"]);
      expect(mod.__fontReadyPendingCount()).toBe(2);

      // Re-prime, then WAVE 2 (a runtime font switch): the still-registered
      // callbacks fire AGAIN and the cache clears AGAIN.
      mod.__primeFontMetricsCache();
      expect(mod.__fontMetricsCacheSize()).toBe(1);
      dispatchLoadingDone();
      expect(mod.__fontMetricsCacheSize()).toBe(0);
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
