// @vitest-environment jsdom
//
// TASK 934 — a Mode-B card is anchored where its MARK is, once.
//
// A note highlights words in the middle of paragraph P (`textObjectIds:[P]`).
// The user presses Enter before the highlighted words: the tail — mark and all
// — becomes a NEW paragraph P', while P stays live. The resolver's mark rung
// correctly answers P', but `resolveCardAnchorRows` then appended every live
// STORED pid, so the one highlight drew TWO margin markers ([P', P]); Delete on
// the real one took the multi-anchor branch and `unanchor`ed P' — a pid the
// card never stored — a silent no-op.
//
// Every leg drives the REAL editor (a real Enter split), the REAL authority and
// the REAL delete door.
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
import { createLinkedAnchor, type CardWithLinks } from "@/links/links";
import {
  buildResolveIndex,
  reconcileCardToResolved,
  resolveCardAnchor,
} from "@/links/resolve-card-anchor";
import type { Link } from "@/links/_shared/types";
import { deleteMarginItem, type MarginItemHandlers } from "@/cards/delete-margin-item";

const HEAD = "Lead-in sentence. ";
const TAIL = "Highlight this span here.";

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
        { type: "paragraph", attrs: { uuid: "P" }, content: [{ type: "text", text: HEAD + TAIL }] },
        { type: "paragraph", attrs: { uuid: "Q" }, content: [{ type: "text", text: "Other." }] },
      ],
    },
  });
}

function modeBLink(anchorId: string, textObjectIds: string[]): Link {
  return {
    id: `link-${anchorId}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds,
      textRange: { anchorId, textSnapshot: "this span" },
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "",
  };
}

function modeALink(uuids: string[]): Link {
  return {
    id: `link-${uuids.join("+")}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: uuids },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "",
  };
}

/** Highlight "this span" in P, then press Enter before the tail sentence. */
function highlightThenSplit(editor: Editor): { anchorId: string; splitPid: string } {
  const from = 1 + (HEAD + TAIL).indexOf("this span");
  const rec = createLinkedAnchor(editor, "note", { from, to: from + "this span".length });
  if (!rec) throw new Error("expected a linkedAnchor record");
  editor.chain().setTextSelection(1 + HEAD.length).splitBlock().run();

  const uuids: string[] = [];
  editor.state.doc.forEach((n) => uuids.push(n.attrs.uuid as string));
  // Premise: the split minted a fresh uuid for the tail and kept P live.
  expect(uuids[0]).toBe("P");
  expect(uuids).toHaveLength(3);
  const splitPid = uuids[1];
  expect(splitPid).toBeTruthy();
  expect(splitPid).not.toBe("P");
  expect(buildResolveIndex(editor).anchorIdToParagraph.get(rec.anchorId)).toBe(splitPid);
  return { anchorId: rec.anchorId, splitPid };
}

function noteCard(links: Link[]): CardWithLinks {
  return { id: "c1", links } as CardWithLinks;
}

describe("Mode-B card after an Enter split (task 934)", () => {
  it("yields ONE row — the mark's paragraph — not the stale stored pid too", () => {
    const editor = mountDoc();
    const { anchorId, splitPid } = highlightThenSplit(editor);
    const card = noteCard([modeBLink(anchorId, ["P"])]);

    const { rows, anchored } = buildCardAnchorPass(editor).resolve(card);
    expect(anchored).toBe(true);
    expect(rows.map((r) => r.pid)).toEqual([splitPid]);
    editor.destroy();
  });

  it("Delete on that single marker takes the last-anchor branch", async () => {
    const editor = mountDoc();
    const { anchorId } = highlightThenSplit(editor);
    const card = noteCard([modeBLink(anchorId, ["P"])]);
    const rows = buildMarginMarkerRows(card, buildCardAnchorPass(editor).resolve);
    expect(rows).toHaveLength(1);

    const unanchor = vi.fn();
    const del = vi.fn();
    const handlers: MarginItemHandlers = {
      findCard: (id) => (id === "c1" ? card : undefined),
      cards: [card],
      contentKind: "note",
      unanchor,
      reanchor: vi.fn(),
      delete: del,
    };
    await deleteMarginItem({
      kind: "note",
      cardId: "c1",
      paragraphId: rows[0].pid,
      anchorPids: rows[0].cardPids,
      anchorId,
      handlers,
      confirm: async () => true,
      editor,
    });

    expect(unanchor, "the silent no-op branch").not.toHaveBeenCalled();
    expect(del).toHaveBeenCalledWith("c1");
    editor.destroy();
  });

  it("CONTROL — a Mode-A sibling link still contributes its own row", () => {
    const editor = mountDoc();
    const { anchorId, splitPid } = highlightThenSplit(editor);
    const card = noteCard([modeBLink(anchorId, ["P"]), modeALink(["Q"])]);

    const { rows } = buildCardAnchorPass(editor).resolve(card);
    // Rung 1 (Mode-A uuid) wins the seed; the Mode-B link adds its MARK's
    // paragraph, never its stale stored P.
    expect(rows.map((r) => r.pid)).toEqual(["Q", splitPid]);
    editor.destroy();
  });

  it("CONTROL — a Mode-B link whose mark is dead still anchors on its live stored pid (rung 2b)", () => {
    const editor = mountDoc();
    const card = noteCard([modeBLink("dead-anchor", ["Q"])]);
    const { rows, anchored } = buildCardAnchorPass(editor).resolve(card);
    expect(anchored).toBe(true);
    expect(rows.map((r) => r.pid)).toEqual(["Q"]);
    editor.destroy();
  });

  it("the load reconcile re-points the Mode-B link's stored pid to the mark's paragraph, idempotently", () => {
    const editor = mountDoc();
    const { anchorId, splitPid } = highlightThenSplit(editor);
    const c0 = noteCard([modeBLink(anchorId, ["P"])]);
    const index = buildResolveIndex(editor);
    const res = resolveCardAnchor(c0, editor, index);
    expect(res.source).toBe("mark");

    const { card: c1, changed } = reconcileCardToResolved(c0, res);
    expect(changed).toBe(true);
    const l1 = c1.links![0];
    if (l1.anchor.type !== "textObject") throw new Error("textObject");
    expect(l1.anchor.textObjectIds).toEqual([splitPid]);
    // The range payload is untouched (no liveMarkText supplied).
    expect(l1.anchor.textRange).toEqual({ anchorId, textSnapshot: "this span" });
    expect(c0.links![0].anchor).not.toBe(l1.anchor); // input not mutated

    const again = reconcileCardToResolved(c1, resolveCardAnchor(c1, editor, index));
    expect(again.changed).toBe(false);
    editor.destroy();
  });
});
