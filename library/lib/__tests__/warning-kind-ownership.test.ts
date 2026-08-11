/**
 * Warning-kind ownership guardrail (task 323).
 *
 * `indexed.warnings` carries eight recomputed-per-pass kinds, and after this
 * task they have TWO owners rather than one: `/library/clean-bibliography`
 * persists its three at source (because `synthesize_canonical_entries.py`,
 * later in that same subskill, gates entirely on reading `missing-bib-entry:`
 * back out of the catalog — a write deferred to `deep-index.md` step 5, which
 * runs after the whole §3 dispatch, made synthesis a guaranteed no-op on every
 * first pass), while step 5 keeps the five whose kinds have no same-run
 * consumer.
 *
 * A split ownership has exactly one new failure mode, and it is silent in both
 * directions: **a kind declared by two owners**. `--recompute-warning-kind`
 * drops the declared kind's lines against the row's live array, so the later
 * writer erases what the earlier one just persisted — the whole-array clobber
 * this mechanism exists to prevent, arriving one level in. And a kind declared
 * by NO owner stops converging: a finding resolved since the last pass stays
 * flagged forever.
 *
 * So the census reads the DISPATCH FORM, not the prose: the flags an agent
 * actually runs. That is the same rule task 163 earned — a mention is not a
 * dispatch, and a partial inline copy of an ownership list is worse than no
 * copy, because it looks like coverage.
 *
 * Honest limits. (1) The agreement leg below asks only that both prose
 * SSOTs NAME all eight kinds; only a reader can tell whether a sentence
 * assigns them correctly. It catches the realistic accident — a kind added to
 * one list and forgotten in the other — not a well-formed lie. (2) Kinds
 * outside the eight (`metadata-mismatch`, di-preflight's) are deliberately
 * unconstrained here; they have one producer each and no cross-skill split.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SKILLS = path.join(REPO_ROOT, "library/skills");

/** Persisted at source by `/library/clean-bibliography`, end of its §3g. */
const SUBSKILL_OWNED = [
  "missing-bib-entry",
  "ambiguous-citation",
  "numeric-citation-style",
] as const;

/** Deferred to `deep-index.md` §5 — no same-run consumer. */
const STEP5_OWNED = [
  "footnote-recovery-needed",
  "examples-not-converted",
  "pgmark-duplicate",
  "pgmark-gap",
  "pgmark-out-of-order",
] as const;

const EIGHT: string[] = [...SUBSKILL_OWNED, ...STEP5_OWNED];

const DECLARATION = /--recompute-warning-kind\s+([A-Za-z][A-Za-z0-9-]*)/g;

function read(name: string): string {
  return readFileSync(path.join(SKILLS, name), "utf8");
}

/** Kinds this skill file DECLARES in a runnable invocation. */
function declaredBy(name: string): Set<string> {
  const out = new Set<string>();
  for (const m of read(name).matchAll(DECLARATION)) out.add(m[1]);
  return out;
}

const OWNERS: Record<string, readonly string[]> = {
  "clean-bibliography.md": SUBSKILL_OWNED,
  "deep-index.md": STEP5_OWNED,
};

describe("recomputed warning-kind ownership", () => {
  it("each owner declares exactly its own kinds", () => {
    for (const [file, expected] of Object.entries(OWNERS)) {
      const declared = [...declaredBy(file)].filter((k) => EIGHT.includes(k));
      expect(declared.sort(), `${file} declares the wrong kinds`).toEqual(
        [...expected].sort(),
      );
    }
  });

  it("no recomputed kind is declared by two skills", () => {
    const seen = new Map<string, string[]>();
    for (const file of ["clean-bibliography.md", "deep-index.md",
                        "di-preflight.md", "recover-footnotes.md",
                        "di-examples.md", "fuse-alternate.md"]) {
      for (const kind of declaredBy(file)) {
        seen.set(kind, [...(seen.get(kind) ?? []), file]);
      }
    }
    const doubled = [...seen.entries()].filter(([, files]) => files.length > 1);
    expect(
      doubled,
      "a kind declared twice means the later writer erases the earlier one",
    ).toEqual([]);
  });

  it("both prose SSOTs name all eight recomputed kinds", () => {
    // A partial inline copy is the task-163 disease: it reads as coverage.
    for (const file of ["deep-index.md", "_doctrine.md"]) {
      const src = read(file);
      const missing = EIGHT.filter((k) => !src.includes(`${k}:`));
      expect(missing, `${file} omits recomputed kinds`).toEqual([]);
    }
  });

  it("clean-bibliography persists BEFORE synthesis reads the warnings", () => {
    // The ordering IS the fix: `synthesize_canonical_entries.py` gates on
    // `missing-bib-entry:` lines it reads out of the catalog, so a persist
    // step below that heading restores the no-op this task removed.
    const src = read("clean-bibliography.md");
    const persist = src.indexOf("--recompute-warning-kind");
    const synthesis = src.indexOf("## Bibliography synthesis");
    expect(persist, "no persist step in clean-bibliography.md").toBeGreaterThan(-1);
    expect(synthesis, "synthesis heading moved or renamed").toBeGreaterThan(-1);
    expect(persist).toBeLessThan(synthesis);
  });

  it("the retired task-167 caveat is gone, not merely appended to", () => {
    const src = read("clean-bibliography.md");
    expect(src).not.toContain("This skill performs no\ncatalog write of its own");
    expect(src).not.toContain("performs no catalog write of its own");
    expect(src).not.toContain("not persisted to the catalog");
  });
});
