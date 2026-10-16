// @vitest-environment node
//
// Task 2026-07-27-238 (follow-on) — "Cancel is a true no-op" survives a
// DOWNSTREAM refusal.
//
// `deleteMarginItem` used to strip the card's inline `linkedAnchor` mark and
// THEN call the delete. That was safe only because the delete could not refuse.
// The lifecycle SETTLE obligation made it refusable: a card owning a live
// applied splice raises a keep/revert prompt, and its Cancel keeps the card. In
// the old order the surviving card came back with its text-range mark torn out
// of the document — and since `removeLinkedAnchor` unsets EVERY `linkedAnchor`
// over the resolved range, the colocated blue `pending-ai-change` mark went with
// it, leaving a card still claiming `status:"applied"` over a range with no
// visible mark until a reload re-stamped both.
//
// So: delete first, strip only on a committed delete. These pin both halves.

import { describe, it, expect, vi } from "vitest";

const removeLinkedAnchor = vi.fn<(editor: unknown, anchorId: unknown) => void>();

vi.mock("@/links/links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/links/links")>()),
  removeLinkedAnchor: (...a: unknown[]) => removeLinkedAnchor(a[0], a[1]),
}));

import {
  deleteMarginItem,
  type BuildMarginItemHandlersDeps,
  type MarginItemHandlers,
} from "@/cards/delete-margin-item";
import type { CardWithLinks } from "@/links/links";
import type { Editor } from "@tiptap/react";

const editor = {} as Editor;

/** A single-anchor card with user content, so the path reaches the confirm and
 *  then the delete — the branch that strips the mark. It carries a Mode-B
 *  text range: the door reads the mark to strip off the CARD (task 939). */
function card(id = "c1"): CardWithLinks {
  return {
    id,
    kind: "suggestion",
    links: [
      {
        anchor: {
          type: "textObject",
          targetKind: "linkedRange",
          textObjectIds: ["P1"],
          textRange: { anchorId: "anc-b", textSnapshot: "span" },
        },
      },
    ],
    user_text: "the user typed this",
  } as unknown as CardWithLinks;
}

function handlers(
  del: MarginItemHandlers["delete"],
): MarginItemHandlers {
  return {
    findCard: () => card(),
    // The capture-retarget half of the bundle (task 491) — unused here.
    cards: [card()],
    contentKind: "revision-suggestion",
    unanchor: vi.fn(),
    detach: vi.fn(),
    reanchor: vi.fn(),
    delete: del,
  };
}

describe("deleteMarginItem — a refused delete leaves the document untouched", () => {
  it("does NOT strip the inline mark when the delete declines", async () => {
    removeLinkedAnchor.mockClear();
    const del = vi.fn(async () => false);

    await deleteMarginItem({
      kind: "revision",
      cardId: "c1",
      paragraphId: "P1",
      // The marker's own row cohort (task 669): a single-anchor card.
      anchorPids: ["P1"],
      sources: [],
      editor,
      handlers: handlers(del),
      confirm: async () => true, // the user confirmed the DELETE...
    });

    // ...and then cancelled the settle prompt downstream. The card survives, so
    // its mark must survive with it — this is the whole "Cancel is a true
    // no-op" contract, one level deeper than the dialog this file owns.
    expect(del).toHaveBeenCalledWith("c1");
    expect(removeLinkedAnchor).not.toHaveBeenCalled();
  });

  it("strips the mark after a delete that committed", async () => {
    removeLinkedAnchor.mockClear();
    const del = vi.fn(async () => true);

    await deleteMarginItem({
      kind: "revision",
      cardId: "c1",
      paragraphId: "P1",
      // The marker's own row cohort (task 669): a single-anchor card.
      anchorPids: ["P1"],
      sources: [],
      editor,
      handlers: handlers(del),
      confirm: async () => true,
    });

    expect(removeLinkedAnchor).toHaveBeenCalledWith(editor, "anc-b");
  });

  it("a delete that cannot answer is a TYPE error, not a silent commit (task 1119)", () => {
    // This leg used to RUN a void delete and pin that it still stripped. That
    // was the hole: `committed === false` honours a refusal only while the
    // runtime value happens to be the promise, so a void-returning delete wired
    // into the table would read a declined delete as a commit and tear a
    // surviving card's mark out of the document. The table's type now demands
    // the answer (`DeclinableCardDelete`) — the guard is the compiler.
    const voidDelete = (_id: string): void => {};
    // @ts-expect-error — a void delete may not stand in a margin handler.
    const handlerDelete: MarginItemHandlers["delete"] = voidDelete;
    // @ts-expect-error — nor in a per-kind dep the builder reads.
    const dep: BuildMarginItemHandlersDeps["todos"]["deleteItem"] = voidDelete;
    const declinable: MarginItemHandlers["delete"] = async () => false;
    expect([handlerDelete, dep, declinable]).toHaveLength(3);
  });

  it("cancelling the content confirm deletes nothing and strips nothing", async () => {
    removeLinkedAnchor.mockClear();
    const del = vi.fn(async () => true);

    await deleteMarginItem({
      kind: "revision",
      cardId: "c1",
      paragraphId: "P1",
      // The marker's own row cohort (task 669): a single-anchor card.
      anchorPids: ["P1"],
      sources: [],
      editor,
      handlers: handlers(del),
      confirm: async () => false,
    });

    expect(del).not.toHaveBeenCalled();
    expect(removeLinkedAnchor).not.toHaveBeenCalled();
  });
});
