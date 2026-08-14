// @vitest-environment jsdom
//
// The viewport → document-position probe (task 327).
//
// Two contracts, and the second was learned the hard way in this task's own
// adversarial review:
//
//  1. `resolveVisiblePosBand` FAILS OPEN. An edge it cannot resolve widens the
//     band to the document edge, because the band gates whether an anchor gets
//     an exact geometry read — too wide costs a few extra forced reads for one
//     pass, too narrow silently withholds the read from something the user can
//     see, which is the absorbing-fixed-point class the module exists to close.
//
//  2. Every probe lands INSIDE the visual viewport. `posAtCoords` asks the
//     browser first, and the browser answers null for an off-viewport point —
//     after which ProseMirror falls back to a wrap-around `getClientRects()`
//     scan over every top-level block. So an off-viewport probe is a
//     doc-proportional forced-layout read wearing an O(1) call's clothes. The
//     first cut of this fix probed at the ±NEAR_ZONE_PX PADDED edges, which are
//     off-screen by construction; the padding is now applied in position space
//     instead. The leg below is what would have caught it.

import { describe, it, expect, vi } from "vitest";
import {
  posAtViewportY,
  resolveVisiblePosBand,
} from "@/lib/editor-geometry/viewport-probe";
import type { EditorView } from "@tiptap/pm/view";

const VIEWPORT_H = 800;

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 800,
    width: 800,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A fake view whose geometry is `top = OFFSET + pos * SCALE`. */
const OFFSET = -1000;
const SCALE = 2;
const DOC_SIZE = 2000;

function fakeView(opts?: {
  domRect?: DOMRect;
  posAtCoords?: (c: { left: number; top: number }) => { pos: number } | null;
}): EditorView {
  const domRect = opts?.domRect ?? rect(OFFSET, OFFSET + DOC_SIZE * SCALE);
  const posAtCoords =
    opts?.posAtCoords ??
    (({ top }: { left: number; top: number }) => ({
      pos: Math.round((top - OFFSET) / SCALE),
    }));
  return {
    dom: {
      getBoundingClientRect: () => domRect,
      ownerDocument: { defaultView: { innerHeight: VIEWPORT_H } },
    },
    state: { doc: { content: { size: DOC_SIZE } } },
    posAtCoords,
  } as unknown as EditorView;
}

describe("posAtViewportY", () => {
  it("probes at the content column's horizontal center", () => {
    const spy = vi.fn(() => ({ pos: 7 }));
    const view = fakeView({ posAtCoords: spy });
    expect(posAtViewportY(view, 400)).toBe(7);
    expect(spy).toHaveBeenCalledWith({ left: 400, top: 400 });
  });

  it("clamps Y into the viewport ∩ content box, so the browser hit-test can answer", () => {
    const spy = vi.fn(({ top }: { left: number; top: number }) => ({ pos: top }));
    // Content box taller than the viewport in BOTH directions.
    const view = fakeView({ domRect: rect(-5000, 9000), posAtCoords: spy });
    expect(posAtViewportY(view, -9999)).toBe(1); // clamped to the viewport top
    expect(posAtViewportY(view, 9999)).toBe(VIEWPORT_H - 1); // …and its bottom
  });

  it("still clamps into the content box when that is the tighter bound", () => {
    const spy = vi.fn(({ top }: { left: number; top: number }) => ({ pos: top }));
    const view = fakeView({ domRect: rect(100, 500), posAtCoords: spy });
    expect(posAtViewportY(view, -9999)).toBe(101);
    expect(posAtViewportY(view, 9999)).toBe(499);
  });

  it("returns null on a miss, a throw, a zero-height box, or no viewport overlap", () => {
    expect(posAtViewportY(fakeView({ posAtCoords: () => null }), 0)).toBeNull();
    expect(
      posAtViewportY(
        fakeView({
          posAtCoords: () => {
            throw new Error("detached");
          },
        }),
        0,
      ),
    ).toBeNull();
    expect(posAtViewportY(fakeView({ domRect: rect(50, 50) }), 0)).toBeNull();
    // Content box entirely below the viewport — nothing is probeable.
    expect(posAtViewportY(fakeView({ domRect: rect(2000, 3000) }), 0)).toBeNull();
  });

  it("reuses a caller-supplied rect instead of re-reading layout", () => {
    const domRect = rect(0, 400);
    const getRect = vi.fn(() => domRect);
    const view = {
      dom: {
        getBoundingClientRect: getRect,
        ownerDocument: { defaultView: { innerHeight: VIEWPORT_H } },
      },
      state: { doc: { content: { size: DOC_SIZE } } },
      posAtCoords: () => ({ pos: 1 }),
    } as unknown as EditorView;
    posAtViewportY(view, 10, domRect);
    expect(getRect).not.toHaveBeenCalled();
  });
});

