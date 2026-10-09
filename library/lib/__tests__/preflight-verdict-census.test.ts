// @vitest-environment node
//
// di-preflight's verdict contract ↔ the orchestrator's stall vocabulary
// (task 2026-10-09-1031).
//
// `/library/di-preflight` promises ONE output: exactly one of `PREFLIGHT_OK`
// / `PREFLIGHT_BLOCKED`, greppable and terminal. Before this guard it had two
// blocking paths and only one of them kept that promise: Step 0.0 (empty
// body) printed `PREFLIGHT_BLOCKED`, while Step 0.2 (the metadata lock)
// printed the ORCHESTRATOR's terminal keyword, `DEEP_INDEX_STALLED`, and no
// verdict at all. `/library/deep-index` Step 0 knew only the empty-body
// block, so a locked paper could read as "no BLOCKED → proceed to §1" — the
// pass the lock exists to forbid — or print the stall twice.
//
// THE CONTRACT: one blocked verdict carrying a reason token,
// `PREFLIGHT_BLOCKED reason=<token>`, where every token is one of the
// STALLED reason tokens `_doctrine.md` §0 lists (the orchestrator copies it
// verbatim into its banner's `Reason:` line). A subskill never prints a
// `DEEP_INDEX_*` keyword itself — it SIGNALS the orchestrator to.
//
// Prose: library/skills/di-preflight.md §Verdict, deep-index.md §Step 0.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SKILLS_DIR = "library/skills";
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const DOCTRINE = `${SKILLS_DIR}/_doctrine.md`;
const DEEP_INDEX = `${SKILLS_DIR}/deep-index.md`;
const PREFLIGHT = `${SKILLS_DIR}/di-preflight.md`;

/** The STALLED reason vocabulary, read out of the doctrine — the SSOT. */
const STALL_TOKENS = (() => {
  const m = read(DOCTRINE)
    .replace(/\s+/g, " ")
    .match(/printed as one of the tokens `([a-z-]+(?: \| [a-z-]+)+)`/);
  if (!m) throw new Error(`${DOCTRINE} no longer lists the STALLED reason tokens`);
  return m[1].split(" | ");
})();

/** Subskills DISCOVERED by their own "Subskill of /" frontmatter claim. */
function subskills(): string[] {
  return readdirSync(join(repoRoot, SKILLS_DIR))
    .filter((f) => f.endsWith(".md"))
    .map((f) => `${SKILLS_DIR}/${f}`)
    .filter((rel) => {
      // The claim lives in the frontmatter, where a description may wrap it
      // across lines — hence `\s+`, and hence frontmatter only (the doctrine
      // QUOTES the phrase in its body without being a subskill).
      const fm = read(rel).match(/^---\n([\s\S]*?)\n---/);
      return !!fm && /Subskill\s+of\s+\/[\w/-]+/.test(fm[1]);
    });
}

describe("preflight verdict: one blocked keyword, one reason vocabulary", () => {
  it("the doctrine's STALLED vocabulary matches deep-index's banner Reason line", () => {
    const banner = read(DEEP_INDEX).match(/Reason: <([a-z-]+(?: \| [a-z-]+)+)>/);
    expect(banner, "deep-index §Output format lost its Reason: line").toBeTruthy();
    expect(banner![1].split(" | ").sort()).toEqual([...STALL_TOKENS].sort());
  });

  it("every PREFLIGHT_BLOCKED emission in di-preflight carries a reason token from that vocabulary", () => {
    const src = read(PREFLIGHT).replace(/\s+/g, " ");
    const emits = [...src.matchAll(/emit `PREFLIGHT_BLOCKED([^`]*)`/gi)];
    expect(emits.length, "di-preflight no longer emits PREFLIGHT_BLOCKED anywhere").toBeGreaterThan(0);
    const tokens = emits.map((m) => {
      const r = m[1].match(/^ reason=([a-z-]+)$/);
      expect(r, `bare or malformed emission: \`PREFLIGHT_BLOCKED${m[1]}\``).toBeTruthy();
      return r![1];
    });
    for (const t of tokens) expect(STALL_TOKENS).toContain(t);
    // Both known producers are wired: the empty body (0.0) and the lock (0.2).
    expect(new Set(tokens)).toEqual(new Set(["extraction-empty-body", "metadata-lock"]));
  });

  it("deep-index's Step 0 handler routes ANY reason token, not one hard-coded block", () => {
    const src = read(DEEP_INDEX).replace(/\s+/g, " ");
    expect(src).toMatch(/If di-preflight reports `PREFLIGHT_BLOCKED reason=<token>`/);
    expect(src).toMatch(/`Reason: <token>` copied verbatim/);
  });

  it("no subskill prints the orchestrator's DEEP_INDEX_* keyword itself", () => {
    const subs = subskills();
    expect(subs).toContain(PREFLIGHT);
    const offenders: string[] = [];
    for (const rel of subs) {
      const src = read(rel).replace(/\s+/g, " ");
      const hasVerdict = /^## Verdict/m.test(read(rel));
      for (const m of src.matchAll(/`DEEP_INDEX_[A-Z_]+`/g)) {
        const before = src.slice(Math.max(0, m.index! - 40), m.index!);
        // A subskill with its own verdict contract names no concrete
        // orchestrator keyword at all; any other subskill may only ask the
        // orchestrator to emit one.
        if (hasVerdict || !/orchestrator to emit $/.test(before)) {
          offenders.push(`${rel}: …${before}${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
