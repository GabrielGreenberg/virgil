// Task 381 — ONE side fact per panel, and every surface DERIVES from it.
//
// THE DEFECT this pins: the two surfaces that give a card a side answered from
// different tables. Margin markers + the Mode-A rail followed the panel's LIVE
// strip placement (task 205's ladder); the OMNI COLUMN read
// `prefs.omniCategories[side]` — stored per-side enabled-category lists seeded
// once from a `registry.omniSide` column and re-derived by nothing. Drag the
// Reports strip icon to the right and its markers moved while its omni cards
// stayed in the left column (which, in Gabriel's stored state, additionally
// hides all cards — so they vanished outright).
//
// Every leg below drives the REAL derivations. `deriveCategorySides` already
// existed and already answered the right question — its ONLY consumer was the
// filter menu's chip list — so the defect legs reimplement the RETIRED stored
// -list rule locally rather than re-parameterising the live one, and therefore
// fail for the reason they name instead of by arithmetic identity.
//
// The leg with teeth is the CENSUS at the bottom: the derivation was never the
// part that could misbehave — a surface that reads a stored per-side list
// instead is, and `prefs.omniCategories[side]` type-checked perfectly.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly, commentsStripped } from "./_source-scan";
import { PANEL_REGISTRY, OMNI_PANELS } from "@/panels/panel-registry";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { ALL_MARKER_TYPES, panelForMarkerType } from "@/cards/marker-meta";
import type { CardKind } from "@/cards/types";
import {
  defaultPanelSide,
  panelSidesFromPlacements,
  resolvePanelSide,
} from "@/lib/panel-side";
import { marginSideForCardKind, marginSideForMarkerType } from "@/lib/margin-side";
import {
  OMNI_CATEGORIES,
  deriveCategorySides,
  hiddenFromLegacySides,
  omniCategoriesForSide,
  omniCategoriesOnSide,
  type OmniCategory,
} from "@/panels/Omni/omni-categories";
import {
  applyPanelSideMigrations,
  PANEL_SIDE_MIGRATIONS,
  type PanelSideMigration,
} from "@/hooks/panel-side-migrations";

type Side = "left" | "right";

/** Every placement id the registry can name, on one stated side. */
function placeAll(side: Side) {
  return (Object.keys(PANEL_REGISTRY) as (keyof typeof PANEL_REGISTRY)[])
    .filter((k) => PANEL_REGISTRY[k].defaultStripSide !== null)
    .map((id) => ({ id: id as string, side }));
}

/** The RETIRED rule, reimplemented locally so a defect leg fails for the reason
 *  it names: which column a category's cards rendered in came from the stored
 *  per-side enabled lists, seeded once from the registry and never re-derived. */
const RETIRED_STORED_LISTS: Record<Side, OmniCategory[]> = {
  left: ["footnotes", "citations", "reports", "examples"],
  right: ["notes", "todo", "archive", "revisions", "cutter", "errors"],
};
function retiredColumnFor(cat: OmniCategory): Side {
  return RETIRED_STORED_LISTS.left.includes(cat) ? "left" : "right";
}

// ───────────────────────────────────────────────────────────────────────────
// LEG 1 — the parity contract: one panel, one side, every surface.
// ───────────────────────────────────────────────────────────────────────────

