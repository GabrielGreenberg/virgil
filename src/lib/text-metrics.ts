/**
 * Font-metric helpers for aligning gutter chrome (grab handles, future
 * markers) to the cap-top of the first rendered glyph of a block.
 *
 * The browser positions an inline `<span>` (or block element)'s bounding
 * rect at the LINE-BOX top, which sits half-leading above the glyph
 * cap-top. To draw a piece of chrome aligned with the cap-top, we need to
 * recover that offset from the actual rendered font, not from a
 * per-kind hardcoded constant.
 *
 * The offset is determined by:
 *   half-leading      = (lineHeight − (fontAscent + fontDescent)) / 2
 *   cap-top-offset    = half-leading + (fontAscent − capHeight)
 *
 * where `fontAscent`/`fontDescent` are the font's strut metrics (the same
 * envelope CSS uses to distribute `line-height` leading) and `capHeight`
 * is the actual ascent of a rendered capital letter. All three come from
 * canvas's `TextMetrics`. We cache per
 * `(fontFamily | fontSize | fontWeight | lineHeight)` signature; the
 * cache is invalidated when `document.fonts.ready` resolves so FOUT
 * (font swap mid-session) doesn't leave handles stuck at the fallback
 * font's cap-top.
 *
 * Used by `src/text-objects/TextObjectGrabHandle.tsx` for both the
 * TextObjectRef placement path and the SelectionRef path. Designed to be
 * a single source of truth — future consumers (e.g. the marginalia
 * registry's line-height parsing at useMarginaliaRegistry.ts:168-172)
 * can share the helper without re-deriving the math.
 */

export interface CapTopMetrics {
  /** Cap-height of a representative capital glyph ("H"), in CSS px. */
  capHeight: number;
  /** Font's typographic ascent (`fontBoundingBoxAscent`), in CSS px. */
  ascent: number;
  /** Font's typographic descent (`fontBoundingBoxDescent`), in CSS px. */
  descent: number;
  /** Resolved `line-height` in CSS px. */
  lineHeightPx: number;
}

const CAP_TOP_CACHE = new Map<string, number>();

function getCtx(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") return null;
  // Fresh canvas per call. Cache misses are infrequent (one per unique
  // font signature, then cached forever), so the createElement cost is
  // negligible — and avoiding a module-cached context keeps the helper
  // trivially testable (stubs to HTMLCanvasElement.prototype.getContext
  // always take effect on the next call).
  const canvas = document.createElement("canvas");
  return canvas.getContext("2d");
}

/**
 * Pure math: given line and font metrics, return the offset from line-box
 * top to glyph cap-top. Clamped at 0 so negative-leading fonts
 * (`line-height < ascent + descent`) don't push the handle below
 * line-box-top, which is impossible for the first line (the strut
 * anchors it).
 *
 * Exported for direct unit testing without canvas mocking.
 */
export function computeCapTopOffset(m: CapTopMetrics): number {
  const halfLeading = (m.lineHeightPx - (m.ascent + m.descent)) / 2;
  const offset = halfLeading + (m.ascent - m.capHeight);
  return offset > 0 ? offset : 0;
}

/**
 * Resolve a computed-style declaration's `line-height` to CSS pixels.
 * `getComputedStyle` returns "normal" for unspecified line-heights, which
 * varies by font (~1.18-1.21 for Latin). Approximate with `fontSize * 1.2`
 * — close enough that the half-leading is small and the resulting
 * cap-top-offset error is sub-pixel.
 */
function resolveLineHeightPx(cs: CSSStyleDeclaration, fontSizePx: number): number {
  const raw = cs.lineHeight;
  if (raw === "normal" || raw === "") return fontSizePx * 1.2;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fontSizePx * 1.2;
}

/**
 * Cap-top offset for a DOM element's first rendered line. The element
 * MUST be attached to the document (so computed style is meaningful) and
 * SHOULD be the inline-context element governing the first line — for
 * wrappers, descend first via `resolveInlineContextElement`.
 *
 * Cached by `(fontFamily | fontSize | fontWeight | lineHeight)`. Returns
 * 0 if no document/canvas is available (SSR safety) or if the canvas
 * stub doesn't report the metrics we need.
 */
