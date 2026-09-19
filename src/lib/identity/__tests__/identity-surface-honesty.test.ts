// The identity + atom-registry surface exports nothing that nothing calls
// (task 647).
//
// THE LAW
//
//   A value exported from the identity cascade or the Atom registry is alive
//   only if something CALLS it. A re-export is not a caller, and a suite is not
//   a consumer.
//
// Third caller of the shared census machinery, after `src/links/**` (task 202)
// and the card spine (task 634) — which predicted this: "the folder after that
// will be too." It is, and for a reason worth naming, because this surface goes
// dead differently from those two.
//
// `src/links/` went dead by STALLING: a phased migration landed its read half,
// its write half never arrived, and the barrel made every grep green. Nothing
// here stalled. This surface went dead by OVER-DECLARING — each of its rollout
// stages published the vocabulary for the stage after it, and the code that was
// supposed to consume it either never came or came in a different shape:
//
//   - `IdentityChange` grew a `retype` arm with a constructor and a narrower.
//     The constructor got a real dispatch (`replaceBibEntry`), so the ARM read
//     alive; the narrower stayed test-only, because both registered migrators
//     open `if (!isRenameCitekey(change)) return;`. The fan-out was a
//     guaranteed no-op for three months with a green suite pinning it, and the
//     one symbol that could have said so was `isRetype`'s caller count. That is
//     this census's exact question, which is why it is the guard for this
//     finding and not a one-line deletion.
//
//   - `ATOM_REGISTRY` published a `label` nobody read ("confirm copy / future
//     UI" — its own comment) and, in task 645, a `CARD_ATOM_DOM_ID_SELECTOR`
//     born with zero callers whose doc-comment named two consumers that
//     structurally cannot use a joined selector. The census found that one; the
//     audit that filed this task did not.
//
// SCOPE. Value exports only, in the identity cascade's own modules plus
// `atom-registry.ts` — the two halves of the "declared but unread" cluster the
// task named. Type exports are excluded (an interface naming its own function's
// signature is normal, not dead), and in-file use counts as alive.
//
// WHAT THIS CANNOT SEE, stated rather than papered over. The census reads
// `export function|class|const|let NAME`, so it censuses neither CLASS METHODS
// (`IdentityCascade.migratorCount`, `IdentityBusConsumer.policyCount` — both
// flagged by the same audit, both in fact already carrying registration
// assertions in the suites below, which is how the audit got them wrong) nor
// REGISTRY FIELDS (`AtomMeta.label`). The field case is not merely unbuilt, it
// is unbuildable by this machinery: `callSites` is a bare-name grep, and `label`
// occurs some hundreds of times across both silos as a node attr, a menu string
// and a DOM dataset key, so a field census keyed on it would read alive no
// matter what. That hole is the shared module's own documented one, at its
// widest. The mitigation is the same one the machinery already relies on — a
// distinctive name — and the honest statement is that this guard covers the
// exported half of the surface, which is where three of the five dead names
// lived.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  censusFiles,
  censusText,
  deadExports,
  staleAllowlistEntries,
  swallowedInCensusedFiles,
  VALUE_EXPORT,
} from "@/lib/__tests__/_export-census";

const CENSUSED = censusFiles([
  "src/lib/identity/bib-cite-rewrite.ts",
  "src/lib/identity/identity-bus-consumer.ts",
  "src/lib/identity/identity-cascade.ts",
  "src/lib/identity/identity-flag.ts",
  "src/lib/identity/inline-atom-lifecycle-flag.ts",
  "src/lib/identity/sidecar-uid-migrate.ts",
  "src/lib/identity/useIdentityBusConsumer.ts",
  "src/lib/tiptap/atom-registry.ts",
]);

/**
 * `"<rel>::<name>"` → why it earns its keep with NO production caller.
 *
 * TWO entries, both the same shape, and the shape is the only one this surface
 * gets: a flag's WRITE door. `readFlag` is the production reader for each; the
 * setter exists so a suite can drive the other branch of a rollout flag, which
 * is what makes a flag-gated change verifiable at all. Deleting them would not
 * remove a dead path, it would remove the ability to test a live one.
 *
 * That is a deliberately narrow justification. It does NOT extend to "a test
 * uses it" — that is the `cardKindToLegacyAnchorKind` shape the machinery
 * exists to catch, and it is how `isRetype` read alive to a casual grep. An
 * entry belongs here only when the symbol's PURPOSE is to be a test seam.
 * Anything else: WIRE it or DELETE it.
 */
