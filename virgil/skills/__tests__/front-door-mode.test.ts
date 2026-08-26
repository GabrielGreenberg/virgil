// @vitest-environment node
//
// The FRONT DOOR's library MODE — one contract, driven at both ends.
//
// `start.md` Step 1 decides the whole session's operating mode, and until task
// 475 it decided it from a two-column table whose columns shared ONE CAUSE:
//
//     | library_path resolves? | library root has `.claude/commands/library/`? |
//
// Column 1 implies column 2 by construction. `library_path.py` accepts a root
// only if `_looks_like_library` passes, which requires `.virgil/scripts/`; that
// directory is written by `syncSkillBundle` — one unfiltered loop over the
// meta-manifest's sources that writes `.claude/commands/<silo>/` and
// `.virgil/scripts/<silo>/` in the same pass, from the same `library`
// sub-manifest (measured on the shipped bundle: 130 files, both prefixes
// present). So a library root that RESOLVES has always been synced and has
// always had the directory. The middle row — `light-ops` — was unreachable,
// which made the whole of Step 4 dead: the mount-or-queue prompt never
// appeared, the queue affordance that feeds `/loop /library/index-pending` was
// unreachable, and `start.md`'s own declared invariant ("does not silently run
// heavy library operations … always surface the mount-or-queue choice") was
// false of the shipped file.
//
// The justification was false in BOTH directions besides. The directory's
// presence is caused by the Virgil PWA opening a folder, not by Claude Code
// mounting one — and the identical sync writes it into every PAPER folder too,
// so it says nothing about mounting anywhere.
//
// The fix asks a question that is causally what it claims: `resolve_mode` in
// `editor/scripts/library_path.py` answers "is a library configured, and is
// THIS SESSION IN IT" — the second half being the exact condition every heavy
// library skill declares about itself ("must run from inside the library
// folder"). Three modes, all reachable.
//
// THE LEGS WITH TEETH ARE THE CROSS-LAYER ONES. The resolver was never the
// part that could misbehave, and neither was the prose: what fails silently is
// the two DRIFTING — a mode the prompt names that the resolver cannot emit is
// a branch that never fires (the pre-475 defect exactly), and a mode the
// resolver emits that the prompt does not name is a state with no behaviour.
// So the vocabulary is MEASURED by driving the real script in all three
// states, and `start.md` is held to that measured set rather than to a list
// typed here.
//
// There is deliberately NO allowlist. A mode the prompt cannot reach is
// FIX-it, never list-it.

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

// virgil/skills/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LIBRARY_PATH_PY = join(repoRoot, "editor", "scripts", "library_path.py");
const START_MD = join(repoRoot, "virgil", "skills", "start.md");

const start = () => readFileSync(START_MD, "utf8");
/** Hard-wrapped prose re-wraps freely — every PHRASE assertion runs against a
 *  whitespace-collapsed copy, for the reason `front-door-doctrine` gives. */
const startFlat = () => start().replace(/\s+/g, " ");

/** Step 1, whole — the section where the mode is decided. */
function stepOne(): string {
  const body = start();
  const at = body.indexOf("### Step 1");
  expect(at, "start.md has no Step 1").toBeGreaterThan(-1);
  const end = body.indexOf("### Step 2", at);
  return body.slice(at, end === -1 ? undefined : end);
}

let box: string;
/** A directory that LOOKS like a library to `_looks_like_library`. */
let lib: string;
/** A paper-shaped folder OUTSIDE the library. */
let paper: string;
/** An empty HOME, so the `~/Virgil-Library` fallback rung finds nothing.
 *  Without this the "no library" case silently resolves the developer's OWN
 *  library and the leg passes for the wrong reason. */
let home: string;

/** Run `library_path.py --mode` from `cwd`, with the resolution chain pinned
 *  by env so the run cannot pick up the developer's real library. */
