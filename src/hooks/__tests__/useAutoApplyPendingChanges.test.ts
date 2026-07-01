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
import type { Editor } from "@tiptap/react";

vi.mock("@/hooks/useEditorUIState", () => ({
  paragraphUuidAtSelection: () => null,
}));

// applyOne routes through the shared applySuggestion; mock it so the guard tests
// stay pure (no editor / doc). Default: a successful apply.
const applySuggestionMock = vi.fn(() => ({
  outcome: "applied" as const,
  anchorUuid: "P1",
  appliedChange: {
    anchorId: "anc",
    anchorUuid: "P1",
    originalText: "old",
    replacement: "new",
    mode: "replace" as const,
    appliedAt: "t",
  },
}));
vi.mock("@/links/pending-change-actions", () => ({
  applySuggestion: (...a: unknown[]) => applySuggestionMock(...(a as [])),
}));

import {
  isAutoApplyEligible,
  collectPendingAiSuggestions,
  paragraphsWithInFlightApplied,
  reconcileDispatched,
  applyOne,
  type RevisionAutoApplyFamily,
  type CutterAutoApplyFamily,
  type ResolvedSuggestion,
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

describe("reconcileDispatched — the double-apply id guard reconciliation", () => {
  it("keeps an id whose card still reads pending (the stale-array lag window)", () => {
    const dispatched = new Set(["a"]);
    // Card 'a' is still pending in the (lagging) array → keep the claim so a
    // splice-triggered re-run doesn't re-apply it.
    reconcileDispatched(dispatched, [suggestion({ id: "a", anchorUuid: "P1" })]);
    expect(dispatched.has("a")).toBe(true);
  });

  it("drops an id once its card commits to applied/stale (or is gone)", () => {
    const applied = {
      ...suggestion({ id: "a", anchorUuid: "P1", status: "applied" }),
      appliedChange: {
        anchorId: "anc",
        anchorUuid: "P1",
        originalText: "old",
        replacement: "new",
        mode: "replace" as const,
        appliedAt: "t",
      },
    } as RevisionCard;
    const d1 = new Set(["a"]);
    reconcileDispatched(d1, [applied]); // status applied → real status now guards
    expect(d1.has("a")).toBe(false);

    const d2 = new Set(["b"]);
    reconcileDispatched(d2, [suggestion({ id: "b", anchorUuid: "P1", status: "stale" })]);
    expect(d2.has("b")).toBe(false);

    const d3 = new Set(["c"]);
    reconcileDispatched(d3, []); // card gone (reverted) → drop
    expect(d3.has("c")).toBe(false);
  });

  it("is a no-op on an empty guard", () => {
    const d = new Set<string>();
    reconcileDispatched(d, [suggestion({ id: "a", anchorUuid: "P1" })]);
    expect(d.size).toBe(0);
  });
});

describe("applyOne — the cross-pass double-apply guard", () => {
  function target(id: string, anchorUuid: string): ResolvedSuggestion {
    return {
      card: suggestion({ id, anchorUuid }),
      anchorUuid,
      family: "revision-suggestion",
      setSuggestionStatus: vi.fn(),
      setAppliedChange: vi.fn(),
    };
  }
  const ed = {} as Editor;

  it("skips a card whose id is already claimed in `dispatched` (the race fix)", () => {
    applySuggestionMock.mockClear();
    const dispatched = new Set(["a"]); // claimed in a prior, not-yet-committed pass
    applyOne(ed, target("a", "P1"), null, new Set(), dispatched);
    expect(applySuggestionMock).not.toHaveBeenCalled();
  });

  it("claims the id and applies once; a same-tick re-pass then skips", () => {
    applySuggestionMock.mockClear();
    const dispatched = new Set<string>();
    const inFlight = new Set<string>();
    const t = target("a", "P1");
    // First pass: eligible → claims + applies.
    applyOne(ed, t, null, inFlight, dispatched);
    expect(applySuggestionMock).toHaveBeenCalledTimes(1);
    expect(dispatched.has("a")).toBe(true);
    expect(inFlight.has("P1")).toBe(true);
    // Splice-triggered re-pass with the SAME (still-pending) card + guard: skips.
    applyOne(ed, t, null, new Set(), dispatched);
    expect(applySuggestionMock).toHaveBeenCalledTimes(1);
  });

  it("does not claim an ineligible (deferred) card, so it can apply after the caret leaves", () => {
    applySuggestionMock.mockClear();
    const dispatched = new Set<string>();
    const t = target("a", "P1");
    // Caret in the target paragraph → deferred, NOT claimed.
    applyOne(ed, t, "P1", new Set(), dispatched);
    expect(applySuggestionMock).not.toHaveBeenCalled();
    expect(dispatched.has("a")).toBe(false);
    // Caret left → now eligible → claims + applies.
    applyOne(ed, t, "P2", new Set(), dispatched);
    expect(applySuggestionMock).toHaveBeenCalledTimes(1);
    expect(dispatched.has("a")).toBe(true);
  });
});
