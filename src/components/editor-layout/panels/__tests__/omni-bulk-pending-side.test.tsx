// @vitest-environment jsdom
//
// Task 420 — the applied-pending NAVIGATOR (prev/next + Keep-all / Dismiss-all)
// renders on exactly ONE omni column, chosen by PLACEMENT and never by the
// filter menu's hidden set.
//
// Pre-420 the host gated the header on `enabledForSide.has("revisions") ||
// enabledForSide.has("cutter")`, where `enabledForSide` is "the categories
// this side OWNS minus the ones the user HID". Two defects fell straight out:
//
//   1. Revisions dragged to the left strip, Cutter left on the right → BOTH
//      sides pass the `||` → two navigators wired to one cursor.
//   2. Revisions + Cutter hidden in the filter menu → NO side passes → the
//      only document-wide way to find / keep / revert unreviewed applied AI
//      text is gone, while the blue ranges stay live in the `.tex`.
//
// `appliedPendingSide(categorySides)` reads only the derived SIDES. Legs 1–2
// below re-implement the RETIRED predicate locally (through the REAL
// `omniCategoriesForSide`) so the defect is demonstrated for the reason it
// names, and then sweep the live resolver over the same configurations.
// Measured by neutering the host gate back to the `||` form: the census leg
// fails; by neutering the resolver to `||`-over-enabled: the sweep fails.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder", "getTexFilename",
    "writePdf", "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const n of names) mod[n] = stub;
  return mod;
});

vi.mock("@/hooks/useInTextPositions", () => ({
  useInTextPositions: (_editor: unknown, items: Array<{ id: string; pos: number }>) => ({
    positions: new Map(items.map((i) => [i.id, i.pos])),
    naturals: new Map(items.map((i) => [i.id, { naturalTop: i.pos, height: 60 }])),
    editorContentHeight: 600,
    panelScrollRef: { current: null },
  }),
}));

import OmniViewPanel, {
  appliedPendingSide,
  deriveCategorySides,
  omniCategoriesForSide,
  type OmniBulkPendingChanges,
  type OmniCategory,
} from "@/panels/Omni/OmniViewPanel";
import type { Side } from "@/hooks/useViewPrefs";
import { APPLIED_SPLICE_KIND_LIST } from "@/cards/lifecycle/applied-splice";
import { getPanelByCardKind } from "@/panels/panel-registry";
import { codeOnly } from "@/lib/__tests__/_source-scan";

afterEach(cleanup);

const SIDES: readonly Side[] = ["left", "right"];

/** The panels that can hold an applied change — DERIVED from the family SSOT
 *  so this suite cannot drift from what the resolver reads. */
const APPLIED_PANELS = APPLIED_SPLICE_KIND_LIST.map(
  (k) => getPanelByCardKind(k)!.kind,
) as OmniCategory[];

/** Build a placement list putting each applied panel on the given side. */
function placements(sides: Partial<Record<OmniCategory, Side>>) {
  return Object.entries(sides).map(([id, side]) => ({ id, side: side! }));
}

/** The RETIRED pre-420 host predicate, re-implemented locally through the REAL
 *  category combiner — "does this side currently SHOW a revisions/cutter
 *  card?" — so the defect legs fail for the reason they name. */
function retiredGateSides(
  sides: Partial<Record<OmniCategory, Side>>,
  hidden: OmniCategory[],
): Side[] {
  const cs = deriveCategorySides(placements(sides));
  return SIDES.filter((side) => {
    const enabled = omniCategoriesForSide(cs, hidden, side);
    return APPLIED_PANELS.some((c) => enabled.has(c));
  });
}

/** The live gate: the sides on which `omni-host` would render the header. */
function liveGateSides(sides: Partial<Record<OmniCategory, Side>>): Side[] {
  const cs = deriveCategorySides(placements(sides));
  return SIDES.filter((side) => side === appliedPendingSide(cs));
}

const [REV, CUT] = APPLIED_PANELS;

const CONFIGS: Array<{ name: string; sides: Partial<Record<OmniCategory, Side>> }> = [
  { name: "both on the right (default)", sides: { [REV]: "right", [CUT]: "right" } },
  { name: "both dragged to the left", sides: { [REV]: "left", [CUT]: "left" } },
  { name: "split: revisions left, cutter right", sides: { [REV]: "left", [CUT]: "right" } },
  { name: "split: revisions right, cutter left", sides: { [REV]: "right", [CUT]: "left" } },
  { name: "no placements at all (registry defaults)", sides: {} },
];

