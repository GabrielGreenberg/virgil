// The menu primitive exports nothing that nothing calls (task 748).
//
// THE LAW
//
//   A value exported from any module under `src/components/menu/` is alive only
//   if something CALLS it. A re-export is not a caller, and a suite is not a
//   consumer. (docs/agents/laws/a-registry-earns-its-name-by-being-read.md)
//
// WHY THIS FOLDER. The primitive was built in phases against a design that
// promised a second, ProseMirror-slash backend. That backend never landed, but
// its seam did: a process-global `menu id → registry handle` table that every
// `<MenuProvider>` published into on mount and that nothing in the app ever
// read — only its own suite and the `menu/index.ts` barrel, which is exactly the
// pair the shared census discounts. It was also a single module slot keyed by
// id, so under multi-pane keep-alive two panes' same-id menus overwrote each
// other; harmless only because nobody read it. Beside it sat a second vestige of
// the same kind, `useMenuGrid()` — a column-count context "shipped now" for grid
// cells that might derive coords from a flat index, which none ever did.
//
// Both are deleted. The census is what stops the third: the barrel re-exports
// this whole folder, so every grep a reviewer runs on a new speculative export
// comes back green. Scope is the whole folder (git-tracked, tests excluded),
// so a new module is censused the day it lands.
import { describe, expect, it } from "vitest";
import {
  censusFiles,
  deadExports,
  declaredExports,
  swallowedInCensusedFiles,
} from "@/lib/__tests__/_export-census";
import { trackedFiles } from "@/lib/__tests__/_source-scan";

const MENU_ROOT = "src/components/menu";

const MENU = censusFiles(
  trackedFiles(MENU_ROOT, /\.tsx?$/)
    .map((abs) => abs.slice(abs.indexOf(`${MENU_ROOT}/`)))
    .filter((rel) => !rel.includes("__tests__")),
  MENU_ROOT,
);

describe("the menu primitive exports nothing that nothing calls (task 748)", () => {
  it("censuses real files", () => {
    // A census that silently scans nothing is compliance-shaped and worthless.
    const rels = MENU.map((m) => m.rel);
    expect(rels).toEqual(expect.arrayContaining(["MenuProvider.tsx", "registry.ts", "index.ts"]));
    expect(declaredExports(MENU).size).toBeGreaterThan(10);
  });

  it("the scanner swallowed no line of a censused file", () => {
    expect(swallowedInCensusedFiles(MENU)).toEqual([]);
  });

  it("every value export has a non-test caller", () => {
    expect(deadExports(MENU)).toEqual([]);
  });
});
