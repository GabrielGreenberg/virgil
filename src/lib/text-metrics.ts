/**
 * Font-metric helpers for aligning margin chrome (grab handles, future
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
 * cache is invalidated on EVERY font-load wave (the `FontFaceSet`'s
 * `loadingdone` event — not just the boot `document.fonts.ready`) so
 * FOUT, including a runtime main-text font switch to a lazily-loaded
 * family, doesn't leave handles stuck at the fallback font's cap-top.
 *
 * Used by `src/text-objects/TextObjectGrabHandle.tsx` for both the
 * TextObjectRef placement path and the SelectionRef path, and — through the
 * shared {@link opticalCenterY} / {@link capBandCenterOffset} primitives — by
 * the canonical block frame (`src/text-objects/block-frame.ts`) and the
 * marginalia registry (`useMarginaliaRegistry.ts`). It is the single source of
 * truth: every consumer composes the SAME primitives (including the exported
 * {@link resolveLineHeightPx}) rather than re-deriving the math, so all the
 * margin affordances align BY CONSTRUCTION.
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

const FONT_METRICS_CACHE = new Map<string, CapTopMetrics>();

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
 *
 * Exported (same for-consumer export convention as {@link capTopOffset} /
 * {@link opticalCenterY}) so the marginalia registry shares this exact
 * parse — and the `* 1.2` "normal"-leading approximation lives in ONE place
 * rather than being re-inlined at the call site.
 */
export function resolveLineHeightPx(cs: CSSStyleDeclaration, fontSizePx: number): number {
  const raw = cs.lineHeight;
  if (raw === "normal" || raw === "") return fontSizePx * 1.2;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fontSizePx * 1.2;
}

/**
 * Measure-and-cache a DOM element's first-line font metrics
 * ({@link CapTopMetrics}). The element MUST be attached to the document
 * (so computed style is meaningful) and SHOULD be the inline-context
 * element governing the first line — for wrappers, descend first via
 * `resolveInlineContextElement`.
 *
 * Cached by `(fontFamily | fontSize | fontWeight | fontStyle | lineHeight)`. The SINGLE
 * source for both {@link capTopOffset} and {@link capHeight}, so the two
 * can never drift and a consumer that needs both pays one measurement.
 * Returns null if no document/canvas is available (SSR safety) or if the
 * canvas stub doesn't report the metrics we need.
 */
function measureFontMetrics(
  el: HTMLElement,
  known?: CSSStyleDeclaration,
): CapTopMetrics | null {
  if (typeof window === "undefined") return null;
  // `known` is a computed style the CALLER already read for THIS element (see
  // the parameter doc on `capBandCenterOffset`). Reading it again here is not
  // free — a placement pass resolving a container and its first item paid two
  // `getComputedStyle` calls per block for one element's style (task 336).
  const cs = known ?? window.getComputedStyle(el);
  const fontSizePx = parseFloat(cs.fontSize);
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) return null;
  const lineHeightPx = resolveLineHeightPx(cs, fontSizePx);
  // Key on EVERY input the measurement depends on. The `ctx.font` string below
  // prepends "italic " for an italic element, so `fontStyle` flips the measured
  // metrics — an italic first-line target must not share a cache entry with a
  // non-italic sibling of otherwise-identical (family | size | weight | lineHeight).
  const key = `${cs.fontFamily}|${fontSizePx}|${cs.fontWeight}|${cs.fontStyle}|${lineHeightPx}`;
  const cached = FONT_METRICS_CACHE.get(key);
  if (cached !== undefined) return cached;

  const ctx = getCtx();
  if (!ctx) return null;
  // `H` dominates the ascent reading (capital height); the probe forces
  // full glyph-envelope reporting on browsers that lazy-compute
  // `actualBoundingBox*`.
  ctx.font = `${cs.fontStyle === "italic" ? "italic " : ""}${cs.fontWeight} ${fontSizePx}px ${cs.fontFamily}`;
  const m = ctx.measureText("H");
  const capHeightPx = m.actualBoundingBoxAscent;
  const ascent = m.fontBoundingBoxAscent;
  const descent = m.fontBoundingBoxDescent;
  if (
    !Number.isFinite(capHeightPx) ||
    !Number.isFinite(ascent) ||
    !Number.isFinite(descent)
  ) {
    return null;
  }
  const metrics: CapTopMetrics = {
    capHeight: capHeightPx,
    ascent,
    descent,
    lineHeightPx,
  };
  FONT_METRICS_CACHE.set(key, metrics);
  return metrics;
}

