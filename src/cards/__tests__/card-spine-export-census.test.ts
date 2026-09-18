// The card spine's two registry modules export nothing that nothing calls
// (task 634).
//
// THE LAW
//
//   A value exported from `src/cards/predicates.ts` or
//   `src/panels/panel-registry.ts` is alive only if something CALLS it.
//   A re-export is not a caller, and a suite is not a consumer.
//
// WHY THESE TWO FILES. The card spine went through two completed migrations —
// the INVERSION (each kind declares its own panel in `CARD_REGISTRY`, so
// panel→kind membership DERIVES) and the AF KEY FLIP (popout keys became
// `float:card:<kind>:<id>`, with no prefix segment at all). Both landed. What did
// not land is the removal of what they replaced, and `predicates.ts` said so in
// the present tense while the replaced things sat two files away:
//
//   • `cardKindsForPanel` — "Replaces `PANEL_REGISTRY.card` +
//     `POLYMORPHIC_CARD_PANEL` entirely" — with `PANEL_REGISTRY.card` still
//     carrying a hand-written `keyPrefix` + `themeKey` per entry, 16 literals
//     duplicating `CARD_REGISTRY`, read by NOBODY. They all agreed, which was
//     luck: `themeKey: ThemeKey` is a 13-member union, so a wrong-but-valid
//     value compiled clean.
//   • `cardKeyPrefix` — "Replaces `CARD_KEY_PREFIXES` + the `popKey`/`cardPopKey`
//     token lookup" — with `CARD_KEY_PREFIXES` still derived, still exported,
//     still carrying "Don't hand-edit; add a registry entry" for a map nothing
//     consulted.
//
// And beside them three predicates — `isSystemCardKind`, `stackableCardKinds`,
// `canMorph` — with zero callers of any kind, not even a test. A dead SSOT is
// worse than none: the next contributor reaches for `canMorph` believing it is
// the enforced morph gate (it is not; the chevron gates on `onConvert` +
// `cardKindsForPanel`).
//
// WHY A CENSUS RATHER THAN SIX DELETIONS. The deletion is the easy half and buys
// nothing on its own — a seventh vestige lands next month, because this surface
// keeps re-growing them: every completed migration leaves a replaced thing, and
// "did anything ever call the replacement's predecessor?" is a question no
// reviewer runs. The census converts "a reviewer noticed" into "CI refuses".
//
// WHAT A CENSUS STRUCTURALLY CANNOT SEE, and how this spine covers it. An export
// census catches an unread EXPORT; it cannot catch a hand-written DUPLICATE of a
// derived fact. `CardLink.keyPrefix` was read by nobody — but had one caller read
// it, the census would have gone quiet while the two copies drifted. So the fix
// there is the one this codebase already prefers, and the census is not asked to
// do it: DELETE the duplicate rather than pin it. `PanelRegistryEntry.card`
// collapsed to `CardKind | null` (the panel's primary kind for `popKey`, which is
// the one fact anything reads), and the whole `CardLink` interface went with the
// two dead columns.
//
// SCOPE — deliberately the two modules the finding is about, not the spine.
// `deadExports` takes any file list, so widening is one line. It is left as a
// DECISION rather than a discovery: a spine-wide scope flags five more members
// today, each needing its own disposition, and a census that lands with a
// five-entry allowlist is weaker than one that lands with the deletions done.
// Measured at this commit, `src/cards/**` + `src/panels/**` would add:
//
//   • `legacy-token-crosswalk.ts::accentTokenFromTint` — a PARSER whose builder
//     is live and whose readers are 3 test legs. Nothing in the app reads a tint
//     back to a token.
//   • `marker-meta.ts::cardKindsForMarkerType` — the sole observer of the
//     module-private `kindsByMarkerType` derivation; deleting it makes
//     `marker-meta-derivation`'s frozen namespace→kinds pin unaskable.
//   • `Omni/omni-categories.ts::PANEL_TO_CATEGORY` — zero callers, tests
//     included.
//   • `card-lifecycle-registry.tsx::CardLifecycleProvider` + `::useCardLifecycle`
//     — the context half of the lifecycle registry, unread because `EditorPane`
//     builds the registry and calls `useCardLifecycleApi` directly. That is task
//     635's subject (`assertLifecycleCoverage` is CI-tested against a synthetic
//     registry, never the real one) and belongs with it, not here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { codeOnly } from "@/lib/__tests__/_source-scan";
import {
  censusFiles,
  deadExports,
  declaredExports,
  staleAllowlistEntries,
  swallowedInCensusedFiles,
} from "@/lib/__tests__/_export-census";

