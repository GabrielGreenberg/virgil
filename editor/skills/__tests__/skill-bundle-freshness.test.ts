// @vitest-environment node
//
// Freshness guard for the DISTRIBUTED copies of the skill set.
//
// Each skill is authored once in `editor/skills/<name>.md` (and each helper in
// `<silo>/scripts/`), but the prompt a run actually READS — and the helper it
// actually EXECUTES — is a mirrored copy: `.claude/commands/editor/<name>.md`,
// the managed-folder mirrors, and the skill bundles. Those are regenerated
// only by `npm run build:skill-bundles`. The editor bundle mirrors each
// skill's bytes with NO transclusion, so a built copy is simply a stale
// snapshot until the build reruns, and NOTHING surfaced the gap.
//
// That gap is not hypothetical. The 2026-07-11 dream authored a recursion
// guard into `dream.md` to terminate a self-referential no-op loop; the branch
// merged to main on 2026-07-18, but the built copy was never regenerated. Six
// consecutive nightly dreams ran the pre-guard prompt and re-emitted exactly
// the empty self-memo the guard existed to prevent — including the run that
// diagnosed this. The fix had landed and could not be seen.
//
// Shape of the guard: a built copy that EXISTS must match its SSOT. An absent
// one skips, so a fresh clone (or CI that never builds) is never failed for
// artifacts it legitimately does not have. Present-but-drifted fails loudly
// with the rebuild command.
//
// LOUD vs ADVISORY (task 374). A staleness signal is only worth failing on if
// the remedy the message names can clear it. `out/skill-bundle/…` is the Next
// static export: nothing short of a full `npm run build` regenerates it, and
// that build regenerates it WHOLESALE — so between releases it says nothing
// about whether the SSOT edit is live anywhere a run can read it. It reports
// and skips. Every mirror a run actually reads stays LOUD.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
// The build's own path-rewrite helper — the SSOT of the transform the paper
// bundle applies (`editor/scripts/` → `.virgil/scripts/editor/`). Importing it
// does not run the build: the module main-guards on `process.argv[1]`.
import { rewriteScriptPathsForPaper } from "../../build/build-editor-bundle.mjs";
// The on-disk layout SSOT — the same routing the app's per-folder sync and
// `scripts/sync-local-mirrors.mjs` write by, so this guard cannot come to
// disagree with the writers about where a mirrored copy lands.
import { commandsDirFor, scriptsDirFor } from "../../../library/lib/skill-bundle-layout.mjs";

// editor/skills/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (abs: string) => readFileSync(abs, "utf8");

const SKILLS_DIR = join(repoRoot, "editor", "skills");
const REBUILD = "npm run build:skill-bundles";

// The in-repo Virgil-managed folder: the dev-storage library workspace, whose
// mirror is what a `/library:…` or `/editor:…` run in that folder READS. It is
// refreshed by `scripts/sync-local-mirrors.mjs`, chained into the same
// `build:skill-bundles` this guard names — so the remedy actually clears it.
const MANAGED_FOLDER = "library-data";

type Mirror = {
  /** repo-relative directory mirroring `editor/skills/*.md` by basename. */
  dir: string;
  /** Bytes pass through `rewriteScriptPathsForPaper` (paper-shaped mirrors). */
  rewritten: boolean;
  /** Stale here FAILS. Advisory mirrors (see header) report and skip. */
  loud: boolean;
};

const MIRRORS: Mirror[] = [
  // The repo's own dev mirror — unrewritten, because a maintainer runs
  // `/editor:<skill>` with the repo root as cwd.
  { dir: commandsDirFor("editor"), rewritten: false, loud: true },
  { dir: join(MANAGED_FOLDER, commandsDirFor("editor")), rewritten: true, loud: true },
  { dir: "public/skill-bundle/editor/claude-commands", rewritten: true, loud: true },
  { dir: "out/skill-bundle/editor/claude-commands", rewritten: true, loud: false },
];

// The other half of the same class, and the one no guard watched: helper
// SCRIPTS. Measured 2026-08-19, `library-data/.virgil/scripts/` carried 17
// stale `.py` files — executables a skill run in that folder actually invokes.
// Scripts ship unrewritten (only `claude-commands/*.md` take the path rewrite),
// so the expected bytes are the SSOT's, verbatim.
type ScriptMirror = { dir: string; silo: "editor" | "library"; loud: boolean };