/**
 * Cap-top offset for a DOM element's first rendered line — the distance
 * from the line-box top to the glyph cap-top. Returns 0 when metrics are
 * unavailable (SSR / canvas stub).
 */
export function capTopOffset(el: HTMLElement): number {
  const m = measureFontMetrics(el);
  return m ? computeCapTopOffset(m) : 0;
}

/**
 * Cap-height (the rendered height of a capital glyph) for a DOM element's
 * first line, in CSS px. Paired with {@link capTopOffset} inside
 * {@link capBandCenterOffset} to find the optical (cap-band) CENTER of a line.
 * Returns 0 when metrics are unavailable (SSR / canvas stub).
 */
export function capHeight(el: HTMLElement): number {
  return measureFontMetrics(el)?.capHeight ?? 0;
}

/**
 * Offset from a line-box top to the OPTICAL (cap-band) CENTER of that line —
 * `capTopOffset(el) + capHeight(el) / 2`. THE vertical primitive: one
 * {@link measureFontMetrics} read feeds both terms from the same cache entry,
 * so `capTopOffset` and `capHeight` can never drift and a consumer that needs
 * the center pays a SINGLE measurement (not two). Returns 0 when metrics are
 * unavailable (SSR / canvas stub) — matching the degrade of its two terms.
 *
 * `cs` is an OPTIONAL already-read computed style **for `el` itself**. Two
 * callers (`resolveBlockFrame`, the geometry service's `measureBlock`) read the
 * target's computed style for their own purposes one line away, so without it
 * every placement / measure paid `getComputedStyle` twice for one element
 * (task 336). Passing another element's style would silently key the metrics
 * cache on the wrong font — the parameter is `el`'s style or nothing.
 */
export function capBandCenterOffset(
  el: HTMLElement,
  cs?: CSSStyleDeclaration,
): number {
  const m = measureFontMetrics(el, cs);
  return m ? computeCapTopOffset(m) + m.capHeight / 2 : 0;
}

/**
 * The OPTICAL (cap-band) CENTER Y of a line, given its line-box top:
 * `lineTop + capBandCenterOffset(el)`. THE canonical vertical anchor for
 * margin chrome — center an affordance's glyph on this and it sits on the
 * optical middle of the text it labels, independent of font size / line-
 * height. The ONE vertical primitive the grab handle, the marginalia markers,
 * and the block frame's `opticalCenterY` all compose (the vertical twin of the
 * horizontal `resolveContentEdges` extraction), so they align BY CONSTRUCTION
 * rather than via three copies of `capTopOffset + capHeight / 2`.
 *
 * `lineTop` is in whatever coordinate space the caller measured the line-box
 * top (viewport for the block frame / grab handle; host-relative for the
 * marginalia registry) — the added offset is space-invariant.
 */
export function opticalCenterY(
  lineTop: number,
  el: HTMLElement,
  cs?: CSSStyleDeclaration,
): number {
  return lineTop + capBandCenterOffset(el, cs);
}

/**
 * Given the outer NodeView element (`editor.view.nodeDOM(blockPos)`
 * returns this), descend to the inline-context element that actually
 * carries the first line's font + line-height. This IS the shared descent
 * strategy — the marginalia registry (`useMarginaliaRegistry.ts`,
 * `resolveInlineContextElement` at its prose branch) and the block frame
 * (`resolveFirstLineTarget`) both call THIS, rather than re-deriving it;
 * it covers `par-title-wrapper` / `heading-wrapper` / `title-field-wrapper`
 * / `list-title-wrapper` / `expex-item` / `blockquote` / `pre` / bare `<li>`.
 *
 * Falls back to `anchorDom` itself for unrecognized wrappers — safe for
 * raw `<p>`, `<blockquote>`, etc., whose own style IS the right reading.
 */
/**
 * A list item's rendered first line lives in its inner `<p>` (TipTap renders a
 * `listItem` as `<li><p>…</p></li>`), and `.tiptap li > p` carries the prose
 * `font-size` + `line-height: 1.8` while the bare `<li>` inherits the base
 * (root 16px / body leading). Because {@link computeCapTopOffset} derives
 * half-leading and cap-height from the MEASURED element's line-height,
 * measuring the `<li>` computes the offset for the WRONG line-height and drops
 * the handle/marker ~1-2px off the text's cap-band. Descend to the direct inner
 * `<p>` so the metrics element owns the line box; fall back to the `<li>` when
 * it has no `:scope > p` child (markerless / non-paragraph content) — the same
 * safe-fallback shape as the `<pre>`→`<code>` descent below.
 */
