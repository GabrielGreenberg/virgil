// @vitest-environment node
//
// Drift guard for the WARNING-KIND census (task 463).
//
// `indexed.warnings` is append-only across deep-index passes EXCEPT for the
// kinds a producer declares with `--recompute-warning-kind`, and the default
// write path REPLACES the whole array (`update_catalog_entry.py`). So "who
// owns which kind" is load-bearing, and two skill files state it:
//
//   * `library/skills/_doctrine.md` §Persistence convergence, and
//   * `library/skills/deep-index.md` §5 "Warnings recompute",
//
// each of which says in as many words that "the two must agree". They did
// agree, and they were both wrong: both omitted `metadata-mismatch`, which
// `/library/di-preflight` — Step 0 of deep-index, one of its six dispatched
// subskills — produces and recomputes at source. The doctrine's own sentence
// states the cost: **a kind nobody names is a kind the next writer clobbers.**
// A step-5 patch declaring an unnamed kind DELETES the preflight's finding,
// and the pass proceeds looking clean.
//
// Both files also carried a hand-typed COUNT ("nine kinds"), which is what
// actually went stale. The counts are gone: a number restating a list is a
// second thing to keep in step. (`deep-index.md`'s "step 5 owns FIVE" stays —
// that five is what its own bash block declares, and this suite checks it.)
//
// THE POPULATION IS DISCOVERED. The skills' own bash blocks already declare
// the answer machine-readably, so the (kind → declaring skill) map is grepped
// out of every non-`_` skill in both silos and both censuses are held to it.
// This is the third hand-repair this one census has needed (323's ownership
// split, 373's derived fusion family, now this); it is the last, because the
// enumeration is no longer the authority — the invocations are.
//
// OUT OF SCOPE, deliberately, so a later reader does not mistake it for
// drift: the `pgmark-fusion-*` heads are a FAMILY, not a kind — their
// membership is derived at runtime from `fuse_alternate.py
// --print-recompute-flags` (task 373) and they are never typed into a bash
// block, so this grep cannot and should not see them.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// library/lib/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const DOCTRINE = "library/skills/_doctrine.md";
const DEEP_INDEX = "library/skills/deep-index.md";

/** Every invocable skill in both silos. `_`-prefixed includes are excluded by
 *  construction: the doctrine SPELLS the flag in its prose (with no kind after
 *  it) to explain the mechanism, which is documentation, not production. */
function skillFiles(): string[] {
  const out: string[] = [];
  for (const silo of ["editor", "library"]) {
    for (const name of readdirSync(join(repoRoot, silo, "skills")).sort()) {
      if (!name.endsWith(".md") || name.startsWith("_")) continue;
      out.push(`${silo}/skills/${name}`);
    }
  }
  return out;
}

/** The DISCOVERED map: kind → the skill file(s) that declare it. */
function producedKinds(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const rel of skillFiles()) {
    for (const m of read(rel).matchAll(/--recompute-warning-kind\s+([a-z][a-z0-9-]*)/g)) {
      const kind = m[1];
      const owners = map.get(kind) ?? [];
      if (!owners.includes(rel)) owners.push(rel);
      map.set(kind, owners);
    }
  }
  return map;
}

/** `deep-index.md` §5's three-column ASCII table, read by column so the
 *  OWNERSHIP claim is checked and not just membership. Column boundaries come
 *  from the header rule line, which is the table's own declaration of them. */
function deepIndexTableColumns(): { left: string[]; middle: string[]; right: string[] } {
  const body = read(DEEP_INDEX);
  const start = body.indexOf("step-5-owned");
  const rule = body.indexOf("────", start);
  const ruleLine = body.slice(rule, body.indexOf("\n", rule));
  // Two gaps in the rule line give the two column start offsets.
  const cols: number[] = [0];
  for (const m of ruleLine.matchAll(/ {2,}(?=─)/g)) cols.push(m.index! + m[0].length);
  const lines = body.slice(body.indexOf("\n", rule) + 1);
  const end = lines.indexOf("```");
  const cut = (line: string, i: number) =>
    line.slice(cols[i], i + 1 < cols.length ? cols[i + 1] : undefined).trim().replace(/:$/, "");
  const out = { left: [] as string[], middle: [] as string[], right: [] as string[] };
  for (const line of lines.slice(0, end).split("\n")) {
    const [l, m, r] = [cut(line, 0), cut(line, 1), cut(line, 2)];
    if (l) out.left.push(l);
    if (m) out.middle.push(m);
    if (r) out.right.push(r);
  }
  return out;
}

