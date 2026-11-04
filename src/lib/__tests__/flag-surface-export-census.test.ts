// The flag-wrapper modules export nothing that nothing calls (task 1466).
//
// THE LAW
//
//   A value exported from a feature-flag module is alive only if something
//   CALLS it. A re-export is not a caller, and a suite is not a consumer.
//
// Seventh caller of the shared census machinery (`_export-census.ts`). The six
// before it are per-SILO — links, cards, menu, text-objects, editor-layout,
// identity — and that is exactly why this one exists: the flag wrappers at the
// top of `src/lib/` belong to no silo, so none of those censuses looked at them,
// and `feature-flag-registry.test.ts` censuses KEYS (dialect, read timing,
// reachability), never exports. `setMultiDocKeepAliveFlag` sat there published
// and called by nothing at all — not the app, not a suite — while its siblings
// (`setPendingChangesFlag`, `setIdentityCascadeFlag`) were alive.
//
// THE POPULATION IS DERIVED, so the next flag module is covered on the commit
// that adds it rather than on the commit after someone remembers this list. A
// "flag module" is either:
//   - a tracked, non-test `src/**` / `library/**` file whose basename follows
//     the flag-module convention (`feature-flags.ts`, `*-flag.ts`,
//     `*-flags.ts`), or
//   - a non-test file that calls `setFlagOverride` — a production write door
//     onto the registry IS a toggle wrapper, whatever the file is named;
// minus any module another export census already names by path (identity's two
// flag files are censused — with their test-seam allowlist — by
// `identity-surface-honesty`; one owner per module keeps one allowlist).
//
// SCOPE + HOLES are the shared machinery's, stated in its header: value exports
// only, in-file use counts, and a bare-name grep can read a colliding dead name
// alive.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  censusFiles,
  censusPopulation,
  censusText,
  deadExports,
  isTestFile,
  staleAllowlistEntries,
  swallowedInCensusedFiles,
  VALUE_EXPORT,
} from "./_export-census";
import { REPO_ROOT, trackedFiles } from "./_source-scan";

const FLAG_MODULE_NAME = /(?:^|[-_])(?:feature-)?flags?\.tsx?$/;
const CALLS_SET_FLAG_OVERRIDE = /\bsetFlagOverride\s*\(/;

/** Repo-relative paths every OTHER export-census suite names. */
function namedByOtherExportCensuses(): Set<string> {
  const self = path.join(REPO_ROOT, "src/lib/__tests__/flag-surface-export-census.test.ts");
  const out = new Set<string>();
  const suites = ["src", "library"]
    .flatMap((root) => trackedFiles(root, /\.test\.tsx?$/))
    .filter((f) => f !== self);
  for (const suite of suites) {
    const src = readFileSync(suite, "utf8");
    if (!/_export-census/.test(src)) continue;
    for (const m of src.matchAll(/["'`]((?:src|library)\/[^"'`]+\.tsx?)["'`]/g)) out.add(m[1]);
  }
  return out;
}

function flagModules(): string[] {
  const elsewhere = namedByOtherExportCensuses();
  const picked: string[] = [];
  for (const [file, text] of censusPopulation()) {
    if (isTestFile(file)) continue;
    const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
    // The registry's own declaration of `setFlagOverride` is not a call site.
    const isWrapper =
      FLAG_MODULE_NAME.test(path.basename(file)) ||
      (CALLS_SET_FLAG_OVERRIDE.test(text) && !/function\s+setFlagOverride\b/.test(text));
    if (isWrapper && !elsewhere.has(rel)) picked.push(rel);
  }
  return picked.sort();
}

const CENSUSED = censusFiles(flagModules());

/**
 * `"<rel>::<name>"` → why it earns its keep with NO production caller.
 *
 * The one admissible shape is identity's: a flag's override door whose PURPOSE
 * is to let a suite drive the non-default branch of a live rollout flag. "A test
 * happens to call it" is not that — WIRE it or DELETE it.
 */
const PERMITTED_UNCALLED: Readonly<Record<string, string>> = {
  // The registry's own census surface: `feature-flag-registry.test.ts` can be
  // TOTAL over every `virgil:` string only because these name the full key set.
  "src/lib/feature-flags.ts::FLAG_KEYS":
    "the registry's key list — what the registry census iterates to check every row's default, sentinel and read timing.",
  "src/lib/feature-flags.ts::isFlagKey":
    "the registry census's membership test (is this `virgil:` string a flag row?).",
  "src/lib/feature-flags.ts::NON_FLAG_VIRGIL_KEYS":
    "the declared non-flag `virgil:` keys — the other half of the registry census's totality.",
  "src/lib/feature-flags.ts::clearFlagOverrides":
    "the override map's test teardown — resets every `setFlagOverride` door between cases.",
  "src/lib/pending-changes-flag.ts::setPendingChangesFlag":
    "the `virgil:pending-changes` override door — how the pending-changes " +
    "suites exercise the producer-gated branch of the rollout flag.",
};

describe("flag-module export census", () => {
  it("the derived population sees the flag modules (anti-vacuity)", () => {
    const rels = CENSUSED.map((c) => c.rel);
    for (const expected of [
      "src/lib/feature-flags.ts",
      "src/lib/multi-doc-keepalive-flag.ts",
      "src/lib/pending-changes-flag.ts",
      "src/lib/perf-feature-flags.ts",
      "src/lib/perf-flags.ts",
    ]) {
      expect(rels).toContain(expected);
    }
    // …and defers the identity flags to the census that already owns them.
    expect(rels).not.toContain("src/lib/identity/identity-flag.ts");
    expect(rels).not.toContain("src/lib/identity/inline-atom-lifecycle-flag.ts");
  });

  it("every value export has a production caller", () => {
    expect(deadExports(CENSUSED, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the allowlist has not rotted in either direction", () => {
    expect(staleAllowlistEntries(CENSUSED, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the scanner swallows nothing in the censused files", () => {
    expect(swallowedInCensusedFiles(CENSUSED)).toEqual([]);
  });

  it("the needle FINDS the declaration this task retired (anti-vacuity)", () => {
    const retired =
      "export function setMultiDocKeepAliveFlag(value: boolean | undefined): void {\n" +
      '  setFlagOverride("virgil:multi-doc-keepalive", value);\n}\n';
    VALUE_EXPORT.lastIndex = 0; // the shared regex is /g — stateful
    const found = [...censusText(retired).matchAll(VALUE_EXPORT)].map((m) => m[1]);
    expect(found).toEqual(["setMultiDocKeepAliveFlag"]);
  });
});
