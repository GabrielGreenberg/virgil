// Task 260 — the action registry's completeness is UNION-EXHAUSTIVE at compile
// time, for all five `ActionId` families (six row tables: `BlockActionId`
// splits into its heading and non-heading halves, which have different sources).
//
// ── WHAT WAS WRONG ────────────────────────────────────────────────────────
// `assertActionCoverage` advertised the registry as the COMPLETE SSOT and
// asserted it "in BOTH directions" — but both directions were HAND-authored
// lists (`EXPECTED_ACTION_IDS` vs the union of the `COVERED_*` slices) compared
// to each other, with the `ActionId` union the reference of neither. Array
// element typing (`readonly CardActionId[]`) enforces SUBSET only: every element
// is a valid member, never that every member is present. And the registry was
// `Partial<Record<ActionId, ActionSpec>>` built through `Object.fromEntries` +
// an `as` cast, so a MISSING row was legal too.
//
// The invariant held for card / format / heading only by ACCIDENT — each has an
// incidental exhaustive `Record` elsewhere (`CARD_ACTION_PRESENTATION`,
// `FORMAT_ACTION_ROWS`, `HEADING_ID_LEVEL`) that a new member breaks first.
// atom / title / non-heading-block had none.
//
// MEASURED on the pre-fix tree (`bd2bc790`), adding three scratch union members
// — `AtomActionId | "eqref"`, `NonHeadingBlockActionId | "verbatim"`,
// `TitleActionId | "keywords"`:
//   * `eqref` and `verbatim` produced ZERO PRODUCTION errors. Row-less, wired to
//     nothing, `assertActionCoverage()` → `[]`.
//   * `keywords` tripped one INCIDENTAL production error — `titleFieldRow`'s
//     parameter was hand-typed `"title" | "author" | "date"` rather than
//     `TitleActionId`, so the `.map` failed. An accident, naming the row BUILDER
//     rather than the missing row. (That parameter now names `TitleActionId`, so
//     the accident is gone and the real pin does the work.)
//   * one TEST-side hit for all three, `applicability-collab-gate.test.ts`'s
//     `EXPECTED_MODE` (`Record<ActionId, ActionSelectionMode>`).
//
// So the honest severity, stated because an overstated guard is this repo's
// defining defect: the project typecheck was **red**, not green — `tsconfig`
// includes `**/*.ts` and CI gates on `npm run typecheck`. The hole was not
// CI-invisible, it was CI-MISDIRECTED. The one error named a missing
// selection-MODE entry in a test's expected-value table; adding the three ids
// there satisfies it completely and still ships three actions the registry
// cannot resolve. A net that names the wrong obligation teaches the next author
// to discharge the wrong obligation, which is why this is still worth a pin at
// the declaration.
//
// A fourth scratch, a whole NEW FAMILY (`ActionId | "macro-scratch"`), measured
// POST-fix: it reddens the assembly AND `_ACTION_ID_PARTITION_PROOF`
// (`{ "an ActionId family has no exhaustive row table": "macro-scratch" }`).
// Within-family cases never reach the proof — their own table fails first — so
// it speaks only for the case it exists for.
//
// ── WHAT IS PROVEN HERE ───────────────────────────────────────────────────
//   A. TYPE-LEVEL (checked by `tsc --noEmit`, not by vitest — see below): the
//      registry is total over the REAL `ActionId`, with an accepting control.
//   B. SOURCE CENSUS: the pins are actually in production — a total annotation
//      with no `Partial`/`as`, an exhaustive row table per family, and every id
//      list DERIVED from a table's keys rather than hand-listed. This is the leg
//      with teeth: the annotation was never the part that could misbehave; a
//      slice re-hand-listed beside it is.
//   C. RUNTIME: `assertActionCoverage()` stays green and every row is keyed by
//      its own id. Sanity, not defect legs — the pre-fix object delivered all 32
//      rows too; these fail only on a future derivation fork.
//
// Note on leg A: `@ts-expect-error` and the assignment below are enforced by the
// PROJECT typecheck (`npm run typecheck` / `npx tsc --noEmit`), which includes
// `**/*.ts`. vitest does not type-check, so these lines are inert at runtime by
// design — they are here, in the suite that explains them, rather than in
// production source where they would read as live code.
//
// Stated limits of the census (all measured, none hypothetical): the read
// needle for a reintroduced manifest is NAME-scoped (three name shapes) and
// FILE-scoped (this registry only), so a manifest called `ALL_IDS`, or moved one
// file over, passes; `@ts-expect-error` suppresses whatever error lands on its
// statement, so an unrelated future error there would satisfy the control
// silently.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import {
  VIRGIL_ACTION_REGISTRY,
  assertActionCoverage,
  type ActionId,
  type ActionSpec,
} from "@/lib/actions/action-registry";

/** Resolved RELATIVE TO THIS FILE, not to `process.cwd()`. A cwd-relative path
 *  silently reads a different tree when the suite is run from elsewhere, and a
 *  census that reads the wrong file passes for the worst possible reason. */
