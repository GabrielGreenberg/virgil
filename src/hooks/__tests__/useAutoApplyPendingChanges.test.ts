// @vitest-environment node
//
// Phase 2 — the auto-apply driver's pure gate logic.
//
// The React-effect timing (batch trigger fires on mount / card-set change; the
// selection-leave callback fires from useEditorUIState's subscriber) is verified
// in-browser later. Here we pin the ISOLABLE pure logic the driver is built on:
//   (a) a safe AI-pending suggestion is eligible;
//   (b) caret-in-the-target-paragraph defers it (not eligible);
//   (d) a second pending suggestion on a paragraph that already holds an applied
//       change waits (serialize per paragraph);
//   (e) a human-authored pending suggestion is NEVER eligible.
// (Case (c) — stale → status `stale`, no mutation — is `applySuggestion`'s
// contract, pinned in links/__tests__/pending-change-actions.test.ts.)
//
// `useEditorUIState` is mocked to a stub `paragraphUuidAtSelection` so importing
// the driver doesn't pull the storage-fsa chain (the pure functions under test
// never call it).

import { describe, it, expect, vi } from "vitest";

vi.mock("@/hooks/useEditorUIState", () => ({
  paragraphUuidAtSelection: () => null,
}));

import {
  isAutoApplyEligible,
  collectPendingAiSuggestions,
  paragraphsWithInFlightApplied,
  type RevisionAutoApplyFamily,
  type CutterAutoApplyFamily,
} from "../useAutoApplyPendingChanges";
import type {
  CutterCard,
  RevisionCard,
  RevisionSuggestionCard,
} from "@/lib/types";

/** A revision suggestion card with one Mode-A textObject link to `anchorUuid`. */
function suggestion(
  over: Partial<RevisionSuggestionCard> & { id: string; anchorUuid?: string },
): RevisionSuggestionCard {
  const { anchorUuid, ...rest } = over;
  return {
    kind: "suggestion",
    createdAt: "t",
    author: "ai",
    original_text: "old",
    suggested_text: "new",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    links: anchorUuid
      ? [
          {
            id: `l-${over.id}`,
            kind: "anchor",
            anchor: {
              type: "textObject",
              targetKind: "paragraph",
              textObjectIds: [anchorUuid],
            },
            target: { panel: "revisions", cardId: over.id },
          },
        ]
      : [],
    ...rest,
  } as RevisionSuggestionCard;
}

const noMutators = {
  setSuggestionStatus: vi.fn(),
  setAppliedChange: vi.fn(),
};

describe("isAutoApplyEligible — the per-suggestion gate", () => {
  const base = {
    card: { author: "ai" as const, status: "pending" as const },
    anchorUuid: "P1",
    caretParagraphUuid: null as string | null,
    paragraphHasInFlightApplied: false,
  };

  it("(a) a safe AI-pending suggestion is eligible", () => {
    expect(isAutoApplyEligible(base)).toBe(true);
  });

  it("(b) caret IN the target paragraph defers it", () => {
    expect(isAutoApplyEligible({ ...base, caretParagraphUuid: "P1" })).toBe(false);
    // caret elsewhere is fine
    expect(isAutoApplyEligible({ ...base, caretParagraphUuid: "P2" })).toBe(true);
  });

  it("(d) waits when the paragraph already holds an in-flight applied change", () => {
    expect(
      isAutoApplyEligible({ ...base, paragraphHasInFlightApplied: true }),
    ).toBe(false);
  });

  it("(e) a human-authored suggestion is NOT eligible", () => {
    expect(
      isAutoApplyEligible({ ...base, card: { author: "human", status: "pending" } }),
    ).toBe(false);
  });

  it("excludes non-pending statuses and missing anchors", () => {
    expect(
      isAutoApplyEligible({ ...base, card: { author: "ai", status: "applied" } }),
    ).toBe(false);
    expect(isAutoApplyEligible({ ...base, anchorUuid: null })).toBe(false);
  });
});

describe("collectPendingAiSuggestions — the candidate filter", () => {
  function fam(cards: RevisionCard[]): RevisionAutoApplyFamily {
    return { cards, ...noMutators };
  }
  const emptyCutter: CutterAutoApplyFamily = { cards: [] as CutterCard[], ...noMutators };

  it("keeps AI-pending suggestions with a resolvable anchor, resolved to their uuid", () => {
    const out = collectPendingAiSuggestions(
      fam([suggestion({ id: "a", anchorUuid: "P1" })]),
      emptyCutter,
    );
    expect(out).toHaveLength(1);
    expect(out[0].card.id).toBe("a");
    expect(out[0].anchorUuid).toBe("P1");
    // Phase 4, Part A: a revision-family suggestion is tagged so the blue mark's
    // linkCard token carries the right family downstream.
    expect(out[0].family).toBe("revision-suggestion");
  });

  it("tags a cutter-family suggestion with family 'cutter-suggestion'", () => {
    const emptyRev: RevisionAutoApplyFamily = {
      cards: [] as RevisionCard[],
      ...noMutators,
    };
    const cutterFam: CutterAutoApplyFamily = {
      cards: [suggestion({ id: "c", anchorUuid: "P1" }) as unknown as CutterCard],
      ...noMutators,
    };
    const out = collectPendingAiSuggestions(emptyRev, cutterFam);
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe("cutter-suggestion");
  });

  it("(e) drops human-authored suggestions", () => {
    const out = collectPendingAiSuggestions(
      fam([suggestion({ id: "h", anchorUuid: "P1", author: "human" })]),
      emptyCutter,
    );
    expect(out).toHaveLength(0);
  });

  it("drops non-pending suggestions and anchorless ones (not applicable)", () => {
    const out = collectPendingAiSuggestions(
      fam([
        suggestion({ id: "applied", anchorUuid: "P1", status: "applied" }),
        suggestion({ id: "noanchor" }), // no anchorUuid → links: []
      ]),
      emptyCutter,
    );
    expect(out).toHaveLength(0);
  });
});

describe("paragraphsWithInFlightApplied — per-paragraph serialization source", () => {
  it("(d) reports the uuids of every applied suggestion carrying an appliedChange", () => {
    const cards: RevisionCard[] = [
      {
        ...suggestion({ id: "x", anchorUuid: "P1", status: "applied" }),
        appliedChange: {
          anchorId: "anc",
          anchorUuid: "P1",
          originalText: "old",
          replacement: "new",
          mode: "replace",
          appliedAt: "t",
        },
      },
      suggestion({ id: "y", anchorUuid: "P2" }), // pending, no appliedChange
    ];
    const set = paragraphsWithInFlightApplied(cards);
    expect(set.has("P1")).toBe(true);
    expect(set.has("P2")).toBe(false);
  });

  it("ignores comment cards and applied cards with no appliedChange", () => {
    const cards: RevisionCard[] = [
      {
        kind: "comment",
        id: "c",
        createdAt: "t",
        text: "",
        content: {},
        aiRequest: false,
        links: [],
      } as RevisionCard,
      suggestion({ id: "z", anchorUuid: "P3", status: "applied" }), // applied but no appliedChange
    ];
    expect(paragraphsWithInFlightApplied(cards).size).toBe(0);
  });
});
