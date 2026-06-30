// @vitest-environment node
//
// Phase 1c — the shared Keep / Revert orchestration (pending-change-actions.ts).
//
// This is the deriver both the card-surface hosts AND the EditorPane
// margin-gutter marker call, so a unit test here pins the SEQUENCE both drivers
// share. The heavy collaborators (`apply-suggestion`'s doc splice + the
// multi-window `.tex` flush) are mocked — we assert the orchestration, not the
// (already-tested) splice mechanics:
//
//   1. Keep: splices via keepPendingChange, flushes the .tex BEFORE flipping
//      card state, then status→accepted + archived→true + appliedChange→undefined.
//   2. Revert: splices via revertPendingChange, flushes, then deletes the card.
//   3. Both no-op (no splice, no flush, no state change) when the card carries
//      no appliedChange — a stale double-Keep / double-Revert.
//   4. docId === null skips the flush (offline / not-yet-registered doc) but
//      still completes the card-state transition.

import { describe, it, expect, vi, beforeEach } from "vitest";

const keepPendingChange = vi.fn<(editor: unknown, args: unknown) => void>();
const revertPendingChange = vi.fn<(editor: unknown, args: unknown) => void>();
// applyPendingChange is mocked so the `applySuggestion` orchestration tests
// assert the SEQUENCE (anchor/mode compute → applyPendingChange → card-state
// flip) without the real doc splice. Default: a successful replace.
const applyPendingChange = vi.fn<
  (editor: unknown, args: unknown) => { ok: true; anchorId: string } | { ok: false; reason: "stale" }
>(() => ({ ok: true, anchorId: "anc-applied" }));
const flushPendingForDoc = vi.fn<(docId: unknown) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock("@/links/apply-suggestion", () => ({
  keepPendingChange: (...a: unknown[]) => keepPendingChange(a[0], a[1]),
  revertPendingChange: (...a: unknown[]) => revertPendingChange(a[0], a[1]),
  applyPendingChange: (...a: unknown[]) => applyPendingChange(a[0], a[1]),
}));
vi.mock("@/lib/multi-window/pending-saves", () => ({
  flushPendingForDoc: (...a: unknown[]) => flushPendingForDoc(a[0]),
}));

import {
  keepSuggestion,
  revertSuggestion,
  applySuggestion,
  type AppliedChangeDescriptor,
  type PendingChangeCardDeps,
  type SuggestionLike,
} from "@/links/pending-change-actions";
import type { Editor } from "@tiptap/react";

const editor = {} as Editor;

const ac: AppliedChangeDescriptor = {
  anchorId: "anc-1",
  anchorUuid: "P1",
  originalText: "old text",
  replacement: "new text",
  mode: "replace",
  appliedAt: "2026-06-30T00:00:00.000Z",
};

/** A deps bag with vi.fn mutators + a single applied card "c1". The mutators
 *  are typed as the `PendingChangeCardDeps` fields (so the bag satisfies the
 *  generic), and re-read off the returned object as `vi.Mock` in assertions. */
function makeDeps(
  hasApplied: boolean,
): PendingChangeCardDeps<"accepted" | "applied"> {
  return {
    getAppliedChange: (id: string) => (hasApplied && id === "c1" ? ac : undefined),
    setSuggestionStatus: vi.fn(),
    setArchived: vi.fn(),
    setAppliedChange: vi.fn(),
    deleteCard: vi.fn(),
    acceptedStatus: "accepted",
  };
}

beforeEach(() => {
  keepPendingChange.mockClear();
  revertPendingChange.mockClear();
  flushPendingForDoc.mockClear();
  applyPendingChange.mockClear();
  applyPendingChange.mockImplementation(() => ({ ok: true, anchorId: "anc-applied" }));
});

describe("keepSuggestion", () => {
  it("splices, flushes, then flips status→accepted + archived + clears appliedChange", () => {
    const deps = makeDeps(true);
    keepSuggestion(editor, "c1", "doc-9", deps);

    expect(keepPendingChange).toHaveBeenCalledTimes(1);
    expect(keepPendingChange).toHaveBeenCalledWith(editor, {
      anchorUuid: "P1",
      mode: "replace",
      anchorId: "anc-1",
      originalText: "old text",
      replacement: "new text",
    });
    expect(flushPendingForDoc).toHaveBeenCalledWith("doc-9");
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "accepted");
    expect(deps.setArchived).toHaveBeenCalledWith("c1", true);
    expect(deps.setAppliedChange).toHaveBeenCalledWith("c1", undefined);
  });

  it("no-ops entirely when the card has no appliedChange (stale double-Keep)", () => {
    const deps = makeDeps(false);
    keepSuggestion(editor, "c1", "doc-9", deps);

    expect(keepPendingChange).not.toHaveBeenCalled();
    expect(flushPendingForDoc).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
    expect(deps.setArchived).not.toHaveBeenCalled();
    expect(deps.setAppliedChange).not.toHaveBeenCalled();
  });

  it("skips the flush when docId is null but still completes the card transition", () => {
    const deps = makeDeps(true);
    keepSuggestion(editor, "c1", null, deps);

    expect(keepPendingChange).toHaveBeenCalledTimes(1);
    expect(flushPendingForDoc).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "accepted");
  });
});

