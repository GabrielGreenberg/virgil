// @vitest-environment jsdom
//
// Task 2026-09-21-696 — the SEEDING half: `original_text` is the APPLY dialect.
//
// `original_text` is documented at its own site as "the currency the apply
// path splices", and `apply-suggestion.ts` byte-matches it against the
// anchored paragraph's inline-LaTeX serialization. Both add doors seeded it
// from `anchor.anchorText` — the RELOCATION currency, `doc.textBetween`, which
// has dropped every mark and every inline atom — so a human-created suggestion
// over any formatted passage could not match and landed `stale`.
//
// Three facts, asked of BOTH panels because cutter and revisions are the same
// rule written twice (the task-201 fork):
//   1. the anchor's LaTeX form is what seeds `original_text`;
//   2. all THREE forms are recorded on the card, so a later morph or clone has
//      the capture rather than one dialect of it;
//   3. an anchor with NO LaTeX form (a span with no single inline shape) leaves
//      `original_text` EMPTY rather than falling back to the flattened line —
//      which is what makes `suggestionApplicability` answer `no-capture` and
//      the card SAY so, instead of offering an Apply that cannot succeed
//      (task 695).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockRead = vi.fn();
const mockWrite = vi.fn();

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule({
    readSidecar: (...a: unknown[]) => mockRead(...a),
    readSidecarIfExists: (...a: unknown[]) => mockRead(...a),
    writeSidecar: (...a: unknown[]) => mockWrite(...a),
  }),
);

import { useCutter } from "../useCutter";
import { useRevisions } from "../useRevisions";
import { suggestionApplicability } from "@/links/pending-change-actions";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  mockRead.mockReset();
  mockRead.mockResolvedValue({ cards: [] });
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

/** The anchor a real selection over `The \emph{quick brown} fox.` mints: the
 *  plain line, the rich slice, and the LaTeX form. */
const ANCHOR = {
  anchorId: "a1",
  anchorText: "The quick brown fox.",
  anchorContent: { type: "doc", content: [] },
  anchorLatex: "The \\emph{quick brown} fox.",
};

type AddSuggestion = (
  paragraphId: string | null,
  originalText?: string,
  anchor?: typeof ANCHOR | { anchorId: string; anchorText: string },
) => { id: string };

const PANELS = [
  ["cutter", useCutter, "cutter-suggestion"] as const,
  ["revisions", useRevisions, "revision-suggestion"] as const,
];

describe.each(PANELS)("%s: a suggestion is seeded in the apply dialect (task 696)", (name, useHook, family) => {
  const docId = `doc-696-${name}`;

  it("seeds original_text from the anchor's LaTeX form, not its flattened line", async () => {
    beginDocPipeline(docId);
    const { result } = renderHook(() => useHook(docId));
    await waitFor(() => expect(result.current.cards).toEqual([]));

    let id = "";
    act(() => {
      id = (result.current.addSuggestion as AddSuggestion)("P1", undefined, ANCHOR).id;
    });
    const card = result.current.cards.find((c) => c.id === id) as {
      original_text: string;
      selectedText?: string;
      selectedContent?: unknown;
      selectedLatex?: string;
    };
    expect(card.original_text).toBe(ANCHOR.anchorLatex);
    // Explicitly NOT the flattened line — the exact defect.
    expect(card.original_text).not.toBe(ANCHOR.anchorText);
    // All three forms are on the card: the plain one still relocates it, the
    // rich one still renders it, the LaTeX one applies it.
    expect(card.selectedText).toBe(ANCHOR.anchorText);
    expect(card.selectedContent).toBeTruthy();
    expect(card.selectedLatex).toBe(ANCHOR.anchorLatex);
  });

  it("an anchor with no LaTeX form leaves original_text EMPTY (no-capture, not a lie)", async () => {
    beginDocPipeline(`${docId}-nolatex`);
    const { result } = renderHook(() => useHook(`${docId}-nolatex`));
    await waitFor(() => expect(result.current.cards).toEqual([]));

    let id = "";
    act(() => {
      id = (result.current.addSuggestion as AddSuggestion)("P1", undefined, {
        anchorId: "a2",
        anchorText: "two paragraphs worth of text",
      }).id;
    });
    const card = result.current.cards.find((c) => c.id === id)!;
    expect((card as { original_text: string }).original_text).toBe("");
    // The card is anchored, so the refusal is about the CAPTURE, and the
    // surface says which — rather than rendering a live Apply that would
    // answer `stale` against a paragraph that never changed.
    expect(suggestionApplicability(card as never, family)).toEqual({
      canApply: false,
      reason: "no-capture",
    });
  });

  it("an explicit originalText still wins (the AI path is untouched)", async () => {
    beginDocPipeline(`${docId}-explicit`);
    const { result } = renderHook(() => useHook(`${docId}-explicit`));
    await waitFor(() => expect(result.current.cards).toEqual([]));

    let id = "";
    act(() => {
      id = (result.current.addSuggestion as AddSuggestion)(
        "P1",
        "\\textbf{bytes from the paper}",
        ANCHOR,
      ).id;
    });
    const card = result.current.cards.find((c) => c.id === id)!;
    expect((card as { original_text: string }).original_text).toBe(
      "\\textbf{bytes from the paper}",
    );
  });
});
