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
// SILO POPULATION (task 473). The skill half of this guard was editor-only
// while three silos ship command markdown — and the one it did not cover,
// `virgil/skills/`, is the USER-FACING FRONT DOOR, whose four mirrored copies
// are what every "Virgil, …" turn actually reads. It had no guard of any kind.
// `virgil` joins here rather than in a second file, because a second
// implementation of "a mirror must match its SSOT" is the fork this repo
// legislates against everywhere else. `library`'s COMMAND mirror is still
// uncovered and deliberately not folded in: its bundle ships a different file
// set (skills + `_`-includes + `CLAUDE.md`) under its own builder, so it is a
// wider question than this task, and its SCRIPTS are already covered below.
//
// LOUD vs ADVISORY (task 374). A staleness signal is only worth failing on if
// the remedy the message names can clear it. `out/skill-bundle/…` is the Next
// static export: nothing short of a full `npm run build` regenerates it, and
// that build regenerates it WHOLESALE — so between releases it says nothing
// about whether the SSOT edit is live anywhere a run can read it. It reports
// and skips. Every mirror a run actually reads stays LOUD.
//
// ─────────────────────────────────────────────────────────────────────────────
// THREE STATES, NOT TWO — a guard that CANNOT SEE its subject must say so
// (task 505).
//
// Every one of the fourteen guarded directories below is GITIGNORED — `/out/`,
// `.claude/`, `/public/skill-bundle/`, `/library-data/.claude/`, and the two
// `/library-data/.virgil/scripts/` dirs. So `git worktree add` materializes NONE
// of them, and the pre-505 guard read that absence as compliance: it returned
// early and the row counted as a green pass. Measured on this tree: **15 passed
// / 0 skipped in a worktree where 14 of the 15 legs could see nothing at all.**
//
// That is exactly how task 496's fix came to be dead in what a skill run
// executes. 496 edited the SSOT scripts (`editor/scripts/_common.py`,
// `library/scripts/_tools.py`) and never regenerated the bundles; the worker's
// worktree run reported 10142 passed while `main` was red on 4 of these legs,
// over identical content. The person who could see the failure was the one who
// had not made the change.
//
//   A verdict has THREE states, never two: FRESH, STALE, and CANNOT-SEE.
//   Absence is not compliance — it is the absence of evidence, and the guard
//   reports it as a loud SKIP naming the directory and the remedy.
//
// It must not go the other way. Hard-failing on absence would red every
// worktree run of the full suite, for every task in the repo — worse than the
// disease. So CANNOT-SEE is a skip, and the obligation it names is a WORKER
// one: a task whose diff touches `editor/scripts/**`, `library/scripts/**` or
// `*/skills/**` owes `npm run build:skill-bundles` on the PRIMARY checkout
// after land-and-clean, plus this suite green there (`WORKER.md` →
// "Land-and-clean", `PROFILE.md` → "Worktree recipe").
//
// The same blindness ran one level down: a mirror that EXISTS but does not
// carry an SSOT file at all was skipped per-file with a bare `continue`. A new
// skill or helper that has never been built is precisely the staleness this
// guard exists to catch, and it passed silently. `missing` is now reported
// beside `stale` — measured zero on this tree when it landed, because every
// row's name list is derived from the same filter its builder ships by.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import type { TestContext } from "vitest";
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

const skillsDirFor = (silo: SkillSilo) => join(repoRoot, silo, "skills");
const REBUILD = "npm run build:skill-bundles";

// The in-repo Virgil-managed folder: the dev-storage library workspace, whose
// mirror is what a `/library:…` or `/editor:…` run in that folder READS. It is
// refreshed by `scripts/sync-local-mirrors.mjs`, chained into the same
// `build:skill-bundles` this guard names — so the remedy actually clears it.
const MANAGED_FOLDER = "library-data";

type SkillSilo = "editor" | "virgil";

type Mirror = {
  /** repo-relative directory mirroring `<silo>/skills/*.md` by basename. */
  dir: string;
  /** Which SSOT directory this mirror copies. */
  silo: SkillSilo;
  /** Bytes pass through `rewriteScriptPathsForPaper` (paper-shaped mirrors). */
  rewritten: boolean;
  /** Stale here FAILS. Advisory mirrors (see header) report and skip. */
  loud: boolean;
};

