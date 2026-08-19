// @vitest-environment jsdom
//
// The END-TO-END half of task 275, driving the REAL `loadPrefs` pipeline.
//
// `rename-panel-id.test.ts` proves the applier is correct. This suite proves
// the two things a test of the applier alone structurally CANNOT — because the
// applier was never the part that could misbehave:
//
//  1. the LOADER actually calls it, and calls it BEFORE the subtractive
//     cleaners (`filterPlacements` / `clampStack` / `validPanelId` /
//     `filterOmniSide` / `filterPrintPanels`) and before the legacy
//     `active*` deletes — those are precisely what turn an un-renamed old id
//     into a silent DROP; and
//  2. no one hand-inlines a fourth rename beside it. The pre-275 loader had
//     three, each covering 2 of 11 carriers.
//
// Defect legs: every `expect` below marked "was DROPPED"/"was ORPHANED" fails
// on the pre-275 loader.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// `useViewPrefs` transitively pulls `@/lib/storage`, whose runtime
// `require("@/lib/storage-fsa")` vitest's resolver can't alias. `loadPrefs`
// never touches a storage backend (it reads localStorage directly).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs } from "../useViewPrefs";

const GLOBAL_KEY = "virgil-view-prefs/global";
const WINDOW_KEY = `virgil-view-prefs/window/${WINDOW_ID}`;

/** Write a legacy blob split across the two slices the way the app stores it:
 *  `placements` / `omniCategories` (pre-381) / `printOptions` are GLOBAL; the dock,
 *  float, height, mode and archive-view carriers are per-window. */
function writeLegacyBlob(opts: {
  global?: Record<string, unknown>;
  window?: Record<string, unknown>;
}) {
  localStorage.setItem(GLOBAL_KEY, JSON.stringify(opts.global ?? {}));
  localStorage.setItem(WINDOW_KEY, JSON.stringify(opts.window ?? {}));
}

beforeEach(() => {
  localStorage.clear();
});

describe("loadPrefs — a retired panel id is RENAMED across every carrier", () => {
  /** The full-fidelity legacy layout: `comments` present in all 11 carriers. */
  function loadCommentsEverywhere() {
    writeLegacyBlob({
      global: {
        // Deliberately the NON-default side, so a passing assertion proves the
        // side transferred rather than that the defaults merge supplied it
        // (`revisions` and `notes` both default to "right").
        placements: [{ id: "comments", side: "left" }],
        omniCategories: { left: ["comments"], right: [] },
        printOptions: {
          // `revisions` ships as false, so `true` here can only have come
          // across from `comments`.
          panels: { comments: true },
          elements: {},
          fontSizeRem: 1,
        },
      },
      window: {
        dockStack: { left: ["comments"], right: [] },
        panelHeights: { comments: 240 },
        panelModes: { comments: "floating" },
        floatPositions: { comments: { x: 11, y: 22, width: 333, height: 444 } },
        cardArchiveView: { comments: "archived" },
        poppedOutPanels: ["comments"],
        poppedOutOrigins: { comments: "bottom" },
      },
    });
    return loadPrefs();
  }

  it("transfers the strip placement, with its side — and lands the split's new panel beside it", () => {
    const p = loadCommentsEverywhere();
    const byId = new Map(p.placements.map((pl) => [pl.id, pl.side]));
    expect(byId.get("revisions")).toBe("left");
    // The split's second panel inherits the heir's side, not its own default.
    expect(byId.get("notes")).toBe("left");
    expect(p.placements.some((pl) => (pl.id as string) === "comments")).toBe(false);
  });

  it("transfers the DOCK slot — was DROPPED by clampStack", () => {
    expect(loadCommentsEverywhere().dockStack).toEqual({ left: ["revisions"], right: [] });
  });

  it("transfers the FLOAT state and its origin — was DROPPED by validPanelId", () => {
    const p = loadCommentsEverywhere();
    expect(p.poppedOutPanels).toEqual(["revisions"]);
    expect(p.poppedOutOrigins).toEqual({ revisions: "bottom" });
  });

  // Task 381 renegotiated the CARRIER, not the contract: omni membership is
  // now the side-free HIDDEN set, folded once from this very legacy per-side
  // blob. So "the chip transferred" reads as "the heir is not hidden" — and the
  // leg keeps its teeth, because without the legacy-carrier rename the fold
  // sees `comments` (not an omni-eligible kind), concludes `revisions` was
  // never enabled, and hides it.
  it("transfers the OMNI chip — was DROPPED by the omni category cleaner", () => {
    const hidden = loadCommentsEverywhere().omniHiddenCategories;
    expect(hidden).not.toContain("revisions");
    // A control: a category the legacy blob genuinely did NOT enable stays
    // hidden, so the assertion above can't pass on an empty hidden set.
    expect(hidden).toContain("footnotes");
  });

  it("transfers the PRINT include — was DROPPED by filterPrintPanels", () => {
    expect(loadCommentsEverywhere().printOptions.panels.revisions).toBe(true);
  });

  it("transfers the band height / mode / float rect / archive view — were ORPHANED", () => {
    const p = loadCommentsEverywhere();
    expect(p.panelHeights).toEqual({ revisions: 240 });
    expect(p.panelModes).toEqual({ revisions: "floating" });
    expect(p.floatPositions).toEqual({
      revisions: { x: 11, y: 22, width: 333, height: 444 },
    });
    expect(p.cardArchiveView).toEqual({ revisions: "archived" });
  });

  it("leaves NO orphan key behind under the retired id", () => {
    const p = loadCommentsEverywhere();
    for (const carrier of [
      p.panelHeights,
      p.panelModes,
      p.floatPositions,
      p.cardArchiveView,
      p.poppedOutOrigins,
    ] as Record<string, unknown>[]) {
      expect(Object.keys(carrier)).not.toContain("comments");
    }
    expect(p.printOptions.panels).not.toHaveProperty("comments");
  });

  it("splits `references` into citations + bibliography on the saved side", () => {
    // Both default to "left", so "right" is what proves the transfer.
    writeLegacyBlob({
      global: { placements: [{ id: "references", side: "right" }] },
      window: { dockStack: { left: [], right: ["references"] }, panelHeights: { references: 180 } },
    });
    const p = loadPrefs();
    const byId = new Map(p.placements.map((pl) => [pl.id, pl.side]));
    expect(byId.get("citations")).toBe("right");
    expect(byId.get("bibliography")).toBe("right");
    // `citations` is the heir: it — not `bibliography` — takes the dock slot
    // and the saved band height.
    expect(p.dockStack.right).toEqual(["citations"]);
    expect(p.panelHeights).toEqual({ citations: 180 });
  });

  it("still derives the legacy activeLeft/Right layout through the rename", () => {
    // No `dockStack` at all — the ancient shape, where the open layout comes
    // wholly from the `active*` scalars the loader deletes moments later.
    writeLegacyBlob({
      global: { placements: [{ id: "comments", side: "left" }] },
      window: { activeLeft: "comments", activeLeftBottom: "suggestions" },
    });
    const p = loadPrefs();
    expect(p.dockStack.left).toEqual(["revisions"]);
    // …and the dead keys never round-trip.
    expect(p).not.toHaveProperty("activeLeft");
    expect(p).not.toHaveProperty("activeLeftBottom");
  });

  it("folds `suggestions` onto an already-docked `revisions` without duplicating it", () => {
    writeLegacyBlob({
      global: {
        placements: [
          { id: "revisions", side: "right" },
          { id: "suggestions", side: "right" },
        ],
      },
      window: { dockStack: { left: [], right: ["revisions", "suggestions"] } },
    });
    const p = loadPrefs();
    expect(p.dockStack.right).toEqual(["revisions"]);
    expect(p.placements.filter((pl) => pl.id === "revisions")).toHaveLength(1);
  });

  it("leaves a modern blob byte-identical (idempotent, no churn)", () => {
    writeLegacyBlob({
      global: { placements: [{ id: "notes", side: "right" }] },
      window: {
        dockStack: { left: [], right: ["notes"] },
        panelHeights: { notes: 200 },
        panelModes: { notes: "docked" },
      },
    });
    const p = loadPrefs();
    expect(p.dockStack).toEqual({ left: [], right: ["notes"] });
    expect(p.panelHeights).toEqual({ notes: 200 });
    expect(p.panelModes).toEqual({ notes: "docked" });
  });

  it("does not disturb the card-kind vocabularies that spell like panels", () => {
    // `hiddenMarginaliaTypes` / `hiddenHighlightTypes` hold CARD kinds. A
    // blob-wide rewrite would silently unhide the user's hidden types.
    writeLegacyBlob({
      global: {
        placements: [{ id: "comments", side: "left" }],
        hiddenHighlightTypes: ["comment", "note"],
        hiddenMarginaliaTypes: ["archive", "todo"],
      },
    });
    const p = loadPrefs();
    expect(p.hiddenHighlightTypes).toEqual(["comment", "note"]);
    expect(p.hiddenMarginaliaTypes).toEqual(["archive", "todo"]);
  });
});

