// @vitest-environment node
//
// Drift guard for Virgil's CENTRAL DESIGN PRINCIPLE in the dev-dream loop.
// The principle is authored ONCE in `editor/skills/_dev-loop-principle.md`
// (the SSOT include) but MUST also appear verbatim, foregrounded, at the top
// of both `dream.md` (night pass) and `reflect.md` (day capture) — because the
// editor bundle mirrors each skill's bytes with NO transclusion, so a bare
// link would leave the principle absent from the compiled command a run reads.
//
// This test makes the inline copies a single source of truth in practice: it
// extracts the principle sentence from the SSOT and asserts both skills carry
// it byte-for-byte. Paraphrase or drift in any copy fails the test.
//
// The REFINEMENTS are held to the same rule (task 516), and the reason is the
// defect that rule closes: until 2026-08-31 they were authored in the SSOT and
// inlined NOWHERE, so the principle reached every run and its two corrections
// reached none — the same "a facet the layer that needs it cannot reach" shape
// the SSOT's own header states about the sentence. Extracting them by SHAPE
// (`Refinement (...)` paragraphs) rather than by a hand list is what makes a
// third refinement added to the SSOT alone a FAILING test rather than a
// silently unread one.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

// editor/skills/__tests__/ → repo root is three levels up.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

const SSOT = "editor/skills/_dev-loop-principle.md";
const DREAM = "editor/skills/dream.md";
const REFLECT = "editor/skills/reflect.md";

// The verbatim principle payload, extracted from the SSOT so the SSOT is the
// only place the wording is authored. Everything from "I want unified" through
// the closing "improve the app." — independent of the surrounding blockquote /
// bold markup, so cosmetic framing may differ but the words may not.
function principleFromSSOT(): string {
  const doc = read(SSOT);
  const m = doc.match(/I want unified[\s\S]*?improve the app\./);
  if (!m) throw new Error(`Principle sentence not found in ${SSOT}`);
  return m[0];
}

// Every `Refinement (...)` paragraph in the SSOT, verbatim (its own wrapping
// included — the copies must match byte-for-byte, so the wrapping is part of
// the payload). DISCOVERED by shape, never hand-listed: a hand list inside the
// guard that exists to stop a refinement going unread could only ever be
// missing the refinement that went unread.
function refinementsFromSSOT(): string[] {
  const doc = read(SSOT);
  const found = doc.match(/^Refinement \([^)]*\):[\s\S]*?(?=\n\n|$)/gm) ?? [];
  if (found.length === 0) throw new Error(`No refinements found in ${SSOT}`);
  return found;
}

describe("dev-loop central design principle (SSOT + inline copies)", () => {
  it("SSOT carries the verbatim principle sentence", () => {
    const p = principleFromSSOT();
    // A couple of load-bearing phrases that must survive any future edit.
    expect(p).toContain("unified, deep, architectural solutions");
    expect(p).toContain("deepest possible solution");
    expect(p).toContain("avoid superficial, surgical patches");
  });

  it("declares itself an include, not a slash command", () => {
    expect(read(SSOT)).toMatch(/Not a slash command/i);
  });

  it.each([DREAM, REFLECT])("%s inlines the principle verbatim from the SSOT", (skill) => {
    expect(read(skill)).toContain(principleFromSSOT());
  });

  it("SSOT carries the refinements the loop has actually learned", () => {
    const refs = refinementsFromSSOT();
    // Both are load-bearing rulings, not prose: pin that each survives.
    expect(refs.join("\n")).toContain("broadest blast radius");
    expect(refs.join("\n")).toContain("QUEUE collision is a queue fact");
  });

  it.each([DREAM, REFLECT])("%s inlines EVERY refinement verbatim", (skill) => {
    const doc = read(skill);
    for (const r of refinementsFromSSOT()) {
      // The failure this catches is a refinement that reaches the SSOT and no
      // run — which is exactly the state this guard was widened out of.
      expect(doc, `${skill} is missing: ${r.slice(0, 60)}…`).toContain(r);
    }
  });

  it.each([DREAM, REFLECT])("%s keeps the refinements WITH the principle", (skill) => {
    const doc = read(skill);
    const principleIdx = doc.indexOf(principleFromSSOT());
    for (const r of refinementsFromSSOT()) {
      const idx = doc.indexOf(r);
      expect(idx).toBeGreaterThan(principleIdx);
      // Immediately after it — a refinement filed elsewhere in the file is a
      // refinement the reader meets detached from what it refines.
      expect(idx - principleIdx).toBeLessThan(1200);
    }
  });

  it.each([DREAM, REFLECT])("%s foregrounds the principle above the intro prose", (skill) => {
    const doc = read(skill);
    const principleIdx = doc.indexOf("(CENTRAL DESIGN PRINCIPLE)");
    const flowIdx = doc.indexOf("## The flow");
    expect(principleIdx).toBeGreaterThan(-1);
    // The callout sits high in the file — before any procedural body.
    if (flowIdx > -1) expect(principleIdx).toBeLessThan(flowIdx);
  });

  it("dream.md nudges toward the deepest unified fix at the proposed-change step", () => {
    const doc = read(DREAM);
    const changeIdx = doc.indexOf("concrete **proposed change** object");
    expect(changeIdx).toBeGreaterThan(-1);
    // The nudge lives right at that decision point.
    const window = doc.slice(changeIdx, changeIdx + 600);
    expect(window).toMatch(/deepest unified fix/i);
    expect(window).toMatch(/pattern class/i);
    // ...without weakening the guard/boundaries.
    expect(window).toMatch(/scope guard|boundaries/i);
  });
});
