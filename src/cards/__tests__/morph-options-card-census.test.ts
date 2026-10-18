// Task 2026-10-18-1173 — every kind-chevron asks its option list WITH the record.
//
// Task 898 made the morph gate per-RECORD (`registerCardMorph(kind, convert,
// gate)` → `canMorphCard(kind, card)`), read by the chevron's option list
// (`morphOptionsFor(kind, card)`) and by the lifecycle executor. But the gate
// only bites when the CARD is passed, and 9 of 11 chevron sites asked
// card-blind — the note's gate survived only because its two surfaces
// re-applied `canMorphNoteToHighlight` by hand. A gate registered for any
// other kind would have been silently bypassed: the menu offers a morph the
// executor then refuses, a visible control that does nothing.
//
// The fix makes `card` a REQUIRED parameter (tsc catches a forgotten one), and
// the kind-only answer the boot assertion needs lives module-private in the
// registry. This census pins the source shape so the hand-checks and the
// card-blind form cannot come back:
//
//   1. no `morphOptionsFor(<one arg>)` call anywhere in app source;
//   2. no direct `canMorphNoteToHighlight` use outside `cards/morphs` — the
//      registered gate is the one answer every surface reads.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, codeOnly, walkFiles } from "@/lib/__tests__/_source-scan";

const SRC = path.join(REPO_ROOT, "src");
const APP_SOURCES = walkFiles(SRC, { skipDirs: ["__tests__"] })
  .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p))
  .map((p) => ({ rel: path.relative(REPO_ROOT, p), code: codeOnly(readFileSync(p, "utf8")) }));

/** Every `morphOptionsFor(` call's argument text, up to its matching paren. */
function morphOptionsCalls(code: string): string[] {
  const out: string[] = [];
  const re = /\bmorphOptionsFor\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < code.length && depth > 0; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")") depth--;
    }
    out.push(code.slice(start, i - 1));
  }
  return out;
}

/** Top-level comma count of an argument list (nested calls/objects skipped). */
function argCount(args: string): number {
  if (args.trim() === "") return 0;
  let depth = 0;
  let n = 1;
  for (const ch of args) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) n++;
  }
  return n;
}

describe("CENSUS: the kind-chevron's option list is asked with the record (task 1173)", () => {
  it("scans a real population (the chevron sites exist)", () => {
    const sites = APP_SOURCES.filter((f) => morphOptionsCalls(f.code).length > 0);
    // card-registry (the declaration + its own doc) and at least the panel
    // cards + floats builders.
    expect(sites.length).toBeGreaterThanOrEqual(8);
  });

  it("no card-blind `morphOptionsFor(kind)` call in app source", () => {
    const offenders: string[] = [];
    for (const f of APP_SOURCES) {
      for (const args of morphOptionsCalls(f.code)) {
        // The declaration itself (`kind: CardKind, card: unknown`) has 2.
        if (argCount(args) < 2) offenders.push(`${f.rel}: morphOptionsFor(${args})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no direct `canMorphNoteToHighlight` read outside cards/morphs", () => {
    const offenders = APP_SOURCES.filter(
      (f) =>
        /\bcanMorphNoteToHighlight\b/.test(f.code) &&
        !f.rel.startsWith(path.join("src", "cards", "morphs")),
    ).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