describe("revertSuggestion", () => {
  it("splices, flushes, then deletes the card", () => {
    const deps = makeDeps(true);
    revertSuggestion(editor, "c1", "doc-9", deps);

    expect(revertPendingChange).toHaveBeenCalledTimes(1);
    expect(revertPendingChange).toHaveBeenCalledWith(editor, {
      anchorUuid: "P1",
      originalText: "old text",
      replacement: "new text",
      mode: "replace",
      anchorId: "anc-1",
    });
    expect(flushPendingForDoc).toHaveBeenCalledWith("doc-9");
    expect(deps.deleteCard).toHaveBeenCalledWith("c1");
  });

  it("no-ops entirely when the card has no appliedChange (stale double-Revert)", () => {
    const deps = makeDeps(false);
    revertSuggestion(editor, "c1", "doc-9", deps);

    expect(revertPendingChange).not.toHaveBeenCalled();
    expect(flushPendingForDoc).not.toHaveBeenCalled();
    expect(deps.deleteCard).not.toHaveBeenCalled();
  });
});

// ── Phase 2 — the shared applySuggestion orchestration ─────────────────────
// Both the manual Apply button (revisions-host / cutter-host) AND the new
// auto-apply driver call this, so a unit here pins the SEQUENCE: compute the
// Mode-A anchor + mode → call applyPendingChange → flip the card to
// applied + appliedChange (success) or stale (verbatim miss) or skip (no
// anchor). The real splice is mocked; we assert orchestration only.

/** A SuggestionLike with one Mode-A textObject link to paragraph `P1`. */
function makeSuggestion(over: Partial<SuggestionLike> = {}): SuggestionLike {
  return {
    id: "s1",
    original_text: "old text",
    suggested_text: "new text",
    links: [
      {
        id: "l1",
        kind: "anchor",
        anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: ["P1"] },
        target: { panel: "revisions", cardId: "s1" },
      },
    ],
    ...over,
  } as SuggestionLike;
}

function makeApplyDeps() {
  return {
    editor,
    // Cutter family so the test pins that `family` propagates into the
    // applyPendingChange call (Phase 4, Part A).
    family: "cutter-suggestion" as const,
    setSuggestionStatus: vi.fn(),
    setAppliedChange: vi.fn(),
    generateAnchorId: () => "anc-new",
    appliedStatus: "applied" as const,
    staleStatus: "stale" as const,
  };
}

describe("applySuggestion", () => {
  it("(replace) splices via applyPendingChange, then flips status→applied + sets appliedChange", () => {
    const deps = makeApplyDeps();
    const result = applySuggestion({ ...deps, card: makeSuggestion() });

    expect(applyPendingChange).toHaveBeenCalledTimes(1);
    expect(applyPendingChange).toHaveBeenCalledWith(editor, {
      anchorUuid: "P1",
      originalText: "old text",
      replacement: "new text",
      mode: "replace",
      cardId: "s1",
      anchorId: "anc-new",
      family: "cutter-suggestion",
    });
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("s1", "applied");
    expect(deps.setAppliedChange).toHaveBeenCalledTimes(1);
    const ac2 = (deps.setAppliedChange as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(ac2).toMatchObject({
      anchorId: "anc-applied",
      anchorUuid: "P1",
      originalText: "old text",
      replacement: "new text",
      mode: "replace",
    });
    expect(result).toMatchObject({ outcome: "applied", anchorUuid: "P1" });
  });

  it("(delete) derives mode:'delete' when suggested_text is empty", () => {
    const deps = makeApplyDeps();
    applySuggestion({ ...deps, card: makeSuggestion({ suggested_text: "" }) });

    expect(applyPendingChange).toHaveBeenCalledWith(
      editor,
      expect.objectContaining({ mode: "delete", replacement: "" }),
    );
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("s1", "applied");
  });

  it("marks the card stale (no appliedChange) when applyPendingChange refuses", () => {
    applyPendingChange.mockImplementation(() => ({ ok: false, reason: "stale" }));
    const deps = makeApplyDeps();
    const result = applySuggestion({ ...deps, card: makeSuggestion() });

    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("s1", "stale");
    expect(deps.setAppliedChange).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "stale" });
  });

  it("skips (no splice, no card change) when the card has no Mode-A anchor", () => {
    const deps = makeApplyDeps();
    const result = applySuggestion({ ...deps, card: makeSuggestion({ links: [] }) });

    expect(applyPendingChange).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
    expect(deps.setAppliedChange).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: "skipped" });
  });
});
