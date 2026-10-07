/**
 * THE GUARD FAMILY — which test files are whole-tree guards (task 988).
 *
 * Three worker merges in one day (969, 981, 984) landed on `main` with a
 * whole-tree census red, each after passing its targeted verify — the third
 * recurrence of the class task 835 named. 835's remedy ("run a census whenever
 * the diff touches its subject", found by grepping the changed symbol) cannot
 * catch a NEGATIVE census: `source-walk-door-census` forbids a walk shape,
 * `dead-component-import-guardrail` an unused import, the field-edit-session
 * CENSUS an undeclared unmount-on-cancel field. A new file that commits the
 * forbidden pattern shares no symbol with the guard, so the grep never picks
 * the guard. So the family is ONE derived suite, `npm run test:guards`, run on
 * EVERY task — no judgment call left to fail a fourth time.
 *
 * Membership is DERIVED, never a hand-list. A collected test file is a guard
 * when ANY of:
 *
 *   1. its NAME says so — `*census*` / `*guardrail*`;
 *   2. it carries a CENSUS-titled block (`describe("… CENSUS …")`, `it(…)`) —
 *      the censuses that live inside a behaviour suite (`field-edit-session`,
 *      `op-scratch-file`, …), whose file name does not say so;
 *   3. it LISTS A DIRECTORY — `walkFiles` / `trackedFiles` (the source-scan
 *      doors), `readdirSync`, `globSync`, `git ls-files`. This is the real
 *      signature of a negative census: "nowhere in the tree does X" cannot be
 *      asserted without enumerating the tree, so every such guard — named,
 *      titled, or neither (most are neither) — is caught by what it DOES.
 *      A suite that lists a temp fixture dir rides along; that costs
 *      milliseconds and buys completeness.
 *
 * The population is exactly what `npm test` collects: the roots come from
 * `vitest.config.ts`'s own `include` (the meta-test pins that every pattern
 * keeps the `<root>/**\/__tests__/**\/*.test.{ts,tsx}` shape this walk
 * mirrors), and the walk is the working copy (`walkFiles`), so a test file
 * written seconds ago — the very file most likely to break a census — is in.
 *
 * BUDGET: measured 2026-10-07 at 260 files / ~15 s wall (vs ~1,200 files in
 * the full suite). It must stay cheap enough to run unconditionally; if it
 * passes ~30 s, narrow signature 3 before anyone is tempted to skip the run.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { commentsStripped, REPO_ROOT, walkFiles } from "./_source-scan";

/** The shape every `vitest.config.ts` include pattern has (and the walk mirrors). */
export const INCLUDE_SHAPE = /^([a-z][\w-]*)\/\*\*\/__tests__\/\*\*\/\*\.test\.\{ts,tsx\}$/;

/** Signature 1: the file's name declares it a guard. */
export const GUARD_NAME = /(census|guardrail)[^/]*\.test\.tsx?$/;

/** Signature 2: a CENSUS-titled describe/it/test block (string literals kept). */
export const CENSUS_TITLE = /\b(?:describe|it|test)(?:\.\w+)*\(\s*["'`][^"'`\n]*\bCENSUS\b/;

/** Signature 3: the file enumerates a directory. */
export const LISTS_A_TREE = /\b(?:walkFiles|trackedFiles|readdirSync|globSync)\s*\(|["'`][^"'`\n]*\bls-files\b/;

/** Which signature(s) select a file — `[]` = not a guard. */
export function guardSignatures(rel: string, source: string): string[] {
  const out: string[] = [];
  if (GUARD_NAME.test(rel)) out.push("name");
  const code = commentsStripped(source);
  if (CENSUS_TITLE.test(code)) out.push("census-title");
  if (LISTS_A_TREE.test(code)) out.push("lists-a-tree");
  return out;
}

/** The test roots, read from the base config's `include`. */
export function testRoots(include: readonly string[]): string[] {
  return include.map((p) => {
    const m = INCLUDE_SHAPE.exec(p);
    if (!m) throw new Error(`vitest include pattern ${p} no longer has the shape _guard-family walks`);
    return m[1];
  });
}

/** Every file `npm test` collects, repo-relative, sorted. */
export function collectedTestFiles(include: readonly string[]): string[] {
  return testRoots(include)
    .flatMap((root) => walkFiles(path.join(REPO_ROOT, root)))
    .map((abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/"))
    .filter((rel) => rel.includes("/__tests__/") && /\.test\.tsx?$/.test(rel))
    .sort();
}

/** THE guard family: repo-relative paths, sorted. */
export function guardFamily(include: readonly string[]): string[] {
  return collectedTestFiles(include).filter(
    (rel) => guardSignatures(rel, fs.readFileSync(path.join(REPO_ROOT, rel), "utf8")).length > 0,
  );
}
