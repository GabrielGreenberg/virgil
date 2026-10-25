/**
 * GUARD-FAMILY CENSUS (task 988) — `npm run test:guards` really selects every
 * whole-tree guard, and nothing hand-picks the list.
 *
 * The selection rule lives in `_guard-family.ts` (read its header for why the
 * worker runs it on every task). This file pins what could rot around it:
 * the script and config still route through the derived rule; the rule still
 * walks exactly what `npm test` collects; the five signatures still SEE the
 * guards that motivated them (987's three breaks and 1282's script-delegating
 * guard among them); and no file
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
    // A cross-silo pin (task 1212): a `library/` test importing `src/` code,
    // red on main after a src-only change whose targeted suites all passed.
    const cross = "library/lib/__tests__/latex-output-stock-compile.test.ts";
    expect(guardSignatures(cross, read(cross))).toEqual(["crosses-a-root"]);
    expect(family).toContain(cross);
    // A guard that DELEGATES the walk to a repo script (task 1282): its own
    // source shows none of signatures 1–4, so it is read off the script it runs.
    const delegating = "src/__tests__/spacing-grid.test.ts";
    expect(guardSignatures(delegating, read(delegating))).toEqual(["runs-a-tree-script"]);
    expect(family).toContain(delegating);
    // Its sibling runner is selected by the SAME rule (it also walks fixtures itself).
    expect(guardSignatures("src/__tests__/radius-scale.test.ts", read("src/__tests__/radius-scale.test.ts"))).toContain(
      "runs-a-tree-script",
    );
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
    // crosses-a-root: relative and aliased imports out of the file's own root
    // count; an import inside its own root, or a path only in prose, does not.
    expect(guardSignatures("library/lib/__tests__/x.test.ts", `import { y } from "../../../src/lib/y";`)).toEqual([
      "crosses-a-root",
    ]);
    expect(guardSignatures("library/lib/__tests__/x.test.ts", `import { y } from "@/lib/y";`)).toEqual([
      "crosses-a-root",
    ]);
    expect(guardSignatures("src/lib/__tests__/x.test.ts", `const m = await import("@library/lib/y");`)).toEqual([
      "crosses-a-root",
    ]);
    expect(guardSignatures("src/lib/__tests__/x.test.ts", `import { y } from "@/lib/y";\nimport { z } from "../z";`)).toEqual([]);
    expect(guardSignatures("library/lib/__tests__/x.test.ts", `// from "../../../src/lib/y"`)).toEqual([]);
  });

  it("runs-a-tree-script: selected by what the SPAWNED script does", () => {
    const scripts: Record<string, string> = {
      "scripts/check-x.mjs": `for (const e of fs.readdirSync(dir)) walk(e);`,
      "library/scripts/scan_x.py": `for root, _, files in os.walk(base):\n    pass`,
      "tools/args-only.mjs": `const [file] = process.argv.slice(2); check(file);`,
    };
    const reader = (rel: string) => scripts[rel] ?? null;
    const sig = (code: string) => guardSignatures("src/__tests__/x.test.ts", code, reader);
    // A spawn of a script that walks the tree — JS or Python — selects.
    expect(sig(`execFileSync("node", ["scripts/check-x.mjs"], { cwd: ROOT });`)).toEqual(["runs-a-tree-script"]);
    expect(sig(`spawnSync("python3", ["library/scripts/scan_x.py"]);`)).toEqual(["runs-a-tree-script"]);
    expect(sig(`execSync("node scripts/check-x.mjs");`)).toEqual(["runs-a-tree-script"]);
    // A script that only processes its arguments (a parity runner) does not.
    expect(sig(`execFileSync("node", ["tools/args-only.mjs", fixture]);`)).toEqual([]);
    // Naming the script without spawning it, or in prose, does not.
    expect(sig(`const p = "scripts/check-x.mjs"; readFileSync(p);`)).toEqual([]);
    expect(sig(`// execFileSync("node", ["scripts/check-x.mjs"])`)).toEqual([]);
    // A script that does not exist does not.
    expect(sig(`execFileSync("node", ["scripts/missing.mjs"]);`)).toEqual([]);
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
