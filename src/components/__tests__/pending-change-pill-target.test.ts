// @vitest-environment jsdom
//
// Phase 3 — the PendingChangePill's target binding (`resolveTargetKey`). This is
// the load-bearing logic the live preview can't drive (the placement compute is
// RAF-gated): given the cardStore hover/selection + the caret-focus anchorIds,
// which applied-pending entry the pill acts on. Hover wins over selection; an
// id-only fallback bridges the cutter-vs-revision mark-kind flatten; the caret
// path matches by anchorId.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";

// Importing PendingChangePill transitively pulls `@/lib/storage`, whose backend
// `require("@/lib/storage-fsa")` isn't resolvable under vitest (jsdom). Stub the
// storage barrel — this test only exercises the pure `resolveTargetKey`, which
// touches none of it. (See the `vitest_extension_barrel_storage_mock` note.)
vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
}));

import {
  pillVerticalSeat,
  resolveTargetKey,
  type PendingChangeIndex,
} from "@/components/PendingChangePill";
import { clearCapTopCache, opticalCenterY } from "@/lib/text-metrics";

function makeIndex(): PendingChangeIndex {
  const map: PendingChangeIndex = new Map();
  map.set("revision-suggestion:R1", {
    anchorId: "anc-rev",
    onKeep: () => {},
    onDismiss: () => {},
  });
  map.set("cutter-suggestion:C1", {
    anchorId: "anc-cut",
    onKeep: () => {},
    onDismiss: () => {},
  });
  return map;
}

describe("resolveTargetKey", () => {
  it("returns the exact kind:id match for a hovered applied card", () => {
    const idx = makeIndex();
    expect(
      resolveTargetKey({ kind: "revision-suggestion", id: "R1" }, null, [], idx),
    ).toBe("revision-suggestion:R1");
  });

  it("prefers hover over selection", () => {
    const idx = makeIndex();
    expect(
      resolveTargetKey(
        { kind: "revision-suggestion", id: "R1" },
        { kind: "cutter-suggestion", id: "C1" },
        [],
        idx,
      ),
    ).toBe("revision-suggestion:R1");
  });

  it("falls back to selection when nothing is hovered", () => {
    const idx = makeIndex();
    expect(
      resolveTargetKey(null, { kind: "cutter-suggestion", id: "C1" }, [], idx),
    ).toBe("cutter-suggestion:C1");
  });

  it("matches by id alone when the hovered kind is the family-flattened mark kind (cutter arrives as revision-suggestion)", () => {
    const idx = makeIndex();
    // The blue in-text mark stamps `revision-suggestion` for a CUTTER applied
    // change too; the id-only fallback still resolves the cutter index entry.
    expect(
      resolveTargetKey({ kind: "revision-suggestion", id: "C1" }, null, [], idx),
    ).toBe("cutter-suggestion:C1");
  });

  it("resolves the caret-focus target by matching a mark anchorId against the index", () => {
    const idx = makeIndex();
    expect(resolveTargetKey(null, null, ["anc-cut"], idx)).toBe(
      "cutter-suggestion:C1",
    );
    expect(resolveTargetKey(null, null, ["anc-rev"], idx)).toBe(
      "revision-suggestion:R1",
    );
  });

  it("returns null when nothing hovered/selected/caret resolves to an applied card", () => {
    const idx = makeIndex();
    expect(resolveTargetKey(null, null, [], idx)).toBeNull();
    // A hovered NON-applied card (not in the index) never summons the pill.
    expect(
      resolveTargetKey({ kind: "note", id: "N9" }, null, ["unknown-anchor"], idx),
    ).toBeNull();
  });
});

// The pill's vertical seat MUST be the shared optical cap-band center (task 266),
// not the line-box geometric center — so it aligns with the grab handle + the
// marginalia marker on the same row BY CONSTRUCTION. Stub the canvas exactly as
// text-metrics.test.ts does so `opticalCenterY` resolves real (non-zero) metrics.
describe("pillVerticalSeat (optical cap-band center, not geometric center)", () => {
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

  it("seats on opticalCenterY(lineTop, target), which diverges from the geometric center", () => {
    const el = attach();
    try {
      const lineTop = 100;
      const lineBottom = 124; // 24px line box
      const seat = pillVerticalSeat(lineTop, lineBottom, el);
      // capBandCenterOffset = (24-16)/2 + (13-11) + 11/2 = 6 + 5.5 = 11.5
      // → optical = 100 + 11.5 = 111.5, NOT the geometric 112.
      expect(seat).toBeCloseTo(opticalCenterY(lineTop, el), 5);
      expect(seat).toBeCloseTo(111.5, 5);
      expect(seat).not.toBeCloseTo((lineTop + lineBottom) / 2, 3);
    } finally {
      el.remove();
    }
  });

  it("falls back to the line-box geometric center when no target element resolves", () => {
    expect(pillVerticalSeat(100, 124, null)).toBeCloseTo(112, 5);
  });
});