describe("appliedPendingSide — the family premise", () => {
  it("the applied-card families map onto two distinct omni panels", () => {
    expect(APPLIED_PANELS.length).toBe(2);
    expect(new Set(APPLIED_PANELS).size).toBe(2);
    expect(APPLIED_PANELS).toEqual(["revisions", "cutter"]);
  });
});

describe("task 420 — the retired gate, demonstrated (controls)", () => {
  it("member 1: split sides → the retired predicate renders on BOTH strips", () => {
    expect(retiredGateSides({ [REV]: "left", [CUT]: "right" }, [])).toEqual(["left", "right"]);
  });
  it("member 2: both categories hidden → the retired predicate renders NOWHERE", () => {
    expect(retiredGateSides({ [REV]: "right", [CUT]: "right" }, [REV, CUT])).toEqual([]);
  });
});

describe("task 420 — the live resolver renders on exactly ONE side", () => {
  for (const { name, sides } of CONFIGS) {
    it(`${name}: exactly one side`, () => {
      expect(liveGateSides(sides).length).toBe(1);
    });
  }

  it("follows the panels when both are dragged across", () => {
    expect(liveGateSides({ [REV]: "left", [CUT]: "left" })).toEqual(["left"]);
    expect(liveGateSides({ [REV]: "right", [CUT]: "right" })).toEqual(["right"]);
  });

  it("split sides: the STATED tie-break is the first family (revisions)", () => {
    expect(liveGateSides({ [REV]: "left", [CUT]: "right" })).toEqual(["left"]);
    expect(liveGateSides({ [REV]: "right", [CUT]: "left" })).toEqual(["right"]);
  });

  it("the resolver takes NO hidden set — visibility cannot reach it", () => {
    // Structural: the function has exactly one parameter, the side map.
    expect(appliedPendingSide.length).toBe(1);
    // And it answers from the derived sides alone, so hiding every category
    // leaves the answer where placement put it.
    const cs = deriveCategorySides(placements({ [REV]: "left", [CUT]: "left" }));
    const hiddenAll = omniCategoriesForSide(cs, [REV, CUT], "left");
    expect(hiddenAll.has(REV)).toBe(false);
    expect(appliedPendingSide(cs)).toBe("left");
  });
});

describe("task 420 — the header is outside every card-filter gate", () => {
  const bulk: OmniBulkPendingChanges = {
    count: 2,
    current: null,
    onPrev: () => {},
    onNext: () => {},
    onKeepAll: () => {},
    onDismissAll: () => {},
  };

  it("renders with hideAllCards ON and NO enabled categories", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[]}
        editor={null}
        enabledCategories={new Set() as Set<OmniCategory>}
        hideAllCards
        bulkPendingChanges={bulk}
      />,
    );
    expect(container.querySelectorAll("[data-omni-bulk-pending]").length).toBe(1);
  });

  it("count === 0 → nothing renders (byte-unchanged behaviour)", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[]}
        editor={null}
        enabledCategories={new Set() as Set<OmniCategory>}
        bulkPendingChanges={{ ...bulk, count: 0 }}
      />,
    );
    expect(container.querySelectorAll("[data-omni-bulk-pending]").length).toBe(0);
  });
});

describe("task 420 — census: the host gate asks PLACEMENT, never the hidden set", () => {
  const ROOT = path.resolve(__dirname, "../../../..");
  const host = codeOnly(
    readFileSync(path.join(ROOT, "components/editor-layout/panels/omni-host.tsx"), "utf8"),
  );
  const pane = codeOnly(readFileSync(path.join(ROOT, "components/EditorPane.tsx"), "utf8"));

  /** The `const bulkForSide = …;` statement, as the host spells it. */
  const gate = /const bulkForSide\s*=([\s\S]*?);/.exec(host)?.[1] ?? "";

  it("the bulk gate exists and spells the resolver", () => {
    expect(gate).not.toBe("");
    expect(gate).toContain("appliedPendingSide(");
  });

  it("the bulk gate does not read the enabled (filtered) set", () => {
    expect(gate).not.toMatch(/enabledForSide|getOmniEnabled|\.has\(/);
  });

  it("EditorPane threads the derived category sides into the host", () => {
    expect(pane).toMatch(/categorySides=\{viewPrefs\.categorySides\}/);
  });
});
