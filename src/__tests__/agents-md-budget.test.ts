import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, trackedFiles } from "../lib/__tests__/_source-scan";

/**
 * ALWAYS-LOADED CONTEXT BUDGET (task 2026-09-15-588).
 *
 * `CLAUDE.md` is `@AGENTS.md`, and Claude Code loads it into EVERY session —
 * every worker, auditor, catcher, release run and non-Explore subagent. The
 * file's own header promised it was a lean index with doctrine loaded on
 * demand; an emergent convention (each task appending its "The X half" note)
 * grew it from 12 KB to 1.24 MB in three months. Every session then started at
 * ~530k tokens, and a worker whose Read of a worktree file nested-loaded a
 * SECOND copy hit the 1M window and died in "Autocompact is thrashing".
 *
 * A convention with no guard is how it got there, so the budget is pinned:
 *   1. `AGENTS.md` stays under the budget (Claude Code's own large-file line).
 *   2. Every tracked `CLAUDE.md`, WITH everything it `@`-imports, does too —
 *      a nested CLAUDE.md is loaded whenever a session reads under its folder.
 *   3. The Laws index and `docs/agents/laws/` agree both ways: an indexed doc
 *      exists, and every law doc is indexed (a doc nobody can find is lost
 *      doctrine; an index entry with no doc is a dead pointer).
 * Doctrine goes in its law's doc. AGENTS.md changes only to index a new law.
 */

const BUDGET_BYTES = 40_000;
const LAWS_DIR = "docs/agents/laws";

function bytes(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/** A memory file plus every `@path` import it pulls in, transitively. */
export function loadedBytes(rel: string, readRel: (r: string) => string | null, seen = new Set<string>()): number {
  const norm = path.normalize(rel);
  if (seen.has(norm)) return 0;
  seen.add(norm);
  const text = readRel(norm);
  if (text === null) return 0;
  let total = bytes(text);
  for (const m of text.matchAll(/^@(\S+)\s*$/gm)) {
    total += loadedBytes(path.join(path.dirname(norm), m[1]), readRel, seen);
  }
  return total;
}

/** `trackedFiles` answers absolute paths; this census speaks repo-relative. */
function tracked(root: string, ext: RegExp): string[] {
  return trackedFiles(root, ext).map((p) => path.relative(REPO_ROOT, p));
}

function readRel(rel: string): string | null {
  const abs = path.join(REPO_ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, "utf8") : null;
}

/** `[docs/agents/laws/x.md](...)` targets named in the Laws index. */
export function indexedLawDocs(agents: string): string[] {
  const laws = agents.split(/^## /m).find((s) => s.startsWith("Laws"));
  if (!laws) return [];
  return [...new Set([...laws.matchAll(/\]\((docs\/agents\/laws\/[^)\s]+\.md)\)/g)].map((m) => m[1]))].sort();
}

describe("always-loaded context budget", () => {
  it("AGENTS.md is under budget", () => {
    const size = bytes(readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8"));
    expect(
      size,
      `AGENTS.md is ${size} bytes (budget ${BUDGET_BYTES}). It is loaded into every session — ` +
        `move doctrine into its law's file under ${LAWS_DIR}/ and keep only the index entry here.`,
    ).toBeLessThanOrEqual(BUDGET_BYTES);
  });

  it("the budget has teeth: a 50 KB section appended would fail it", () => {
    const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    const grown = `${agents}\n## Some new half\n\n${"doctrine ".repeat(6_000)}`;
    const size = loadedBytes("CLAUDE.md", (r) => (path.normalize(r) === "AGENTS.md" ? grown : readRel(r)));
    expect(size).toBeGreaterThan(BUDGET_BYTES);
  });

  it("every tracked CLAUDE.md, with its @imports, is under budget", () => {
    const files = tracked(".", /^CLAUDE\.md$/);
    expect(files).toContain("CLAUDE.md");
    const over = files
      .map((f) => [f, loadedBytes(f, readRel)] as const)
      .filter(([, n]) => n > BUDGET_BYTES)
      .map(([f, n]) => `${f}: ${n} bytes loaded`);
    expect(over, "a CLAUDE.md is nested-loaded when a session reads under its folder — point, don't copy").toEqual([]);
  });

  it("the Laws index and docs/agents/laws agree both ways", () => {
    const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    const indexed = indexedLawDocs(agents);
    const onDisk = tracked(LAWS_DIR, /\.md$/);
    expect(indexed.length, "AGENTS.md lost its '## Laws' index").toBeGreaterThan(0);
    expect(indexed.filter((d) => !existsSync(path.join(REPO_ROOT, d))), "indexed law doc does not exist").toEqual([]);
    expect(onDisk.filter((d) => !indexed.includes(d)), "law doc not indexed in AGENTS.md").toEqual([]);
  });

  it("each law doc is titled as its index entry and carries the doc header", () => {
    const agents = readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8");
    const headings = new Set([...agents.matchAll(/^### (.+)$/gm)].map((m) => m[1].trim()));
    const bad: string[] = [];
    for (const d of tracked(LAWS_DIR, /\.md$/)) {
      const text = readFileSync(path.join(REPO_ROOT, d), "utf8");
      const title = text.match(/^# (.+)$/m)?.[1].trim();
      if (!title || !headings.has(title)) bad.push(`${d}: title ${JSON.stringify(title)} has no '### ' index entry`);
      if (!/^<!-- last-verified: /.test(text) || !/<!-- derives-from: /.test(text)) bad.push(`${d}: missing header`);
    }
    expect(bad).toEqual([]);
  });

  it("the synthetic loader follows @imports (canary)", () => {
    const files: Record<string, string> = { "CLAUDE.md": "@a.md\n", "a.md": "x".repeat(10) + "\n@b/c.md\n", "b/c.md": "yy" };
    expect(loadedBytes("CLAUDE.md", (r) => files[r] ?? null)).toBe(6 + 19 + 2);
  });
});
