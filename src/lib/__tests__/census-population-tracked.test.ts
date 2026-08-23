/**
 * CENSUS POPULATION = WHAT THE REPO SHIPS (task 429).
 *
 * Four grep-censuses walked `editor/` (and `docs/`) from DISK and filtered by
 * extension alone, so a gitignored critique memo under `editor/dev/` that
 * QUOTES a retired sidecar shape — while explaining it is wrong — indicted
 * itself. `npm test` was red on the one checkout holding that scratch and green
 * in CI and every worktree: the person who sees the failure is the one least
 * able to connect it to a change.
 *
 * The door is `trackedFiles` in `_source-scan.ts`: tracked + untracked-but-not-
 * ignored. This suite is the leg that proves the door, and the census that
 * proves the callers enter it — the door was never the part that could
 * misbehave; a walker that reads the working copy is.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT, resetTrackedFilesCache, trackedFiles } from "./_source-scan";

/** The retired `anchor.margin` shape the margin-side census retires (task 205),
 *  spelled the way a critique memo quotes it. */
const RETIRED_SHAPE = '"margin": { "side": "right" }';

const planted: string[] = [];
function plant(rel: string, text: string): string {
  const abs = path.join(REPO_ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  planted.push(abs);
  resetTrackedFilesCache();
  return abs;
}
afterEach(() => {
  for (const p of planted.splice(0)) {
    fs.rmSync(p, { force: true });
    // Remove the planted directory only if we emptied it.
    const dir = path.dirname(p);
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      /* someone else's directory — leave it */
    }
  }
  resetTrackedFilesCache();
});

/** The pre-429 population: a raw disk walk by extension. Kept here only to
 *  prove the planted file is the kind of file that walk would have counted. */
function diskWalk(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) diskWalk(p, ext, out);
    else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

describe("trackedFiles — the population a census reads", () => {
  it("a gitignored scratch memo under editor/dev/ quoting the retired shape is UNREPRESENTABLE (a disk walk would have indicted it)", () => {
    const abs = plant(
      "editor/dev/iterations/__task429-planted__/critique.md",
      `This attempt wrote ${RETIRED_SHAPE} — the retired shape; do not copy it.\n`,
    );
    // The defect: the pre-429 walk sees it …
    expect(diskWalk(path.join(REPO_ROOT, "editor"), /\.(py|md)$/)).toContain(abs);
    // … the door does not.
    expect(trackedFiles("editor", /\.(py|md)$/)).not.toContain(abs);
  });

  it("a TRACKED file under the same root is in the population", () => {
    const files = trackedFiles("editor", /\.(py|md)$/).map((p) => path.relative(REPO_ROOT, p));
    expect(files).toContain("editor/AGENTS.md");
    expect(files.some((f) => f.startsWith("editor/scripts/") && f.endsWith(".py"))).toBe(true);
  });

  it("an UNTRACKED, not-ignored file IS in the population — a file being written must be censused before it is committed", () => {
    const abs = plant("editor/__task429-untracked-probe__.md", `${RETIRED_SHAPE}\n`);
    expect(trackedFiles("editor", /\.md$/)).toContain(abs);
  });

  it("filters by basename and sorts, so a census's report order is machine-independent", () => {
    const md = trackedFiles("editor", /\.md$/);
    expect(md.every((p) => p.endsWith(".md"))).toBe(true);
    expect(md).toEqual([...md].sort());
  });
});

// ---------------------------------------------------------------------------
// CENSUS: no suite walks a root outside src/ + library/ from disk.
// ---------------------------------------------------------------------------

/** Every suite in both silos. Read from disk deliberately — this census is
 *  about what a suite's SOURCE spells, and a suite that is not yet tracked is
 *  exactly the one that should be caught before it lands. */
function suites(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) suites(p, out);
    else if (/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** A readdir walk whose root is one of the repo's non-source trees. Those
 *  trees (`editor/`, `docs/`) are where gitignored scratch accumulates. */
const DISK_ROOT_NEEDLE = /(?:REPO|ROOT|REPO_ROOT)\s*,\s*"(?:editor|docs)"/;

/**
 * Per FILE, with the reason. May only SHRINK, and is EMPTY today.
 *
 * Stated scope: the needle names `editor/` and `docs/` — the two roots where
 * gitignored scratch accumulates. `public-asset-url-ssot` reads `public/`,
 * `scripts/` and `tools/` from disk to DISCOVER a vocabulary, and two of those
 * entries are BUILD OUTPUT that exists in no fresh checkout, so "what the repo
 * ships" is the wrong question there; it is outside this needle by design, not
 * by exemption.
 */
const PERMITTED_DISK_WALKS: Record<string, string> = {};

describe("census: a walk over editor/ or docs/ reads the shipped population", () => {
  const hits = [...suites(path.join(REPO_ROOT, "src")), ...suites(path.join(REPO_ROOT, "library"))]
    .filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      return /readdirSync\(/.test(src) && DISK_ROOT_NEEDLE.test(src);
    })
    .map((f) => path.relative(REPO_ROOT, f))
    .filter((f) => !f.endsWith("census-population-tracked.test.ts"));

  it("no suite pairs readdirSync with an editor/ or docs/ root (allowlist EMPTY — a hit is MIGRATE-it to trackedFiles)", () => {
    expect(hits.filter((h) => !(h in PERMITTED_DISK_WALKS))).toEqual([]);
  });

  it("the converted censuses enter the door", () => {
    for (const rel of [
      "src/lib/__tests__/margin-side-ssot.test.tsx",
      "src/lib/__tests__/latex-marker-ssot.test.ts",
      "src/__tests__/spec-authority-guardrail.test.ts",
    ]) {
      const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      expect(src, rel).toMatch(/trackedFiles\(/);
    }
  });

  it("the needle can see the shape it indicts (canary)", () => {
    expect(DISK_ROOT_NEEDLE.test('walkAny(path.join(REPO, "editor"), /x/)')).toBe(true);
    expect(DISK_ROOT_NEEDLE.test('trackedFiles("editor", /x/)')).toBe(false);
  });
});
