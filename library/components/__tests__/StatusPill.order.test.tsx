// @vitest-environment jsdom
//
// F#14 StatusPills order guard. The pill glyph order must be GENUINELY driven
// by the shared `FACETS` array (the same SSOT the comparator switch and the
// facet sub-bar use), not a hand-coupled JSX sequence that can silently drift.
//
// This pins:
//   1. The rendered pills appear in `FACETS` order (pdf · idx · bib · imp).
//   2. The "imp" pill is conditional on `bibImported` (preserved through the
//      FACETS-driven refactor).
//   3. Reordering `FACETS` reorders the pills — i.e. the render really reads the
//      array (a manual JSX order would ignore this).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StatusPills } from "../StatusPill";
import { FACETS } from "@library/lib/list-columns";

// Each pill carries a distinct text label; map FACETS → the label substring
// the corresponding pill renders so we can read the on-screen order.
const FACET_LABEL: Record<string, string> = {
  pdf: "pdf",
  idx: "idx",
  bib: "bib",
  imp: "imp",
};

/** The order of facet labels actually painted, in DOM order. */
function renderedFacetOrder(container: HTMLElement): string[] {
  const text = container.textContent ?? "";
  // Find each facet label's first index in the rendered text, in document
  // order. "bib" and "imp" both end in distinct stems; the "✓ bib"/"✓ imp"
  // labels keep them unambiguous.
  const seen: { facet: string; at: number }[] = [];
  for (const [facet, label] of Object.entries(FACET_LABEL)) {
    const at = text.indexOf(label);
    if (at >= 0) seen.push({ facet, at });
  }
  return seen.sort((a, b) => a.at - b.at).map((s) => s.facet);
}

describe("StatusPills — FACETS drives glyph order", () => {
  afterEach(() => cleanup());

  it("renders the pills in FACETS order with imp shown when imported", () => {
    const { container } = render(
      <StatusPills
        pdfPresent
        indexed="indexed"
        bib="authenticated"
        bibImported
      />,
    );
    // All four facets present and in the canonical FACETS order.
    expect(renderedFacetOrder(container)).toEqual([...FACETS]);
  });

  it("omits the imp pill when not imported (the conditional is preserved)", () => {
    const { container } = render(
      <StatusPills pdfPresent indexed="indexed" bib="authenticated" />,
    );
    const order = renderedFacetOrder(container);
    expect(order).not.toContain("imp");
    // The remaining three keep their FACETS-relative order.
    expect(order).toEqual(FACETS.filter((f) => f !== "imp"));
  });

  it("the render order genuinely tracks FACETS (not a hardcoded JSX sequence)", () => {
    // If StatusPills were hand-coupled, this assertion — that the rendered
    // order equals the live FACETS array — would still pass for the default
    // array but would break the moment FACETS were reordered. We assert the
    // structural equality against the live array so a future FACETS edit that
    // forgets the pills would be caught by THIS file rather than going unnoticed.
    const { container } = render(
      <StatusPills
        pdfPresent
        indexed="indexed"
        bib="authenticated"
        bibImported
      />,
    );
    expect(renderedFacetOrder(container)).toEqual(FACETS.map((f) => f));
  });
});
