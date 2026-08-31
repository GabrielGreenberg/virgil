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
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import type { TestContext } from "vitest";
// WHAT SHIPS, WHERE IT LANDS, and THE BYTES IT SHIPS WITH — the same SSOT the
// four builders read (task 506). This guard used to hand-copy two of those
// answers (`skillNames`/`scriptNames` restated each builder's own filter) and
// import a third from the editor builder; a mirror guard that re-derives what
// a mirror should contain is the fork it exists to prevent.
import {
  commandMirrorNames,
  scriptFileNames,
  shippedBytes,
  shippedPathMap,
  shippedSources,
} from "../../../library/build/bundle-sources.mjs";
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
  /** PAPER-SHAPED: this mirror carries what the bundle SHIPS, in the bytes it
   *  ships them with (links re-spelled, helper prefixes rewritten). One flag,
   *  because those are one fact — the shipped SET and the shipped BYTES both
   *  come from `bundle-sources.mjs`. `false` is the repo's own dev mirror,
   *  which carries unrewritten source AND the repo-only maintainer skills a
   *  paper folder never receives (`/editor:dream` is read from there). */
  paper: boolean;
  /** Stale here FAILS. Advisory mirrors (see header) report and skip. */
  loud: boolean;
};

const MIRRORS: Mirror[] = [
  // The repo's own dev mirror — unrewritten, because a maintainer runs
  // `/editor:<skill>` with the repo root as cwd.
  { dir: commandsDirFor("editor"), silo: "editor", paper: false, loud: true },
  { dir: join(MANAGED_FOLDER, commandsDirFor("editor")), silo: "editor", paper: true, loud: true },
  { dir: "public/skill-bundle/editor/claude-commands", silo: "editor", paper: true, loud: true },
  { dir: "out/skill-bundle/editor/claude-commands", silo: "editor", paper: true, loud: false },
  // The FRONT DOOR. It takes no helper-PREFIX rewrite — that is why `start.md`
  // names its scripts through a resolved `<editor-scripts>/` prefix rather than
  // a literal `editor/scripts/…` path (task 473) — but its paper-shaped copies
  // do take the LINK rewrite every shipped markdown takes, so they are
  // `paper: true` like any other. `shippedBytes` is what decides which
  // transforms a given file actually gets.
  { dir: commandsDirFor("virgil"), silo: "virgil", paper: false, loud: true },
  { dir: join(MANAGED_FOLDER, commandsDirFor("virgil")), silo: "virgil", paper: true, loud: true },
  { dir: "public/skill-bundle/virgil/claude-commands", silo: "virgil", paper: true, loud: true },
  { dir: "out/skill-bundle/virgil/claude-commands", silo: "virgil", paper: true, loud: false },
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

// The shipped map, resolved once — both halves of every expectation below read
// it, so this guard and the builders cannot disagree about what a mirrored copy
// should say.
const SHIPPED = await shippedPathMap(repoRoot);

/** Repo path of a silo's skill by basename. */
const skillRepoPath = (silo: SkillSilo, name: string) => `${silo}/skills/${name}`;

/** What a PAPER-shaped mirror carries: exactly the command markdown the
 *  bundle ships — `_`-prefixed includes included (they ship like any other
 *  file; nothing transcludes anything, task 461) and repo-only maintainer
 *  skills excluded. */
async function shippedSkillNames(silo: SkillSilo): Promise<string[]> {
  return (await shippedSources(repoRoot, silo))
    .filter((s) => s.bundlePath.startsWith("claude-commands/"))
    .map((s) => s.bundlePath.slice("claude-commands/".length))
    .sort();
}

/** What the repo's OWN dev mirror carries: every non-underscore skill,
 *  repo-only ones included — `/editor:dream` is read from there. */
const mirrorSkillNames = (silo: SkillSilo) => commandMirrorNames(repoRoot, silo);

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
  expectedFor: (ssot: string, name: string) => string,
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
    if (read(built) !== expectedFor(read(ssotAbsFor(name)), name)) stale.push(name);
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
  ...(await Promise.all(
    MIRRORS.map(async ({ dir, silo, paper, loud }): Promise<Row> => ({
      dir,
      subject: "built skill copies",
      consequence: "These are what a run actually reads",
      loud,
      verdict: resolveMirror(
        join(repoRoot, dir),
        paper ? await shippedSkillNames(silo) : await mirrorSkillNames(silo),
        (name) => join(skillsDirFor(silo), name),
        (ssot, name) => (paper ? shippedBytes(skillRepoPath(silo, name), ssot, SHIPPED) : ssot),
      ),
    })),
  )),
  ...(await Promise.all(
    SCRIPT_MIRRORS.map(async ({ dir, silo, loud }): Promise<Row> => ({
      dir,
      subject: "helper scripts",
      consequence: "These are what a skill run actually EXECUTES",
      loud,
      verdict: resolveMirror(
        join(repoRoot, dir),
        await scriptFileNames(repoRoot, silo),
        (name) => join(repoRoot, silo, "scripts", name),
        (ssot) => ssot,
      ),
    })),
  )),
];

describe("skill bundle freshness (SSOT → built copies)", () => {
  it("finds skills to guard", async () => {
    expect((await shippedSkillNames("editor")).length).toBeGreaterThan(0);
    // The canary for the widened population: a virgil silo that resolved to an
    // empty list would make every front-door freshness row pass vacuously.
    expect(await shippedSkillNames("virgil")).toContain("start.md");
    expect((await scriptFileNames(repoRoot, "editor")).length).toBeGreaterThan(0);
    expect((await scriptFileNames(repoRoot, "library")).length).toBeGreaterThan(0);
  });

  it("guards the two populations for what each mirror actually carries", async () => {
    const dev = await mirrorSkillNames("editor");
    const shipped = await shippedSkillNames("editor");
    // The dev mirror carries the maintainer skills; the bundle does not. A
    // single population would red every paper-shaped row (missing) or leave
    // the dev mirror's three unguarded.
    expect(dev).toContain("dream.md");
    expect(shipped).not.toContain("dream.md");
    // …and the bundle carries the `_`-includes the dev mirror never has.
    expect(shipped).toContain("_ask-shape.md");
    expect(dev).not.toContain("_ask-shape.md");
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
