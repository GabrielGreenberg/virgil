// @vitest-environment node
//
// task 241, the OTHER delete door. `usePanelCardTryDelete` (the docked trash +
// Delete key) is pinned in `suggestion-docked-delete-confirm.test.tsx`; this
// pins `deleteMarginItem` — the in-text cut/revision margin marker — which is
// the surface the human-authored suggestion was actually lost through.
//
// Both doors read the SAME `cardHasContent` SSOT, so the fix reaches this one
// for free — but "for free" is exactly the assumption worth pinning: the margin
// door resolves its kind through a per-marker `contentKind` RESOLVER and hands
// the predicate whatever `findCard` returns. If that record ever stopped
// carrying `author` (a narrowed projection, a rebuilt shape), the author-aware
// branch would silently read every card as human — safe here, but the same
// plumbing failing the other way is how a confirm goes blind.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/links/links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/links/links")>()),
  removeLinkedAnchor: vi.fn(),
}));

import { deleteMarginItem, type MarginItemHandlers } from "@/cards/delete-margin-item";
import type { CardWithLinks } from "@/links/links";
import type { Editor } from "@tiptap/react";

const editor = {} as Editor;

/** A single-anchor suggestion carrying ONLY a `suggested_text` — the shape the
 *  pre-241 descriptor called empty. `author` is the variable under test. */
function suggestion(author: "human" | "ai"): CardWithLinks {
  return {
    id: "c1",
    kind: "suggestion",
    author,
    original_text: "the original passage",
    suggested_text: "a typed replacement",
    explanation: "",
    user_text: "",
    links: [{ anchor: { type: "textObject", textObjectIds: ["P1"] } }],
  } as unknown as CardWithLinks;
}

function handlers(card: CardWithLinks, del: MarginItemHandlers["delete"]): MarginItemHandlers {
  return {
    findCard: () => card,
    // The capture-retarget half of the bundle (task 491) — unused here.
    cards: [card],
    reanchor: vi.fn(),
    // The real resolver both cut and revision markers install.
    contentKind: (c) =>
      (c as { kind?: string }).kind === "suggestion"
        ? "revision-suggestion"
        : "revision-comment",
    unanchor: vi.fn(),
    delete: del,
  };
}

async function runMarginDelete(author: "human" | "ai", confirmAnswer: boolean) {
  const confirm = vi.fn(async () => confirmAnswer);
  const del = vi.fn(async () => undefined);
  await deleteMarginItem({
    kind: "revision",
    cardId: "c1",
    paragraphId: "P1",
    anchorId: "anc-a",
    editor,
    handlers: handlers(suggestion(author), del),
    confirm,
  });
  return { confirm, del };
}

describe("deleteMarginItem — author-aware confirm for a suggestion (task 241)", () => {
  it("a HUMAN suggestion with only a typed `suggested_text` CONFIRMS first", async () => {
    const { confirm, del } = await runMarginDelete("human", false);
    expect(confirm).toHaveBeenCalledTimes(1);
    // Cancel is a true no-op — the card (and the user's typed text) survives.
    expect(del).not.toHaveBeenCalled();
  });

  it("…and confirming then deletes", async () => {
    const { confirm, del } = await runMarginDelete("human", true);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("c1");
  });

  it("an untouched AI suggestion still deletes straight through — no nag", async () => {
    const { confirm, del } = await runMarginDelete("ai", true);
    expect(confirm).not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith("c1");
  });
});