const SCRIPT_MIRRORS: ScriptMirror[] = [
  { dir: join(MANAGED_FOLDER, scriptsDirFor("editor")), silo: "editor", loud: true },
  { dir: join(MANAGED_FOLDER, scriptsDirFor("library")), silo: "library", loud: true },
  { dir: "public/skill-bundle/editor/scripts", silo: "editor", loud: true },
  { dir: "public/skill-bundle/library/scripts", silo: "library", loud: true },
  { dir: "out/skill-bundle/editor/scripts", silo: "editor", loud: false },
  { dir: "out/skill-bundle/library/scripts", silo: "library", loud: false },
];

// Skills are the top-level `*.md` in editor/skills/, minus the `_`-prefixed
// includes (e.g. `_dev-loop-principle.md`), which are transcluded by the drift
// guard in dev-loop-principle.test.ts rather than shipped as commands.
function skillNames(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();
}

/** SSOT helper files for a silo — exactly what its builder ships. */
function scriptNames(silo: "editor" | "library"): string[] {
  const keep =
    silo === "editor"
      ? (n: string) => n.endsWith(".py") || n.endsWith(".json")
      : (n: string) => n.endsWith(".py") || n === "requirements.txt";
  return readdirSync(join(repoRoot, silo, "scripts"))
    .filter(keep)
    .sort();
}

/** Compare a mirror directory against its SSOT, returning the stale basenames.
 *  `null` means the whole mirror is absent — nothing to guard. */
function staleIn(
  dir: string,
  names: string[],
  ssotFor: (name: string) => string,
  expectedFor: (ssot: string) => string,
): string[] | null {
  const mirrorDir = join(repoRoot, dir);
  if (!existsSync(mirrorDir)) return null;
  const stale: string[] = [];
  for (const name of names) {
    const built = join(mirrorDir, name);
    // This mirror does not carry this file (or has not built it yet).
    if (!existsSync(built)) continue;
    if (read(built) !== expectedFor(read(ssotFor(name)))) stale.push(name);
  }
  return stale;
}

describe("skill bundle freshness (SSOT → built copies)", () => {
  it("finds skills to guard", () => {
    expect(skillNames().length).toBeGreaterThan(0);
    expect(scriptNames("editor").length).toBeGreaterThan(0);
    expect(scriptNames("library").length).toBeGreaterThan(0);
  });

  // Explicit loop rather than `it.each`: an advisory row needs the test
  // CONTEXT to skip at runtime, and `each` spreads the case into the argument
  // slot the context would occupy.
  for (const { dir, rewritten, loud } of MIRRORS) {
  it(`${dir} carries no stale skill copies`, (ctx) => {
    const stale = staleIn(
      dir,
      skillNames(),
      (name) => join(SKILLS_DIR, name),
      (ssot) => (rewritten ? rewriteScriptPathsForPaper(ssot) : ssot),
    );
    if (stale === null) return;
    if (stale.length > 0 && !loud) {
      ctx.skip(`Advisory mirror ${dir} is stale (${stale.join(", ")}) — regenerated wholesale by \`npm run build\`, so between releases it is not a staleness signal.`);
    }
    expect(
      stale,
      `Stale built skill copies in ${dir}: ${stale.join(", ")}.\n` +
        `These are what a run actually reads, so the SSOT edit is NOT live.\n` +
        `Regenerate with: ${REBUILD}`,
    ).toEqual([]);
  });
  }

  for (const { dir, silo, loud } of SCRIPT_MIRRORS) {
  it(`${dir} carries no stale helper scripts`, (ctx) => {
    const stale = staleIn(
      dir,
      scriptNames(silo),
      (name) => join(repoRoot, silo, "scripts", name),
      (ssot) => ssot,
    );
    if (stale === null) return;
    if (stale.length > 0 && !loud) {
      ctx.skip(`Advisory mirror ${dir} is stale (${stale.join(", ")}) — regenerated wholesale by \`npm run build\`.`);
    }
    expect(
      stale,
      `Stale helper scripts in ${dir}: ${stale.join(", ")}.\n` +
        `These are what a skill run actually EXECUTES, so the SSOT edit is NOT live.\n` +
        `Regenerate with: ${REBUILD}`,
    ).toEqual([]);
  });
  }
});
