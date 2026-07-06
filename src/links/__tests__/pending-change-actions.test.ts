// @vitest-environment node
//
// The shared applied-change orchestration (pending-change-actions.ts).
//
// This is the deriver both the card-surface hosts AND the EditorPane
// margin-gutter marker / pill call, so a unit test here pins the SEQUENCE all
// drivers share. The heavy collaborators (`apply-suggestion`'s doc splice + the
// multi-window `.tex` flush) are mocked — we assert the orchestration, not the
// (already-tested) splice mechanics:
//
//   1. Keep: splices via keepPendingChange, flushes the .tex BEFORE flipping
//      card state, then status→accepted + archived→true + appliedChange→undefined.
//   2. Dismiss (SESSION 4 — dismiss-PRESERVES): splices via revertPendingChange,
//      flushes, then status→rejected + archived→true + appliedChange→undefined —
//      and NEVER hard-deletes the card (no deleteCard in the deps anymore).
//   3. Both no-op (no splice, no flush, no state change) when the card carries
//      no appliedChange — a stale double-Keep / double-Cross.
//   4. docId === null skips the flush (offline / not-yet-registered doc) but
//      still completes the card-state transition.
//   5. Preview toggle (previewOriginal / previewSuggested): non-committing —
//      splices + records the preview dir, but NEVER touches card status /
//      archived / appliedChange.
//   6. Mid-preview commit determinism: Check reconciles from `appliedChange`
//      (re-applies the suggested view when previewing original) BEFORE keeping;
//      Cross is idempotent from either preview direction.

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
// insertParagraphAfter (the non-destructive insert primitive) + removeLinkedAnchor
// (the applied-teardown) are mocked so the `insertSuggestionBelow` orchestration
// test asserts the SEQUENCE without a real editor/doc. Default: a successful insert.
const insertParagraphAfter = vi.fn<
  (editor: unknown, uuid: unknown, latex: unknown) => boolean
>(() => true);
const removeLinkedAnchor = vi.fn<(editor: unknown, anchorId: unknown) => void>();

vi.mock("@/links/apply-suggestion", () => ({
  keepPendingChange: (...a: unknown[]) => keepPendingChange(a[0], a[1]),
  revertPendingChange: (...a: unknown[]) => revertPendingChange(a[0], a[1]),
  applyPendingChange: (...a: unknown[]) => applyPendingChange(a[0], a[1]),
  insertParagraphAfter: (...a: unknown[]) =>
    insertParagraphAfter(a[0], a[1], a[2]),
}));
vi.mock("@/lib/multi-window/pending-saves", () => ({
  flushPendingForDoc: (...a: unknown[]) => flushPendingForDoc(a[0]),
}));
// Partial-mock links: keep the real getLinkedTextObjectIds (the applySuggestion
// tests rely on it) but stub removeLinkedAnchor (no real editor here).
vi.mock("@/links/links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/links/links")>()),
  removeLinkedAnchor: (...a: unknown[]) => removeLinkedAnchor(a[0], a[1]),
}));

import {
  keepSuggestion,
  dismissSuggestion,
  previewOriginal,
  previewSuggested,
  applySuggestion,
  insertSuggestionBelow,
  type AppliedChangeDescriptor,
  type PendingChangeCardDeps,
  type InsertBelowCardDeps,
  type SuggestionLike,
} from "@/links/pending-change-actions";
import {
  getPreviewDir,
  resetPreviewDir,
  setPreviewDir,
} from "@/links/pending-preview-store";
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

const deleteAc: AppliedChangeDescriptor = {
  ...ac,
  replacement: "",
  mode: "delete",
};

/** A deps bag with vi.fn mutators + a single applied card "c1". The mutators
 *  are typed as the `PendingChangeCardDeps` fields (so the bag satisfies the
 *  generic), and re-read off the returned object as `vi.Mock` in assertions.
 *  `over` swaps in a different appliedChange (e.g. the delete-mode descriptor). */
