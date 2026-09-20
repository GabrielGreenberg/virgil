// @vitest-environment node
//
// THE CENSUS IS READ BY BOTH HALVES (task 675).
//
// `PANEL_ID_CARRIERS` states, once, which `ViewPrefs` fields carry panel ids,
// how each holds them, and which live registry may keep one. Two operations
// walk it: the ADDITIVE `applyPanelRenames` and the SUBTRACTIVE
// `scrubUnknownPanelIds`. Before this task the scrub read no table at all — it
// was four hand-inlined functions over three hardcoded allowlists, covering
// four carriers of eleven, and `panelHeights` / `panelModes` /
// `floatPositions` / `cardArchiveView` kept a retired id forever.
//
// So these legs are GENERATED FROM THE CENSUS rather than hand-listed: a
// carrier added to `ViewPrefs` is a compile error in the census until it is
// classified, and the moment it is classified it is covered here — by both
// halves — with no edit to this file. That pairing is the guard; a hand-listed
// suite would have the same hole the hand-listed scrub had.
//
// Pure module chain (census → types only; scrub → the three registry SSOTs),
// so this runs in the bare node env with no mocks.
import { describe, it, expect } from "vitest";
import { PANEL_REGISTRY, OMNI_PANELS } from "@/panels/panel-registry";
import { PRINT_PANELS } from "@/lib/print";
import {
  PANEL_ID_CARRIERS,
  type CarrierShape,
  type CarrierVocabulary,
} from "../panel-id-carriers";
import { scrubUnknownPanelIds } from "../dropUnknownPanelIds";
import { applyPanelRenames } from "../rename-panel-id";

/** The real retired panel — the fixture that kept re-appearing in the
 *  snapshots, and the reason the scrub exists at all. */
const RETIRED = "quotations";

/** A live member of each vocabulary, read from the registry itself so a future
 *  panel rename can't rot the fixture. */
const LIVE: Readonly<Record<CarrierVocabulary, string>> = {
  panel: Object.keys(PANEL_REGISTRY)[0],
  omni: OMNI_PANELS[0].kind,
  print: Object.keys(PRINT_PANELS)[0],
};

/** Build a carrier value of the given shape holding `live` and `retired`. */
function seed(shape: CarrierShape, live: string, retired: string): unknown {
  switch (shape) {
    case "placements":
      return [
        { id: live, side: "left" },
        { id: retired, side: "right" },
      ];
    case "id-list":
      return [live, retired];
    case "sided-id-list":
      return { left: [live, retired], right: [retired] };
    case "id-record":
      return { [live]: 1, [retired]: 2 };
    case "print-panels":
      return { elements: {}, panels: { [live]: true, [retired]: true } };
  }
}

/** Every panel id a carrier value holds, whatever its shape. */
function idsIn(shape: CarrierShape, value: unknown): string[] {
  const asRecord = (v: unknown) =>
    v && typeof v === "object" ? Object.keys(v as object) : [];
  switch (shape) {
    case "placements":
      return (value as { id: string }[]).map((p) => p.id);
    case "id-list":
      return value as string[];
    case "sided-id-list": {
      const v = value as { left: string[]; right: string[] };
      return [...v.left, ...v.right];
    }
    case "id-record":
      return asRecord(value);
    case "print-panels":
      return asRecord((value as { panels: unknown }).panels);
  }
}

/** The classified carriers, as `[field, carrier]` — the table both halves walk. */
const CLASSIFIED = Object.entries(PANEL_ID_CARRIERS).flatMap(([field, carrier]) =>
  carrier ? [[field, carrier] as const] : [],
);

