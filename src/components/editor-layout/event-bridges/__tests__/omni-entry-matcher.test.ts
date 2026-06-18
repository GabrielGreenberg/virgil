// @vitest-environment jsdom
//
// T5 Pillar E-2 — the shared prefix-or-exact omni matcher (`findOmniEntry` /
// `omniEntrySelector`). This is the DOM-level proof for the multi-anchor `@N`
// jump (REP-F3-01 / OMNI-F3-01 / OMNI-F8-02): a fully-qualified `@N` key must
// land on ITS OWN row, never the card's first row; a bare card key must still
// resolve a multi-anchor card's first row (back-compat) and a single-anchor
// card's only row.

import { describe, it, expect, afterEach } from "vitest";
import {
  findOmniEntry,
  omniEntrySelector,
} from "@/components/editor-layout/event-bridges/open-for-card";

function el(attrVal: string, attr = "data-omni-entry"): HTMLElement {
  const d = document.createElement("div");
  d.setAttribute(attr, attrVal);
  document.body.appendChild(d);
  return d;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("omniEntrySelector", () => {
  it("emits the exact-OR-prefix selector for the default attr", () => {
    expect(omniEntrySelector("float:card:note:n1")).toBe(
      '[data-omni-entry="float:card:note:n1"], [data-omni-entry^="float:card:note:n1@"]',
    );
  });

  it("honors a wrapper-attr override", () => {
    expect(omniEntrySelector("k", "data-omni-entry-wrapper")).toBe(
      '[data-omni-entry-wrapper="k"], [data-omni-entry-wrapper^="k@"]',
    );
  });
});

describe("findOmniEntry — multi-anchor `@N` resolution (REP-F3-01)", () => {
  it("a fully-qualified `@1` key lands on the `@1` row, not `@0`", () => {
    const base = "float:card:report:r1";
    const row0 = el(`${base}@0`);
    const row1 = el(`${base}@1`);

    // The marker for anchor-1 produces the `…@1` key → must resolve row1.
    expect(findOmniEntry(`${base}@1`)).toBe(row1);
    // And anchor-0 → row0 (so we're really discriminating, not just lucky).
    expect(findOmniEntry(`${base}@0`)).toBe(row0);
  });

  it("a bare card key resolves a multi-anchor card's FIRST row via prefix", () => {
    const base = "float:card:report:r1";
    const row0 = el(`${base}@0`);
    el(`${base}@1`);

    // No exact `[…="base"]` element exists; the prefix arm finds the first
    // `…@N` row (DOM order) — the established single-anchor-key fallback.
    expect(findOmniEntry(base)).toBe(row0);
  });

  it("prefers the EXACT row when both an exact element and `@N` siblings exist", () => {
    const base = "float:card:report:r1";
    const exact = el(base);
    el(`${base}@1`);
    // A bare key that has an exact element must NOT be hijacked by a prefix
    // sibling (the exact arm wins).
    expect(findOmniEntry(base)).toBe(exact);
  });

  it("a single-anchor card (no `@N` suffix) resolves its only row exactly", () => {
    const only = el("float:card:report:r2");
    expect(findOmniEntry("float:card:report:r2")).toBe(only);
  });

  it("returns null when nothing matches", () => {
    el("float:card:report:other");
    expect(findOmniEntry("float:card:report:missing")).toBeNull();
  });

  it("resolves on the wrapper attribute too (the alignOmniCardWithClick path)", () => {
    const base = "float:card:note:n9";
    el(`${base}@0`, "data-omni-entry-wrapper");
    const w1 = el(`${base}@1`, "data-omni-entry-wrapper");
    expect(findOmniEntry(`${base}@1`, "data-omni-entry-wrapper")).toBe(w1);
  });
});