function makeDeps(
  hasApplied: boolean,
  applied: AppliedChangeDescriptor = ac,
): PendingChangeCardDeps<"accepted" | "applied" | "rejected"> {
  return {
    getAppliedChange: (id: string) =>
      hasApplied && id === "c1" ? applied : undefined,
    setSuggestionStatus: vi.fn(),
    setArchived: vi.fn(),
    setAppliedChange: vi.fn(),
    family: "revision-suggestion",
    acceptedStatus: "accepted",
    rejectedStatus: "rejected",
  };
}

beforeEach(() => {
  keepPendingChange.mockClear();
  revertPendingChange.mockClear();
  flushPendingForDoc.mockClear();
  applyPendingChange.mockClear();
  applyPendingChange.mockImplementation(() => ({ ok: true, anchorId: "anc-applied" }));
  insertParagraphAfter.mockClear();
  insertParagraphAfter.mockImplementation(() => true);
  removeLinkedAnchor.mockClear();
  // The preview store is a REAL module-level store (not mocked) — reset the
  // test card so each case starts on the default "suggested" direction.
  resetPreviewDir("c1");
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

describe("dismissSuggestion (dismiss-PRESERVES)", () => {
  it("restores the original, flushes, then status→rejected + archived + clears appliedChange — and NEVER deletes", () => {
    const deps = makeDeps(true);
    dismissSuggestion(editor, "c1", "doc-9", deps);

    expect(revertPendingChange).toHaveBeenCalledTimes(1);
    expect(revertPendingChange).toHaveBeenCalledWith(editor, {
      anchorUuid: "P1",
      originalText: "old text",
      replacement: "new text",
      mode: "replace",
      anchorId: "anc-1",
    });
    expect(flushPendingForDoc).toHaveBeenCalledWith("doc-9");
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "rejected");
    expect(deps.setArchived).toHaveBeenCalledWith("c1", true);
    expect(deps.setAppliedChange).toHaveBeenCalledWith("c1", undefined);
    // The whole point of SESSION 4: the card + its comment survive.
    expect(deps).not.toHaveProperty("deleteCard");
  });

  it("no-ops entirely when the card has no appliedChange (stale double-Cross)", () => {
    const deps = makeDeps(false);
    dismissSuggestion(editor, "c1", "doc-9", deps);

    expect(revertPendingChange).not.toHaveBeenCalled();
    expect(flushPendingForDoc).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
    expect(deps.setArchived).not.toHaveBeenCalled();
  });

  it("resets the preview direction back to suggested", () => {
    setPreviewDir("c1", "original");
    dismissSuggestion(editor, "c1", "doc-9", makeDeps(true));
    expect(getPreviewDir("c1")).toBe("suggested");
  });
});

// ── SESSION 4 — the non-committing Original / Suggested preview toggle ──────
describe("previewOriginal / previewSuggested (non-committing)", () => {
  it("previewOriginal restores the original + records the dir, WITHOUT touching card state", () => {
    const deps = makeDeps(true);
    previewOriginal(editor, "c1", "doc-9", deps);

    expect(revertPendingChange).toHaveBeenCalledTimes(1);
    expect(getPreviewDir("c1")).toBe("original");
    expect(flushPendingForDoc).toHaveBeenCalledWith("doc-9");
    // Non-committing: no status / archived / appliedChange change.
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
    expect(deps.setArchived).not.toHaveBeenCalled();
    expect(deps.setAppliedChange).not.toHaveBeenCalled();
  });

  it("previewSuggested re-applies the suggested splice + records the dir, WITHOUT touching card state", () => {
    setPreviewDir("c1", "original");
    const deps = makeDeps(true);
    previewSuggested(editor, "c1", "doc-9", deps);

    expect(applyPendingChange).toHaveBeenCalledTimes(1);
    expect(applyPendingChange).toHaveBeenCalledWith(editor, {
      anchorUuid: "P1",
      originalText: "old text",
      replacement: "new text",
      mode: "replace",
      cardId: "c1",
      anchorId: "anc-1",
      family: "revision-suggestion",
    });
    expect(getPreviewDir("c1")).toBe("suggested");
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
  });

  it("previewOriginal no-ops when already previewing the original (no double-splice)", () => {
    setPreviewDir("c1", "original");
    previewOriginal(editor, "c1", "doc-9", makeDeps(true));
    expect(revertPendingChange).not.toHaveBeenCalled();
  });

  it("a full round-trip is lossless (original → suggested → original) and never commits", () => {
    const deps = makeDeps(true);
    previewOriginal(editor, "c1", "doc-9", deps); // suggested → original
    previewSuggested(editor, "c1", "doc-9", deps); // original → suggested
    previewOriginal(editor, "c1", "doc-9", deps); // suggested → original
    expect(getPreviewDir("c1")).toBe("original");
    expect(revertPendingChange).toHaveBeenCalledTimes(2);
    expect(applyPendingChange).toHaveBeenCalledTimes(1);
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
    expect(deps.setAppliedChange).not.toHaveBeenCalled();
  });
});

// ── SESSION 4 — mid-preview commit determinism ─────────────────────────────
describe("commit determinism reads appliedChange, not the transient preview", () => {
  it("Check while previewing ORIGINAL re-applies the suggested view BEFORE keeping (replace)", () => {
    setPreviewDir("c1", "original");
    const deps = makeDeps(true);
    keepSuggestion(editor, "c1", "doc-9", deps);

    // Reconcile: re-apply the suggested splice, then finalize it.
    expect(applyPendingChange).toHaveBeenCalledTimes(1);
    expect(keepPendingChange).toHaveBeenCalledTimes(1);
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "accepted");
    expect(getPreviewDir("c1")).toBe("suggested");
  });

  it("Check while previewing SUGGESTED does NOT re-apply (no reconcile needed)", () => {
    const deps = makeDeps(true); // default preview dir = suggested
    keepSuggestion(editor, "c1", "doc-9", deps);

    expect(applyPendingChange).not.toHaveBeenCalled();
    expect(keepPendingChange).toHaveBeenCalledTimes(1);
  });

  it("Cross while previewing ORIGINAL still restores the original deterministically (delete mode)", () => {
    setPreviewDir("c1", "original");
    const deps = makeDeps(true, deleteAc);
    dismissSuggestion(editor, "c1", "doc-9", deps);

    expect(revertPendingChange).toHaveBeenCalledWith(editor, {
      anchorUuid: "P1",
      originalText: "old text",
      replacement: "",
      mode: "delete",
      anchorId: "anc-1",
    });
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "rejected");
    expect(getPreviewDir("c1")).toBe("suggested");
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

// ── insertSuggestionBelow — the third landing verb (retires the 4-field fallback) ──
//
// The escape hatch behind the retired AI 4-field grid: drop `suggested_text` as
// a new paragraph below the anchor (non-destructive), then retire the card.
// The heavy collaborators (insertParagraphAfter's real doc insert, removeLinkedAnchor,
// the .tex flush) are mocked — we assert the SEQUENCE.

/** An InsertBelow deps bag whose `getSuggestion` returns a fixed record (or
 *  undefined for the not-found case). `applied` toggles the auto-applied-first
 *  teardown branch. */
function makeInsertDeps(
  suggestion:
    | {
        suggestedText: string;
        anchorUuid: string | undefined;
        appliedChange: AppliedChangeDescriptor | undefined;
      }
    | undefined,
): InsertBelowCardDeps<"accepted" | "applied" | "rejected"> {
  return {
    getSuggestion: (id: string) => (id === "c1" ? suggestion : undefined),
    setSuggestionStatus: vi.fn(),
    setArchived: vi.fn(),
    setAppliedChange: vi.fn(),
    acceptedStatus: "accepted",
  };
}

describe("insertSuggestionBelow", () => {
  it("inserts below the anchor, flushes, then flips status→accepted + archived (never-applied pending card)", () => {
    const deps = makeInsertDeps({
      suggestedText: "A fresh paragraph.",
      anchorUuid: "P1",
      appliedChange: undefined,
    });
    const ok = insertSuggestionBelow(editor, "c1", "doc-9", deps);

    expect(ok).toBe(true);
    expect(insertParagraphAfter).toHaveBeenCalledWith(editor, "P1", "A fresh paragraph.");
    // No blue-mark teardown for a never-applied card.
    expect(removeLinkedAnchor).not.toHaveBeenCalled();
    expect(deps.setAppliedChange).not.toHaveBeenCalled();
    expect(flushPendingForDoc).toHaveBeenCalledWith("doc-9");
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "accepted");
    expect(deps.setArchived).toHaveBeenCalledWith("c1", true);
  });

  it("tears down the blue mark + descriptor first when the card was auto-applied", () => {
    const deps = makeInsertDeps({
      suggestedText: "A fresh paragraph.",
      anchorUuid: "P1",
      appliedChange: ac, // anchorId "anc-1"
    });
    const ok = insertSuggestionBelow(editor, "c1", "doc-9", deps);

    expect(ok).toBe(true);
    expect(insertParagraphAfter).toHaveBeenCalledWith(editor, "P1", "A fresh paragraph.");
    expect(removeLinkedAnchor).toHaveBeenCalledWith(editor, "anc-1");
    expect(deps.setAppliedChange).toHaveBeenCalledWith("c1", undefined);
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "accepted");
    expect(deps.setArchived).toHaveBeenCalledWith("c1", true);
  });

  it("refuses (false, no insert, no state change) when suggested_text is blank", () => {
    const deps = makeInsertDeps({
      suggestedText: "   ",
      anchorUuid: "P1",
      appliedChange: undefined,
    });
    const ok = insertSuggestionBelow(editor, "c1", "doc-9", deps);

    expect(ok).toBe(false);
    expect(insertParagraphAfter).not.toHaveBeenCalled();
    expect(flushPendingForDoc).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
    expect(deps.setArchived).not.toHaveBeenCalled();
  });

  it("refuses (false) when the anchor uuid is missing", () => {
    const deps = makeInsertDeps({
      suggestedText: "A fresh paragraph.",
      anchorUuid: undefined,
      appliedChange: undefined,
    });
    const ok = insertSuggestionBelow(editor, "c1", "doc-9", deps);

    expect(ok).toBe(false);
    expect(insertParagraphAfter).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
  });

  it("refuses (false, no card change) when the insert itself fails (dead anchor)", () => {
    insertParagraphAfter.mockImplementation(() => false);
    const deps = makeInsertDeps({
      suggestedText: "A fresh paragraph.",
      anchorUuid: "P1",
      appliedChange: undefined,
    });
    const ok = insertSuggestionBelow(editor, "c1", "doc-9", deps);

    expect(ok).toBe(false);
    expect(insertParagraphAfter).toHaveBeenCalledTimes(1);
    expect(flushPendingForDoc).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
    expect(deps.setArchived).not.toHaveBeenCalled();
  });

  it("no-ops when the card can't be resolved", () => {
    const deps = makeInsertDeps(undefined);
    const ok = insertSuggestionBelow(editor, "c1", "doc-9", deps);

    expect(ok).toBe(false);
    expect(insertParagraphAfter).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).not.toHaveBeenCalled();
  });

  it("skips the flush when docId is null but still completes the card transition", () => {
    const deps = makeInsertDeps({
      suggestedText: "A fresh paragraph.",
      anchorUuid: "P1",
      appliedChange: undefined,
    });
    const ok = insertSuggestionBelow(editor, "c1", null, deps);

    expect(ok).toBe(true);
    expect(flushPendingForDoc).not.toHaveBeenCalled();
    expect(deps.setSuggestionStatus).toHaveBeenCalledWith("c1", "accepted");
    expect(deps.setArchived).toHaveBeenCalledWith("c1", true);
  });
});
