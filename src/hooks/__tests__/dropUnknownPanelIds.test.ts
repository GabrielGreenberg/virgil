// @vitest-environment node
//
// Contract test for the load-time defensive unknown-id drop (the ROOT FIX for
// the recurring stale-snapshot incidents). A panel removed from the codebase
// (the real example: the retired `quotations` panel) must be dropped on load
// from ALL THREE carriers — placements, omniCategories (both sides), and
// printOptions.panels — so it can never round-trip forward into the shipped
// defaults. Every still-valid panel must survive, in order, with side intact.
//
// Imports only the pure helper (which imports only the three registry SSOTs:
// PANEL_REGISTRY / OMNI_PANELS from panel-registry.ts, PRINT_PANELS from
// lib/print.ts). No tiptap barrel, no @/lib/storage — so this runs in the
// default node env with no vi.mock.
import { describe, it, expect } from "vitest";
import { PANEL_REGISTRY, OMNI_PANELS } from "@/panels/panel-registry";
import { PRINT_PANELS } from "@/lib/print";
import {
  filterPlacements,
  filterOmniSide,
  filterOmniCategories,
  filterPrintPanels,
} from "../dropUnknownPanelIds";

// The real retired panel — the fixture that kept re-appearing in the snapshots.
const REMOVED = "quotations";

describe("dropUnknownPanelIds — the removed `quotations` panel in all three carriers", () => {
  it("drops `quotations` from placements while keeping valid ids in order + side", () => {
    const input = [
      { id: "footnotes", side: "left" },
      { id: REMOVED, side: "left" },
      { id: "citations", side: "left" },
      { id: "notes", side: "right" },
      { id: REMOVED, side: "right" },
    ];
    const out = filterPlacements<{ id: string; side: string }>(input);
    expect(out.map((p) => p.id)).toEqual(["footnotes", "citations", "notes"]);
    // Side preserved for survivors.
    expect(out).toEqual([
      { id: "footnotes", side: "left" },
      { id: "citations", side: "left" },
      { id: "notes", side: "right" },
    ]);
    // Nothing injected — strictly a subset of the input ids.
    expect(out.length).toBeLessThan(input.length);
  });

  it("drops `quotations` from omniCategories on BOTH sides, preserving order", () => {
    const out = filterOmniCategories({
      left: ["footnotes", REMOVED, "citations", "examples"],
      right: ["notes", "todo", REMOVED, "archive"],
    });
    expect(out.left).toEqual(["footnotes", "citations", "examples"]);
    expect(out.right).toEqual(["notes", "todo", "archive"]);
  });

  it("drops `quotations` from printOptions.panels, preserving valid keys + values", () => {
    const out = filterPrintPanels({
      footnotes: true,
      [REMOVED]: true,
      citations: false,
      notes: true,
    });
    expect(out).toEqual({ footnotes: true, citations: false, notes: true });
    expect(REMOVED in out).toBe(false);
  });
});

describe("dropUnknownPanelIds — validates against the live registry SSOTs (allowlist)", () => {
  it("keeps every real PANEL_REGISTRY placement id", () => {
    const all = Object.keys(PANEL_REGISTRY).map((id) => ({ id, side: "left" }));
    const out = filterPlacements<{ id: string; side: string }>(all);
    expect(out.map((p) => p.id)).toEqual(Object.keys(PANEL_REGISTRY));
  });

  it("keeps every omni-eligible PanelKind, drops a non-omni / unknown one", () => {
    const omniKinds = OMNI_PANELS.map((e) => e.kind);
    // `bibliography` is a real PanelKind but NOT omni-eligible → must drop.
    const out = filterOmniSide([...omniKinds, "bibliography", "made-up-panel"]);
    expect(out).toEqual(omniKinds);
  });

  it("keeps every real PRINT_PANELS key", () => {
    const allTrue = Object.fromEntries(
      Object.keys(PRINT_PANELS).map((k) => [k, true]),
    );
    const out = filterPrintPanels(allTrue);
    expect(Object.keys(out).sort()).toEqual(Object.keys(PRINT_PANELS).sort());
  });
});

describe("dropUnknownPanelIds — known-good blob round-trips unchanged", () => {
  it("placements: all-valid input returns the same ids in the same order", () => {
    const good = [
      { id: "footnotes", side: "left" },
      { id: "citations", side: "left" },
      { id: "notes", side: "right" },
      { id: "todo", side: "right" },
    ];
    expect(filterPlacements<{ id: string; side: string }>(good)).toEqual(good);
  });

  it("omniCategories: all-valid input is unchanged", () => {
    const good = {
      left: ["footnotes", "citations", "examples"],
      right: ["notes", "todo", "archive", "revisions"],
    };
    expect(filterOmniCategories(good)).toEqual(good);
  });

  it("printOptions.panels: all-valid input is unchanged", () => {
    const good = { footnotes: true, citations: false, notes: true, todo: true };
    expect(filterPrintPanels(good)).toEqual(good);
  });
});

describe("dropUnknownPanelIds — malformed input is safe (never throws)", () => {
  it("filterPlacements tolerates non-array / non-object / missing-id entries", () => {
    expect(filterPlacements(null)).toEqual([]);
    expect(filterPlacements(undefined)).toEqual([]);
    expect(filterPlacements("nope" as unknown)).toEqual([]);
    expect(filterPlacements(42 as unknown)).toEqual([]);
    expect(
      filterPlacements<{ id: string; side: string }>([
        null,
        42,
        "string",
        {},
        { id: 7 },
        { id: "footnotes", side: "left" },
      ]),
    ).toEqual([{ id: "footnotes", side: "left" }]);
  });

  it("filterOmniCategories tolerates a missing / malformed container or sides", () => {
    expect(filterOmniCategories(null)).toEqual({ left: [], right: [] });
    expect(filterOmniCategories(undefined)).toEqual({ left: [], right: [] });
    expect(filterOmniCategories("nope" as unknown)).toEqual({ left: [], right: [] });
    expect(filterOmniCategories({})).toEqual({ left: [], right: [] });
    expect(
      filterOmniCategories({ left: "notarray", right: [1, 2, "notes", REMOVED] }),
    ).toEqual({ left: [], right: ["notes"] });
  });

  it("filterPrintPanels tolerates non-object input and coerces values to boolean", () => {
    expect(filterPrintPanels(null)).toEqual({});
    expect(filterPrintPanels(undefined)).toEqual({});
    expect(filterPrintPanels("nope" as unknown)).toEqual({});
    expect(filterPrintPanels(42 as unknown)).toEqual({});
    // Truthy/falsy values are coerced to a real boolean.
    expect(filterPrintPanels({ footnotes: 1, citations: 0, notes: "" })).toEqual({
      footnotes: true,
      citations: false,
      notes: false,
    });
  });
});
