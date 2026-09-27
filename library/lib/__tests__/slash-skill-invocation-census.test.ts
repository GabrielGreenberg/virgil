// @vitest-environment node
//
// Slash-skill invocation census, both silos (task 800).
//
// `skill-script-cli-guardrail.test.ts` checks the flags on every
// `python3 …/<script>.py` line a skill prints. A skill can also tell an agent
// to run ANOTHER SKILL — `/library/index-paper <citekey> --re-extract` — and
// that invocation was checked against nothing. `_doctrine.md` shipped exactly
// that line to every deep-index-family skill while index-paper declared no
// such flag and `index_paper.py`'s argparse rejected it; an agent that
// "helpfully" dropped the flag re-ran the indexer and silently replaced a
// deep-indexed main.tex with a raw extraction.
//
// Two legs, one boundary — a skill markdown may not name a CONTRACT that
// does not exist:
//
//   1. every `--flag` on a `/library/<skill>` or `/editor/<skill>` invocation
//      appears in that skill's own markdown (its Args / Optional flags), and
//      the skill exists;
//   2. every `indexed.<field>` a skill names is a field of `IndexedStatus`
//      (`library/lib/catalog.ts`) — the recipe's "signal" was
//      `indexed.notes`, a field no writer has ever written.
//
// Literal presence, deliberately — the same trade the script census makes and
// states: a target skill whose prose MENTIONS a flag it does not implement
// would immunise the check. The pinned end-to-end half for index-paper is
// `library/scripts/tests/test_re_extract_door.py`, which drives the real
// parser.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SILOS = ["editor", "library"] as const;

function skillMarkdown(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".md")) out.push(p);
    }
  };
  for (const silo of SILOS) walk(path.join(REPO_ROOT, silo, "skills"));
  return out;
}

const rel = (p: string) => path.relative(REPO_ROOT, p);

/**
 * `/library/<name>` or `/editor/<name>` followed by argument tokens. A token
 * is a placeholder (`<citekey>`), a shell variable, a quoted string, an
 * optional group (`[--x]`), or a bare word — the run stops at a backtick,
 * pipe or paren, which is where an inline-code invocation or its prose ends.
 */
const INVOCATION =
  /\/(library|editor)\/([a-z][a-z0-9-]*)((?:[ \t]+(?:<[^>]*>|\$\w+|"[^"]*"|\[[^\]]*\]|[^\s`|()]+))*)/g;
const FLAG = /(?<![\w-])--[a-z][a-z0-9-]*/g;

function targetSkill(silo: string, name: string): string | null {
  for (const c of [
    path.join(REPO_ROOT, silo, "skills", `${name}.md`),
    path.join(REPO_ROOT, silo, "skills", name, "SKILL.md"),
  ]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function indexedStatusFields(): Set<string> {
  const ts = readFileSync(path.join(REPO_ROOT, "library/lib/catalog.ts"), "utf8");
  const m = /export interface IndexedStatus\s*\{([\s\S]*?)\n\}/.exec(ts);
  if (!m) throw new Error("IndexedStatus not found in library/lib/catalog.ts");
  return new Set([...m[1].matchAll(/^\s*(\w+)\??:/gm)].map((x) => x[1]));
}

describe("slash-skill invocation census (task 800)", () => {
  const files = skillMarkdown();

  it("scans a real population", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("every flag on a /<silo>/<skill> invocation is one that skill documents", () => {
    const findings: string[] = [];
    let flagged = 0;
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(INVOCATION)) {
          const flags = (m[3] ?? "").match(FLAG) ?? [];
          if (flags.length === 0) continue;
          flagged++;
          const target = targetSkill(m[1], m[2]);
          if (!target) {
            findings.push(`${rel(file)}:${i + 1} invokes /${m[1]}/${m[2]}, which does not exist`);
            continue;
          }
          const doc = readFileSync(target, "utf8");
          for (const f of flags) {
            if (!doc.includes(f)) {
              findings.push(
                `${rel(file)}:${i + 1} passes ${f} to /${m[1]}/${m[2]}, which ${rel(target)} never declares`,
              );
            }
          }
        }
      });
    }
    // Non-vacuity: the population with flags is real (deep-index --fresh,
    // index-paper --re-extract, …).
    expect(flagged).toBeGreaterThan(3);
    expect(findings).toEqual([]);
  });

  it("every indexed.<field> a skill names is declared on IndexedStatus", () => {
    const declared = indexedStatusFields();
    expect(declared.has("extractor")).toBe(true);
    const findings: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/(?<![\w.])indexed\.([A-Za-z_]\w*)/g)) {
          if (!declared.has(m[1])) {
            findings.push(`${rel(file)}:${i + 1} names indexed.${m[1]}, which IndexedStatus does not declare`);
          }
        }
      });
    }
    expect(findings).toEqual([]);
  });

  it("_doctrine.md's pre-marker signal is the field the indexer writes", () => {
    const doctrine = readFileSync(path.join(REPO_ROOT, "library/skills/_doctrine.md"), "utf8");
    expect(doctrine).toContain("`indexed.extractor`");
    expect(doctrine).not.toContain("indexed.notes");
    const indexer = readFileSync(path.join(REPO_ROOT, "library/scripts/index_paper.py"), "utf8");
    expect(indexer).toMatch(/"extractor":\s*extractor_used/);
  });
});
