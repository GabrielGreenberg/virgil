import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MARGIN_LABEL_INSET,
  MARGIN_LABEL_MIN_WIDTH,
  MARGIN_COL_CHEVRON_OFFSET,
  marginLabelsFit,
} from "@/lib/marginalia";

const css = readFileSync(path.resolve(__dirname, "..", "..", "app", "globals.css"), "utf8");

describe("the block-label column", () => {
  it("fits exactly when the margin holds the inset plus a usable column", () => {
    const floor = MARGIN_LABEL_INSET + MARGIN_LABEL_MIN_WIDTH;
    expect(marginLabelsFit(floor)).toBe(true);
    expect(marginLabelsFit(floor - 1)).toBe(false);
  });

  it("the default margin holds it, and the code-split gutter does not", () => {
    expect(marginLabelsFit(155)).toBe(true);
    expect(marginLabelsFit(48)).toBe(false);
  });

  it("fails open while unmeasured, so a hidden pane never flips its labels", () => {
    expect(marginLabelsFit(null)).toBe(true);
  });

  it("sits outboard of the fold chevron", () => {
    expect(MARGIN_LABEL_INSET).toBeGreaterThan(-MARGIN_COL_CHEVRON_OFFSET);
  });

  it("states one inset in CSS and TS", () => {
    expect(css).toContain(`--margin-col-label: ${MARGIN_LABEL_INSET}px;`);
  });

  it("spells the column's width once, and every side label reads it (task 1615)", () => {
    // The census: `- var(--margin-col-label) -` (the width arithmetic) appears
    // only in the token's own declaration, which sits on the pod's .tiptap so
    // it substitutes --editor-pl where the labels do.
    const spellings = css.match(/- var\(--margin-col-label\) -/g) ?? [];
    expect(spellings).toHaveLength(1);
    expect(css).toMatch(
      /\[data-margin-labels="side"\] \.tiptap \{\s*--margin-label-col-width: calc\(var\(--editor-pl, 88px\) - var\(--margin-col-label\) - var\(--margin-label-outboard-gap\)\);/,
    );
    expect(css).toContain("--margin-label-outboard-gap: 8px;");
    const readers = css.match(/width: var\(--margin-label-col-width\);/g) ?? [];
    expect(readers).toHaveLength(4);
  });

  it("takes every label out of flow, so no mode can move the text", () => {
    const side = /\[data-margin-labels="side"\] \.heading-annotation,\s*\[data-margin-labels="side"\] \.title-field-annotation \{[^}]*position: absolute/;
    const hover = /\[data-margin-labels="hover"\] \.heading-annotation,\s*\[data-margin-labels="hover"\] \.title-field-annotation \{[^}]*position: absolute/;
    expect(css).toMatch(side);
    expect(css).toMatch(hover);
  });

  it("gives an example's label the hover pill when the margin cannot hold it", () => {
    // A rule for both modes kept the label bare, visible and on the text above.
    expect(css).not.toMatch(
      /\[data-margin-labels\] :is\(\.expex-label-annotation, \.expex-item-label-annotation\) \{/,
    );
    expect(css).toMatch(
      /\[data-margin-labels="side"\] :is\(\.expex-label-annotation, \.expex-item-label-annotation\) \{\s*position: absolute;/,
    );
    expect(css).toMatch(
      /\[data-margin-labels\] \.expex-par-wrapper:hover > \.expex-label-annotation \{\s*opacity: 1;\s*pointer-events: auto;/,
    );
  });
});
