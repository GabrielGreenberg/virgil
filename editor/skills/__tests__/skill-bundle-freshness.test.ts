// @vitest-environment node
//
// Freshness guard for the DISTRIBUTED copies of the editor skill set.
//
// Each skill is authored once in `editor/skills/<name>.md`, but the prompt a
// run actually reads is a built artifact — `.claude/commands/editor/<name>.md`
// and the skill bundles — regenerated only by `npm run build:skill-bundles`
// (wired to `predev`/`prebuild`). The editor bundle mirrors each skill's bytes
// with NO transclusion, so a built copy is simply a stale snapshot until the
// build reruns, and NOTHING surfaced the gap.
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

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
// The build's own path-rewrite helper — the SSOT of the transform the paper
// bundle applies (`editor/scripts/` → `.virgil/scripts/editor/`). Importing it
// does not run the build: the module main-guards on `process.argv[1]`.
import { rewriteScriptPathsForPaper } from "../../build/build-editor-bundle.mjs";

// editor/skills/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (abs: string) => readFileSync(abs, "utf8");

const SKILLS_DIR = join(repoRoot, "editor", "skills");
const REBUILD = "npm run build:skill-bundles";

// Every place a built copy of an editor skill lands. Each entry is a directory
// that mirrors `editor/skills/*.md` by basename. `rewritten` marks the mirrors
// the build ships to PAPER folders, whose bytes pass through
// `rewriteScriptPathsForPaper` — a shipped copy still carrying the RAW repo
// paths predates the rewrite and is stale by definition, so the expected form
// is per-mirror, not either/or.
const MIRRORS: { dir: string; rewritten: boolean }[] = [
  { dir: ".claude/commands/editor", rewritten: false },
  { dir: "library-data/.claude/commands/editor", rewritten: true },
  { dir: "public/skill-bundle/editor/claude-commands", rewritten: true },
  { dir: "out/skill-bundle/editor/claude-commands", rewritten: true },
];

// Skills are the top-level `*.md` in editor/skills/, minus the `_`-prefixed
// includes (e.g. `_dev-loop-principle.md`), which are transcluded by the drift
// guard in dev-loop-principle.test.ts rather than shipped as commands.
function skillNames(): string[] {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
    .sort();
}

describe("editor skill bundle freshness (SSOT → built copies)", () => {
  it("finds skills to guard", () => {
    expect(skillNames().length).toBeGreaterThan(0);
  });

  it.each(MIRRORS)("$dir carries no stale skill copies", ({ dir, rewritten }) => {
    const mirrorDir = join(repoRoot, dir);
    // The whole mirror is absent (fresh clone, or never built) — nothing to
    // guard. Freshness is only meaningful for an artifact that exists.
    if (!existsSync(mirrorDir)) return;

    const stale: string[] = [];
    for (const name of skillNames()) {
      const built = join(mirrorDir, name);
      // This mirror does not carry this skill (or has not built it yet).
      if (!existsSync(built)) continue;
      const ssot = read(join(SKILLS_DIR, name));
      const expected = rewritten ? rewriteScriptPathsForPaper(ssot) : ssot;
      if (read(built) !== expected) stale.push(name);
    }

    expect(
      stale,
      `Stale built skill copies in ${dir}: ${stale.join(", ")}.\n` +
        `These are what a run actually reads, so the SSOT edit is NOT live.\n` +
        `Regenerate with: ${REBUILD}`,
    ).toEqual([]);
  });
});
