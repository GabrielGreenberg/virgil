// @vitest-environment node
//
// The anchor-highlight reconciler must paint an APPLIED pending-AI-change as an
// inline text highlight on the AI-written span — NOT the whole-paragraph
// vertical bar. It does that by synthesizing a Mode-B text-range link onto the
// live blue mark (`appliedChange.anchorId`) instead of following the card's
// persisted links, which still point at the now-replaced ORIGINAL span. These
// pin `appliedChangeLink`, the pure synthesis:
//   - an applied suggestion → a linkedRange link on appliedChange.anchorId,
//     tagged with the SPINE kind (revision-suggestion / cutter-suggestion);
//   - pending / stale / non-suggestion / missing-appliedChange → null (fall
//     back to the persisted links → resolveLink's normal behavior).

import { describe, it, expect } from "vitest";
import { appliedChangeLink } from "../useAnchorHighlightReconciler";
import type { AnchoredCardRef } from "../anchored-card-store";

const APPLIED = {
  id: "rs1",
  kind: "suggestion" as const,
  status: "applied" as const,
  appliedChange: {
    anchorId: "anc-blue-1",
    anchorUuid: "para-uuid-1",
    replacement: "The revised (AI) sentence.",
    originalText: "The original sentence.",
    mode: "replace" as const,
    appliedAt: "t",
  },
  links: [
    // The STALE original link the reconciler must NOT follow for an applied card.
    { id: "orig-link", kind: "anchor", anchor: {}, target: {} } as never,
  ],
};

const revRef: AnchoredCardRef = { kind: "revision-suggestion", id: "rs1" };
const cutRef: AnchoredCardRef = { kind: "cutter-suggestion", id: "rs1" };

describe("appliedChangeLink — inline highlight for an applied pending-AI-change", () => {
  it("synthesizes a Mode-B text-range link onto appliedChange.anchorId", () => {
    const link = appliedChangeLink(revRef, APPLIED);
    expect(link).not.toBeNull();
    expect(link!.kind).toBe("anchor");
    expect(link!.anchor.type).toBe("textObject");
    // resolveLink follows anchor.textRange.anchorId → the live blue mark.
    expect((link!.anchor as { targetKind?: string }).targetKind).toBe("linkedRange");
    expect((link!.anchor as { textRange?: { anchorId: string } }).textRange?.anchorId).toBe(
      "anc-blue-1",
    );
    // Anchored inside the paragraph uuid; target carries the SPINE kind (not raw "suggestion").
    expect((link!.anchor as { textObjectIds?: string[] }).textObjectIds).toEqual(["para-uuid-1"]);
    expect(link!.target.ref.kind).toBe("revision-suggestion");
    expect(link!.target.ref.id).toBe("rs1");
  });

  it("tags the cutter family with cutter-suggestion", () => {
    const link = appliedChangeLink(cutRef, APPLIED);
    expect(link!.target.ref.kind).toBe("cutter-suggestion");
  });

  it("returns null for a pending (not-yet-applied) suggestion", () => {
    const pending = { ...APPLIED, status: "pending" as const, appliedChange: undefined };
    expect(appliedChangeLink(revRef, pending)).toBeNull();
  });

  it("returns null for a stale suggestion (mark would be gone)", () => {
    const stale = { ...APPLIED, status: "stale" as const };
    expect(appliedChangeLink(revRef, stale)).toBeNull();
  });

  it("returns null when appliedChange is absent even if status reads applied", () => {
    const noAc = { ...APPLIED, appliedChange: undefined };
    expect(appliedChangeLink(revRef, noAc)).toBeNull();
  });

  it("returns null for a non-suggestion ref (note/todo/etc)", () => {
    expect(appliedChangeLink({ kind: "note", id: "n1" }, APPLIED)).toBeNull();
    expect(appliedChangeLink({ kind: "todo", id: "t1" }, APPLIED)).toBeNull();
  });

  it("returns null for a revision COMMENT (kind suggestion required)", () => {
    const comment = { ...APPLIED, kind: "comment" as const };
    expect(appliedChangeLink(revRef, comment)).toBeNull();
  });
});
