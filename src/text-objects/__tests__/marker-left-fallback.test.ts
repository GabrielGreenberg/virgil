// @vitest-environment jsdom
/**
 * Backlog #49 (hypothesis 1) — the grab handle's x is `markerLeft − gapPx −
 * HANDLE_WIDTH` (handle-layout.ts). `resolveMarkerLeft` (block-frame.ts) feeds
 * `markerLeft` per kind: an example block hugs its `.expex-number`, an example
 * item its `.expex-item-marker`. When that marker chrome ISN'T resolvable (a
 * transient render before the NodeView mounts, or an unfaithful clone), the
 * helper falls back. The fallback MUST stay in the GUTTER (left of content) —
 * a `contentLeft` fallback would anchor the handle at the text start, RIGHT of
 * the marker, dropping the dots onto the content (the reported symptom).
 *
 * These tests are PURE-LOGIC: they don't trust jsdom layout (the synthetic DOM
 * harness is unfaithful per the backlog note). The marker-present path is
 * exercised with a stubbed `getBoundingClientRect` to confirm the MEASURED rect
 * wins; the marker-absent path confirms the fallback DIRECTION (= one
 * track-width left of content), not a real px value.
 */

import { describe, expect, it } from "vitest";
import { resolveMarkerLeft } from "@/text-objects/block-frame";

const CONTENT_LEFT = 300;
const TRACK_WIDTH = 20;

/** A block element with NO marker chrome inside (querySelector → null). */
function blockWithoutMarker(): HTMLElement {
  return document.createElement("div");
}

/** A block element whose marker matches `selector` and reports `markerLeft`. */
function blockWithMarker(selector: string, markerLeft: number): HTMLElement {
  const el = document.createElement("div");
  const className = selector.replace(/^\./, "");
  const marker = document.createElement("span");
  marker.className = className;
  marker.getBoundingClientRect = () =>
    ({
      left: markerLeft, right: markerLeft + 10, top: 0, bottom: 10,
      width: 10, height: 10, x: markerLeft, y: 0, toJSON: () => ({}),
    }) as DOMRect;
  el.appendChild(marker);
  return el;
}

describe("resolveMarkerLeft — example marker fallback stays LEFT of content (#49)", () => {
  it("exampleBlock with NO .expex-number falls back LEFT of content, not on it", () => {
    const left = resolveMarkerLeft(
      blockWithoutMarker(),
      "exampleBlock",
      CONTENT_LEFT,
      TRACK_WIDTH,
    );
    // Must be strictly left of the content start (in the gutter), never == it.
    expect(left).toBeLessThan(CONTENT_LEFT);
    expect(left).toBe(CONTENT_LEFT - TRACK_WIDTH);
  });

  it("exampleItem with NO .expex-item-marker falls back LEFT of content, not on it", () => {
    const left = resolveMarkerLeft(
      blockWithoutMarker(),
      "exampleItem",
      CONTENT_LEFT,
      TRACK_WIDTH,
    );
    expect(left).toBeLessThan(CONTENT_LEFT);
    expect(left).toBe(CONTENT_LEFT - TRACK_WIDTH);
  });

  it("exampleBlock WITH a measured .expex-number uses the marker rect's left", () => {
    const markerLeft = CONTENT_LEFT - 24; // a real `(16)` sits left of the text
    const left = resolveMarkerLeft(
      blockWithMarker(".expex-number", markerLeft),
      "exampleBlock",
      CONTENT_LEFT,
      TRACK_WIDTH,
    );
    expect(left).toBe(markerLeft);
  });

  it("exampleItem WITH a measured .expex-item-marker uses the marker rect's left", () => {
    const markerLeft = CONTENT_LEFT - 18;
    const left = resolveMarkerLeft(
      blockWithMarker(".expex-item-marker", markerLeft),
      "exampleItem",
      CONTENT_LEFT,
      TRACK_WIDTH,
    );
    expect(left).toBe(markerLeft);
  });

  it("a top-level paragraph (no kind branch) anchors at contentLeft (unchanged)", () => {
    const left = resolveMarkerLeft(
      blockWithoutMarker(),
      "paragraph",
      CONTENT_LEFT,
      TRACK_WIDTH,
    );
    expect(left).toBe(CONTENT_LEFT);
  });
});
