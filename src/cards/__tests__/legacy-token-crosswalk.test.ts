import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LEGACY_TOKEN_CROSSWALK,
  cssTokenForCardKind,
  legacyDataKindForCardKind,
  normalizeLegacyCardKind,
} from "../legacy-token-crosswalk";
import type { CardKind } from "../types";

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
      todo: { legacyDataKind: "todo", cssToken: "todo" },
      archive: { legacyDataKind: null, cssToken: "archive" },
      report: { legacyDataKind: "report", cssToken: "report" },
      "report-request": { legacyDataKind: "report-request", cssToken: "report" },
      "revision-comment": { legacyDataKind: "revision-comment", cssToken: "comment" },
      "revision-suggestion": { legacyDataKind: "revision-suggestion", cssToken: "comment" },
      "cutter-comment": { legacyDataKind: "cutter-comment", cssToken: "cut" },
      "cutter-suggestion": { legacyDataKind: "cutter-suggestion", cssToken: "cut" },
      bib: { legacyDataKind: null, cssToken: null },
      error: { legacyDataKind: null, cssToken: null },
    });
  });

  it("the CSS-contract mappings hold (revision data-link-card = spine; paragraph-kind = legacy)", () => {
    // The data-link-card token for revisions is the SPINE kind (unified so
    // updateLinkedAnchorCard + the render fallback agree; CSS rule
    // [data-link-card^="revision-comment:"], with "comment:" kept as a legacy alias).
    // The data-paragraph-kind cssToken stays the legacy "comment" — the two columns
    // intentionally diverge here, like cutter (cssToken "cut").
    expect(legacyDataKindForCardKind("revision-comment")).toBe("revision-comment");
    expect(legacyDataKindForCardKind("revision-suggestion")).toBe("revision-suggestion");
    expect(cssTokenForCardKind("revision-comment")).toBe("comment");
    expect(cssTokenForCardKind("cutter-comment")).toBe("cut");
    expect(cssTokenForCardKind("cutter-suggestion")).toBe("cut");
    // Atoms / unanchored kinds carry no link-card or paragraph-kind token.
    expect(legacyDataKindForCardKind("footnote")).toBeNull();
    expect(cssTokenForCardKind("highlight")).toBeNull();
  });
});

describe("normalizeLegacyCardKind", () => {
  it("passes every spine CardKind through unchanged", () => {
    for (const kind of Object.keys(LEGACY_TOKEN_CROSSWALK)) {
      expect(normalizeLegacyCardKind(kind)).toBe(kind);
    }
  });

  it("maps the evidenced legacy on-disk tokens to their spine kinds", () => {
    // Pre-refactor revision cards persisted "comment" in links[].target.ref.kind.
    expect(normalizeLegacyCardKind("comment")).toBe("revision-comment");
    // Pre-refactor cutter cards (legacy cuts[] shape) persisted "cut".
    expect(normalizeLegacyCardKind("cut")).toBe("cutter-comment");
  });

  it("returns null for unknown tokens (incl. the removed quotations panel)", () => {
    expect(normalizeLegacyCardKind("quotation")).toBeNull();
    expect(normalizeLegacyCardKind("bogus-token")).toBeNull();
    expect(normalizeLegacyCardKind("")).toBeNull();
    // Object.prototype keys must not leak through the string-keyed map.
    expect(normalizeLegacyCardKind("hasOwnProperty")).toBeNull();
    expect(normalizeLegacyCardKind("constructor")).toBeNull();
  });
});

describe("runtime-total accessors (legacy on-disk token backstop)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("cssTokenForCardKind returns null (no throw) on an unknown token", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poisoned = "legacy-unknown-css" as CardKind;
    expect(() => cssTokenForCardKind(poisoned)).not.toThrow();
    expect(cssTokenForCardKind(poisoned)).toBeNull();
    // Loud dev-only error, once per token.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("legacy-unknown-css");
  });

  it("legacyDataKindForCardKind returns null (no throw) on an unknown token", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const poisoned = "legacy-unknown-data" as CardKind;
    expect(() => legacyDataKindForCardKind(poisoned)).not.toThrow();
    expect(legacyDataKindForCardKind(poisoned)).toBeNull();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain("legacy-unknown-data");
  });

  it("dev pins hold: the invariants the module-load assertions guard", () => {
    // Mirrors the two module-level dev pins (see the bottom of
    // legacy-token-crosswalk.ts) so the contract is also test-enforced. The
    // revision data-link-card token is the SPINE kind (unified; CSS matches
    // [data-link-card^="revision-comment:"], "comment:" kept as a legacy alias).
    expect(LEGACY_TOKEN_CROSSWALK["revision-comment"].legacyDataKind).toBe("revision-comment");
    expect(LEGACY_TOKEN_CROSSWALK["cutter-comment"].cssToken).toBe("cut");
  });
});