/* ── The census: nothing hand-inlines a rename beside the applier ───────── */

describe("census — the loader delegates renames, and delegates them FIRST", () => {
  // Comments stripped, STRING LITERALS KEPT — the drift lives in literals.
  const src = commentsStripped(
    readFileSync(resolve(process.cwd(), "src/hooks/useViewPrefs.ts"), "utf8"),
  );

  it("can see what it is looking for (canary)", () => {
    expect(src.length).toBeGreaterThan(10_000);
    expect(src).toContain("applyPanelRenames(");
    expect(src).toContain("clampStack(");
  });

  for (const retired of ["references", "comments", "suggestions"]) {
    it(`\`${retired}\` is not spelled anywhere in the loader`, () => {
      // A retired panel id in this file is a hand-inlined rename — the pre-275
      // shape, which covered 2 of 11 carriers. Declare it in `PANEL_RENAMES`.
      expect(src).not.toContain(`"${retired}"`);
    });
  }

  it("renames run BEFORE every subtractive cleaner and before the legacy deletes", () => {
    // Order is the whole mechanism: a cleaner that runs first DROPS the old id
    // and leaves the rename nothing to carry. This is what a future refactor
    // (hoisting the applier, or moving the cleaners up) would break silently.
    // The cleaners are named by BARE name and located with `lastIndexOf`: each
    // is also spelled in the import block at the top of the file, and each has
    // exactly one call site, so the last occurrence IS the call — and the
    // needle survives a generic argument (`filterPlacements<PanelPlacement>(`)
    // that a `name(` needle would miss, which is how this leg first failed.
    const at = (needle: string, from: "first" | "last") => {
      const i = from === "first" ? src.indexOf(needle) : src.lastIndexOf(needle);
      expect(i, `missing: ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    // `applyPanelRenames(` with the paren appears only at the call — the
    // import spells `applyPanelRenames,`.
    const rename = at("applyPanelRenames(", "first");
    for (const cleaner of [
      "filterPlacements",
      "filterOmniSide",
      "filterPrintPanels",
      "clampStack",
      "const validPanelId",
      '"activeLeftBottom"', // the legacy-scalar delete list
    ]) {
      expect(rename, `applyPanelRenames must precede ${cleaner}`).toBeLessThan(
        at(cleaner, "last"),
      );
    }
  });
});
