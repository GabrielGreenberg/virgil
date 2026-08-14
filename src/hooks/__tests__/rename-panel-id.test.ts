// @vitest-environment node
//
// Contract test for the load-time panel-RENAME migration — the additive twin of
// `dropUnknownPanelIds`. Task 275: the three shipped renames rewrote only
// `placements` + the legacy `active*` scalars, so a panel docked/floating under
// a retired id was DROPPED by the subtractive cleaners and its saved
// rect/height/mode/archive-view/print-include/omni-chip left ORPHANED.
//
// The module under test has ZERO runtime imports (types only), so this runs in
// the bare node env with no `vi.mock` — the same property `view-prefs-dock`'s
// suite relies on. The real-`loadPrefs` end-to-end legs (and the census that
// catches the ORIGINAL shape — a loader that never calls the helper) live in
// `view-prefs-panel-rename.test.ts`, which needs jsdom.
import { describe, it, expect } from "vitest";
import { applyPanelRenames, PANEL_RENAMES, type PanelRename } from "../rename-panel-id";

/** A one→one rename, the shape the helper's carriers all see. */
const FOLD: readonly PanelRename[] = [{ from: "suggestions", to: "revisions" }];
/** A split: heir + a genuinely new panel. */
const SPLIT: readonly PanelRename[] = [
  { from: "comments", to: "revisions", alsoPlace: ["notes"] },
];