const REGISTRY_SRC = fileURLToPath(
  new URL("../action-registry.ts", import.meta.url),
);
const source = readFileSync(REGISTRY_SRC, "utf8");
/** Comments blanked, string literals KEPT — the ids this census looks for live
 *  in literals (a re-hand-listed slice is exactly a list of quoted ids), while
 *  the prose that DESCRIBES the retired shapes (in the registry, and in this
 *  file) must not read as the shapes themselves. */
const code = commentsStripped(source);
/** All whitespace removed — several of the annotations below wrap across lines,
 *  and a needle should not have to guess where. */
const squeeze = (s: string) => s.replace(/\s+/g, "");
const squeezed = squeeze(code);

/** Every `const <ID-LIST-NAME>: … = [` in a source blob — the hand-authored
 *  manifest shape this task retired. Names the declarations it finds, so a
 *  failure reads as "COVERED_ATOM_IDS was re-hand-listed" rather than a count.
 *  Name-scoped by design (see the limits note in the header): it watches the
 *  three shapes this file actually used, not every possible array of ids. */
function handListedManifests(src: string): string[] {
  return [
    ...src.matchAll(
      /const\s+(EXPECTED_ACTION_IDS|COVERED_[A-Z_]+|[A-Z_]*ACTION_IDS)\s*:[^=]*=\s*\[/g,
    ),
  ].map((m) => m[1]);
}

/** The family row tables, read off `_FamilyCoveredActionId`'s `keyof typeof`
 *  clauses — the registry's own statement of which tables partition `ActionId`.
 *  Discovering them keeps the census self-extending: a seventh family added to
 *  the proof is censused without anyone editing this file. */
function familyTableNames(src: string): string[] {
  const decl = src.match(/type _FamilyCoveredActionId =([\s\S]*?);/);
  if (!decl) return [];
  return [...decl[1].matchAll(/keyof typeof ([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
}

// ===========================================================================
// (A) TYPE-LEVEL pins — red `tsc`, not red vitest.
// ===========================================================================

/** POSITIVE: the registry is TOTAL over the real union. Reverting it to
 *  `Partial<Record<ActionId, ActionSpec>>` — or dropping a family from the
 *  assembly — makes this assignment fail to compile. */
const _registryIsTotal: Record<ActionId, ActionSpec> = VIRGIL_ACTION_REGISTRY;
void _registryIsTotal;

/** NEGATIVE (the accepting control): a union with ONE MORE member must NOT be
 *  satisfiable by the registry. Without it the positive leg could pass for the
 *  wrong reason — a registry typed `any` satisfies every assignment. Measured:
 *  typing it `any` makes this line report `TS2578: Unused '@ts-expect-error'`,
 *  so the build goes red. (An index SIGNATURE, `Record<string, ActionSpec>`, is
 *  NOT such a route — measured, it reddens the positive leg directly, because a
 *  string index signature is not assignable to a specific-key Record.) */
// @ts-expect-error - "scratch-action" has no row, and that is the whole point.
const _scratchMemberIsRefused: Record<ActionId | "scratch-action", ActionSpec> =
  VIRGIL_ACTION_REGISTRY;
void _scratchMemberIsRefused;

// ===========================================================================
// (B) SOURCE CENSUS — the pins are in PRODUCTION, not just described here.
// ===========================================================================

describe("action registry — the completeness pin is union-exhaustive at compile time", () => {
  it("declares VIRGIL_ACTION_REGISTRY as a TOTAL Record<ActionId, ActionSpec>", () => {
    expect(squeezed).toContain(
      squeeze(
        "export const VIRGIL_ACTION_REGISTRY: Readonly<Record<ActionId, ActionSpec>> = {",
      ),
    );
    // The two shapes that made a missing row legal pre-260.
    expect(squeezed).not.toContain(squeeze("VIRGIL_ACTION_REGISTRY: Partial<"));
    expect(squeezed).not.toContain(
      squeeze("as Partial<Record<ActionId, ActionSpec>>"),
    );
  });

  it("builds the registry by spreading an exhaustive row table PER FAMILY", () => {
    // The table names are DISCOVERED from `_FamilyCoveredActionId`, not listed
    // here — a hand list in the census that outlaws hand lists would be this
    // very defect one level up, and would stay silently green when a seventh
    // family arrived with a `Record<string, …>` table.
    const names = familyTableNames(code);
    expect(names.length, "parsed the family tables out of the proof").toBeGreaterThanOrEqual(6);
    for (const name of names) {
      const annotation = squeezed.match(
        new RegExp(`const${name}:Readonly<Record<([A-Za-z]+),ActionSpec>>`),
      );
      expect(annotation, `${name} must be Readonly<Record<…, ActionSpec>>`).toBeTruthy();
      // The key type must be a NAMED family union. `string` here is the
      // degradation that would make the table exhaustive over nothing.
      expect(annotation![1], `${name}'s key type`).toMatch(/ActionId$/);
      expect(squeezed, `${name} must be spread into the registry`).toContain(
        `...${name}`,
      );
    }
  });

  it("keeps the compile-time partition proof beside the assembly", () => {
    expect(squeezed).toContain("_ACTION_ID_PARTITION_PROOF");
    expect(squeezed).toContain(squeeze("Exclude<ActionId, _FamilyCoveredActionId>"));
    expect(squeezed).toContain(squeeze("Exclude<_FamilyCoveredActionId, ActionId>"));
  });

  it("DERIVES the manifest and every COVERED_* slice from a table's keys", () => {
    // Needles omit the closing paren: a multi-line call carries a trailing
    // comma, and a census that encodes Prettier's line breaks fails on a
    // cosmetic reformat rather than on a drift.
    const DERIVED: readonly [string, string][] = [
      ["EXPECTED_ACTION_IDS", "keysOf(VIRGIL_ACTION_REGISTRY"],
      ["COVERED_CARD_IDS", "keysOf(CARD_ACTION_ROWS"],
      ["COVERED_HEADING_IDS", "keysOf(HEADING_ACTION_ROWS"],
      ["COVERED_BLOCK_IDS", "keysOf(NON_HEADING_BLOCK_ACTION_ROWS"],
      ["COVERED_FORMAT_IDS", "keysOf(FORMAT_ACTION_ROWS"],
      ["COVERED_ATOM_IDS", "keysOf(ATOM_ACTION_ROWS"],
      ["COVERED_TITLE_IDS", "keysOf(TITLE_ACTION_ROWS"],
    ];
    for (const [name, derivation] of DERIVED) {
      expect(squeezed, `${name} must be derived`).toContain(
        squeeze(`${name}: readonly`),
      );
      expect(squeezed, `${name} must be derived from a key set`).toContain(
        squeeze(derivation),
      );
    }
  });

  it("leaves NO hand-listed id manifest behind (the shape that made the old guard a tautology)", () => {
    // Every id list in this file is now `keysOf(…)`. The three SLASH subsets are
    // derived too (`slashOwnersAmong(…)` — the block + format halves in task
    // 385, the card half in task 399), so the only set that remains literal is
    // `CARD_IDS_WITH_TYPED_RULE`: `new Set<…>([…])`, saying something about a
    // handful of rows that a Record over the family cannot AND that no live
    // vocabulary can reconcile (input rules have no table — task 228). It is
    // outside this needle by shape rather than by exemption, and its own doc
    // states why it stays declared.
    expect(handListedManifests(code)).toEqual([]);
  });

  it("SELF-CHECK: the census needles really do fire on the pre-260 shapes", () => {
    // A canary standing on a live production line would evaporate the day that
    // line is fixed, so it stands on a synthetic fixture instead (the rule task
    // 220 earned). Each fixture is a shape this task retired, byte-for-byte.
    const preFixRegistry =
      "export const VIRGIL_ACTION_REGISTRY: Partial<Record<ActionId, ActionSpec>> =";
    expect(squeeze(commentsStripped(preFixRegistry))).toContain(
      squeeze("VIRGIL_ACTION_REGISTRY: Partial<"),
    );

    const preFixSlice = 'const COVERED_ATOM_IDS: readonly AtomActionId[] = ["ref"];';
    expect(handListedManifests(commentsStripped(preFixSlice))).toEqual([
      "COVERED_ATOM_IDS",
    ]);

    // And the stripper is not swallowing the file. A LENGTH floor is the weak
    // instrument (10k tolerates a ~74% swallow of a 38k blob); the siblings at
    // tasks 202b / 205 count DECLARATIONS, because that is what a runaway
    // template-literal actually eats. Same here: the count must survive the
    // strip exactly.
    const declsBefore = (source.match(/^\s*(export )?(const|function|type) /gm) ?? []).length;
    const declsAfter = (code.match(/^\s*(export )?(const|function|type) /gm) ?? []).length;
    expect(declsBefore).toBeGreaterThan(100);
    expect(declsAfter).toBe(declsBefore);
    expect(squeezed).toContain("assertActionCoverage");
  });
});

// ===========================================================================
// (C) RUNTIME — the derivation is intact and the rows are sane.
// ===========================================================================

describe("action registry — runtime shape after the derivation", () => {
  it("assertActionCoverage() is green (the derivation-fork guard)", () => {
    expect(assertActionCoverage()).toEqual([]);
  });

  it("every registry key holds a row keyed by its own id", () => {
    for (const [key, row] of Object.entries(VIRGIL_ACTION_REGISTRY)) {
      expect(row, `row for "${key}"`).toBeTruthy();
      expect(row.id, `row keyed "${key}"`).toBe(key);
    }
  });

  it("has no undefined row — the total Record is total at RUNTIME too", () => {
    // A SANITY leg, not a defect leg: the pre-fix `Object.fromEntries` object
    // delivered all 32 rows too, so this cannot fail on the retired shape. It
    // fails on a future derivation fork that drops a table from the spread.
    const values = Object.values(VIRGIL_ACTION_REGISTRY);
    expect(values.length).toBeGreaterThan(0);
    expect(values.filter((r) => !r)).toEqual([]);
  });
});
