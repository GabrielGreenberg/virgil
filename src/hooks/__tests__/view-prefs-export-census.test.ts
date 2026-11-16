// The view-prefs surface exports nothing that nothing calls (task 1640).
//
// THE LAW
//
//   A value exported from the view-prefs registry, its derived/dock helpers or
//   the panel-id carrier migrations is alive only if something CALLS it. A
//   re-export is not a caller, and a suite is not a consumer.
//   (docs/agents/laws/a-registry-earns-its-name-by-being-read.md)
//
// WHY THIS SURFACE. Audit tick 528 found two vestiges of the same kind here:
// `dockStackTop` — "the nearest analog to the retired activeLeft/activeRight",
// a task-273 leftover whose only hit was the `useViewPrefs` re-export — and
// `toggleRowsInMenuGroup`, a toggle slice of `menuEntriesInGroup` that two
// suites asserted on while MenuBar renders every View-menu group straight off
// `menuEntriesInGroup` (task 1317). Both are deleted; the suites now assert on
// the door the menu renders from. `useViewPrefs.ts` re-exports this surface's
// helpers, which is exactly what made the first one read alive to a grep.
//
// The second leg pins the same task's third member: the four legacy
// active-panel keys were spelled twice — once for the rename, once for the
// load-time fold — with nothing binding the two lists, the defect class whose
// own comment records a lost split-layout band. They are named ONCE now.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  censusFiles,
  deadExports,
  declaredExports,
  staleAllowlistEntries,
  swallowedInCensusedFiles,
} from "@/lib/__tests__/_export-census";
import { commentsStripped, trackedFiles } from "@/lib/__tests__/_source-scan";
import { LEGACY_ACTIVE_PANEL_KEYS } from "@/hooks/panel-id-carriers";

const repoRel = (abs: string, root: string) => abs.slice(abs.indexOf(`${root}/`));

const SURFACE = censusFiles([
  ...trackedFiles("src/lib/view-prefs", /\.tsx?$/)
    .map((abs) => repoRel(abs, "src/lib/view-prefs"))
    .filter((rel) => !rel.includes("__tests__")),
  ...trackedFiles("src/hooks", /\.ts$/)
    .map((abs) => repoRel(abs, "src/hooks"))
    .filter(
      (rel) =>
        !rel.includes("__tests__") &&
        /^src\/hooks\/(view-prefs-[^/]+|rename-panel-id|dropUnknownPanelIds|panel-id-carriers)\.ts$/.test(rel),
    ),
]);

// Exports with no production CALLER that earn their keep anyway. Each is an
// ORACLE: the derived side of a contract whose other side is data the app's
// TypeScript cannot import — the promotion whitelist in
// `src/lib/dev-prefs-registry.json`, read by the Node promoter
// (`tools/promote-defaults.mjs`). The JSON cannot be derived from them at
// runtime, so the suite that pins whitelist ⇔ derivation
// (`view-menu-registry-source.test.ts`) IS their reader. Delete an entry the
// day the whitelist is generated from them.
const PERMITTED: Readonly<Record<string, string>> = {
  "src/lib/view-prefs/registry.ts::REGISTRY_PROMOTED_GLOBAL_KEYS":
    "registry half of the promotion-whitelist oracle (task 057/676)",
  "src/lib/view-prefs/structural-globals.ts::STRUCTURAL_PROMOTED_GLOBAL_KEYS":
    "structural half of the promotion-whitelist oracle (task 676)",
  "src/lib/view-prefs/structural-globals.ts::STRUCTURAL_PROMOTION_EXEMPT":
    "the oracle's stated exemptions, with their `why` (task 676)",
};

describe("the view-prefs surface exports nothing that nothing calls (task 1640)", () => {
  it("censuses real files", () => {
    // A census that silently scans nothing is compliance-shaped and worthless.
    const rels = SURFACE.map((m) => m.rel);
    expect(rels).toEqual(
      expect.arrayContaining([
        "src/lib/view-prefs/registry.ts",
        "src/hooks/view-prefs-derived.ts",
        "src/hooks/view-prefs-dock.ts",
        "src/hooks/rename-panel-id.ts",
        "src/hooks/dropUnknownPanelIds.ts",
        "src/hooks/panel-id-carriers.ts",
      ]),
    );
    expect(declaredExports(SURFACE).size).toBeGreaterThan(20);
  });

  it("the scanner swallowed no line of a censused file", () => {
    expect(swallowedInCensusedFiles(SURFACE)).toEqual([]);
  });

  it("every value export has a non-test caller", () => {
    expect(deadExports(SURFACE, PERMITTED)).toEqual([]);
  });

  it("the allowlist names only declared, still-uncalled exports", () => {
    expect(staleAllowlistEntries(SURFACE, PERMITTED)).toEqual([]);
  });
});

describe("the legacy active-panel keys are spelled once (task 1640)", () => {
  const PRODUCTION = [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter((p) => !p.includes("__tests__"));

  it.each(LEGACY_ACTIVE_PANEL_KEYS.map((k) => [k]))(
    "the literal %s appears in exactly one production file",
    (key) => {
      const quoted = new RegExp(`["'\`]${key}["'\`]`);
      const holders = PRODUCTION.filter((f) =>
        quoted.test(commentsStripped(readFileSync(f, "utf8"))),
      ).map((f) => repoRel(f, "src"));
      expect(holders).toEqual(["src/hooks/panel-id-carriers.ts"]);
    },
  );
});