describe("card side — the margin and the omni column cannot disagree", () => {
  it("agree for every omni panel, at every placement (defect leg)", () => {
    // Sweep both sides AND the unplaced case, so the assertion cannot pass by
    // both surfaces happening to read the same registry default.
    const configs: Array<{ label: string; placements: { id: string; side: Side }[] }> = [
      { label: "all-left", placements: placeAll("left") },
      { label: "all-right", placements: placeAll("right") },
      { label: "unplaced", placements: [] },
    ];
    let disagreementsUnderRetiredRule = 0;
    for (const cfg of configs) {
      const sides = deriveCategorySides(cfg.placements);
      const map = panelSidesFromPlacements(cfg.placements);
      for (const panel of OMNI_PANELS) {
        const omniColumn = sides[panel.kind];
        // The STRIP the panel's icon renders on.
        expect(omniColumn, `${cfg.label} ${panel.kind} strip`).toBe(
          resolvePanelSide(panel.kind, map),
        );
        // Every CARD kind this panel hosts — the rail's answer.
        for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
          if (CARD_REGISTRY[kind].panel !== panel.kind) continue;
          expect(marginSideForCardKind(kind, map), `${cfg.label} ${kind} rail`).toBe(
            omniColumn,
          );
        }
        if (retiredColumnFor(panel.kind) !== omniColumn) disagreementsUnderRetiredRule++;
      }
      // Every MARKER namespace — the grid's answer.
      for (const t of ALL_MARKER_TYPES) {
        const panel = panelForMarkerType(t);
        if (!OMNI_CATEGORIES.includes(panel)) continue;
        expect(marginSideForMarkerType(t, map), `${cfg.label} marker ${t}`).toBe(
          sides[panel],
        );
      }
    }
    // The defect leg's own teeth: under the retired stored-list rule the two
    // surfaces genuinely disagree for most panels once anything is dragged, so
    // this sweep is not passing because the two answers are trivially equal.
    expect(disagreementsUnderRetiredRule).toBeGreaterThan(8);
  });

  it("dragging a panel's strip icon moves its omni cards with its markers", () => {
    const before = [{ id: "reports", side: "left" as Side }];
    const after = [{ id: "reports", side: "right" as Side }];
    expect(deriveCategorySides(before).reports).toBe("left");
    expect(deriveCategorySides(after).reports).toBe("right");
    expect(marginSideForCardKind("report", panelSidesFromPlacements(before))).toBe("left");
    expect(marginSideForCardKind("report", panelSidesFromPlacements(after))).toBe("right");
    // …and the card actually leaves one column for the other.
    expect(omniCategoriesForSide(deriveCategorySides(before), [], "left")).toContain(
      "reports",
    );
    expect(omniCategoriesForSide(deriveCategorySides(after), [], "left")).not.toContain(
      "reports",
    );
    expect(omniCategoriesForSide(deriveCategorySides(after), [], "right")).toContain(
      "reports",
    );
  });

  it("visibility is side-free, so a hidden category stays hidden across the move", () => {
    const hidden: OmniCategory[] = ["reports"];
    for (const side of ["left", "right"] as Side[]) {
      const sides = deriveCategorySides([{ id: "reports", side }]);
      expect(omniCategoriesForSide(sides, hidden, "left")).not.toContain("reports");
      expect(omniCategoriesForSide(sides, hidden, "right")).not.toContain("reports");
    }
    // A control: unhidden, it appears on exactly one side and never both.
    for (const side of ["left", "right"] as Side[]) {
      const sides = deriveCategorySides([{ id: "reports", side }]);
      const l = omniCategoriesForSide(sides, [], "left").has("reports");
      const r = omniCategoriesForSide(sides, [], "right").has("reports");
      expect(l !== r).toBe(true);
    }
  });

  it("every omni category lands in exactly ONE column, always", () => {
    for (const cfg of [placeAll("left"), placeAll("right"), []]) {
      const sides = deriveCategorySides(cfg);
      const l = omniCategoriesForSide(sides, [], "left");
      const r = omniCategoriesForSide(sides, [], "right");
      expect(l.size + r.size).toBe(OMNI_CATEGORIES.length);
      for (const c of OMNI_CATEGORIES) expect(l.has(c) !== r.has(c)).toBe(true);
    }
  });

  it("the filter menu's row list is the SAME derivation the cards read", () => {
    // The pre-381 fork lived exactly here: the chip list derived and the cards
    // did not. A category may only be checkable on the side it renders in.
    for (const cfg of [placeAll("left"), placeAll("right"), []]) {
      const sides = deriveCategorySides(cfg);
      for (const side of ["left", "right"] as Side[]) {
        const rows = omniCategoriesOnSide(sides, side);
        const cards = omniCategoriesForSide(sides, [], side);
        expect(new Set(rows)).toEqual(cards);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LEG 2 — the reports default flip, and the one-shot that makes it durable.
// ───────────────────────────────────────────────────────────────────────────

describe("reports defaults RIGHT (task 381)", () => {
  it("the registry and the shipped placements agree", () => {
    expect(PANEL_REGISTRY.reports.defaultStripSide).toBe("right");
    expect(defaultPanelSide("reports")).toBe("right");
    const json = JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, "../../hooks/useViewPrefs.defaults.json"),
        "utf8",
      ),
    ) as { placements: { id: string; side: Side }[] };
    expect(json.placements.find((p) => p.id === "reports")?.side).toBe("right");
  });

  it("a shipped migration carries the STORED value over", () => {
    const out = applyPanelSideMigrations(
      [{ id: "reports", side: "left" }],
      [],
      PANEL_SIDE_MIGRATIONS,
    );
    expect(out.changed).toBe(true);
    expect(out.placements).toEqual([{ id: "reports", side: "right" }]);
    expect(out.applied).toEqual(PANEL_SIDE_MIGRATIONS.map((m) => m.id));
  });

  it("is a ONE-SHOT: a deliberate drag back to left sticks", () => {
    const first = applyPanelSideMigrations(
      [{ id: "reports", side: "left" }],
      [],
      PANEL_SIDE_MIGRATIONS,
    );
    // The user drags it back.
    const draggedBack = [{ id: "reports", side: "left" as Side }];
    const second = applyPanelSideMigrations(
      draggedBack,
      first.applied,
      PANEL_SIDE_MIGRATIONS,
    );
    expect(second.changed).toBe(false);
    expect(second.placements).toBe(draggedBack); // same object — no allocation
    expect(second.placements).toEqual([{ id: "reports", side: "left" }]);
  });

  it("does not fight a user who had already moved the panel", () => {
    // `from` is part of the match, so a stored `right` (or any other side) is
    // untouched — but the migration still records, because it had its chance.
    const mig: PanelSideMigration[] = [
      { id: "t", panel: "notes", from: "left", to: "right" },
    ];
    const out = applyPanelSideMigrations([{ id: "notes", side: "right" }], [], mig);
    expect(out.placements).toEqual([{ id: "notes", side: "right" }]);
    expect(out.applied).toEqual(["t"]);
  });

  it("malformed input is carried, never thrown on", () => {
    expect(() =>
      applyPanelSideMigrations("nonsense", 7, PANEL_SIDE_MIGRATIONS),
    ).not.toThrow();
    const out = applyPanelSideMigrations([null, 3, { id: "reports" }], null, PANEL_SIDE_MIGRATIONS);
    expect(out.placements).toEqual([null, 3, { id: "reports" }]);
    expect(out.applied).toEqual(PANEL_SIDE_MIGRATIONS.map((m) => m.id));
  });

  it("migration ids are unique — the id IS the applied evidence", () => {
    const ids = PANEL_SIDE_MIGRATIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LEG 3 — the legacy fold: per-side enabled lists → the side-free hidden set.
// ───────────────────────────────────────────────────────────────────────────

describe("omniCategories → omniHiddenCategories", () => {
  it("a category absent from BOTH stored sides is hidden", () => {
    const hidden = hiddenFromLegacySides({
      left: ["footnotes", "citations"],
      right: ["notes", "todo"],
    });
    expect(hidden).not.toContain("footnotes");
    expect(hidden).not.toContain("notes");
    expect(hidden).toContain("reports");
    expect(hidden).toContain("errors");
  });

  it("the fold runs the legacy VOCABULARIES too", () => {
    // A blob from the earliest builds carries 2-char prefixes / CardKinds. Read
    // raw they resolve to nothing and every category reads as hidden.
    expect(hiddenFromLegacySides({ left: ["fn"], right: ["nt"] })).not.toContain(
      "footnotes",
    );
    expect(hiddenFromLegacySides({ left: ["fn"], right: ["nt"] })).not.toContain("notes");
  });

  it("fails OPEN — an unreadable blob hides nothing", () => {
    for (const bad of [null, undefined, 7, "x", []]) {
      expect(hiddenFromLegacySides(bad)).toEqual([]);
    }
  });

  it("a fully-enabled legacy blob folds to an EMPTY hidden set", () => {
    const all = OMNI_CATEGORIES;
    expect(
      hiddenFromLegacySides({ left: all.slice(0, 4), right: all.slice(4) }),
    ).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// LEG 4 — the census. The derivation was never the part that could misbehave.
// ───────────────────────────────────────────────────────────────────────────

const REPO = path.resolve(__dirname, "../../..");
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const SELF = path.join(__dirname, "card-side-derivation.test.ts");
const ALL = [...walk(path.join(REPO, "src")), ...walk(path.join(REPO, "library"))].filter(
  (f) => f !== SELF,
);
const rel = (p: string) => path.relative(REPO, p);
const PROD = ALL.filter((f) => !/__tests__|\.test\.tsx?$/.test(f));
const hits = (files: string[], re: RegExp, read = codeOnly) =>
  files.filter((f) => re.test(read(fs.readFileSync(f, "utf8")))).map(rel);

describe("card side — no second speller", () => {
  it("the census can see (canary)", () => {
    expect(ALL.length).toBeGreaterThan(500);
    // Positive control on a needle that must always fire somewhere.
    expect(hits(PROD, /\bderiveCategorySides\b/).length).toBeGreaterThan(0);
  });

  it("`registry.omniSide` and `DEFAULT_OMNI_CATEGORIES` stay DELETED", () => {
    // A second side table is a stored, drag-blind copy of a live answer — the
    // drift this task removed. Re-adding one is how the omni column stops
    // following the panel again. Literals kept: the drift lives in them.
    expect(hits(ALL, /\bomniSide\b/, commentsStripped)).toEqual([]);
    expect(hits(ALL, /\bDEFAULT_OMNI_CATEGORIES\b/, commentsStripped)).toEqual([]);
  });

  it("nothing reads a per-side omni category list", () => {
    // `prefs.omniCategories` is retired as a live carrier. The ONE surviving
    // mention is the loader's one-shot fold of a pre-381 stored blob, plus the
    // rename applier's legacy carrier that must rewrite it BEFORE the fold —
    // both keyed by NAME with their reason, never by file, so a real read added
    // beside them still fails. `filterOmniCategories` went with the carrier: it
    // had no production caller once the fold landed, and a suite is not a
    // consumer (task 202).
    const PERMITTED = new Set([
      // The one-shot legacy fold (`hiddenFromLegacySides`), then `delete`d so it
      // can never round-trip.
      "src/hooks/useViewPrefs.ts",
      // `LEGACY_ID_CARRIERS` — renames the pre-381 blob so the fold sees heirs.
      "src/hooks/rename-panel-id.ts",
    ]);
    const found = hits(PROD, /\bomniCategories\b/, commentsStripped);
    expect(found.filter((f) => !PERMITTED.has(f))).toEqual([]);
    // BOTH halves: an entry that stops mentioning it would otherwise sit there
    // pre-authorizing a real read in that file.
    expect([...PERMITTED].filter((f) => !found.includes(f))).toEqual([]);
  });

  it("every omni HOST combines the two facts through the shared door", () => {
    // The column a card renders in is `omniCategoriesForSide(derived, hidden)`.
    // A host that intersects them by hand is the two-tables shape restored, and
    // it type-checks perfectly. Membership is DISCOVERED: any production file
    // that builds a per-side enabled set for the omni panel must be one of
    // these, and each must call the door.
    const hosts = PROD.filter((f) =>
      /\bgetOmniEnabled\b/.test(codeOnly(fs.readFileSync(f, "utf8"))),
    ).map(rel);
    // The two hosts (main app + Reader) plus the consumers that merely RECEIVE
    // the getter as a prop/field. Only the ones that BUILD the set must call the
    // door — identified by their own `useMemo`/derivation of it.
    const builders = hosts.filter((f) =>
      /getOmniEnabled\s*=\s*useCallback/.test(
        codeOnly(fs.readFileSync(path.join(REPO, f), "utf8")),
      ),
    );
    expect(builders.sort()).toEqual(
      [
        "src/components/EditorLayout.tsx",
        "src/components/editor-layout/reader-view-prefs.ts",
      ].sort(),
    );
    for (const f of builders) {
      const src = codeOnly(fs.readFileSync(path.join(REPO, f), "utf8"));
      expect(/\bomniCategoriesForSide\s*\(/.test(src), `${f} must call the door`).toBe(
        true,
      );
      expect(/\bderiveCategorySides\s*\(/.test(src), `${f} must derive sides`).toBe(true);
    }
  });

  it("`omniHideAllCards` stays per-SIDE, and says so", () => {
    // It describes a COLUMN ("show nothing in this gutter"), not a category, so
    // it has no panel whose placement it could derive from. Pinned so a future
    // sweep doesn't fold it into the side-free set by symmetry.
    const src = fs.readFileSync(
      path.join(REPO, "src/hooks/useViewPrefs.ts"),
      "utf8",
    );
    expect(src).toMatch(/omniHideAllCards: \{ left: boolean; right: boolean \}/);
  });

  it("the promote-defaults whitelist tracks the live key", () => {
    // A whitelist entry naming a key the code cannot read is cron-refreshed
    // forever (task 326's aiMarker shape). The JSON must ship the live key and
    // the whitelist must name it.
    const registry = JSON.parse(
      fs.readFileSync(path.join(REPO, "src/lib/dev-prefs-registry.json"), "utf8"),
    ) as { promotable: { defaultsFile: string; whitelist?: string[] }[] };
    const entry = registry.promotable.find(
      (p) => p.defaultsFile === "src/hooks/useViewPrefs.defaults.json",
    )!;
    expect(entry.whitelist).toContain("omniHiddenCategories");
    expect(entry.whitelist).not.toContain("omniCategories");
    const json = JSON.parse(
      fs.readFileSync(path.join(REPO, "src/hooks/useViewPrefs.defaults.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(json.omniHiddenCategories).toEqual([]);
    expect("omniCategories" in json).toBe(false);
  });
});