function mode(cwd: string, opts: { libraryRoot?: string } = {}): string[] {
  // A DELIBERATELY MINIMAL env, not a spread of `process.env`: the resolution
  // chain reads `VIRGIL_LIBRARY_ROOT`, `$HOME/.config/virgil/library-path.json`
  // and `$HOME/Virgil-Library`, so an inherited value would resolve the
  // developer's own library and the no-library leg would pass for the wrong
  // reason. (`NODE_ENV` only satisfies this repo's augmented `ProcessEnv`.)
  const env = {
    NODE_ENV: process.env.NODE_ENV ?? "test",
    PATH: process.env.PATH ?? "",
    HOME: home,
    VIRGIL_LIBRARY_ROOT: opts.libraryRoot ?? "",
  } as NodeJS.ProcessEnv;
  const out = execFileSync("python3", [LIBRARY_PATH_PY, "--mode"], {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.trimEnd().split("\n");
}

beforeAll(() => {
  // realpath: macOS hands out `/var/…` for a `/private/var/…` tmpdir, and
  // `resolve_mode` compares RESOLVED paths — so an unresolved fixture path
  // would make the assertions fail for a reason that has nothing to do with
  // the rule they guard.
  box = realpathSync(mkdtempSync(join(tmpdir(), "virgil-mode-")));
  lib = join(box, "Virgil-Library");
  paper = join(box, "some-paper");
  home = join(box, "home");
  mkdirSync(join(lib, ".virgil", "scripts"), { recursive: true });
  mkdirSync(join(lib, "papers", "smith2020"), { recursive: true });
  mkdirSync(join(paper, "virgil"), { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(lib, "master.bib"), "");
  writeFileSync(join(lib, ".virgil", "catalog.json"), "{}");
});

afterAll(() => {
  rmSync(box, { recursive: true, force: true });
});

describe("library_path.py --mode: the three states, measured", () => {
  it("no library in the chain → no-library, exit 0, no path line", () => {
    // Exit 0 matters on its own. `--get` exits 2 when nothing resolves, which
    // forces the front door to read a legitimate STATE through an error path;
    // a mode is an answer, and "not set up" is one of the three.
    expect(mode(paper)).toEqual(["no-library"]);
  });

  it("cwd IS the library root → in-library", () => {
    expect(mode(lib, { libraryRoot: lib })).toEqual(["in-library", lib]);
  });

  it("cwd is UNDER the library root → in-library", () => {
    // The library session's cwd is not always the root: `/library/*` skills
    // work inside `papers/<citekey>/`. Treating that as a paper session would
    // put the mount-or-queue prompt in front of the one session that has
    // nothing to mount.
    expect(mode(join(lib, "papers", "smith2020"), { libraryRoot: lib })).toEqual([
      "in-library",
      lib,
    ]);
  });

  it("a library resolves but cwd is elsewhere → paper-session", () => {
    expect(mode(paper, { libraryRoot: lib })).toEqual(["paper-session", lib]);
  });

  it("the middle mode is REACHABLE — which is the whole defect", () => {
    // The pre-475 question was "does the library ROOT hold
    // `.claude/commands/library/`?", and a resolvable root always does. This
    // leg is the one that fails on the retired heuristic: the fixture library
    // has NO `.claude/` at all and the answer still turns on cwd, which is
    // the fact the mode is actually about.
    const modes = new Set([
      mode(paper)[0],
      mode(lib, { libraryRoot: lib })[0],
      mode(paper, { libraryRoot: lib })[0],
    ]);
    expect([...modes].sort()).toEqual(["in-library", "no-library", "paper-session"]);
  });
});

describe("start.md and the resolver agree about the vocabulary", () => {
  /** The modes the shipped script can actually emit, measured. */
  const emitted = () =>
    [
      mode(paper)[0],
      mode(lib, { libraryRoot: lib })[0],
      mode(paper, { libraryRoot: lib })[0],
    ].sort();

  it("start.md runs --mode, not --get, for the mode question", () => {
    // `--get` cannot answer this: it prints a path and exits 2 when there is
    // none, so a front door built on it has to infer the mode from an error.
    // Asserted over the Step 1 SLICE and by the two things that matter (the
    // script and the flag) rather than by one placeholder spelling, so
    // dropping the `<…>` brackets does not fail the leg for a reason
    // unrelated to the rule it guards.
    const s1 = stepOne().replace(/\s+/g, " ");
    expect(
      s1.includes("library_path.py") && s1.includes("--mode"),
      "start.md's Step 1 does not run `library_path.py --mode`, the one door " +
        "that answers the mode question.",
    ).toBe(true);
  });

  it("names every mode the resolver can emit, IN THE MODE TABLE", () => {
    // Scoped to the table rather than the whole file, and the scoping is the
    // leg. Measured: a bare whole-file `includes` is satisfied by the Step 3
    // onboarding template and the Step 4 branch labels, so deleting the ENTIRE
    // Step 1 mode table — the only place that says what each mode MEANS and
    // which library skills it permits — leaves every leg green. The table is
    // the operative statement; a mode with no row is a state with no rule.
    const rows = new Set(
      [...stepOne().matchAll(/^\s*\|\s*\*\*([a-z][a-z-]*)\*\*\s*\|/gm)].map((m) => m[1]),
    );
    expect(rows.size, "start.md's Step 1 has no mode table").toBeGreaterThan(0);
    const missing = emitted().filter((m) => !rows.has(m));
    expect(
      missing,
      `start.md's Step 1 mode table has no row for ${missing.join(", ")} — a ` +
        `state the resolver can return and the prompt states no rule for.`,
    ).toEqual([]);
  });

  it("names no mode the resolver cannot emit", () => {
    // The pre-475 file named `full-ops` and `light-ops`; one of them was
    // unreachable and NOTHING said so. A mode word in the prompt that the
    // resolver cannot produce is a dead branch by definition.
    const known = new Set(emitted());
    // BOTH spellings, and that is the leg. `start.md` states its mode words
    // two ways — **bold** in the table and the onboarding line, `backticked`
    // at every OPERATIVE gate (Step 1's routing rung, Step 2 rule 2, Step 4's
    // trigger, the Queue scope, the skip-Step-4 line). Measured on a scratch
    // copy: with a bold-only extractor, rewriting Step 2 rule 2 to
    // "when the mode is not `full-ops`" — a dead gate, i.e. the pre-475 defect
    // verbatim — passed 15/15. The delimiter must wrap the WHOLE token, so a
    // longer backticked span like `.claude/commands/library/` cannot match.
    const named = new Set(
      [...start().matchAll(/(?:\*\*|`)([a-z]+(?:-[a-z]+)+)(?:\*\*|`)/g)]
        .map((m) => m[1])
        .filter((n) => /-(?:ops|library|session)$/.test(n)),
    );
    // Canary: an extractor that matched nothing would make this pass vacuously.
    expect(named.size, "start.md bolds no mode name at all").toBeGreaterThan(0);
    const phantom = [...named].filter((m) => !known.has(m));
    expect(
      phantom,
      `start.md names mode(s) ${phantom.join(", ")} that ` +
        `library_path.py --mode cannot return.`,
    ).toEqual([]);
  });

  it("every named mode is REACHABLE through Step 1's own procedure", () => {
    // Naming a mode is not the same as being able to be in it, and this is
    // the defect one remove out. `in-library` means cwd IS the library root,
    // and a library root has no `virgil/` subdir — which is exactly what
    // Step 1's doc-context rung looked for before hard-stopping. A mode the
    // procedure stops before reaching is the pre-475 dead branch wearing a
    // new name, so Step 1 must say what it does when there is no paper.
    const body = start();
    const at = body.indexOf("### Step 1");
    expect(at, "start.md has no Step 1").toBeGreaterThan(-1);
    const docRung = body.slice(at, body.indexOf("\n2. ", at)).replace(/\s+/g, " ");
    expect(
      docRung.includes("in-library"),
      `Step 1's doc-context rung does not say what happens in the ` +
        `\`in-library\` mode, whose cwd is the library root and therefore has ` +
        `no \`virgil/\` subdir to find. Stopping there makes the mode ` +
        `unreachable:\n\n${docRung}`,
    ).toBe(true);
    expect(
      !/\bStop if no doc context can be resolved\b/.test(docRung),
      `Step 1's doc-context rung still stops unconditionally before the mode ` +
        `is known, so the mode cannot decide whether a paper folder is ` +
        `required — and \`in-library\` is exactly the mode that has none.`,
    ).toBe(true);
  });

  it("does not reintroduce the retired `.claude/commands/library/` probe", () => {
    // SCOPED BY PARAGRAPH, not by phrase. `start.md` legitimately explains
    // why that directory means nothing, so a bare name grep would indict the
    // fix — but a list of exact phrasings only ever catches the wording that
    // happened to ship. Measured: against three literals, inserting
    // "Then look at the library root for a `.claude/commands/library/`
    // directory: if it is there the library is mounted here and every library
    // skill runs inline." into Step 1 passed 15/15.
    //
    // The mode is decided in Step 1 and nowhere else, so the rule is simply
    // that the directory may not be MENTIONED there outside the paragraph
    // that retires it. Brittle in one stated direction: rewording that
    // paragraph's opening fails LOUDLY (a false red), never vacuously.
    const RETIREMENT = "Do **not** reintroduce";
    const offenders = stepOne()
      .split(/\n\s*\n/)
      .filter((para) => para.includes(".claude/commands") && !para.includes(RETIREMENT));
    expect(
      offenders.map((p) => p.replace(/\s+/g, " ").slice(0, 120)),
      `start.md's Step 1 — where the mode is decided — mentions ` +
        `\`.claude/commands\` outside the paragraph that retires it. That ` +
        `directory is written by the PWA's per-folder sync into EVERY managed ` +
        `folder, in the same unfiltered pass that writes \`.virgil/scripts/\` ` +
        `— the thing library_path.py already requires. The two questions ` +
        `share one cause, which is what made the middle mode unreachable.`,
    ).toEqual([]);
  });
});

describe("Step 4 is reachable, and its Queue branch states the entry", () => {
  /** Step 4, whole. */
  function stepFour(): string {
    const body = start();
    const at = body.indexOf("### Step 4");
    expect(at, "start.md has no Step 4").toBeGreaterThan(-1);
    const end = body.indexOf("\n## ", at);
    return body.slice(at, end === -1 ? undefined : end);
  }

  /** Step 4's TRIGGER CONDITION — the first paragraph AFTER the heading.
   *  Scoped to the condition rather than the section: the Queue branch below
   *  legitimately names modes and skills of its own. */
  function stepFourTrigger(): string {
    const s4 = stepFour();
    const bodyStart = s4.indexOf("\n\n") + 2;
    const rel = s4.slice(bodyStart).indexOf("\n\n");
    return s4.slice(bodyStart, rel === -1 ? undefined : bodyStart + rel);
  }

  it("its trigger names a mode the resolver can emit", () => {
    // The gate reads "the mode is not X". If X is a mode nothing returns, the
    // gate is always true or always false and the branch is dead either way —
    // which is what `not full-ops` was.
    const trigger = stepFourTrigger();
    const named = [
      ...trigger.matchAll(/`(no-library|in-library|paper-session)`/g),
    ].map((m) => m[1]);
    expect(
      named.length,
      `Step 4's trigger condition names no mode at all:\n\n${trigger}`,
    ).toBeGreaterThan(0);
    const emitted = new Set([
      mode(paper)[0],
      mode(lib, { libraryRoot: lib })[0],
      mode(paper, { libraryRoot: lib })[0],
    ]);
    for (const m of named) expect(emitted.has(m), `${m} is not an emitted mode`).toBe(true);
  });

  it("the trigger's phrase criterion covers the CASINGS actually shipped", () => {
    // The gate is a phrase a skill writes about itself, and the skills do not
    // agree on its casing: five say `Heavy operation` and `deep-index` — the
    // one skill this Step's whole Queue branch exists for — says `HEAVY
    // operation`. `front-door-doctrine`'s derivation has always been
    // case-insensitive; the PROMPT stated one literal, so a model reading it
    // strictly would drop the one op that matters to the light default and
    // dispatch it inline from a paper session. The leg fires only when the
    // shipped casings genuinely differ, so it is a measurement rather than a
    // wording pin: normalise the skills and it stops asking.
    const dir = join(repoRoot, "library", "skills");
    const casings = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md") || f.startsWith("_")) continue;
      const fm = readFileSync(join(dir, f), "utf8").match(/^---\n([\s\S]*?)\n---/);
      if (!fm) continue;
      for (const m of fm[1].replace(/\s+/g, " ").matchAll(/(\w+ operation)/gi)) {
        if (/^heavy operation$/i.test(m[1])) casings.add(m[1]);
      }
    }
    // Canary: a derivation that found nothing would make this pass vacuously.
    expect(casings.size, "no library skill declares a heavy operation").toBeGreaterThan(0);
    if (casings.size === 1) return;
    const trigger = stepFourTrigger();
    expect(
      /capitalisation|capitalization|case/i.test(trigger),
      `library skills declare the heavy phrase in ${casings.size} casings ` +
        `(${[...casings].join(", ")}) and Step 4's trigger states one literal ` +
        `with no note that casing does not matter:\n\n${trigger}`,
    ).toBe(true);
  });

  it("the Queue branch states `status: \"requested\"`", () => {
    // The member this task could not ship without. `queue-state-store.ts`
    // skips any entry whose status is not "requested" (no queued badge), and
    // `cancelDeepIndex` requires the same value (the user cannot cancel) —
    // while `drain_queue.py` defers on `kind` alone, so the request still
    // RUNS. Invisible and unstoppable is the worst of both.
    const s4 = stepFour();
    expect(
      /"status"\s*:\s*"requested"/.test(s4),
      `Step 4's Queue branch tells the model to write a queue entry without ` +
        `stating status: "requested". Un-deadening the branch without the ` +
        `shape turns a dead write into a broken one.`,
    ).toBe(true);
  });

  it("the Queue branch states every REQUIRED field of QueueEntry", () => {
    // Derived from the TypeScript SSOT rather than restated: `queue.ts`'s
    // `QueueEntry` marks optional members with `?`, so the required set is
    // whatever is left. A field added there without a note here is a queue
    // entry the front door writes incomplete.
    const iface = readFileSync(join(repoRoot, "library/lib/queue.ts"), "utf8")
      .match(/export interface QueueEntry \{([\s\S]*?)\n\}/);
    expect(iface, "library/lib/queue.ts has no QueueEntry interface").not.toBeNull();
    const required = [...iface![1].matchAll(/^\s{2}([A-Za-z]+)(\??):/gm)]
      .filter((m) => m[2] !== "?")
      .map((m) => m[1]);
    expect(required.sort()).toEqual(["attempts", "kind", "requestedAt", "status"]);
    const s4 = stepFour();
    const missing = required.filter((f) => !new RegExp(`"${f}"\\s*:`).test(s4));
    expect(
      missing,
      `Step 4's Queue branch omits required QueueEntry field(s): ` +
        `${missing.join(", ")}. The shape is library/lib/queue.ts.`,
    ).toEqual([]);
    // `citekey` is optional on the interface (triage entries have none) and
    // REQUIRED for this filename — `queueFilename` throws without it.
    expect(/"citekey"\s*:/.test(s4), "Step 4 omits citekey").toBe(true);
  });

  it("the Queue branch cites the schema SSOT by path", () => {
    expect(
      stepFour().includes("library/lib/queue.ts"),
      `Step 4 states a JSON shape without naming where it is defined. A ` +
        `shape stated with no SSOT to check it against is the next drift.`,
    ).toBe(true);
  });

  it("the declared invariant is true of the shipped file", () => {
    // `start.md` declares in "What this skill does NOT do" that it always
    // surfaces the mount-or-queue choice. Pre-475 that was false — the branch
    // was unreachable. The claim must now name the mode gate that makes it
    // true, so the sentence and the gate move together.
    const flat = startFlat();
    const claim = flat.match(/Does \*\*not\*\* silently run[^.]*\.[^.]*\.[^.]*\./);
    expect(claim, "start.md no longer declares the heavy-op invariant").not.toBeNull();
    expect(
      /in-library/.test(claim![0]),
      `start.md's heavy-op invariant does not name the mode that gates it, ` +
        `so nothing ties the claim to Step 4:\n\n${claim![0]}`,
    ).toBe(true);
  });
});