describe("warning-kind census (deep-index ownership)", () => {
  // The can-see canary: the discovery must be non-trivial and must contain
  // kinds it cannot lose — never one this task added, or every leg below could
  // pass vacuously on a broken grep.
  it("discovers the kind → skill map from the skills' own invocations", () => {
    const kinds = producedKinds();
    expect(kinds.size).toBeGreaterThanOrEqual(9);
    expect([...kinds.keys()]).toContain("missing-bib-entry");
    expect([...kinds.keys()]).toContain("bib-coherence");
    expect(kinds.get("missing-bib-entry")).toEqual(["library/skills/clean-bibliography.md"]);
    expect(kinds.get("bib-coherence")).toEqual(["library/skills/authenticate-bib.md"]);
  });

  // The leg with teeth. The census was never the part that could misbehave —
  // a kind nobody names is, and it type-checks perfectly because prose does.
  it("every produced kind is named in BOTH censuses", () => {
    const doctrine = read(DOCTRINE);
    const deepIndex = read(DEEP_INDEX);
    const missing: string[] = [];
    for (const [kind, owners] of producedKinds()) {
      if (!doctrine.includes(`${kind}:`)) missing.push(`${kind} (declared by ${owners.join(", ")}) — absent from ${DOCTRINE}`);
      if (!deepIndex.includes(`${kind}:`)) missing.push(`${kind} (declared by ${owners.join(", ")}) — absent from ${DEEP_INDEX}`);
    }
    expect(
      missing,
      "a kind nobody names is a kind the next writer clobbers: a step-5 patch " +
        "that declares an unnamed kind deletes its producer's findings. Add it " +
        "to both censuses, in the producer class it belongs to.",
    ).toEqual([]);
  });

  // The two files claim, in their own words, that they must agree. Nothing
  // checked that until now.
  it("the two censuses agree on which kinds exist", () => {
    const kinds = [...producedKinds().keys()].sort();
    const doctrine = read(DOCTRINE);
    const deepIndex = read(DEEP_INDEX);
    expect(kinds.filter((k) => doctrine.includes(`${k}:`))).toEqual(
      kinds.filter((k) => deepIndex.includes(`${k}:`)),
    );
  });

  // …and on OWNERSHIP, which is the half that decides whether declaring a kind
  // deletes someone else's findings. `deep-index.md`'s own bash block is the
  // authority for its left column.
  it("deep-index owns exactly the kinds its own bash block declares", () => {
    const table = deepIndexTableColumns();
    const declaredHere = [...producedKinds()]
      .filter(([, owners]) => owners.includes(DEEP_INDEX))
      .map(([k]) => k)
      .sort();
    expect(table.left.sort()).toEqual(declaredHere);
    expect(table.left.length).toBe(5); // the "step 5 owns FIVE" in the heading
    expect(read(DEEP_INDEX)).toContain("step 5 owns FIVE of them");
  });

  it("the subskill-owned column is exactly the kinds other in-pass skills declare", () => {
    const table = deepIndexTableColumns();
    const kinds = producedKinds();
    // Everything produced somewhere OTHER than deep-index.md, minus the one
    // producer that runs outside the pass entirely.
    const outsidePass = new Set(table.right);
    const elsewhere = [...kinds]
      .filter(([k, owners]) => !owners.includes(DEEP_INDEX) && !outsidePass.has(k))
      .map(([k]) => k)
      .sort();
    expect(table.middle.sort()).toEqual(elsewhere);
    expect(table.middle).toContain("metadata-mismatch"); // task 463
  });

  // The hand-typed totals are gone — they are what actually went stale. Pinned
  // so a later edit cannot reintroduce one under either census.
  it("neither census carries a hand-typed total", () => {
    expect(read(DOCTRINE)).not.toMatch(/recomputed per pass for nine kinds/i);
    expect(read(DEEP_INDEX)).not.toMatch(/Warnings recompute — nine kinds/i);
    expect(read(DEEP_INDEX)).not.toMatch(/append-only across passes EXCEPT for nine/i);
  });

  // The load-bearing half of naming a subskill-owned kind: step 5 must be told
  // NOT to declare it, or the census makes the deletion easier rather than
  // harder.
  it("warns step 5 off every subskill-owned kind", () => {
    const flat = read(DEEP_INDEX).replace(/\s+/g, " ");
    expect(flat).toMatch(/do not declare them below/i);
    expect(flat).toMatch(/metadata-mismatch/);
    const doctrineFlat = read(DOCTRINE).replace(/\s+/g, " ");
    expect(doctrineFlat).toMatch(/No step-5 patch may declare any of these four/i);
  });
});
