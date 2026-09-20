// TASK 666 — census: "which collections carry a Mode-B anchor?" is asked ONCE.
//
// The defect this pins: the question was asked in FOUR places as four
// hand-kept parallel lists, and they did not agree —
//
//   useLinkedAnchorReconciler   notes highlights cutterCards comments reportCards todos   (6)
//   reapply-mode-b-anchors      notes todoItems comments cutterCards reports highlights   (6)
//   EditorLayout (hoveredAnchorId literal)  notes cutter comments todoItems               (4 + archive)
//   useTextHoverBridge          notes cutterCards comments reportCards                    (4)
//
// so a highlight's anchored text, and a selection-created todo's, was painted
// but inert in BOTH directions. That is the "a registry earns its name by being
// read" law's failure shape: one membership question, N lists, and the narrowest
// list silently loses a feature.
//
// Two halves, both durable:
//   (A) MEMBERSHIP is derived, and the declared slot table agrees with it — so
//       a new Mode-B kind cannot be half-added.
//   (B) every consumer READS the derived set; none re-lists it. Allowlist EMPTY.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MODE_B_CARD_KINDS,
  MODE_B_COLLECTIONS,
  carriesModeBAnchor,
  markKindForCardKind,
  forEachModeBCard,
  type ModeBSlot,
  type ModeBBag,
} from "@/cards/mode-b-collections";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import { CARD_KINDS, isAnchoredCardKind } from "@/cards/predicates";
import { legacyDataKindForCardKind } from "@/cards/legacy-token-crosswalk";

