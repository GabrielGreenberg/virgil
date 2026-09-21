// @vitest-environment node
//
// Task 2026-09-21-696 — the MORPH seam, which is where the defect actually
// reached most users.
//
// The quick in-text gestures ("+ Cut", "+ Comment" over a selection) mint a
// COMMENT, and a comment has no `original_text`. The suggestion is born later,
// when the user morphs that comment — and the converter seeded `original_text`
// from `selectedText`, the flattened relocation line. So the dominant human
// path to an appliable suggestion produced one that could not be applied over
// any formatted passage, and said the paragraph had changed.
//
// The converter now seeds from `selectedLatex`, the capture's apply dialect,
// and the form travels BOTH ways so morphing back and forth is lossless. A
// PRE-696 comment (no `selectedLatex` on disk) still seeds from the flattened
// line — deliberately, because nothing may rewrite a stored capture on a
// guess; the apply path's own plain-text rung is what repairs those, where
// both dialects are in hand.
import { describe, it, expect } from "vitest";
import { applyCardMorph } from "@/cards/morphs/apply";
import "@/cards/morphs";
import type {
  CutterCommentCard,
  CutterSuggestionCard,
  RevisionRequestCard,
  RevisionSuggestionCard,
} from "@/lib/types";

const PLAIN = "The quick brown fox.";
const LATEX = "The \\emph{quick brown} fox.";
const RICH = { type: "doc", content: [] };

function comment(extra: Partial<CutterCommentCard> = {}): CutterCommentCard {
  return {
    kind: "comment",
    id: "c1",
    createdAt: "2026-01-01T00:00:00.000Z",
    text: "tighten this",
    content: {},
    aiRequest: false,
    selectedText: PLAIN,
    selectedContent: RICH,
    selectedLatex: LATEX,
    links: [],
    ...extra,
  };
}

const SEAMS = [
  ["cutter", "cutter-comment", "cutter-suggestion"],
  ["revisions", "revision-comment", "revision-suggestion"],
] as const;

describe.each(SEAMS)("%s: a comment morphs into an APPLIABLE suggestion (task 696)", (_name, commentKind, suggestionKind) => {
  it("seeds original_text from the LaTeX form and carries all three forms", () => {
    const c = comment() as CutterCommentCard & RevisionRequestCard;
    const s = applyCardMorph(commentKind, c) as unknown as
      | CutterSuggestionCard
      | RevisionSuggestionCard;
    expect(s.kind).toBe("suggestion");
    expect(s.original_text).toBe(LATEX);
    expect(s.original_text).not.toBe(PLAIN);
    expect(s.selectedText).toBe(PLAIN);
    expect(s.selectedContent).toBe(RICH);
    expect(s.selectedLatex).toBe(LATEX);
  });

  it("round-trips the LaTeX form back through the comment shape", () => {
    const c = comment() as CutterCommentCard & RevisionRequestCard;
    const s = applyCardMorph(commentKind, c) as never;
    const back = applyCardMorph(suggestionKind, s) as CutterCommentCard;
    expect(back.kind).toBe("comment");
    expect(back.selectedLatex).toBe(LATEX);
    expect(back.selectedContent).toBe(RICH);
  });

  it("a PRE-696 comment (no LaTeX form) still seeds from the flattened line", () => {
    const c = comment({ selectedLatex: undefined }) as CutterCommentCard &
      RevisionRequestCard;
    const s = applyCardMorph(commentKind, c) as unknown as CutterSuggestionCard;
    expect(s.original_text).toBe(PLAIN);
    expect(s.selectedLatex).toBeUndefined();
  });
});