const PERMITTED_UNCALLED: Readonly<Record<string, string>> = {
  "src/lib/identity/identity-flag.ts::setIdentityCascadeFlag":
    "the `virgil:identity-cascade` override door — the only way a suite can " +
    "exercise the flag-ON branch of a default-OFF rollout flag.",
  "src/lib/identity/inline-atom-lifecycle-flag.ts::setInlineAtomLifecycleFlag":
    "the `virgil:inline-atom-lifecycle` override door, same role. Its flag " +
    "also `requires` the cascade flag, so a suite must be able to set both.",
};

describe("identity + atom-registry surface honesty", () => {
  it("every value export has a production caller", () => {
    expect(deadExports(CENSUSED, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the allowlist has not rotted in either direction", () => {
    // A key naming a symbol that is gone sanctions nothing; a key naming a
    // symbol that has SINCE acquired callers is an exemption for code that no
    // longer needs one — which is the very drift being censused.
    expect(staleAllowlistEntries(CENSUSED, PERMITTED_UNCALLED)).toEqual([]);
  });

  it("the scanner swallows nothing in the censused files", () => {
    // The verdict above passes on "no findings", which is also what a blinded
    // scanner produces. An unterminated string would silently shrink what the
    // census can see and turn a live symbol into a reported corpse — or, worse
    // here, hide a real one.
    expect(swallowedInCensusedFiles(CENSUSED)).toEqual([]);
  });

  it("the needle FINDS the declarations this task retired (anti-vacuity)", () => {
    // "Zero findings" is exactly what a broken census reports, so replay the
    // retired declarations — verbatim pre-fix text — as fixtures the REAL
    // needle must still flag. `VALUE_EXPORT` is imported rather than re-spelled
    // here on purpose: a local copy would pass while the machinery the census
    // actually runs had gone blind, which is the failure this leg exists for.
    const retired: Array<[string, string]> = [
      [
        "isRetype",
        "export function isRetype(\n  change: IdentityChange,\n" +
          "): change is { kind: \"bibEntry\"; retype: RetypeChange } {\n" +
          '  return change.kind === "bibEntry" && "retype" in change;\n}\n',
      ],
      [
        "retypeChange",
        "export function retypeChange(c: RetypeChange): IdentityChange {\n" +
          '  return { kind: "bibEntry", retype: c };\n}\n',
      ],
      [
        "CARD_ATOM_DOM_ID_SELECTOR",
        "export const CARD_ATOM_DOM_ID_SELECTOR: string = CARD_ATOM_DOM_ID_ATTRS.map(\n" +
          '  (a) => `[${a}]`,\n).join(",");\n',
      ],
    ];
    for (const [name, declaration] of retired) {
      VALUE_EXPORT.lastIndex = 0; // the shared regex is /g — stateful
      const found = [...censusText(declaration).matchAll(VALUE_EXPORT)].map((m) => m[1]);
      expect(found).toEqual([name]);
    }
  });

  it("the retired names are gone from the shipped modules", () => {
    // The census can only report on what is declared, so a half-landed deletion
    // — the symbol still sitting there, its callers removed — would read GREEN
    // as an allowlist-free dead export only if the census also ran. This asks
    // the blunt question directly, on comment-and-string-blanked source so a
    // doc-comment explaining the retirement (there is one in each file) is not
    // mistaken for the thing itself.
    const gone = ["isRetype", "retypeChange", "RetypeChange", "CARD_ATOM_DOM_ID_SELECTOR"];
    for (const entry of CENSUSED) {
      const code = censusText(readFileSync(entry.file, "utf8"));
      for (const name of gone) {
        expect(`${entry.rel}: ${code.includes(name)}`).toBe(`${entry.rel}: false`);
      }
    }
  });
});