describe("resolveVisiblePosBand", () => {
  it("NEVER probes outside the visual viewport, however large the padding", () => {
    const seen: number[] = [];
    const view = fakeView({
      posAtCoords: ({ top }) => {
        seen.push(top);
        return { pos: Math.round((top - OFFSET) / SCALE) };
      },
    });
    // A mid-document scroll: the content box runs far above and below the
    // viewport, and the padded edges (-600 / 1400) are off-screen by design.
    resolveVisiblePosBand(view, 0, VIEWPORT_H, 600);
    expect(seen.length).toBeGreaterThan(0);
    for (const y of seen) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(VIEWPORT_H);
    }
  });

  it("covers the visible range exactly and pads outward in position space", () => {
    // top = -1000 + 2·pos ⇒ y=1 ⇒ pos 500.5→501, y=799 ⇒ pos 900.
    // Local density is 1/SCALE pos-per-px, so 600px of padding ≈ 300 pos.
    const band = resolveVisiblePosBand(fakeView(), 0, VIEWPORT_H, 600);
    // The VISIBLE range is inside the band — the part that must never be wrong.
    expect(band.start).toBeLessThanOrEqual(501);
    expect(band.end).toBeGreaterThanOrEqual(900);
    // …and the padding lands near the density-converted 600px on each side.
    expect(band.start).toBeCloseTo(501 - 300.5, -1);
    expect(band.end).toBeCloseTo(900 + 300.5, -1);
  });

  it("resolves a padded band that already covers the content box unprobed", () => {
    const spy = vi.fn(({ top }: { left: number; top: number }) => ({
      pos: Math.round((top - OFFSET) / SCALE),
    }));
    const view = fakeView({ domRect: rect(100, 400), posAtCoords: spy });
    expect(resolveVisiblePosBand(view, 0, VIEWPORT_H, 600)).toEqual({
      start: 0,
      end: DOC_SIZE,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("FAILS OPEN when a probe cannot answer", () => {
    const blind = fakeView({ posAtCoords: () => null });
    expect(resolveVisiblePosBand(blind, 0, VIEWPORT_H, 600)).toEqual({
      start: 0,
      end: DOC_SIZE,
    });
    // One edge unanswerable is enough — the band cannot be trusted at all.
    const halfBlind = fakeView({
      posAtCoords: ({ top }) =>
        top > 400 ? null : { pos: Math.round((top - OFFSET) / SCALE) },
    });
    expect(resolveVisiblePosBand(halfBlind, 0, VIEWPORT_H, 600)).toEqual({
      start: 0,
      end: DOC_SIZE,
    });
  });

  it("fails open on a zero-height box and on no viewport overlap", () => {
    expect(
      resolveVisiblePosBand(fakeView({ domRect: rect(0, 0) }), 0, VIEWPORT_H, 600),
    ).toEqual({ start: 0, end: DOC_SIZE });
    expect(
      resolveVisiblePosBand(
        fakeView({ domRect: rect(5000, 9000) }),
        0,
        VIEWPORT_H,
        600,
      ),
    ).toEqual({ start: 0, end: DOC_SIZE });
  });

  it("falls back to the document's average density when both probes agree", () => {
    // One huge block: every probe answers the same position, so there is no
    // local density to read. Average is DOC_SIZE / height = 1/SCALE pos-per-px.
    const view = fakeView({ posAtCoords: () => ({ pos: 700 }) });
    const band = resolveVisiblePosBand(view, 0, VIEWPORT_H, 600);
    // (±1px: the probes clamp to the viewport's inside edges, 1 and H-1.)
    expect(band.start).toBeCloseTo(700 - 600 / SCALE, -1);
    expect(band.end).toBeCloseTo(700 + 600 / SCALE, -1);
  });

  it("never yields an empty band from an inverted probe pair", () => {
    const inverted = fakeView({
      posAtCoords: ({ top }) => ({ pos: top < 400 ? 900 : 100 }),
    });
    const band = resolveVisiblePosBand(inverted, 0, VIEWPORT_H, 0);
    expect(band.start).toBeLessThan(band.end);
    expect(band.start).toBeCloseTo(100, -1);
    expect(band.end).toBeCloseTo(900, -1);
  });

  it("clamps the padded result to the document", () => {
    const band = resolveVisiblePosBand(fakeView(), 0, VIEWPORT_H, 1e9);
    expect(band.start).toBe(0);
    expect(band.end).toBe(DOC_SIZE);
  });
});
