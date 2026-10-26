/**
 * "Developer-only" has ONE answer — CENSUS (task 1310).
 *
 * A skill whose `description` opens `Developer-only` (`virgil/skills/start.md`
 * rule 1) is read by TWO readers in two languages:
 *
 *   - `editor/scripts/skill_catalog.py` → `developerOnly`, which keeps the
 *     skill off the front door's routes;
 *   - `library/build/bundle-sources.mjs` → `isRepoOnlySkill`, which keeps the
 *     skill OUT of the shipped bundle.
 *
 * Until task 1310 the first was a case-sensitive `startswith` on the parsed
 * description and the second a case-insensitive regex on the first raw line,
 * so a skill spelled `developer-only` (or a quoted inline description) was
 * dropped from the bundle yet still routable — the front door would route to
 * a file that is not on disk. Both now share one rule (any casing, on the
 * whitespace-normalised, unquoted description), and this census pins the two
 * answers EQUAL: over every real skill, and over a fixture matrix of the
 * shapes that split them before.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isRepoOnlySkill } from "../../../library/build/bundle-sources.mjs";

const REPO_ROOT = resolve(__dirname, "../../..");
const CATALOG_PY = join(REPO_ROOT, "editor/scripts/skill_catalog.py");
/** The silos the catalog reads (`SILOS` in skill_catalog.py). */
const SILOS = ["editor", "library"] as const;

/** `name → developerOnly`, by RUNNING the catalog the front door runs. */
function catalogDeveloperOnly(root: string): Map<string, boolean> {
  const out = execFileSync("python3", [CATALOG_PY, "--root", root], { encoding: "utf8" });
  const rows = out
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { name: string; developerOnly: boolean });
  return new Map(rows.map((r) => [r.name, r.developerOnly]));
}

/** `name → isRepoOnlySkill`, over the same files the catalog lists
 *  (`<silo>/skills/*.md`, `_`-includes excluded). */
function bundleRepoOnly(root: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const silo of SILOS) {
    const dir = join(root, silo, "skills");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith("_")).sort()) {
      out.set(`${silo}:${f.slice(0, -3)}`, isRepoOnlySkill(readFileSync(join(dir, f), "utf8")));
    }
  }
  return out;
}

describe("developer-only CENSUS — catalog and bundle filter agree (task 1310)", () => {
  it("every real skill gets the same answer from both readers", () => {
    const catalog = catalogDeveloperOnly(REPO_ROOT);
    const bundle = bundleRepoOnly(REPO_ROOT);
    expect([...catalog.keys()].sort()).toEqual([...bundle.keys()].sort());
    const disagree = [...bundle].filter(([n, v]) => catalog.get(n) !== v).map(([n]) => n);
    expect(disagree, "skills the two readers classify differently").toEqual([]);
    // Non-vacuous: the population really contains maintainer skills.
    expect(bundle.get("editor:dream")).toBe(true);
    expect(bundle.get("editor:review")).toBe(false);
  });

  // The shapes that split the two readers before task 1310, plus controls.
  const FIXTURES: Record<string, { fm: string; dev: boolean }> = {
    "block-canonical": { fm: "description: |\n  Developer-only — a maintainer skill.\n", dev: true },
    "block-lowercase": { fm: "description: |\n  developer-only — a maintainer skill.\n", dev: true },
    "block-uppercase": { fm: "description: >-\n  DEVELOPER-ONLY — a maintainer skill.\n", dev: true },
    "block-leading-blank": { fm: "description: |\n\n  Developer-only — a maintainer skill.\n", dev: true },
    "inline-plain": { fm: "description: developer-only maintainer skill\n  wrapped onto a second line.\n", dev: true },
    "inline-quoted": { fm: 'description: "Developer-only maintainer skill."\n', dev: true },
    "mid-sentence": { fm: "description: |\n  Not Developer-only — a user skill.\n", dev: false },
    "user-skill": { fm: "description: |\n  Review a paragraph. Triggers on: \"review this\".\n", dev: false },
  };

  it("a fixture matrix of description shapes gets the same answer from both readers", () => {
    const root = mkdtempSync(join(tmpdir(), "devonly-census-"));
    try {
      for (const silo of SILOS) mkdirSync(join(root, silo, "skills"), { recursive: true });
      for (const [name, { fm }] of Object.entries(FIXTURES)) {
        writeFileSync(join(root, "editor", "skills", `${name}.md`), `---\nname: ${name}\n${fm}---\n\nBody.\n`);
      }
      const catalog = catalogDeveloperOnly(root);
      const bundle = bundleRepoOnly(root);
      for (const [name, { dev }] of Object.entries(FIXTURES)) {
        expect(bundle.get(`editor:${name}`), `isRepoOnlySkill ${name}`).toBe(dev);
        expect(catalog.get(`editor:${name}`), `catalog developerOnly ${name}`).toBe(dev);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