describe("applyPanelRenames — every PanelId-keyed carrier", () => {
  it("renames the id in ALL carriers at once, not just placements", () => {
    const out = applyPanelRenames(
      {
        placements: [
          { id: "footnotes", side: "left" },
          { id: "suggestions", side: "right" },
        ],
        dockStack: { left: [], right: ["suggestions"] },
        panelMRU: { left: ["suggestions"], right: [] },
        poppedOutPanels: ["suggestions"],
        poppedOutOrigins: { suggestions: "bottom" },
        panelModes: { suggestions: "floating" },
        panelHeights: { suggestions: 240 },
        floatPositions: { suggestions: { x: 1, y: 2, width: 3, height: 4 } },
        cardArchiveView: { suggestions: "archived" },
        omniCategories: { left: ["suggestions"], right: [] },
        printOptions: { panels: { suggestions: true }, fontSizeRem: 1 },
      },
      FOLD,
    );

    expect(out.placements).toEqual([
      { id: "footnotes", side: "left" },
      // Position AND side preserved — a rename must not move the strip icon.
      { id: "revisions", side: "right" },
    ]);
    expect(out.dockStack).toEqual({ left: [], right: ["revisions"] });
    expect(out.panelMRU).toEqual({ left: ["revisions"], right: [] });
    expect(out.poppedOutPanels).toEqual(["revisions"]);
    expect(out.poppedOutOrigins).toEqual({ revisions: "bottom" });
    expect(out.panelModes).toEqual({ revisions: "floating" });
    expect(out.panelHeights).toEqual({ revisions: 240 });
    expect(out.floatPositions).toEqual({
      revisions: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(out.cardArchiveView).toEqual({ revisions: "archived" });
    expect(out.omniCategories).toEqual({ left: ["revisions"], right: [] });
    expect(out.printOptions).toEqual({
      panels: { revisions: true },
      fontSizeRem: 1,
    });
  });

  it("carries the LEGACY active* scalars — all four, not just the two top slots", () => {
    // The pre-275 inline template rewrote activeLeft/activeRight only, so an
    // ancient split layout whose SECOND band was the renamed panel lost it.
    const out = applyPanelRenames(
      {
        activeLeft: "suggestions",
        activeRight: "footnotes",
        activeLeftBottom: "suggestions",
        activeRightBottom: "suggestions",
      },
      FOLD,
    );
    expect(out.activeLeft).toBe("revisions");
    expect(out.activeRight).toBe("footnotes");
    expect(out.activeLeftBottom).toBe("revisions");
    expect(out.activeRightBottom).toBe("revisions");
  });

  it("leaves NON-panel-keyed collections alone (side keys, card keys)", () => {
    const panelWidths = { left: 300, right: 280 };
    const poppedOutCards = ["float:card:note:abc"];
    const cardFloatPositions = { "float:card:note:abc": { x: 0, y: 0, width: 1, height: 1 } };
    const omniHideAllCards = { left: false, right: true };
    const out = applyPanelRenames(
      { panelWidths, poppedOutCards, cardFloatPositions, omniHideAllCards },
      PANEL_RENAMES,
    );
    // Untouched by IDENTITY — no copy was even made.
    expect(out.panelWidths).toBe(panelWidths);
    expect(out.poppedOutCards).toBe(poppedOutCards);
    expect(out.cardFloatPositions).toBe(cardFloatPositions);
    expect(out.omniHideAllCards).toBe(omniHideAllCards);
  });

  it("never rewrites the card-kind vocabularies that COLLIDE by spelling", () => {
    // `hiddenMarginaliaTypes`/`hiddenHighlightTypes` hold CARD kinds — `note`,
    // `todo`, `archive`, `comment` — that spell like PanelKinds. A blob-wide
    // string rewrite would silently unhide the user's hidden card types.
    const hiddenHighlightTypes = ["comment", "note"];
    const hiddenMarginaliaTypes = ["archive", "todo"];
    const out = applyPanelRenames(
      { hiddenHighlightTypes, hiddenMarginaliaTypes },
      PANEL_RENAMES,
    );
    expect(out.hiddenHighlightTypes).toBe(hiddenHighlightTypes);
    expect(out.hiddenMarginaliaTypes).toBe(hiddenMarginaliaTypes);
  });
});

describe("applyPanelRenames — the heir model", () => {
  it("places the split's NEW panel beside the heir, on the heir's side", () => {
    const out = applyPanelRenames(
      {
        placements: [
          { id: "comments", side: "left" },
          { id: "footnotes", side: "right" },
        ],
      },
      SPLIT,
    );
    expect(out.placements).toEqual([
      { id: "revisions", side: "left" },
      { id: "notes", side: "left" },
      { id: "footnotes", side: "right" },
    ]);
  });

  it("gives the split's extra panel NO dock slot, rect, mode or height", () => {
    // Only the heir inherits identity. Inventing state for a panel the user
    // never opened would be fabricating a layout they didn't choose.
    const out = applyPanelRenames(
      {
        placements: [{ id: "comments", side: "left" }],
        dockStack: { left: ["comments"], right: [] },
        panelHeights: { comments: 200 },
        floatPositions: { comments: { x: 1, y: 1, width: 1, height: 1 } },
      },
      SPLIT,
    );
    expect(out.dockStack).toEqual({ left: ["revisions"], right: [] });
    expect(out.panelHeights).toEqual({ revisions: 200 });
    expect(out.floatPositions).toEqual({
      revisions: { x: 1, y: 1, width: 1, height: 1 },
    });
  });
});

describe("applyPanelRenames — collisions: the LIVE entry wins", () => {
  it("does not mint a duplicate when the heir is already docked/placed", () => {
    const out = applyPanelRenames(
      {
        placements: [
          { id: "revisions", side: "left" },
          { id: "suggestions", side: "right" },
        ],
        dockStack: { left: ["revisions", "suggestions"], right: [] },
        poppedOutPanels: ["revisions", "suggestions"],
      },
      FOLD,
    );
    // The retired entry is dropped; the live heir keeps its own side/position.
    expect(out.placements).toEqual([{ id: "revisions", side: "left" }]);
    expect(out.dockStack).toEqual({ left: ["revisions"], right: [] });
    expect(out.poppedOutPanels).toEqual(["revisions"]);
  });

  it("leaves the live heir in its OWN dock position, not the retired id's", () => {
    // Renaming the retired id in place would move the band: `revisions` is the
    // third band here and must stay third, rather than being pulled to the top
    // because `suggestions` happened to sit there.
    const out = applyPanelRenames(
      { dockStack: { left: ["suggestions", "footnotes", "revisions"], right: [] } },
      FOLD,
    );
    expect(out.dockStack).toEqual({ left: ["footnotes", "revisions"], right: [] });
  });

  it("de-duplicates a blob that carries the retired id twice", () => {
    const out = applyPanelRenames(
      { poppedOutPanels: ["suggestions", "footnotes", "suggestions"] },
      FOLD,
    );
    expect(out.poppedOutPanels).toEqual(["revisions", "footnotes"]);
  });

  it("keeps the heir's OWN record value on a record collision", () => {
    const out = applyPanelRenames(
      {
        panelHeights: { revisions: 100, suggestions: 999 },
        cardArchiveView: { revisions: "active", suggestions: "archived" },
      },
      FOLD,
    );
    expect(out.panelHeights).toEqual({ revisions: 100 });
    expect(out.cardArchiveView).toEqual({ revisions: "active" });
  });

  it("folds two renames onto ONE heir (comments AND suggestions → revisions)", () => {
    const out = applyPanelRenames(
      {
        placements: [
          { id: "comments", side: "left" },
          { id: "suggestions", side: "right" },
        ],
        dockStack: { left: ["comments"], right: ["suggestions"] },
      },
      PANEL_RENAMES,
    );
    expect(out.placements).toEqual([
      { id: "revisions", side: "left" },
      { id: "notes", side: "left" },
    ]);
    // Per-side by design: the cross-side duplicate is `clampStack`'s job, and
    // it runs after this in the loader.
    expect(out.dockStack).toEqual({ left: ["revisions"], right: ["revisions"] });
  });
});

describe("applyPanelRenames — purity and malformed input", () => {
  it("returns the SAME object when nothing matched", () => {
    const blob = {
      placements: [{ id: "footnotes", side: "left" }],
      dockStack: { left: ["footnotes"], right: [] },
    };
    expect(applyPanelRenames(blob, PANEL_RENAMES)).toBe(blob);
  });

  it("never mutates its input", () => {
    const blob = {
      placements: [{ id: "suggestions", side: "left" }],
      panelHeights: { suggestions: 120 },
    };
    const snapshot = JSON.parse(JSON.stringify(blob));
    applyPanelRenames(blob, FOLD);
    expect(blob).toEqual(snapshot);
  });

  it("is idempotent — a second pass changes nothing", () => {
    const once = applyPanelRenames(
      { placements: [{ id: "comments", side: "left" }], panelModes: { comments: "floating" } },
      PANEL_RENAMES,
    );
    expect(applyPanelRenames(once, PANEL_RENAMES)).toBe(once);
  });

  it("leaves malformed carriers untouched rather than throwing", () => {
    // The loader wraps everything in one `try` that falls back to DEFAULT_PREFS
    // for the WHOLE blob, so a throw here would reset the user's entire layout
    // over one bad key.
    expect(() =>
      applyPanelRenames(
        {
          placements: "not-an-array",
          dockStack: 7,
          panelHeights: null,
          printOptions: { panels: "nope" },
          omniCategories: { left: null, right: ["suggestions"] },
        },
        PANEL_RENAMES,
      ),
    ).not.toThrow();
    const out = applyPanelRenames(
      { placements: "not-an-array", dockStack: 7, omniCategories: { left: null, right: ["suggestions"] } },
      FOLD,
    );
    expect(out.placements).toBe("not-an-array");
    expect(out.dockStack).toBe(7);
    // A malformed SIDE doesn't stop the well-formed one.
    expect(out.omniCategories).toEqual({ left: null, right: ["revisions"] });
  });

  it("tolerates junk entries inside placements", () => {
    const out = applyPanelRenames(
      { placements: [null, 42, { side: "left" }, { id: "suggestions", side: "left" }] },
      FOLD,
    );
    expect(out.placements).toEqual([
      null,
      42,
      { side: "left" },
      { id: "revisions", side: "left" },
    ]);
  });
});

describe("PANEL_RENAMES — the shipped table", () => {
  it("declares the three historical renames with their heirs", () => {
    expect(PANEL_RENAMES).toEqual([
      { from: "references", to: "citations", alsoPlace: ["bibliography"] },
      { from: "comments", to: "revisions", alsoPlace: ["notes"] },
      { from: "suggestions", to: "revisions" },
    ]);
  });

  it("orders comments→revisions BEFORE suggestions→revisions", () => {
    // Reversed, a blob carrying both would land two `revisions` placements
    // before the de-dupe could see the second one as a collision.
    const iComments = PANEL_RENAMES.findIndex((r) => r.from === "comments");
    const iSuggestions = PANEL_RENAMES.findIndex((r) => r.from === "suggestions");
    expect(iComments).toBeLessThan(iSuggestions);
  });

  it("takes the rename table as a REQUIRED argument", () => {
    // A defaulted table is a decision nobody made — the same rule
    // `clampStack(…, max)` earned in task 273. Pinned by arity.
    expect(applyPanelRenames.length).toBe(2);
  });
});