describe("PANEL_ID_CARRIERS — the SUBTRACTIVE half covers every classified carrier", () => {
  it.each(CLASSIFIED)("%s drops a retired id and keeps the live one", (field, carrier) => {
    const live = LIVE[carrier.vocabulary];
    const blob = { [field]: seed(carrier.shape, live, RETIRED) };

    const out = scrubUnknownPanelIds(blob);
    const ids = idsIn(carrier.shape, out[field]);

    expect(ids).not.toContain(RETIRED);
    expect(ids).toContain(live);
  });

  it("leaves a blob that carries only live ids strictly alone (same object)", () => {
    const blob: Record<string, unknown> = {};
    for (const [field, carrier] of CLASSIFIED) {
      const live = LIVE[carrier.vocabulary];
      blob[field] = seed(carrier.shape, live, live);
    }
    expect(scrubUnknownPanelIds(blob)).toBe(blob);
  });

  it("leaves MALFORMED carriers untouched rather than emptying them", () => {
    // This walk runs on the raw blob BEFORE the defaults merge; shape validity
    // belongs to the loader's post-merge filters, which still get their say.
    const blob = {
      placements: "nope",
      panelHeights: 42,
      dockStack: null,
      printOptions: { panels: "nope" },
    };
    expect(scrubUnknownPanelIds(blob)).toBe(blob);
  });

  it("never touches a carrier classified `null` — those are keyed by something else", () => {
    // `panelWidths` is keyed by Side and `cardFloatPositions` by float card
    // key. Scrubbing them against the panel registry would delete every entry.
    const blob = {
      panelWidths: { left: 320, right: 280 },
      cardFloatPositions: { "float:margin:note:abc": { x: 1, y: 2, width: 3, height: 4 } },
      poppedOutCards: ["float:margin:note:abc"],
      omniHideAllCards: { left: true, right: false },
      appliedPrefMigrations: ["some-migration-id"],
    };
    expect(scrubUnknownPanelIds(blob)).toBe(blob);
  });
});

describe("PANEL_ID_CARRIERS — the two halves move in lockstep", () => {
  // The whole point of one table: a rename must reach every carrier the scrub
  // reaches, or an id the rename missed is an id the scrub then DELETES — the
  // silent-drop defect task 275 fixed, re-armed one carrier at a time.
  it.each(CLASSIFIED)(
    "%s: a rename promotes the retired id instead of losing it to the scrub",
    (field, carrier) => {
      const live = LIVE[carrier.vocabulary];
      const heir = LIVE[carrier.vocabulary];
      const blob = { [field]: seed(carrier.shape, live, RETIRED) };

      // Rename first (the production order), then scrub.
      const renamed = applyPanelRenames(blob, [{ from: RETIRED, to: heir }]);
      const out = scrubUnknownPanelIds(renamed);

      expect(idsIn(carrier.shape, out[field])).toContain(heir);
    },
  );
});

describe("PANEL_ID_CARRIERS — each carrier is scrubbed against its OWN vocabulary", () => {
  it("omniHiddenCategories keeps only omni-eligible kinds, not every panel", () => {
    const nonOmni = Object.keys(PANEL_REGISTRY).find(
      (k) => !OMNI_PANELS.some((e) => e.kind === k),
    );
    expect(nonOmni).toBeDefined();
    const out = scrubUnknownPanelIds({
      omniHiddenCategories: [OMNI_PANELS[0].kind, nonOmni!],
      // The SAME id in a panel-vocabulary carrier must survive — that is the
      // whole reason the vocabularies are not interchangeable.
      panelModes: { [nonOmni!]: "floating" },
    });
    expect(out.omniHiddenCategories).toEqual([OMNI_PANELS[0].kind]);
    expect(out.panelModes).toEqual({ [nonOmni!]: "floating" });
  });

  it("printOptions.panels is validated against PRINT_PANELS, not PANEL_REGISTRY", () => {
    const panelOnly = Object.keys(PANEL_REGISTRY).find((k) => !(k in PRINT_PANELS));
    expect(panelOnly).toBeDefined();
    const out = scrubUnknownPanelIds({
      printOptions: {
        scale: 1,
        panels: { [Object.keys(PRINT_PANELS)[0]]: true, [panelOnly!]: true },
      },
    });
    const panels = (out.printOptions as { panels: Record<string, boolean> }).panels;
    expect(Object.keys(panels)).toEqual([Object.keys(PRINT_PANELS)[0]]);
    // Sibling print options ride through untouched.
    expect((out.printOptions as { scale: number }).scale).toBe(1);
  });
});