const SPINE = censusFiles(["src/cards/predicates.ts", "src/panels/panel-registry.ts"], "src");

/** Uncalled value exports deliberately kept, each with its reason.
 *
 *  An entry here is a claim that the export earns its keep WITHOUT a caller,
 *  which is a high bar: the whole finding is that "published" reads like "used".
 *  WIRE it or DELETE it; do not list it to make CI quiet. */
const PERMITTED_UNCALLED: Record<string, string> = {
  "panels/panel-registry.ts::nextCardTitle":
    "A PARITY ORACLE, not scaffolding — it is `isAutoTitle`'s specification. " +
    "`isAutoTitle` is a LIVE legacy parser (the one-time fallback inside " +
    "`resolveLoadedTitle`, for pre-T6 records carrying no `titleAuto` bit), and " +
    "the shape it must keep matching is exactly what `nextCardTitle` used to " +
    "PERSIST. auto-title.test.ts round-trips generator → parser for every kind; " +
    "deleting the generator would move `${label} ${n}` into the suite, i.e. put " +
    "the frozen shape in two places with nothing pinning them together. Retire " +
    "this entry when the legacy fallback itself is retired (every record stamped), " +
    "and delete both together.",
};

describe("the card spine's registry modules export nothing that nothing calls (task 634)", () => {
  it("censuses real files", () => {
    // A census that silently scans nothing is compliance-shaped and worthless.
    const declared = declaredExports(SPINE);
    expect(SPINE.length).toBe(2);
    expect(declared.size).toBeGreaterThan(20);
  });

  it("the scanner never swallows part of a censused file", () => {
    expect(
      swallowedInCensusedFiles(SPINE),
      "an unterminated quoted string shrank the census's view of a censused file",
    ).toEqual([]);
  });

  it("every value export has a non-test caller", () => {
    expect(deadExports(SPINE, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the allowlist has no stale entries — still declared, still uncalled", () => {
    expect(staleAllowlistEntries(SPINE, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the retired popout-key vocabulary is gone, not renamed", () => {
    // Read backwards: these are the names a future reader would reach for
    // believing they are the live key grammar. Their reappearance is only wrong
    // if it is another unread duplicate — which the census above already fails —
    // so this leg pins the two things the census structurally cannot see: a
    // hand-written duplicate COLUMN (member 1, read by one caller and therefore
    // invisible to a census) and the facet it duplicated.
    const declared = declaredExports(SPINE);
    expect([...declared.keys()]).not.toContain("panels/panel-registry.ts::CARD_KEY_PREFIXES");
    // CODE only — the module's own header explains at length what these two
    // columns were and why they went, and a guard that forbids naming the thing
    // it retired forbids the explanation with it.
    const registry = readSpine("src/panels/panel-registry.ts");
    expect(registry, "the CardLink duplicate columns are back").not.toMatch(
      /\bkeyPrefix\b|\bthemeKey\b/,
    );
    expect(registry, "the CardLink interface is back").not.toContain("interface CardLink");
    // `CardMeta.keyPrefix` moved to `LEGACY_TOKEN_CROSSWALK.legacyKeyPrefix` —
    // the module whose whole promise is that its values are frozen legacy tokens
    // no live grammar reads. The live key grammar has no prefix segment at all
    // (`buildFloatKey` → `float:<domain>:<kind>:<id>`), so a `keyPrefix` facet on
    // the LIVE spine registry is a standing invitation to build a key from it.
    expect(readSpine("src/cards/types.ts"), "keyPrefix is back on CardMeta").not.toMatch(
      /^\s*keyPrefix:/m,
    );
  });
});

/** A censused-adjacent source file as CODE — comments and string literals
 *  blanked — for the two things a census structurally cannot see (a duplicate
 *  COLUMN, and a facet on another module). Code, because a module that retires a
 *  vocabulary should be free to EXPLAIN what it retired; a guard that reads the
 *  prose forbids the explanation along with the thing. */
function readSpine(rel: string): string {
  return codeOnly(readFileSync(path.resolve(__dirname, "../../..", rel), "utf8"));
}
