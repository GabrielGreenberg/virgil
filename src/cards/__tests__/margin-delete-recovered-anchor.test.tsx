// @vitest-environment jsdom
//
// TASK 669 — the margin's Delete asks the SAME authority the marker came from.
//
// A margin marker's paragraph is the four-rung authority's RESOLVED answer
// (`buildCardAnchorPass` → `buildMarginMarkerRows`), which deliberately seeds
// the row set with `res.paragraphId` so a card recovered through its
// `linkedAnchor` mark or its `paragraphSnapshot` still paints a marker beside
// the paragraph it was recovered ON — a paragraph that is NOT one of the card's
// stored pids.
//
// `deleteMarginItem` used to re-derive "is this the card's last anchor?" from
// `getLinkedTextObjectIds(card)` — the STORED pids. For a recovered card the
// two lists are disjoint, so the diff removed nothing, reported a phantom
// sibling, and took the MULTI-ANCHOR branch on a card with exactly one anchor:
// `handlers.unanchor(cardId, <a pid the card does not store>)`, i.e. a silent
// no-op. No confirm, no delete, no feedback — the card stayed undeletable from
// the margin for the rest of the session, healed only by a reload.
//
// Every leg drives the REAL editor, the REAL authority, the REAL margin reader
// and the REAL delete door end-to-end. The defect leg RESTATES the retired
// stored-pid rule locally rather than re-parameterising the live one, so it
// fails for the reason it names.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { buildCardAnchorPass, buildMarginMarkerRows } from "@/links/card-anchor-rows";
import { getLinkedTextObjectIds, type CardWithLinks } from "@/links/links";
import type { Link } from "@/links/_shared/types";
import type { ArchivedSnippet } from "@/lib/types";
import { deleteMarginItem, type MarginItemHandlers } from "../delete-margin-item";

const P1_TEXT = "The first paragraph.";
const P2_TEXT = "The second paragraph.";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

/** A two-paragraph doc whose live uuids are `P1` / `P2`. */
function mountDoc(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "P1" }, content: [{ type: "text", text: P1_TEXT }] },
        { type: "paragraph", attrs: { uuid: "P2" }, content: [{ type: "text", text: P2_TEXT }] },
      ],
    },
  });
}

