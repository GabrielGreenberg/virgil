// Range-ness is asked of the registry, never spelled (task 743).
//
// `TEXT_OBJECT_REGISTRY[kind].isRange` is the facet that says a text-object
// kind is MARK-backed (no node of its own). Production code asks it through
// `isRangeKind` / `isNodeTextObjectKind` (text-object-registry.ts). Before
// task 743, eleven sites compared `kind === "linkedRange"` instead — so a
// second range kind would have been missed at every one of them while the
// facet sat unread. This census forbids a new comparison against the literal
// anywhere in `src/` outside the registry module itself.
//
// The one stated exception is the LINK vocabulary's own door,
// `src/links/_shared/types.ts` (`isRangedModeB`): it compares a persisted
// link's `anchor.targetKind`, a sidecar field, and is documented there as the
// only place that spelling may appear.

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { TEXT_OBJECT_REGISTRY, isRangeKind } from "../text-object-registry";
import type { TextObjectKind } from "../types";

const SRC = join(__dirname, "..", "..");

const ALLOWED = new Set([
  "text-objects/text-object-registry.ts",
  "links/_shared/types.ts",
]);

// `x === "linkedRange"`, `x !== "linkedRange"`, and the reversed forms.
const LITERAL_COMPARE =
  /[!=]==\s*["']linkedRange["']|["']linkedRange["']\s*[!=]==/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("range-kind census (task 743)", () => {
  it("no production module compares a kind against the \"linkedRange\" literal", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC, [])) {
      const rel = relative(SRC, file);
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, "");
          if (/^\s*\*/.test(code)) return; // JSDoc prose
          if (LITERAL_COMPARE.test(code)) offenders.push(`${rel}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("isRangeKind reads the registry facet for every kind", () => {
    for (const kind of Object.keys(TEXT_OBJECT_REGISTRY) as TextObjectKind[]) {
      expect(isRangeKind(kind)).toBe(TEXT_OBJECT_REGISTRY[kind].isRange);
    }
  });
});
