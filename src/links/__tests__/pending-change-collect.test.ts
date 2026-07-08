// @vitest-environment node
//
// Phase 3 — the pure collectors for the applied-pending AI change set
// (pending-change-collect.ts). The omni BULK index (Keep-all / Revert-all) and
// the floating PILL both depend on this membership rule, so a unit here pins it:
//
//   1. isAppliedPending: TRUE only for a `suggestion` card with status "applied"
//      AND an `appliedChange`; FALSE for comments, pending/accepted/stale, and an
//      applied card whose `appliedChange` was already cleared (a kept card).
//   2. collectAppliedPendingIds: order-stable ids of exactly the applied set,
//      across a mixed revision/cutter array.
//   3. findAppliedPendingByAnchorId: resolves the owning card by the blue mark's
//      anchorId (the pill's caret-focus lookup), null when none owns the range.

import { describe, it, expect } from "vitest";
import {
  isAppliedPending,
  collectAppliedPendingIds,
  findAppliedPendingByAnchorId,
} from "@/links/pending-change-collect";
import type { RevisionCard, CutterCard } from "@/lib/types";

/** Minimal applied revision-suggestion card (structurally complete enough for
 *  the predicate; cast to the real type so the array typing matches the API). */
function appliedRevision(id: string, anchorId: string): RevisionCard {
  return {
    kind: "suggestion",
    id,
    createdAt: "2026-06-30T00:00:00.000Z",
    author: "ai",
    original_text: "old",
    suggested_text: "new",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "applied",
    appliedChange: {
      anchorId,
      anchorUuid: "P1",
      originalText: "old",
      replacement: "new",
      mode: "replace",
      appliedAt: "2026-06-30T00:00:00.000Z",
    },
    links: [],
  } as RevisionCard;
}

function pendingRevision(id: string): RevisionCard {
  return {
    kind: "suggestion",
    id,
    createdAt: "2026-06-30T00:00:00.000Z",
    author: "ai",
    original_text: "old",
    suggested_text: "new",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "pending",
    links: [],
  } as RevisionCard;
}

function revisionRequest(id: string): RevisionCard {
  return {
    kind: "comment",
    id,
    createdAt: "2026-06-30T00:00:00.000Z",
    content: { type: "doc", content: [] },
    links: [],
  } as unknown as RevisionCard;
}

function appliedCutter(id: string, anchorId: string): CutterCard {
  return {
    kind: "suggestion",
    id,
    createdAt: "2026-06-30T00:00:00.000Z",
    author: "ai",
    original_text: "old",
    suggested_text: "",
    explanation: "",
    user_text: "",
    instructions: "",
    status: "applied",
    appliedChange: {
      anchorId,
      anchorUuid: "P2",
      originalText: "old",
      replacement: "",
      mode: "delete",
      appliedAt: "2026-06-30T00:00:00.000Z",
    },
    links: [],
  } as unknown as CutterCard;
}

describe("isAppliedPending", () => {
  it("is true for an applied suggestion with an appliedChange", () => {
    expect(isAppliedPending(appliedRevision("r1", "a1"))).toBe(true);
    expect(isAppliedPending(appliedCutter("c1", "a2"))).toBe(true);
  });

  it("is false for a comment (no status / appliedChange)", () => {
    expect(isAppliedPending(revisionRequest("rc1"))).toBe(false);
  });

  it("is false for a non-applied suggestion status", () => {
    expect(isAppliedPending(pendingRevision("r2"))).toBe(false);
  });

  it("is false for an applied suggestion whose appliedChange was cleared (a kept card)", () => {
    const kept = { ...appliedRevision("r3", "a3"), appliedChange: undefined } as RevisionCard;
    expect(isAppliedPending(kept)).toBe(false);
  });
});

describe("collectAppliedPendingIds", () => {
  it("collects exactly the applied ids, in source order, across a mixed array", () => {
    const cards: RevisionCard[] = [
      revisionRequest("c0"),
      appliedRevision("r1", "a1"),
      pendingRevision("p0"),
      appliedRevision("r2", "a2"),
    ];
    expect(collectAppliedPendingIds(cards)).toEqual(["r1", "r2"]);
  });

  it("returns [] when nothing is applied", () => {
    expect(collectAppliedPendingIds([pendingRevision("p1"), revisionRequest("c1")])).toEqual([]);
  });
});

describe("findAppliedPendingByAnchorId", () => {
  it("resolves the owning applied card by anchorId", () => {
    const cards = [appliedRevision("r1", "a1"), appliedCutter("c1", "a2")];
    expect(findAppliedPendingByAnchorId(cards, "a2")).toBe("c1");
    expect(findAppliedPendingByAnchorId(cards, "a1")).toBe("r1");
  });

  it("returns null when no applied card owns that anchorId", () => {
    const cards = [appliedRevision("r1", "a1")];
    expect(findAppliedPendingByAnchorId(cards, "nope")).toBeNull();
    // A pending suggestion with a matching id-less shape is never matched.
    expect(findAppliedPendingByAnchorId([pendingRevision("p1")], "a1")).toBeNull();
  });
});