function descendListItem(li: HTMLElement): HTMLElement {
  return (li.querySelector(":scope > p") as HTMLElement | null) ?? li;
}

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
    const li = anchorDom.querySelector("ul > li, ol > li") as HTMLElement | null;
    return li ? descendListItem(li) : anchorDom;
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
  if (anchorDom.tagName === "LI") {
    // A bare `<li>` (the block frame's `resolveFirstLineTarget` and the
    // marginalia registry both hand us the raw list-item node DOM) — descend to
    // the inner `<p>` that owns the rendered line box. See {@link descendListItem}.
    return descendListItem(anchorDom);
  }
  return anchorDom;
}

const fontReadyCallbacks = new Set<() => void>();
let fontReadyArmed = false;

/**
 * The slice of the live `FontFaceSet` we depend on. Structural so a test can
 * stub it with a minimal `EventTarget` + `status` (jsdom ships neither reliably).
 */
interface FontFaceSetLike {
  status?: "loading" | "loaded";
  addEventListener?: (type: "loadingdone", listener: () => void) => void;
}

/** Clear the cap-top cache and re-run every registered callback. */
function fireFontReady(): void {
  FONT_METRICS_CACHE.clear();
  for (const fn of fontReadyCallbacks) {
    try {
      fn();
    } catch {
      // Swallow — callbacks are best-effort schedule pings.
    }
  }
}

/**
 * Register a callback to fire whenever a font-load wave completes.
 * Also clears the cap-top cache at that moment so cached offsets computed
 * against the fallback font during FOUT are recomputed against the real
 * font on the next read.
 *
 * `document.fonts` is a live `FontFaceSet`: the boot `next/font` faces are
 * one wave, but a runtime typography change (e.g. the Fonts… picker swapping
 * the main-text family to a lazily-loaded, `font-display: swap` Google font)
 * is a SECOND wave the already-settled `fonts.ready` promise never reports.
 * So we arm a **persistent** `loadingdone` listener (fires once per completed
 * wave), not a one-shot `fonts.ready.then` — every wave self-corrects
 * identically, defeating stale-fallback cap-band metrics that previously
 * persisted until a full page reload.
 *
 * Returns a **disposer** — call it (in an effect cleanup) to unregister the
 * callback so a fresh closure per effect run doesn't accumulate. Every closure
 * transitively pins its editor graph, so an un-disposed registration across
 * paper switches / panel toggles / multi-window opens leaks torn-down editors.
 * Leak-safety rests ENTIRELY on these disposers (both current callers invoke
 * theirs unconditionally in cleanup) — the listener is armed once and never
 * disarmed, and the callback Set is never cleared, so a persistent registrant
 * keeps re-firing across waves as intended.
 *
 * `fontReadyCallbacks` is a `Set`, so registering the SAME callback reference
 * twice dedupes (fires once); only distinct closures fire separately.
 */
export function onFontReady(cb: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  fontReadyCallbacks.add(cb);
  const dispose = () => {
    fontReadyCallbacks.delete(cb);
  };
  if (fontReadyArmed) return dispose;
  const fonts = (document as unknown as { fonts?: FontFaceSetLike }).fonts;
  // Feature-detect `addEventListener` (absent under SSR / jsdom / old engines)
  // — same SSR-safe shape as the former `fonts?.ready?.then` guard.
  if (!fonts || typeof fonts.addEventListener !== "function") return dispose;
  fontReadyArmed = true;
  fonts.addEventListener("loadingdone", fireFontReady);
  // Catch-up for the boot wave if it ALREADY settled before we attached (the
  // old resolved-`fonts.ready`-promise case): `loadingdone` only reports FUTURE
  // waves, so without this a late first-registration would miss a stale cache
  // primed during boot FOUT. Mutually exclusive with the boot `loadingdone`
  // (status is "loading" until that wave completes), so it never double-fires.
  if (fonts.status === "loaded") {
    Promise.resolve().then(fireFontReady);
  }
  return dispose;
}

/** Test-only: number of callbacks currently registered with {@link onFontReady}. */
export function __fontReadyPendingCount(): number {
  return fontReadyCallbacks.size;
}

/** Test-only: drop the cap-top cache. */
export function clearCapTopCache(): void {
  FONT_METRICS_CACHE.clear();
}

/** Test-only: current cap-top cache size (jsdom can't drive real measurement). */
export function __fontMetricsCacheSize(): number {
  return FONT_METRICS_CACHE.size;
}

/** Test-only: insert a dummy cache entry so invalidation can be observed. */
export function __primeFontMetricsCache(key = "__test__"): void {
  FONT_METRICS_CACHE.set(key, {
    capHeight: 0,
    ascent: 0,
    descent: 0,
    lineHeightPx: 0,
  });
}
