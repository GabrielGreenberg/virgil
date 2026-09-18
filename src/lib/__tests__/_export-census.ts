/**
 * SHARED EXPORT CENSUS — "a published export is alive only if something CALLS it."
 *
 * Not a suite (vitest collects `*.test.{ts,tsx}` only) — the machinery the
 * per-silo censuses import, in the shape of
 * [_source-scan.ts](./_source-scan.ts) beside it.
 *
 * The law is
 * [a-registry-earns-its-name-by-being-read](../../../docs/agents/laws/a-registry-earns-its-name-by-being-read.md)
 * and its second sentence is the whole finding: **a re-export is not a caller.**
 * `src/links/` published a write half nobody called for three months and every
 * grep a reviewer ran came back green, because `links.ts` re-exported the lot.
 * So the population below STRIPS `export { … } from "…"` clauses before
 * counting — a barrel entry proves the symbol was published, never that it was
 * wanted.
 *
 * WHY THIS IS SHARED (task 634). `link-surface-honesty.test.ts` (task 202) built
 * this census for ONE silo and hard-wired it: a `readdirSync` walk for its
 * population and a five-stage regex chain for its stripper, with a
 * "the strippers never swallow a declaration" self-guard bolted on because that
 * chain had already eaten 7 kB of a live source file. Both halves have since
 * been solved ONCE, properly, in `_source-scan.ts` — `trackedFiles` (the
 * git-tracked population, so gitignored scratch can't turn a census red on one
 * checkout and green in CI) and the one-pass `strip`/`codeOnly` scanner (which
 * structurally cannot make the runaway mistake, because it is already inside the
 * string when it meets the backtick). A census that needs a second silo gets the
 * shared routine, not a second copy of the regex chain: the card spine's own
 * vestiges (task 634) are the same phenomenon in a different folder, and the
 * folder after that will be too.
 *
 * SCOPE, stated honestly. This censuses VALUE exports (`function` / `class` /
 * `const` / `let`), never TYPE exports: a `…Args` interface that only names its
 * own function's signature is normal, not dead. In-file use COUNTS as alive, so
 * a dead mutually-recursive cluster is caught at its entry point — which is
 * where deleting it starts anyway.
 *
 * AND ITS ONE REAL HOLE, stated rather than papered over: `callSites` is a
 * bare-name grep with no module resolution, so a dead export whose name collides
 * with a live symbol anywhere in the population reads ALIVE. That is not closed
 * here; the honest mitigation is that scaffolding usually gets a distinctive
 * name, and the alternative is a type-aware pass no suite in this repo can
 * afford.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly, REPO_ROOT, swallowedLines, trackedFiles } from "./_source-scan";

/** A value export declaration at the start of a line. */
export const VALUE_EXPORT = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_]+)/gm;

/**
 * `codeOnly` (comments + string/template literals blanked), MINUS the
 * re-export clauses — the one construct that looks like a reference and is not.
 *
 * Run AFTER `codeOnly` on purpose: it collapses every quoted string to `""`, so
 * the module specifier is already gone and these patterns cannot reach into a
 * comment that happens to quote a barrel line. Import clauses are deliberately
 * KEPT — an unused import is a lint error, so an import really does imply a use
 * in that file.
 *
 * The bare `export { X };` form is stripped too. It is the SPLIT barrel — the
 * `import` on one line and the `export` on another — already the idiom in
 * `src/links/` (`usePlacement.ts`, `resolve-card-anchor.ts`). Stripping only the
 * one-statement form closed ONE SPELLING of the blind spot: the two lines then
 * counted as two references and any dead export re-published this way read
 * alive. Only the `export` half goes; the `import` half stays, for the reason
 * above.
 */
export function censusText(src: string): string {
  return codeOnly(src)
    .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*from\s*""\s*;?/g, " ")
    .replace(/export\s*\*\s*(?:as\s+\w+\s*)?from\s*""\s*;?/g, " ")
    .replace(/export\s*(?:type\s*)?\{[^}]*\}\s*;/g, " ");
}

/** The two silos every Virgil census counts call sites across. */
const POPULATION_ROOTS = ["src", "library"] as const;

let populationCache: Map<string, string> | null = null;

/**
 * Every `.ts`/`.tsx` file the repo SHIPS under `src/` + `library/`, mapped to
 * its `censusText`. Built once per test run (the read + scan is ~2 k files).
 */
export function censusPopulation(): Map<string, string> {
  if (populationCache) return populationCache;
  const files = POPULATION_ROOTS.flatMap((root) => trackedFiles(root, /\.tsx?$/));
  populationCache = new Map(files.map((f) => [f, censusText(readFileSync(f, "utf8"))]));
  return populationCache;
}

/** True for a file whose references are a SUITE's, not a consumer's. */
export const isTestFile = (file: string): boolean =>
  file.includes("__tests__") || /\.test\.tsx?$/.test(file);

/**
 * Uses of `name` across the population, not counting its own declaration, split
 * by whether the caller is a TEST.
 *
 * The split is the whole point, and task 202's own deletion is the proof: run
 * the census against the pre-fix tree and `cardKindToLegacyAnchorKind` — which
 * that commit deleted as dead and whose suite it had to rewrite — reported
 * FOURTEEN callers, all of them in `anchor-kind-maps.test.ts`. A guard that
 * counts a suite as a consumer says "alive" about every dead export that was
 * ever tested, which in this repo is most of them.
 */
