import { describe, it, expect } from "vitest";
import {
  LEGACY_TOKEN_CROSSWALK,
  cssTokenForCardKind,
  legacyDataKindForCardKind,
} from "../legacy-token-crosswalk";

/**
 * Frozen-table pin for the A2 legacy-token crosswalk (R-C: NO token migration).
 * tsc only guards the KEY set (exhaustive `Record<CardKind, …>`); it cannot catch
 * a wrong VALUE. These on-disk `data-link-card` + CSS `data-paragraph-kind` tokens
 * are read by `globals.css` selectors and by already-persisted marks — flipping one
 * silently breaks the CSS contract / corrupts a mark. This snapshot fails loudly if
 * any of the 16 (legacyDataKind, cssToken) pairs ever drifts from the byte-identical
 * values A2 inherited from the pre-refactor literal switches.
 */
describe("LEGACY_TOKEN_CROSSWALK (R-C frozen tokens)", () => {
  it("matches the byte-identical legacy projection for every CardKind", () => {
    expect(LEGACY_TOKEN_CROSSWALK).toEqual({
      note: { legacyDataKind: "note", cssToken: "note" },
      highlight: { legacyDataKind: "highlight", cssToken: null },
      footnote: { legacyDataKind: null, cssToken: null },
      citation: { legacyDataKind: null, cssToken: null },
      example: { legacyDataKind: null, cssToken: null },
      todo: { legacyDataKind: null, cssToken: "todo" },
      archive: { legacyDataKind: null, cssToken: "archive" },
      report: { legacyDataKind: "report", cssToken: "report" },
      "report-request": { legacyDataKind: "report-request", cssToken: "report" },
      "revision-comment": { legacyDataKind: "comment", cssToken: "comment" },
      "revision-suggestion": { legacyDataKind: "comment", cssToken: "comment" },
      "cutter-comment": { legacyDataKind: "cutter-comment", cssToken: "cut" },
      "cutter-suggestion": { legacyDataKind: "cutter-suggestion", cssToken: "cut" },
      bib: { legacyDataKind: null, cssToken: null },
      ai: { legacyDataKind: null, cssToken: null },
      error: { legacyDataKind: null, cssToken: null },
    });
  });

  it("the divergent CSS-contract mappings hold (revision→comment, cutter→cut)", () => {
    // The two columns intentionally diverge for cutter; these are the exact
    // tokens the [data-link-card^="comment:"] / [data-paragraph-kind="cut"] rules read.
    expect(legacyDataKindForCardKind("revision-comment")).toBe("comment");
    expect(legacyDataKindForCardKind("revision-suggestion")).toBe("comment");
    expect(cssTokenForCardKind("cutter-comment")).toBe("cut");
    expect(cssTokenForCardKind("cutter-suggestion")).toBe("cut");
    // Atoms / unanchored kinds carry no link-card or paragraph-kind token.
    expect(legacyDataKindForCardKind("footnote")).toBeNull();
    expect(cssTokenForCardKind("highlight")).toBeNull();
  });
});
