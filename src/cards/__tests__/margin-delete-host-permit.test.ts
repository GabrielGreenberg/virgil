// @vitest-environment node
//
// Task 2026-11-08-1527 — a margin marker's Delete/Backspace honours the host's
// card-mutation permit.
//
// A card can be deleted through three doors. The panel trash
// (`useCardDeleteAllowed`) and the drag-handle actions asked the host's
// per-kind permit; the focused margin marker's Delete did not. In the Library
// Reader (`READER_CHROME.editableCardKinds: ["note"]`) Backspace on a todo /
// report / cut / revision marker dropped the card from React state while the
// sidecar write was refused — gone until reload, nothing written, nothing said.
//
// Two halves, one derivation (`isCardMutationAllowed`):
//   1. AFFORDANCE — the marker builder withholds `onDelete` for a refused kind,
//      so the key is inert (the margin's answer to the hidden trash button).
//   2. FLOOR — `deleteMarginItem` itself asks the card's own kind before
//      anything moves, so every caller of the door inherits it.

import { describe, it, expect, vi } from "vitest";

const removeLinkedAnchor = vi.fn<(editor: unknown, anchorId: unknown) => void>();

vi.mock("@/links/links", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/links/links")>()),
  removeLinkedAnchor: (...a: unknown[]) => removeLinkedAnchor(a[0], a[1]),
}));

import {
  FULL_CHROME,
  READER_CHROME,
  isCardMutationAllowed,
} from "@/components/editor-layout/chrome-config";
import {
  MARGIN_MARKER_SOURCES,
  buildCardMarkers,
  type CardMarkerCtx,
  type MarginMarkerSource,
} from "@/cards/margin-markers";
import { deleteMarginItem, type MarginItemHandlers } from "@/cards/delete-margin-item";
import type { CardKind } from "@/cards/types";
import type { CardWithLinks } from "@/links/links";
import type { Editor } from "@tiptap/react";

const readerPermit = (k: CardKind) => isCardMutationAllowed(READER_CHROME, k);
const mainPermit = (k: CardKind) => isCardMutationAllowed(FULL_CHROME, k);

function cardOf(kind: string): CardWithLinks {
  return {
    id: "c1",
    kind,
    text: "typed",
    links: [
      {
        anchor: {
          type: "textObject",
          targetKind: "linkedRange",
          textObjectIds: ["P1"],
          textRange: { anchorId: "anc-1", textSnapshot: "span" },
        },
      },
    ],
  } as unknown as CardWithLinks;
}

function ctx(mayDelete: (k: CardKind) => boolean): CardMarkerCtx {
  return {
    resolve: () => ({ rows: [{ pid: "P1" } as never], anchored: true }),
    onClick: vi.fn(),
    onDelete: vi.fn(),
    mayDelete,
  };
}

const SOURCES: ReadonlyArray<[string, MarginMarkerSource, string]> = [
  ["note", MARGIN_MARKER_SOURCES.notes as MarginMarkerSource, "note"],
  ["todo", MARGIN_MARKER_SOURCES.todos as MarginMarkerSource, "todo"],
  ["report", MARGIN_MARKER_SOURCES.reports as MarginMarkerSource, "report"],
  ["cutter-comment", MARGIN_MARKER_SOURCES.cutter as MarginMarkerSource, "comment"],
  ["revision-comment", MARGIN_MARKER_SOURCES.revisions as MarginMarkerSource, "comment"],
  ["archive", MARGIN_MARKER_SOURCES.archive as MarginMarkerSource, "archive"],
];

describe("margin marker Delete — the affordance half (builder)", () => {
  it.each(SOURCES)("Reader: a %s marker has onDelete iff the host permits its kind", (kind, source, stored) => {
    const [m] = buildCardMarkers(cardOf(stored), source, ctx(readerPermit));
    expect(m).toBeDefined();
    const permitted = readerPermit(kind as CardKind);
    expect(permitted).toBe(kind === "note");
    expect(typeof m.onDelete).toBe(permitted ? "function" : "undefined");
  });

  it.each(SOURCES)("main app: a %s marker keeps onDelete", (_kind, source, stored) => {
    const [m] = buildCardMarkers(cardOf(stored), source, ctx(mainPermit));
    expect(typeof m.onDelete).toBe("function");
  });
});

describe("deleteMarginItem — the floor half (door)", () => {
  function handlers(contentKind: MarginItemHandlers["contentKind"]) {
    const c = cardOf("todo");
    return {
      findCard: () => c,
      cards: [c],
      contentKind,
      unanchor: vi.fn(),
      detach: vi.fn(),
      reanchor: vi.fn(),
      delete: vi.fn(async () => true),
    } satisfies MarginItemHandlers;
  }

  async function run(h: MarginItemHandlers, permit: (k: CardKind) => boolean, anchorPids = ["P1"]) {
    const confirm = vi.fn(async () => true);
    await deleteMarginItem({
      kind: "todo",
      cardId: "c1",
      paragraphId: "P1",
      anchorPids,
      sources: [{ pid: null, anchorId: "anc-1" }] as never,
      handlers: h,
      confirm,
      editor: {} as Editor,
      mayMutate: permit,
    });
    return confirm;
  }

  it("a refused kind writes nothing: no confirm, no delete, no mark strip", async () => {
    removeLinkedAnchor.mockClear();
    const h = handlers("todo");
    const confirm = await run(h, readerPermit);
    expect(confirm).not.toHaveBeenCalled();
    expect(h.delete).not.toHaveBeenCalled();
    expect(removeLinkedAnchor).not.toHaveBeenCalled();
  });

  it("a refused kind's multi-anchor detach is refused too", async () => {
    removeLinkedAnchor.mockClear();
    const h = handlers("todo");
    await run(h, readerPermit, ["P1", "P2"]);
    expect(h.detach).not.toHaveBeenCalled();
    expect(removeLinkedAnchor).not.toHaveBeenCalled();
  });

  it("asks the CARD's own kind (a resolver bundle), not the marker namespace", async () => {
    const seen: CardKind[] = [];
    const h = handlers(() => "revision-suggestion");
    await run(h, (k) => (seen.push(k), false));
    expect(seen).toEqual(["revision-suggestion"]);
    expect(h.delete).not.toHaveBeenCalled();
  });

  it("a permitted kind deletes as before", async () => {
    removeLinkedAnchor.mockClear();
    const h = handlers("note");
    await run(h, readerPermit);
    expect(h.delete).toHaveBeenCalledWith("c1");
    expect(removeLinkedAnchor).toHaveBeenCalled();
  });
});
