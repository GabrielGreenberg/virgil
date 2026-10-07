/**
 * GUARD-FAMILY CENSUS (task 988) — `npm run test:guards` really selects every
 * whole-tree guard, and nothing hand-picks the list.
 *
 * The selection rule lives in `_guard-family.ts` (read its header for why the
 * worker runs it on every task). This file pins what could rot around it:
 * the script and config still route through the derived rule; the rule still
 * walks exactly what `npm test` collects; the three signatures still SEE the
 * guards that motivated them (987's three breaks among them); and no file
 * with a CENSUS block can sit outside the selection.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import baseConfig from "../../../vitest.config";
import { commentsStripped, REPO_ROOT } from "./_source-scan";
import {
  CENSUS_TITLE,
  INCLUDE_SHAPE,
  collectedTestFiles,
  guardFamily,
  guardSignatures,
} from "./_guard-family";

const INCLUDE = baseConfig.test?.include ?? [];
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

describe("guard family — the derived selection", () => {
  const family = guardFamily(INCLUDE);
  const collected = collectedTestFiles(INCLUDE);

  it("every vitest include pattern keeps the shape the walk mirrors", () => {
    expect(INCLUDE.length).toBeGreaterThan(0);
    for (const p of INCLUDE) expect(p, p).toMatch(INCLUDE_SHAPE);
  });

  it("can see: the walk finds the full suite, and the family is a real slice of it", () => {
    expect(collected.length).toBeGreaterThan(1000);
    expect(family.length).toBeGreaterThan(200);
    expect(family.length).toBeLessThan(collected.length);
    for (const rel of family) expect(collected).toContain(rel);
  });

  it("can see: each signature selects the guards that motivated it", () => {
    // Task 987's three breaks — two by name, one CENSUS inside a behaviour suite.
    expect(family).toContain("src/lib/__tests__/source-walk-door-census.test.ts");
    expect(family).toContain("src/__tests__/dead-component-import-guardrail.test.ts");
    expect(family).toContain("src/lib/__tests__/field-edit-session.test.tsx");
    // A negative census that is neither named nor titled — caught by what it does.
    const rel = "src/lib/__tests__/ai-requests-authority.test.ts";
    expect(guardSignatures(rel, read(rel))).toEqual(["lists-a-tree"]);
    expect(family).toContain(rel);
    // And this file.
    expect(family).toContain("src/lib/__tests__/guard-family-census.test.ts");
  });

  it("stays cheap: the Python-suite RUNNER is out, its census legs are in", () => {
    // `python-suites.test.ts` runs every stdlib-Python suite (~70 s) — five
    // times the rest of the family together. Its census legs were split out
    // so the unconditional run stays unconditional (see the budget note in
    // `_guard-family.ts`).
    expect(family).not.toContain("scripts/__tests__/python-suites.test.ts");
    expect(family).toContain("scripts/__tests__/python-suites-census.test.ts");
  });

  it("the detectors read code, not prose", () => {
    expect(guardSignatures("a/__tests__/x.test.ts", `// readdirSync(dir) and a CENSUS`)).toEqual([]);
    expect(guardSignatures("a/__tests__/x.test.ts", `describe("CENSUS — y", () => {})`)).toEqual([
      "census-title",
    ]);
    expect(guardSignatures("a/__tests__/x.test.ts", `execFileSync("git", ["ls-files", "src"])`)).toEqual([
      "lists-a-tree",
    ]);
    expect(guardSignatures("a/__tests__/x-guardrail.test.ts", ``)).toEqual(["name"]);
  });

  it("no CENSUS-titled block lives outside the selection", () => {
    const outside = collected.filter(
      (rel) => !family.includes(rel) && CENSUS_TITLE.test(commentsStripped(read(rel))),
    );
    expect(outside).toEqual([]);
  });
});

describe("guard family — the script runs the derived rule, not a list", () => {
  it("`npm run test:guards` runs vitest on the guards config", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:guards"]).toBe("vitest run --config vitest.guards.config.ts");
  });

  it("the guards config replaces include with guardFamily(base include) and nothing else", () => {
    const cfg = commentsStripped(read("vitest.guards.config.ts"));
    expect(cfg).toMatch(/from "\.\/vitest\.config"/);
    expect(cfg).toMatch(/include:\s*guardFamily\(include\)/);
    expect(cfg).not.toMatch(/mergeConfig/);
    // No literal test path — a hand-list is the thing this replaced.
    expect(cfg).not.toMatch(/\.test\.tsx?["'`]/);
  });
});
