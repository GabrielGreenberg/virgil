import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CARD_KINDS,
  STORED_KIND_BY_PANEL,
  cardKindFromRecord,
  storedKindForCardKind,
  type PolymorphicPanel,
} from "../predicates";
import { CARD_REGISTRY } from "../card-registry";
import { commentsStripped, walkFiles } from "../../lib/__tests__/_source-scan";

/**
 * Task 999 — the stored-kind ↔ card-kind pairing is ONE declared table
 * (`STORED_KIND_BY_PANEL`), read forward by `cardKindFromRecord` and backward by
 * `storedKindForCardKind`. Before it, ~12 sites re-spelled the pairing by hand:
 * `c.kind === "suggestion" ? "revision-suggestion" : "revision-comment"`
 * ternaries in the hooks, marker sources and delete wrappers, and an 8-case
 * `switch (toCardKind) { … convertCard(id, "suggestion") }` in the morph
 * chokepoint. Every copy agreed — the cost was that a third kind or a renamed
 * discriminator had to be found at each, and every ternary's else-leg silently
 * classified an unknown record.
 *
 * The census bans both SHAPES outside `predicates.ts`, with the token sets
 * DERIVED from the table so a new row is covered without editing this file.
 */

const ROOT = join(__dirname, "..", "..");
const PANELS = Object.keys(STORED_KIND_BY_PANEL) as PolymorphicPanel[];
const rowOf = (p: PolymorphicPanel): Readonly<Record<string, string>> => STORED_KIND_BY_PANEL[p];
const STORED = new Set(PANELS.flatMap((p) => Object.keys(rowOf(p))));
const SPINE = new Set(PANELS.flatMap((p) => Object.values(rowOf(p))));
// Monomorphic-in-spelling rows (notes, reports) store the spine token itself;
// the ban there is on the SHAPE, which is the same either way.

const alt = (s: Set<string>) =>
  [...s].map((t) => t.replace(/[-]/g, "\\-")).join("|");
/** `x.kind === "<stored>" ? "<spine>" : "<spine>"` — a hand classifier. */
const TERNARY = new RegExp(
  `\\.kind\\s*===\\s*"(?:${alt(STORED)})"\\s*\\?\\s*"(?:${alt(SPINE)})"\\s*:\\s*"(?:${alt(SPINE)})"`,
);
/** `.convertCard(id, "<stored>")` — a hand inverse (the old morph switch). */
const CONVERT_LITERAL = new RegExp(`\\.convertCard\\([^,()]+,\\s*"(?:${alt(STORED)})"\\s*\\)`);

function sources(): string[] {
  return walkFiles(ROOT, { skipDirs: ["__tests__"] }).filter(
    (p) => /\.tsx?$/.test(p) && !p.endsWith(join("cards", "predicates.ts")),
  );
}

describe("stored-kind pairing census (task 999)", () => {
  it("no stored→spine ternary or literal convertCard outside predicates.ts", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      const code = commentsStripped(readFileSync(file, "utf8"));
      code.split("\n").forEach((line, i) => {
        if (TERNARY.test(line) || CONVERT_LITERAL.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders, `route through cardKindFromRecord / storedKindForCardKind:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("the patterns are live — they catch the retired dialect", () => {
    expect(TERNARY.test(`c.kind === "suggestion" ? "revision-suggestion" : "revision-comment"`)).toBe(true);
    expect(TERNARY.test(`c?.kind === "report-request" ? "report-request" : "report"`)).toBe(true);
    expect(CONVERT_LITERAL.test(`cutterHookRaw.convertCard(id, "comment")`)).toBe(true);
  });
});

describe("storedKindForCardKind ∘ cardKindFromRecord", () => {
  it("round-trips every row of every polymorphic panel", () => {
    for (const panel of PANELS) {
      for (const [stored, kind] of Object.entries(rowOf(panel))) {
        expect(cardKindFromRecord({ kind: stored }, panel)).toBe(kind);
        expect(storedKindForCardKind(kind as never)).toEqual({ panel, stored });
      }
    }
  });

  it("each row's spine kinds are exactly the registry's kinds for that panel", () => {
    for (const panel of PANELS) {
      const declared = CARD_KINDS.filter((k) => CARD_REGISTRY[k].panel === panel).sort();
      expect(Object.values(rowOf(panel)).sort()).toEqual(declared);
    }
  });

  it("covers every morphing kind and its target (the chokepoint is total)", () => {
    for (const k of CARD_KINDS) {
      const morph = CARD_REGISTRY[k].morph;
      if (!morph) continue;
      expect(storedKindForCardKind(k), k).not.toBeNull();
      expect(storedKindForCardKind(morph.to), morph.to).not.toBeNull();
    }
  });

  it("an unknown or missing stored kind falls back to the panel's first row", () => {
    expect(cardKindFromRecord({}, "revisions")).toBe("revision-comment");
    expect(cardKindFromRecord({ kind: "bogus" }, "cutter")).toBe("cutter-comment");
    expect(cardKindFromRecord({ kind: "toString" }, "reports")).toBe("report");
  });
});
