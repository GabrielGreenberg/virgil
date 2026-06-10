import { describe, it, expect } from "vitest";
import { ANCHOR_CLICK_ROUTES } from "@/components/editor-layout/event-bridges/marker-clicks";
import { entityKindToAnchorKind } from "../entity-hover";

/**
 * A2 Commit D pin-test. `ANCHOR_CLICK_ROUTES` (marker-clicks) and
 * `entityKindToAnchorKind` (entity-hover) were hand-kept literal tables; A2
 * DERIVES them from the registry (`panelForCardKind` / `markerType`) with two
 * deliberate carve-outs:
 *
 *  - the `note` `entrySelectorBase` override (`data-note-entry`, not the
 *    canonical `data-card-key`);
 *  - the R-B cutter anchor-tint SPLIT — cutter-comment/cutter-suggestion keep
 *    their own kind as the anchor key (NOT the shared `markerType: "cut"`),
 *    while revision-comment/revision-suggestion collapse to `"revision"`.
 *
 * This pins the derived output to the exact pre-A2 literals so the derivation
 * can't silently drift.
 */

// The exact literals the hand-kept ANCHOR_CLICK_ROUTES table held pre-A2
// (the five Mode-B kinds), plus the four Mode-A paragraph-anchored kinds A6
// added when gutter clicks unified onto the same bridge (R15). The Mode-A
// entrySelectorBases are the legacy `data-<kind>-entry` attributes those
// panels stamp (cf. panel-selection.ts).
const EXPECTED_ROUTES = {
  note: { panelId: "notes", cardKind: "note", entrySelectorBase: "data-note-entry" },
  "cutter-comment": {
    panelId: "cutter",
    cardKind: "cutter-comment",
    entrySelectorBase: "data-card-key",
  },
  "cutter-suggestion": {
    panelId: "cutter",
    cardKind: "cutter-suggestion",
    entrySelectorBase: "data-card-key",
  },
  "revision-comment": {
    panelId: "revisions",
    cardKind: "revision-comment",
    entrySelectorBase: "data-card-key",
  },
  "revision-suggestion": {
    panelId: "revisions",
    cardKind: "revision-suggestion",
    entrySelectorBase: "data-card-key",
  },
  // A6/R15: the gutter's Mode-A paragraph-anchored kinds.
  archive: { panelId: "archive", cardKind: "archive", entrySelectorBase: "data-archive-entry" },
  todo: { panelId: "todo", cardKind: "todo", entrySelectorBase: "data-todo-entry" },
  report: { panelId: "reports", cardKind: "report", entrySelectorBase: "data-report-entry" },
  "report-request": {
    panelId: "reports",
    cardKind: "report-request",
    entrySelectorBase: "data-report-request-entry",
  },
} as const;

// entityKindToAnchorKind is now collection-free (WS5: it never read the bag).

describe("ANCHOR_CLICK_ROUTES derived ≡ the frozen literals", () => {
  it("matches the frozen table exactly (panelId via panelForCardKind, cardKind = key)", () => {
    expect(ANCHOR_CLICK_ROUTES).toEqual(EXPECTED_ROUTES);
  });

  it("exactly the nine routed kinds — five Mode-B + four Mode-A (no extra/missing keys)", () => {
    expect(Object.keys(ANCHOR_CLICK_ROUTES).sort()).toEqual(
      Object.keys(EXPECTED_ROUTES).sort(),
    );
  });
});

describe("entityKindToAnchorKind derived ≡ the pre-A2 literal switch (R-B carve-out)", () => {
  const EXPECTED_ANCHOR_KIND = {
    note: "note",
    highlight: "highlight",
    "revision-comment": "revision",
    "revision-suggestion": "revision",
    // R-B: cutter stays SPLIT, never collapses to "cut".
    "cutter-comment": "cutter-comment",
    "cutter-suggestion": "cutter-suggestion",
  } as const;

  it("note / highlight / revision-* / cutter-* map to the exact old tokens", () => {
    for (const [kind, expected] of Object.entries(EXPECTED_ANCHOR_KIND)) {
      expect(
        entityKindToAnchorKind({ id: "x", kind: kind as never }),
        `anchor kind for ${kind}`,
      ).toBe(expected);
    }
  });

  it("R-B: the cutter pair does NOT collapse to the shared marker (stays split)", () => {
    expect(entityKindToAnchorKind({ id: "x", kind: "cutter-comment" })).toBe(
      "cutter-comment",
    );
    expect(entityKindToAnchorKind({ id: "x", kind: "cutter-suggestion" })).toBe(
      "cutter-suggestion",
    );
    // …while revisions DO collapse.
    expect(entityKindToAnchorKind({ id: "x", kind: "revision-comment" })).toBe(
      "revision",
    );
    expect(entityKindToAnchorKind({ id: "x", kind: "revision-suggestion" })).toBe(
      "revision",
    );
  });

  it("non-anchor-tint kinds (todo / report / archive / footnote) and null ref → null", () => {
    for (const kind of ["todo", "report", "report-request", "archive", "footnote", "citation", "example"] as const) {
      expect(
        entityKindToAnchorKind({ id: "x", kind }),
        `${kind} has no anchor tint`,
      ).toBeNull();
    }
    expect(entityKindToAnchorKind(null)).toBeNull();
  });
});
