/**
 * SOURCE-WALK DOOR CENSUS (task 954).
 *
 * The v0.1.127 deploy gate died on ONE test, a guard about highlight marks:
 * `ENOENT … stat 'library/scripts/__pycache__/x.cpython-312.pyc.140681511800384'`.
 * Its hand-rolled walker did `readdirSync` and then `statSync` on every entry,
 * and Python's atomic bytecode write (a `.pyc.<pid>` temp, then a rename) —
 * from a sibling suite spawning a Library script — removed the entry between
 * the two calls. ~95 census suites carried their own copy of that walker, and
 * one had already grown a private try/catch for exactly this
 * (`reparent-identity-conservation`), which is how a class stays alive: each
 * copy learns the lesson alone.
 *
 * So there is ONE disk walk, `walkFiles` in `_source-scan.ts`: entries typed
 * by the readdir itself (no per-entry stat to race), generated dirs
 * (`__pycache__`, `node_modules`, …) never entered, a vanished directory read
 * as empty. And the trigger is off at the source: vitest workers, the
 * python-suite runner and both CI gates run with `PYTHONDONTWRITEBYTECODE=1`.
 *
 * This census keeps the hand-rolled shape from coming back: no test-tree file
 * may pair a `readdirSync` listing (without `withFileTypes`) with a
 * `statSync` — route the walk through `walkFiles`, or `trackedFiles` when the
 * census means "what the repo ships".
 */
import { describe, it, expect, afterAll } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { codeOnly, trackedFiles, walkFiles, GENERATED_DIRS } from "./_source-scan";
import { suiteEnv } from "../../../scripts/lib/python-suites.mjs";

/** The test silos vitest collects (vitest.config.ts `include`). */
const TEST_ROOTS = ["src", "library", "editor", "scripts", "virgil"];

/** The door itself is the one file allowed to stat (a symlink's target). */
const DOOR = "src/lib/__tests__/_source-scan.ts";

/** A per-entry stat walk: a NAME listing paired with a `statSync`. */
export function isHandRolledStatWalk(source: string): boolean {
  const code = codeOnly(source);
  if (!/\bstatSync\s*\(/.test(code)) return false;
  for (const m of code.matchAll(/\breaddirSync\s*\(([^)]*)\)/g)) {
    if (!/\bwithFileTypes\b/.test(m[1])) return true;
  }
  return false;
}

describe("source-walk door census", () => {
  it("the detector flags the retired shape and passes the door's", () => {
    const retired = `for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
    }`;
    expect(isHandRolledStatWalk(retired)).toBe(true);
    expect(isHandRolledStatWalk(`for (const f of walkFiles(dir)) out.push(f);`)).toBe(false);
    // A Dirent listing never stats per entry; a stat for SIZE is not a walk.
    expect(
      isHandRolledStatWalk(`for (const e of readdirSync(d, { withFileTypes: true })) statSync(p).size;`),
    ).toBe(false);
    // Prose that NAMES the old pair is not code.
    expect(isHandRolledStatWalk(`// readdirSync(dir) then statSync(full) raced`)).toBe(false);
  });

  it("no test-tree file hand-rolls a readdirSync + statSync walk", () => {
    const population = TEST_ROOTS.flatMap((root) => trackedFiles(root, /\.(ts|tsx|mjs)$/))
      .map((abs) => path.relative(path.resolve(__dirname, "../../.."), abs).split(path.sep).join("/"))
      .filter((rel) => rel.includes("/__tests__/") && rel !== DOOR);
    // Non-vacuity: an empty population would pass every census.
    expect(population.length).toBeGreaterThan(500);
    const offenders = population.filter((rel) =>
      isHandRolledStatWalk(fs.readFileSync(path.resolve(__dirname, "../../..", rel), "utf8")),
    );
    expect(
      offenders,
      "Route the walk through walkFiles (or trackedFiles) in src/lib/__tests__/_source-scan.ts — " +
        "a per-entry statSync races any file vanishing mid-walk (task 954).",
    ).toEqual([]);
  });
});

describe("walkFiles — the one disk walk", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "walk-files-"));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("never enters generated dirs and honours the caller's skips", () => {
    const put = (rel: string) => {
      fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
      fs.writeFileSync(path.join(tmp, rel), "");
    };
    put("a.ts");
    put("sub/b.tsx");
    put("__pycache__/x.cpython-312.pyc.140681511800384");
    put("node_modules/dep/index.ts");
    put("__tests__/c.test.ts");
    put(".hidden/d.ts");
    expect(GENERATED_DIRS.has("__pycache__")).toBe(true);
    const rel = (opts?: Parameters<typeof walkFiles>[1]) =>
      walkFiles(tmp, opts).map((p) => path.relative(tmp, p).split(path.sep).join("/"));
    expect(rel()).toEqual([".hidden/d.ts", "__tests__/c.test.ts", "a.ts", "sub/b.tsx"]);
    expect(rel({ skipDirs: ["__tests__"] })).toEqual([".hidden/d.ts", "a.ts", "sub/b.tsx"]);
    expect(rel({ skipDirs: (n) => n.startsWith(".") })).toEqual(["__tests__/c.test.ts", "a.ts", "sub/b.tsx"]);
  });

  it("reads a root that is not there as empty, rather than throwing", () => {
    expect(walkFiles(path.join(tmp, "vanished"))).toEqual([]);
  });
});

describe("no bytecode is written while the suites run", () => {
  it("vitest workers export PYTHONDONTWRITEBYTECODE to every child they spawn", () => {
    expect(process.env.PYTHONDONTWRITEBYTECODE).toBe("1");
  });

  it("the python-suite runner's sandbox env carries it too (CI runs it as its own step)", () => {
    expect(suiteEnv().PYTHONDONTWRITEBYTECODE).toBe("1");
  });
});