const MIRRORS: Mirror[] = [
  // The repo's own dev mirror — unrewritten, because a maintainer runs
  // `/editor:<skill>` with the repo root as cwd.
  { dir: commandsDirFor("editor"), silo: "editor", rewritten: false, loud: true },
  { dir: join(MANAGED_FOLDER, commandsDirFor("editor")), silo: "editor", rewritten: true, loud: true },
  { dir: "public/skill-bundle/editor/claude-commands", silo: "editor", rewritten: true, loud: true },
  { dir: "out/skill-bundle/editor/claude-commands", silo: "editor", rewritten: true, loud: false },
  // The FRONT DOOR. `build-virgil-bundle.mjs` copies bytes verbatim — it
  // applies no path rewrite — so every virgil mirror is `rewritten: false`,
  // including the paper-shaped ones. That is exactly why `start.md` names its
  // helper scripts through a resolved `<editor-scripts>/` prefix rather than a
  // literal `editor/scripts/…` path (task 473): with no rewrite, a literal one
  // would be wrong in every synced folder.
  { dir: commandsDirFor("virgil"), silo: "virgil", rewritten: false, loud: true },
  { dir: join(MANAGED_FOLDER, commandsDirFor("virgil")), silo: "virgil", rewritten: false, loud: true },
  { dir: "public/skill-bundle/virgil/claude-commands", silo: "virgil", rewritten: false, loud: true },
  { dir: "out/skill-bundle/virgil/claude-commands", silo: "virgil", rewritten: false, loud: false },
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
// includes (e.g. `_dev-loop-principle.md`). Those ship in the bundle like any
// other file — nothing transcludes anything (task 461) — but the leading
// underscore keeps them out of the COMMAND mirror, so they are not skills.
// `_dev-loop-principle.md` is the one include a skill inlines rather than
// links, and `dev-loop-principle.test.ts` is what holds that inlined copy to
// this file's bytes.
function skillNames(silo: SkillSilo): string[] {
  return readdirSync(skillsDirFor(silo))
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

// ── The three-state verdict ──────────────────────────────────────────────────

/** What this checkout could establish about one mirror directory.
 *
 *  `unseen` is the state the pre-505 guard could not express: the directory is
 *  not here, so nothing was compared. It is NOT `{ missing: [], stale: [] }` —
 *  conflating the two is the whole defect, because that shape is what a
 *  perfectly fresh mirror also reports. */
export type MirrorVerdict =
  | { kind: "unseen" }
  | { kind: "seen"; missing: string[]; stale: string[] };

/** Resolve one mirror against its SSOT. Absolute paths in, so the pin legs
 *  below can point it at a temp fixture instead of the repo. */
export function resolveMirror(
  mirrorDirAbs: string,
  names: string[],
  ssotAbsFor: (name: string) => string,
  expectedFor: (ssot: string) => string,
): MirrorVerdict {
  if (!existsSync(mirrorDirAbs)) return { kind: "unseen" };
  const missing: string[] = [];
  const stale: string[] = [];
  for (const name of names) {
    const built = join(mirrorDirAbs, name);
    // Never built here. The pre-505 guard `continue`d past this — the same
    // absence-is-compliance reading, one level down.
    if (!existsSync(built)) {
      missing.push(name);
      continue;
    }
    if (read(built) !== expectedFor(read(ssotAbsFor(name)))) stale.push(name);
  }
  return { kind: "seen", missing, stale };
}

const CANNOT_SEE = (dir: string) =>
  `CANNOT SEE ${dir} — this checkout does not have it, so freshness here is ` +
  `UNVERIFIED, not verified-clean. Every guarded directory is gitignored, so a ` +
  `\`git worktree add\` materializes none of them. Run this suite on the PRIMARY ` +
  `checkout after landing — and \`${REBUILD}\` there first if the diff touched ` +
  `editor/scripts/**, library/scripts/**, or */skills/**.`;

/** One drift entry per out-of-date file, saying WHY it is out of date. */
function driftOf(v: Extract<MirrorVerdict, { kind: "seen" }>): string[] {
  return [
    ...v.missing.map((n) => `${n} (never built here)`),
    ...v.stale.map((n) => `${n} (drifted from SSOT)`),
  ];
}

type Row = {
  dir: string;
  /** What this row guards, for the failure message. */
  subject: string;
  /** What a run does with these bytes, for the failure message. */
  consequence: string;
  loud: boolean;
  verdict: MirrorVerdict;
};

/** The shared reporter. THREE outcomes, and the caller does not choose:
 *  unseen → loud skip; drifted → advisory skip or red; clean → green. */
export function reportMirror(ctx: TestContext, row: Row): void {
  if (row.verdict.kind === "unseen") {
    ctx.skip(CANNOT_SEE(row.dir));
    return;
  }
  const drift = driftOf(row.verdict);
  if (drift.length > 0 && !row.loud) {
    ctx.skip(
      `Advisory mirror ${row.dir} is out of date (${drift.join(", ")}) — regenerated ` +
        `wholesale by \`npm run build\`, so between releases it is not a staleness signal.`,
    );
    return;
  }
  expect(
    drift,
    `Out-of-date ${row.subject} in ${row.dir}: ${drift.join(", ")}.\n` +
      `${row.consequence}, so the SSOT edit is NOT live.\n` +
      `Regenerate with: ${REBUILD}`,
  ).toEqual([]);
}

// Verdicts are resolved ONCE, at collection, so the summary row below can name
// exactly the set the per-row legs skipped on rather than re-deriving it.
const ROWS: Row[] = [
  ...MIRRORS.map(({ dir, silo, rewritten, loud }): Row => ({
    dir,
    subject: "built skill copies",
    consequence: "These are what a run actually reads",
    loud,
    verdict: resolveMirror(
      join(repoRoot, dir),
      skillNames(silo),
      (name) => join(skillsDirFor(silo), name),
      (ssot) => (rewritten ? rewriteScriptPathsForPaper(ssot) : ssot),
    ),
  })),
  ...SCRIPT_MIRRORS.map(({ dir, silo, loud }): Row => ({
    dir,
    subject: "helper scripts",
    consequence: "These are what a skill run actually EXECUTES",
    loud,
    verdict: resolveMirror(
      join(repoRoot, dir),
      scriptNames(silo),
      (name) => join(repoRoot, silo, "scripts", name),
      (ssot) => ssot,
    ),
  })),
];

describe("skill bundle freshness (SSOT → built copies)", () => {
  it("finds skills to guard", () => {
    expect(skillNames("editor").length).toBeGreaterThan(0);
    // The canary for the widened population: a virgil silo that resolved to an
    // empty list would make every front-door freshness row pass vacuously.
    expect(skillNames("virgil")).toContain("start.md");
    expect(scriptNames("editor").length).toBeGreaterThan(0);
    expect(scriptNames("library").length).toBeGreaterThan(0);
  });

  // The single line a worker reads off the summary. It can only SKIP or pass —
  // failing here would red every worktree run of the whole suite, which is
  // worse than the disease it reports.
  it("this checkout can SEE every guarded mirror", (ctx) => {
    const unseen = ROWS.filter((r) => r.verdict.kind === "unseen").map((r) => r.dir);
    if (unseen.length > 0) {
      ctx.skip(
        `FRESHNESS UNVERIFIED for ${unseen.length} of ${ROWS.length} guarded mirrors — ` +
          `absent from this checkout: ${unseen.join(", ")}. ` +
          `The rows below that skip were not checked; they did not pass. ` +
          `Re-run on the PRIMARY checkout (see WORKER.md → Land-and-clean).`,
      );
      return;
    }
    expect(unseen).toEqual([]);
  });

  // Explicit loop rather than `it.each`: an advisory (or unseen) row needs the
  // test CONTEXT to skip at runtime, and `each` spreads the case into the
  // argument slot the context would occupy.
  for (const row of ROWS) {
    it(`${row.dir} carries no out-of-date ${row.subject}`, (ctx) => {
      reportMirror(ctx, row);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// The leg with teeth: the CANNOT-SEE state itself.
//
// The guard above was never the part that could misbehave — a state that reads
// absence as compliance is, and it type-checks and runs green forever. So the
// resolver and the reporter are driven against a temp fixture through all four
// shapes (absent / fresh / drifted / never-built), in both the loud and the
// advisory posture. Neutering the resolver's `unseen` arm back to
// `{ kind: "seen", missing: [], stale: [] }` fails these, where it fails
// nothing at all in the suite above.

describe("a guard that cannot see its subject says so", () => {
  /** What the fake context throws, so a SKIP is distinguishable from a RED. */
  class Skipped extends Error {}
  const fakeCtx = () =>
    ({
      skip: (note?: string) => {
        throw new Skipped(note ?? "");
      },
    }) as unknown as TestContext;

  /** Run the reporter and classify the outcome the way vitest would. */
  function outcomeOf(row: Row): { kind: "green" } | { kind: "skip" | "red"; message: string } {
    try {
      reportMirror(fakeCtx(), row);
      return { kind: "green" };
    } catch (e) {
      if (e instanceof Skipped) return { kind: "skip", message: e.message };
      return { kind: "red", message: (e as Error).message };
    }
  }

  const SSOT = "one\ntwo\n";
  let root = "";
  const ssotDir = () => join(root, "ssot");
  const mirrorDir = () => join(root, "mirror");
  const resolveFixture = () =>
    resolveMirror(mirrorDir(), ["a.md"], (n) => join(ssotDir(), n), (s) => s);
  const rowFor = (verdict: MirrorVerdict, loud: boolean): Row => ({
    dir: "mirror",
    subject: "built skill copies",
    consequence: "These are what a run actually reads",
    loud,
    verdict,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "freshness-cannot-see-"));
    mkdirSync(ssotDir(), { recursive: true });
    writeFileSync(join(ssotDir(), "a.md"), SSOT);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("ABSENT directory → unseen, and the reporter SKIPS with the remedy (never a green pass)", () => {
    const verdict = resolveFixture();
    expect(verdict).toEqual({ kind: "unseen" });
    const out = outcomeOf(rowFor(verdict, true));
    expect(out.kind).toBe("skip");
    expect((out as { message: string }).message).toContain("CANNOT SEE mirror");
    expect((out as { message: string }).message).toContain(REBUILD);
  });

  it("an ADVISORY row is skipped for absence too — unverified is unverified whatever the posture", () => {
    expect(outcomeOf(rowFor(resolveFixture(), false)).kind).toBe("skip");
  });

  it("PRESENT and matching → seen-clean, and the reporter is GREEN", () => {
    mkdirSync(mirrorDir(), { recursive: true });
    writeFileSync(join(mirrorDir(), "a.md"), SSOT);
    const verdict = resolveFixture();
    expect(verdict).toEqual({ kind: "seen", missing: [], stale: [] });
    expect(outcomeOf(rowFor(verdict, true)).kind).toBe("green");
  });

  it("PRESENT and drifted → seen-stale, and a LOUD row is RED naming the rebuild", () => {
    mkdirSync(mirrorDir(), { recursive: true });
    writeFileSync(join(mirrorDir(), "a.md"), "one\nTWO\n");
    const verdict = resolveFixture();
    expect(verdict).toEqual({ kind: "seen", missing: [], stale: ["a.md"] });
    const out = outcomeOf(rowFor(verdict, true));
    expect(out.kind).toBe("red");
    expect((out as { message: string }).message).toContain("a.md (drifted from SSOT)");
    expect((out as { message: string }).message).toContain(REBUILD);
  });

  it("PRESENT and drifted, ADVISORY → skipped, not red (task 374's posture is unchanged)", () => {
    mkdirSync(mirrorDir(), { recursive: true });
    writeFileSync(join(mirrorDir(), "a.md"), "one\nTWO\n");
    const out = outcomeOf(rowFor(resolveFixture(), false));
    expect(out.kind).toBe("skip");
    expect((out as { message: string }).message).toContain("Advisory mirror mirror");
  });

  it("PRESENT but the file was NEVER BUILT → seen-missing, and a LOUD row is RED (the pre-505 `continue` passed)", () => {
    mkdirSync(mirrorDir(), { recursive: true });
    const verdict = resolveFixture();
    expect(verdict).toEqual({ kind: "seen", missing: ["a.md"], stale: [] });
    const out = outcomeOf(rowFor(verdict, true));
    expect(out.kind).toBe("red");
    expect((out as { message: string }).message).toContain("a.md (never built here)");
  });

  it("the two absences are DIFFERENT verdicts — an unseen mirror is not an empty-drift one", () => {
    const absent = resolveFixture();
    mkdirSync(mirrorDir(), { recursive: true });
    writeFileSync(join(mirrorDir(), "a.md"), SSOT);
    const clean = resolveFixture();
    // Both would be "no drift" under the pre-505 shape; only one is evidence.
    expect(absent).not.toEqual(clean);
    expect(outcomeOf(rowFor(absent, true)).kind).not.toBe(outcomeOf(rowFor(clean, true)).kind);
  });
});