const ROOT = resolve(__dirname, "../../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

// Type-level: every Mode-B slot is a slot of the shared entity bag, and is
// REQUIRED there. Optionality on `highlights` / `reportCards` is exactly what
// let the shell's literal omit them and still compile (they are now required).
type _SlotsAreEntitySlots = ModeBSlot extends keyof EntityCollectionSlots
  ? true
  : never;
const _slotsAreEntitySlots: _SlotsAreEntitySlots = true;
type _NoOptionalModeBSlot = undefined extends EntityCollectionSlots["highlights"]
  ? never
  : undefined extends EntityCollectionSlots["reportCards"]
    ? never
    : true;
const _noOptionalModeBSlot: _NoOptionalModeBSlot = true;

describe("Mode-B collection set — (A) membership is DERIVED and the table agrees", () => {
  it("membership comes from the crosswalk facet that already declared it", () => {
    // `legacyDataKind`'s own contract is "null if this kind never carries a
    // `linkedAnchor` mark" — so the fact was written down before task 666; it
    // just was not read. No new registry facet was added.
    for (const kind of CARD_KINDS) {
      expect(carriesModeBAnchor(kind)).toBe(
        isAnchoredCardKind(kind) && legacyDataKindForCardKind(kind) !== null,
      );
    }
  });

  it("the derived Mode-B kind set is the nine mark-bearing kinds", () => {
    expect([...MODE_B_CARD_KINDS].sort()).toEqual(
      [
        "note",
        "highlight",
        "todo",
        "report",
        "report-request",
        "revision-comment",
        "revision-suggestion",
        "cutter-comment",
        "cutter-suggestion",
      ].sort(),
    );
    // Anchored but NOT Mode-B: archive is paragraph-anchored (Mode-A), footnote
    // and citation ride inline ATOMS, example is derived. `archiveSnippets`
    // appearing in the shell's old literal was therefore NOT a fifth-member
    // disagreement — it rides along because `findEntity` is generic over all
    // anchored kinds, and it resolves no text anchor.
    for (const k of ["archive", "footnote", "citation", "example"] as const) {
      expect(isAnchoredCardKind(k)).toBe(true);
      expect(carriesModeBAnchor(k)).toBe(false);
    }
  });

  it("the declared slot table covers EXACTLY the derived set — no kind half-added", () => {
    const bound = MODE_B_COLLECTIONS.flatMap((c) => c.kinds);
    expect(bound.length).toBe(new Set(bound).size); // each kind bound once
    expect([...bound].sort()).toEqual([...MODE_B_CARD_KINDS].sort());
  });

  it("highlights are LAST — the overlap last-wins order the re-apply depends on", () => {
    // A highlight whose range sits inside a broader revision/cutter selection
    // must win the overlap, or `LinkedAnchorGuard` fires a spurious orphan.
    expect(MODE_B_COLLECTIONS[MODE_B_COLLECTIONS.length - 1].slot).toBe("highlights");
    expect(MODE_B_COLLECTIONS.map((c) => c.slot)).toEqual([
      "notes",
      "todoItems",
      "comments",
      "cutterCards",
      "reportCards",
      "highlights",
    ]);
  });

  it("every Mode-B kind resolves to a mark kind, and only the revision pair folds", () => {
    for (const k of MODE_B_CARD_KINDS) {
      const mark = markKindForCardKind(k);
      expect(mark).not.toBeNull();
      if (k === "revision-comment" || k === "revision-suggestion") {
        expect(mark).toBe("revision"); // the one many-to-one fold
      } else {
        expect(mark).toBe(legacyDataKindForCardKind(k));
      }
    }
  });

  it("the shared walker visits every slot, in table order, with the resolved kind", () => {
    const bag: ModeBBag = {
      notes: [{ id: "n" }],
      todoItems: [{ id: "t" }],
      comments: [{ id: "rs", kind: "suggestion" }],
      cutterCards: [{ id: "cc", kind: "comment" }],
      reportCards: [{ id: "rr", kind: "report-request" }],
      highlights: [{ id: "h" }],
    };
    const seen: Array<[string, string]> = [];
    forEachModeBCard(bag, (record, kind) => seen.push([record.id, kind]));
    expect(seen).toEqual([
      ["n", "note"],
      ["t", "todo"],
      ["rs", "revision-suggestion"],
      ["cc", "cutter-comment"],
      ["rr", "report-request"],
      ["h", "highlight"],
    ]);
  });
});

// ── (B) No consumer re-lists the set ────────────────────────────────────────

const SLOT_NAMES: readonly string[] = [
  "notes",
  "highlights",
  "todoItems",
  "comments",
  "cutterCards",
  "reportCards",
];

/** The consumers of the Mode-B set — each must read the SSOT. */
const CONSUMERS = [
  "src/links/_shared/useTextHoverBridge.ts",
  "src/links/_shared/useLinkedAnchorReconciler.ts",
  "src/links/_shared/reapply-mode-b-anchors.ts",
  "src/components/EditorLayout.tsx",
] as const;

/** Files permitted to enumerate the slot names as a literal group. EMPTY of
 *  consumers by design: the ONE bag-construction site (EditorPane) and the SSOT
 *  itself are where the names legitimately appear, and the shell's inert
 *  fallback bag. If a fifth consumer needs a row here, that is the drift this
 *  census exists to refuse — give it the `ModeBBag` instead. */
const SLOT_LITERAL_SITES: readonly string[] = [
  "src/cards/mode-b-collections.ts",
  "src/cards/entity-collections.ts",
  "src/components/EditorPane.tsx",
  "src/components/EditorLayout.tsx",
];

/** The consumer allowlist — a consumer that hand-lists the set instead of
 *  reading the SSOT. MUST STAY EMPTY. */
const CONSUMER_ALLOWLIST: readonly string[] = [];

describe("Mode-B collection set — (B) every consumer READS it", () => {
  it("each consumer imports the SSOT", () => {
    expect(CONSUMER_ALLOWLIST).toEqual([]);
    for (const file of CONSUMERS) {
      expect(read(file), file).toMatch(/from "@\/cards\/mode-b-collections"/);
    }
  });

  it("no consumer enumerates the slot names in its own argument list", () => {
    // The hover bridge and the two reconcilers must carry NO slot-name group of
    // their own — they take the total `ModeBBag`. (EditorLayout is excluded
    // only for its ONE inert empty-bag fallback constant, which is a bag, not a
    // membership decision; it is `Record<ModeBSlot, …>`-typed, so it cannot be
    // written short.)
    for (const file of CONSUMERS) {
      if (SLOT_LITERAL_SITES.includes(file)) continue;
      const src = read(file);
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const window = lines.slice(i, i + 12).join("\n");
        const hits = SLOT_NAMES.filter((s) =>
          new RegExp(`(^|[^\\w.])${s}\\s*:`, "m").test(window),
        );
        expect(
          hits.length,
          `${file}:${i + 1} re-lists the Mode-B set (${hits.join(", ")}) — ` +
            `take the total ModeBBag instead`,
        ).toBeLessThan(3);
      }
    }
  });

  it("the shell resolves a hovered card's anchor from the PANE's bag, not its own literal", () => {
    const shell = read("src/components/EditorLayout.tsx");
    // The bag handed to `entityToAnchorId` spreads the pane's Mode-B bag.
    expect(shell).toMatch(/\{ \.\.\.modeBCards, archiveSnippets, examples: \[\] \}/);
    expect(shell).toMatch(/paneState\?\.modeBCards/);
  });
});