/** A Mode-A paragraph link over `uuids`, with an optional text snapshot. */
function paraLink(uuids: string[], snapshot?: string): Link {
  return {
    id: `link-${uuids.join("+")}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: uuids,
      ...(snapshot ? { paragraphSnapshot: snapshot } : {}),
    },
    target: { type: "card", ref: { kind: "archive", id: "c1" } },
    createdAt: "2026-01-01T00:00:00.000Z",
  } as Link;
}

/** An archive clip with a non-empty body, so the confirm-on-content path is
 *  the one a last-anchor delete has to travel. */
function clip(id: string, links: Link[]): ArchivedSnippet {
  return {
    id,
    title: "",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "captured prose" }] }],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    links,
  };
}

function handlers(card: CardWithLinks) {
  const unanchor = vi.fn();
  const del = vi.fn();
  const bundle: MarginItemHandlers = {
    findCard: (id) => (id === card.id ? card : undefined),
    cards: [card],
    contentKind: "archive",
    unanchor,
    reanchor: vi.fn(),
    delete: del,
  };
  return { bundle, unanchor, del };
}

/** The RETIRED rule, restated locally: `remaining` off the card's STORED pids.
 *  Returns the branch the old door would have taken. */
function preFixBranch(card: CardWithLinks, paragraphId: string): "unanchor" | "delete" {
  const remaining = getLinkedTextObjectIds(card).filter((p) => p !== paragraphId);
  return remaining.length > 0 ? "unanchor" : "delete";
}

describe("margin Delete on a RECOVERED anchor (task 669)", () => {
  it("a snapshot-recovered single-anchor card deletes, it does not silently unanchor", async () => {
    const editor = mountDoc();
    // Stored uuid is DEAD; the snapshot still matches live P2 (rung 4).
    const card = clip("c1", [paraLink(["P_DEAD"], P2_TEXT)]);
    const pass = buildCardAnchorPass(editor);

    const rows = buildMarginMarkerRows(card, pass.resolve);
    // Premise: the marker really is painted on a paragraph the card does not
    // store — otherwise every assertion below is vacuous.
    expect(rows).toHaveLength(1);
    expect(rows[0].pid).toBe("P2");
    expect(getLinkedTextObjectIds(card)).toEqual(["P_DEAD"]);
    // ...and the retired rule takes the WRONG branch on exactly this row.
    expect(preFixBranch(card, rows[0].pid)).toBe("unanchor");

    const { bundle, unanchor, del } = handlers(card);
    const confirm = vi.fn(async () => true);
    await deleteMarginItem({
      kind: "archive",
      cardId: "c1",
      paragraphId: rows[0].pid,
      anchorPids: rows[0].cardPids,
      handlers: bundle,
      confirm,
      editor,
    });

    expect(confirm, "a last-anchor delete must raise the content confirm").toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("c1");
    expect(unanchor, "the no-op branch (task 669)").not.toHaveBeenCalled();
    editor.destroy();
  });

  it("Cancel on that same confirm is still a true no-op", async () => {
    const editor = mountDoc();
    const card = clip("c1", [paraLink(["P_DEAD"], P2_TEXT)]);
    const rows = buildMarginMarkerRows(card, buildCardAnchorPass(editor).resolve);

    const { bundle, unanchor, del } = handlers(card);
    await deleteMarginItem({
      kind: "archive",
      cardId: "c1",
      paragraphId: rows[0].pid,
      anchorPids: rows[0].cardPids,
      handlers: bundle,
      confirm: async () => false,
      editor,
    });

    expect(del).not.toHaveBeenCalled();
    expect(unanchor).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("CONTROL — a genuinely multi-anchor card still drops only the one anchor", async () => {
    const editor = mountDoc();
    const card = clip("c1", [paraLink(["P1", "P2"])]);
    const pass = buildCardAnchorPass(editor);

    const rows = buildMarginMarkerRows(card, pass.resolve);
    expect(rows.map((r) => r.pid)).toEqual(["P1", "P2"]);

    const { bundle, unanchor, del } = handlers(card);
    const confirm = vi.fn(async () => true);
    await deleteMarginItem({
      kind: "archive",
      cardId: "c1",
      paragraphId: "P1",
      anchorPids: rows[0].cardPids,
      handlers: bundle,
      confirm,
      editor,
    });

    expect(unanchor).toHaveBeenCalledWith("c1", "P1");
    expect(del).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("CONTROL — the ordinary stored-pid case is unchanged (stored pid == resolved pid)", async () => {
    const editor = mountDoc();
    const card = clip("c1", [paraLink(["P2"])]);
    const rows = buildMarginMarkerRows(card, buildCardAnchorPass(editor).resolve);
    expect(rows[0].pid).toBe("P2");
    expect(preFixBranch(card, rows[0].pid), "old and new agree here").toBe("delete");

    const { bundle, unanchor, del } = handlers(card);
    await deleteMarginItem({
      kind: "archive",
      cardId: "c1",
      paragraphId: rows[0].pid,
      anchorPids: rows[0].cardPids,
      handlers: bundle,
      confirm: async () => true,
      editor,
    });

    expect(del).toHaveBeenCalledTimes(1);
    expect(unanchor).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("MOUNT GAP — with no index the cohort IS the stored pids, so the two rules agree", () => {
    const card = clip("c1", [paraLink(["P1", "P2"])]);
    const rows = buildMarginMarkerRows(card, buildCardAnchorPass(null).resolve);
    // The fallback is not a second answer: the authority hands back the raw
    // stored pids, which is exactly what the retired diff read.
    expect(rows[0].cardPids).toEqual(getLinkedTextObjectIds(card));
  });
});