export function callSites(name: string, declaredIn: string): { real: number; testOnly: number } {
  const re = new RegExp(`\\b${name}\\b`, "g");
  let real = 0;
  let testOnly = 0;
  for (const [file, text] of censusPopulation()) {
    let hits = (text.match(re) ?? []).length;
    if (file === declaredIn) hits = Math.max(0, hits - 1);
    if (!hits) continue;
    if (isTestFile(file)) testOnly += hits;
    else real += hits;
  }
  return { real, testOnly };
}

/** One censused module: its absolute path and the key prefix a verdict reports. */
export interface CensusFile {
  /** Absolute path. */
  file: string;
  /** How a finding names it (`"predicates.ts"`, `"_shared/link-dom-contract.ts"`). */
  rel: string;
}

/** Resolve repo-relative paths to `CensusFile`s, reporting each under `rel` as
 *  given (so a caller decides whether a finding reads `predicates.ts` or
 *  `cards/predicates.ts`). */
export function censusFiles(
  repoRelative: readonly string[],
  relFrom?: string,
): CensusFile[] {
  return repoRelative.map((r) => ({
    file: path.join(REPO_ROOT, r),
    rel: relFrom ? path.relative(relFrom, r).split(path.sep).join("/") : r,
  }));
}

/** Every value export declared across `files`, keyed `"<rel>::<name>"`. */
export function declaredExports(files: readonly CensusFile[]): Map<string, CensusFile> {
  const out = new Map<string, CensusFile>();
  for (const entry of files) {
    const text = censusText(readFileSync(entry.file, "utf8"));
    for (const m of text.matchAll(VALUE_EXPORT)) out.set(`${entry.rel}::${m[1]}`, entry);
  }
  return out;
}

/**
 * The verdict: every value export in `files` with no NON-TEST caller, minus the
 * allowlist. One line per finding, already phrased for the failure message.
 *
 * `permitted` maps `"<rel>::<name>"` → the reason it earns its keep WITHOUT a
 * caller. That is a HIGH bar, since the whole finding is that "published" reads
 * like "used": WIRE it or DELETE it; do not list it to make CI quiet. Keep every
 * allowlist honest with {@link staleAllowlistEntries}.
 */
export function deadExports(
  files: readonly CensusFile[],
  permitted: Readonly<Record<string, string>> = {},
): string[] {
  const dead: string[] = [];
  for (const entry of files) {
    const text = censusText(readFileSync(entry.file, "utf8"));
    for (const m of text.matchAll(VALUE_EXPORT)) {
      const name = m[1];
      const key = `${entry.rel}::${name}`;
      if (permitted[key]) continue;
      const { real, testOnly } = callSites(name, entry.file);
      if (real > 0) continue;
      dead.push(
        testOnly > 0
          ? `${key} is called ONLY by tests (${testOnly} hit(s)) — a suite is not a ` +
            `consumer. This is the exact shape of cardKindToLegacyAnchorKind, which ` +
            `read alive on 14 test hits while being dead in the app.`
          : `${key} is exported and never called. Wire it at the call sites in the ` +
            `same commit, or delete it. A re-export does not count as a caller — ` +
            `that is exactly how the links write half survived for three months.`,
      );
    }
  }
  return dead;
}

/**
 * The leg that ROTS, in both directions. An allowlist key naming a symbol that
 * no longer exists justifies nothing and reads as if the dead thing were still
 * sanctioned; a key naming a symbol that has SINCE acquired real callers is an
 * exemption granted to code that no longer needs one — which is exactly the
 * "declared but unread" shape the census exists to kill.
 */
export function staleAllowlistEntries(
  files: readonly CensusFile[],
  permitted: Readonly<Record<string, string>>,
): string[] {
  const declared = declaredExports(files);
  const stale: string[] = [];
  for (const key of Object.keys(permitted)) {
    const entry = declared.get(key);
    if (!entry) {
      stale.push(`${key} is allowlisted but no longer declared — drop the entry`);
      continue;
    }
    const { real } = callSites(key.split("::")[1], entry.file);
    if (real > 0) {
      stale.push(`${key} is allowlisted as uncalled but now has ${real} caller(s) — drop the entry`);
    }
  }
  return stale;
}

/**
 * The census's own guard: the 1-based lines in each censused file where a quoted
 * string opened and hit a newline before closing, i.e. every line the scanner may
 * have swallowed.
 *
 * A census whose rule is "does this name occur a SECOND time?" needs this more
 * than a `toContain`-shaped guard does — a swallowed line can eat a symbol's only
 * use, and the verdict then names a dead export that is not dead, with no
 * diagnostic attached. This does not FAIL the census; it silently shrinks what
 * the census looks at, which is worse. Empty means the census's view of every
 * censused file is the whole file.
 */
export function swallowedInCensusedFiles(files: readonly CensusFile[]): string[] {
  const out: string[] = [];
  for (const entry of files) {
    for (const line of swallowedLines(readFileSync(entry.file, "utf8"))) {
      out.push(`${entry.rel}:${line}`);
    }
  }
  return out;
}
