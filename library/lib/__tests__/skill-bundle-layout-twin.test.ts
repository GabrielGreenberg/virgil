/**
 * CENSUS — the skill-mirror layout's two spellings agree (task 1309).
 *
 * `library/lib/skill-bundle-layout.mjs` (`diskPathFor`) is the ONE spelling of
 * "a bundle file goes HERE on disk" for every JS writer. The terminal sync
 * `editor/scripts/sync_skills.py` is an import-free Python bootstrap that may
 * be replacing its own files mid-run, so it keeps a COPY (`disk_path_for`).
 * Until task 1309 that copy was pinned only against its own hand-written
 * fixtures — a rule added to the leaf (task 374's own scenario) diverged the
 * terminal sync from the app sync silently — and it alone had no path
 * containment, so a `..` in a manifest or STAMP entry wrote/deleted outside
 * the paper folder.
 *
 * Three legs:
 *   1. VOCABULARY — the match literals each side tests a bundle path against
 *      (`startsWith`/`===` vs `startswith`/`==`) are the same set, and every
 *      one of them is exercised by a case below. A new rule on one side only
 *      goes red here even before a case is written for it.
 *   2. CASES — a shared case list (every rule, the unrecognized shape, and the
 *      containment rejections) resolves identically on both sides.
 *   3. REAL SHAPES — every file the bundle actually ships
 *      (`shippedSources`) resolves identically on both sides.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { diskPathFor } from "../skill-bundle-layout.mjs";
import { SUBSYSTEMS, shippedSources } from "../../build/bundle-sources.mjs";

const ROOT = resolve(__dirname, "../../..");
const MJS = join(ROOT, "library/lib/skill-bundle-layout.mjs");
const PY_DIR = join(ROOT, "editor/scripts");

type Case = [subsystem: string, bundlePath: string];

const CASES: Case[] = [
  // every rule
  ["library", "CLAUDE.md"],
  ["editor", "CLAUDE.md"],
  ["manifest", "INDEX.md"],
  ["manifest", "sub/dir/file.md"],
  ["library", "claude-commands/deep-index.md"],
  ["editor", "claude-commands/_ask-shape.md"],
  ["virgil", "claude-commands/start.md"],
  ["editor", "scripts/apply_response.py"],
  ["library", "scripts/lib/nested.py"],
  // unrecognized shape
  ["editor", "unrecognized/odd.bin"],
  ["editor", "claude-commandsX/a.md"],
  // containment rejections
  ["editor", "scripts/"],
  ["editor", "claude-commands/"],
  ["editor", "scripts/../x"],
  ["editor", "scripts/../../../../evil.py"],
  ["editor", "claude-commands/../x.md"],
  ["editor", "scripts//x"],
  ["editor", "scripts/./x"],
  ["editor", "scripts/a\\b"],
  ["editor", "scripts/a\u0000b"],
  ["manifest", ""],
  ["manifest", "../x"],
  ["manifest", "/etc/passwd"],
  ["..", "scripts/x"],
  ["a/b", "scripts/x"],
  ["", "scripts/x"],
];

function pyResolve(cases: Case[]): (string | null)[] {
  const prog = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(PY_DIR)})`,
    "import sync_skills",
    "cases = json.load(sys.stdin)",
    "print(json.dumps([sync_skills.disk_path_for(s, b) for s, b in cases]))",
  ].join("\n");
  const out = execFileSync("python3", ["-I", "-c", prog], {
    input: JSON.stringify(cases),
    encoding: "utf8",
  });
  return JSON.parse(out) as (string | null)[];
}

const jsResolve = (cases: Case[]) => cases.map(([s, b]) => diskPathFor(s, b) ?? null);

function functionBody(src: string, header: RegExp, end: RegExp): string {
  const start = src.search(header);
  expect(start, `function header ${header} not found`).toBeGreaterThanOrEqual(0);
  const rest = src.slice(start);
  const stop = rest.slice(1).search(end);
  return stop < 0 ? rest : rest.slice(0, stop + 1);
}

function literals(body: string, re: RegExp): Set<string> {
  return new Set([...body.matchAll(re)].map((m) => m[1]));
}

describe("skill-bundle layout twin (mjs ↔ sync_skills.py)", () => {
  it("both sides test bundle paths against the same match vocabulary, and every match is cased", () => {
    const js = functionBody(
      readFileSync(MJS, "utf8"),
      /export function diskPathFor\(/,
      /\n(?:export )?function |\n\/\*\*/,
    );
    const py = functionBody(
      readFileSync(join(PY_DIR, "sync_skills.py"), "utf8"),
      /def disk_path_for\(/,
      /\n(?:def |class )/,
    );
    const jsVocab = literals(js, /(?:startsWith\(|===\s*)"([^"]*)"/g);
    const pyVocab = literals(py, /(?:startswith\(|==\s*)"([^"]*)"/g);
    expect(jsVocab.size).toBeGreaterThan(0);
    expect([...pyVocab].sort()).toEqual([...jsVocab].sort());
    for (const lit of jsVocab) {
      expect(
        CASES.some(([s, b]) => s === lit || b === lit || b.startsWith(lit)),
        `match literal "${lit}" has no case in CASES — add one`,
      ).toBe(true);
    }
  });

  it("every shared case resolves identically on both sides", () => {
    expect(pyResolve(CASES)).toEqual(jsResolve(CASES));
  });

  it("containment: no case resolves outside .claude/ or .virgil/scripts/", () => {
    for (const out of jsResolve(CASES)) {
      if (out === null) continue;
      expect(out.split("/")).not.toContain("..");
      expect(out.startsWith(".claude/") || out.startsWith(".virgil/scripts/")).toBe(true);
    }
  });

  it("every file the bundle actually ships resolves identically on both sides", async () => {
    const real: Case[] = [];
    for (const subsystem of SUBSYSTEMS) {
      for (const { bundlePath } of await shippedSources(ROOT, subsystem)) {
        real.push([subsystem, bundlePath]);
      }
    }
    expect(real.length).toBeGreaterThan(20);
    const js = jsResolve(real);
    expect(js.every((p) => p !== null)).toBe(true);
    expect(pyResolve(real)).toEqual(js);
  });
});
