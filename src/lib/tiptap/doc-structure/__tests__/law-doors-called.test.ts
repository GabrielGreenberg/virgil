/**
 * Law-door honesty census (task 924).
 *
 * The keystroke-sanctity law tells every session which doors to consume the
 * structural diff through — once in the always-loaded `AGENTS.md` index line
 * ("Consume the diff. Don't walk the doc.") and once in the law's own bullet
 * list (`docs/agents/laws/keystroke-sanctity.md`). Until task 924 two of the
 * three React doors it named (`useDocStructure`, `useDocStructureEvent`) had
 * ZERO production callers: the doctrine pointed agents at doors nobody used,
 * which is how parallel consumption styles grow.
 *
 * Law "A registry earns its name by being read": a door is alive only if
 * something CALLS it. So every identifier those two passages cite must have at
 * least one production call site OUTSIDE the doc-structure module itself (a
 * re-export, a definition or a comment is not a caller).
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..", "..");
const MODULE_DIR = join("src", "lib", "tiptap", "doc-structure");

function lawPassages(): string[] {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const indexLine = agents
    .split("\n")
    .find((l) => l.startsWith("**Consume the diff. Don't walk the doc.**"));
  const law = readFileSync(join(ROOT, "docs/agents/laws/keystroke-sanctity.md"), "utf8");
  const start = law.indexOf("**Consume the diff. Don't walk the doc.**");
  const end = law.indexOf("### Permitted", start);
  return [indexLine ?? "", start >= 0 && end > start ? law.slice(start, end) : ""];
}

/** Backticked identifiers that read as callable doors (`name(…)` or `useX`/`getX`/`readX`). */
function citedDoors(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([A-Za-z_]\w*)(?:\([^`]*\))?`/g)) {
    const name = m[1];
    if (/^(use|get|read)[A-Z]/.test(name)) out.add(name);
  }
  return [...out].sort();
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) acc.push(full);
  }
  return acc;
}

const PROD_FILES = ["src", "library"]
  .flatMap((d) => sourceFiles(join(ROOT, d)))
  .filter((f) => !relative(ROOT, f).startsWith(MODULE_DIR + sep));

const STRIPPED = new Map<string, string>();
function stripped(file: string): string {
  let s = STRIPPED.get(file);
  if (s === undefined) {
    s = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    STRIPPED.set(file, s);
  }
  return s;
}

function callers(name: string): string[] {
  const call = new RegExp(`(?<!function\\s)\\b${name}\\s*\\(`);
  return PROD_FILES.filter((f) => call.test(stripped(f))).map((f) => relative(ROOT, f));
}

describe("keystroke-sanctity law names only doors that are called", () => {
  const passages = lawPassages();

  it("finds both law passages (the census is not vacuous)", () => {
    expect(passages[0]).not.toBe("");
    expect(passages[1]).not.toBe("");
    expect(citedDoors(passages.join("\n"))).toEqual(
      expect.arrayContaining(["getBus", "readPendingDiff", "useDocStructureBus"]),
    );
  });

  for (const door of citedDoors(passages.join("\n"))) {
    it(`\`${door}\` has a production caller outside the doc-structure module`, () => {
      expect(callers(door), `${door} is cited by the law but nothing calls it`).not.toEqual([]);
    });
  }

  it("the matcher rejects a door with no callers (the retired useDocStructureEvent)", () => {
    expect(callers("useDocStructureEvent")).toEqual([]);
  });
});