export function capTopOffset(el: HTMLElement): number {
  if (typeof window === "undefined") return 0;
  const cs = window.getComputedStyle(el);
  const fontSizePx = parseFloat(cs.fontSize);
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) return 0;
  const lineHeightPx = resolveLineHeightPx(cs, fontSizePx);
  const key = `${cs.fontFamily}|${fontSizePx}|${cs.fontWeight}|${lineHeightPx}`;
  const cached = CAP_TOP_CACHE.get(key);
  if (cached !== undefined) return cached;

  const ctx = getCtx();
  if (!ctx) return 0;
  // Multi-character probe forces full glyph envelope reporting on
  // browsers that lazy-compute `actualBoundingBox*`. `H` dominates the
  // ascent reading (capital height), `g` ensures the descender bounds
  // are populated for the font.
  ctx.font = `${cs.fontStyle === "italic" ? "italic " : ""}${cs.fontWeight} ${fontSizePx}px ${cs.fontFamily}`;
  const m = ctx.measureText("H");
  const capHeight = m.actualBoundingBoxAscent;
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  if (
    !Number.isFinite(capHeight) ||
    !Number.isFinite(ascent) ||
    !Number.isFinite(descent)
  ) {
    return 0;
  }
  const offset = computeCapTopOffset({ capHeight, ascent, descent, lineHeightPx });
  CAP_TOP_CACHE.set(key, offset);
  return offset;
}

/**
 * Given the outer NodeView element (`editor.view.nodeDOM(blockPos)`
 * returns this), descend to the inline-context element that actually
 * carries the first line's font + line-height. Mirrors the strategy at
 * `useMarginaliaRegistry.ts:124-141` and extends it with `title-field-
 * wrapper` and `expex-item` cases.
 *
 * Falls back to `anchorDom` itself for unrecognized wrappers — safe for
 * raw `<p>`, `<blockquote>`, `<pre>`, `<li>`, etc., whose own style IS
 * the right reading.
 */
export function resolveInlineContextElement(anchorDom: HTMLElement): HTMLElement {
  if (anchorDom.classList.contains("par-title-wrapper")) {
    return (
      (anchorDom.querySelector(".par-body-container p, p") as HTMLElement | null) ??
      anchorDom
    );
  }
  if (anchorDom.classList.contains("heading-wrapper")) {
    return (
      (anchorDom.querySelector("h1, h2, h3, h4, h5, h6, h0") as HTMLElement | null) ??
      anchorDom
    );
  }
  if (anchorDom.classList.contains("title-field-wrapper")) {
    return (
      (anchorDom.querySelector(".title-field-content") as HTMLElement | null) ??
      anchorDom
    );
  }
  if (anchorDom.classList.contains("list-title-wrapper")) {
    return (
      (anchorDom.querySelector("ul > li, ol > li") as HTMLElement | null) ??
      anchorDom
    );
  }
  if (anchorDom.classList.contains("expex-item")) {
    // Prefer the inner `<p>` (carries body line-height); fall back to
    // the `.expex-item-body` container, then to `anchorDom`. Two-pass
    // because `querySelector(".expex-item-body p, .expex-item-body")`
    // resolves in document order — the container is shallower and
    // would always win, hiding the inner `<p>` we want.
    const inner = anchorDom.querySelector(".expex-item-body p") as HTMLElement | null;
    if (inner) return inner;
    const body = anchorDom.querySelector(".expex-item-body") as HTMLElement | null;
    return body ?? anchorDom;
  }
  if (anchorDom.tagName === "BLOCKQUOTE") {
    return (
      (anchorDom.querySelector(
        ".par-body-container p, :scope > p, :scope > h1, :scope > h2, :scope > h3",
      ) as HTMLElement | null) ?? anchorDom
    );
  }
  if (anchorDom.tagName === "PRE") {
    // `<pre>` carries padding-top from the code-block style; the inner
    // `<code>` (inline) is the actual first line's anchor. Without this
    // descent the handle floats 10px above the cap-top.
    return (
      (anchorDom.querySelector("code") as HTMLElement | null) ?? anchorDom
    );
  }
  return anchorDom;
}

const fontReadyCallbacks = new Set<() => void>();
let fontReadyArmed = false;

/**
 * Register a callback to fire after `document.fonts.ready` resolves.
 * Also clears the cap-top cache at that moment so cached offsets
 * computed against the fallback font during FOUT are recomputed against
 * the real font on the next read. Idempotent — registering the same
 * callback twice will fire it twice; that's the caller's contract.
 */
export function onFontReady(cb: () => void): void {
  if (typeof document === "undefined") return;
  fontReadyCallbacks.add(cb);
  if (fontReadyArmed) return;
  const fonts = (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts;
  if (!fonts || !fonts.ready || typeof fonts.ready.then !== "function") return;
  fontReadyArmed = true;
  fonts.ready.then(() => {
    CAP_TOP_CACHE.clear();
    for (const fn of fontReadyCallbacks) {
      try {
        fn();
      } catch {
        // Swallow — callbacks are best-effort schedule pings.
      }
    }
  });
}

/** Test-only: drop the cap-top cache. */
export function clearCapTopCache(): void {
  CAP_TOP_CACHE.clear();
}
