// @vitest-environment jsdom
//
// Task 1149 — Delete on ONE marker of a multi-anchor card removes exactly the
// link that marker is drawn from, and the marker does not come back.
//
// The multi-anchor branch used to `unanchor(cardId, pid)` — every kind's
// `removeTextObjectLink`, a match on the card's STORED pids — while the marker
// carries a RESOLVED row. For a Mode-B link the two disagree twice over:
// `removeTextObjectLink` keeps a Mode-B link by design (its range is the
// binding) and the mark was never stripped, so the next pass resolved the
// mark's paragraph again and the marker reappeared; and once the highlighted
// words have moved into a new paragraph (an Enter split) the card does not
// store the row's pid at all, so the call was a silent no-op.
//
// Every leg drives the REAL editor, the REAL authority, the REAL margin rows
// and the REAL delete door, with a `detach` that applies the real transform
// (`detachAnchorSources`) to the card — then re-resolves, because "does not
// come back" is a statement about the NEXT pass.
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
import {
  createLinkedAnchor,
  detachAnchorSources,
  removeTextObjectLink,
  type CardWithLinks,
} from "@/links/links";
import { buildResolveIndex } from "@/links/resolve-card-anchor";
import type { Link } from "@/links/_shared/types";
import { deleteMarginItem, type MarginItemHandlers } from "../delete-margin-item";

const P_TEXT = "Lead-in sentence. Highlight this span here.";
const Q_TEXT = "Other paragraph.";

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
        { type: "paragraph", attrs: { uuid: "P" }, content: [{ type: "text", text: P_TEXT }] },
        { type: "paragraph", attrs: { uuid: "Q" }, content: [{ type: "text", text: Q_TEXT }] },
      ],
    },
  });
}

/** Highlight "this span" in P — a live `linkedAnchor` mark. */
function highlight(editor: Editor): string {
  const from = 1 + P_TEXT.indexOf("this span");
  const rec = createLinkedAnchor(editor, "note", { from, to: from + "this span".length });
  if (!rec) throw new Error("expected a linkedAnchor record");
  return rec.anchorId;
}

function modeBLink(anchorId: string, textObjectIds: string[]): Link {
  return {
    id: anchorId,
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

function modeALink(uuids: string[], snapshot?: string): Link {
  return {
    id: `c1@${uuids[0]}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: uuids,
      ...(snapshot ? { paragraphSnapshot: snapshot } : {}),
    },
    target: { type: "card", ref: { kind: "note", id: "c1" } },
    createdAt: "",
  };
}

/** A one-card store whose `detach` applies the real transform. */
function store(initial: CardWithLinks) {
  let card = initial;
  const del = vi.fn();
  const unanchor = vi.fn();
  const confirm = vi.fn(async () => true);
  const handlers: MarginItemHandlers = {
    findCard: (id) => (id === card.id ? card : undefined),
    get cards() {
      return [card];
    },
    contentKind: "note",
    unanchor,
    detach: (id, sources) => {
      if (id === card.id) card = detachAnchorSources(card, sources);
    },
    reanchor: vi.fn(),
    delete: del,
  };
  return { handlers, del, unanchor, confirm, get card() { return card; } };
}

async function deleteRow(editor: Editor, s: ReturnType<typeof store>, pid: string) {
  const rows = buildMarginMarkerRows(s.card, buildCardAnchorPass(editor).resolve);
  const row = rows.find((r) => r.pid === pid);
  if (!row) throw new Error(`no row for ${pid}`);
  await deleteMarginItem({
    kind: "note",
    cardId: s.card.id,
    paragraphId: row.pid,
    anchorPids: row.cardPids,
    sources: row.sources,
    handlers: s.handlers,
    confirm: s.confirm,
    editor,
  });
}

const rowPids = (editor: Editor, card: CardWithLinks) =>
  buildMarginMarkerRows(card, buildCardAnchorPass(editor).resolve).map((r) => r.pid);

describe("margin Delete on one marker of a multi-anchor card (task 1149)", () => {
  it("Mode-B(P) + Mode-A(Q): deleting the P marker removes the link AND its mark, for good", async () => {
    const editor = mountDoc();
    const anchorId = highlight(editor);
    const card = { id: "c1", links: [modeBLink(anchorId, ["P"]), modeALink(["Q"])] };
    expect(rowPids(editor, card)).toEqual(["Q", "P"]);

    // The retired door, restated: a stored-pid match keeps the Mode-B link,
    // so the very next pass paints the P marker again.
    expect(rowPids(editor, removeTextObjectLink(card, "P"))).toContain("P");

    const s = store(card);
    await deleteRow(editor, s, "P");

    expect(s.card.links!.map((l) => l.id)).toEqual(["c1@Q"]);
    expect(buildResolveIndex(editor).anchorIdToParagraph.has(anchorId), "mark stripped").toBe(false);
    expect(rowPids(editor, s.card), "the marker does not come back").toEqual(["Q"]);
    expect(s.del).not.toHaveBeenCalled();
    expect(s.confirm).not.toHaveBeenCalled();
    expect(s.unanchor).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("the Mode-B words split into a new paragraph: the row's pid is NOT stored, the delete still lands", async () => {
    const editor = mountDoc();
    const anchorId = highlight(editor);
    editor.chain().setTextSelection(1 + "Lead-in sentence. ".length).splitBlock().run();
    const markPid = buildResolveIndex(editor).anchorIdToParagraph.get(anchorId)!;
    expect(markPid).not.toBe("P");

    const card = { id: "c1", links: [modeBLink(anchorId, ["P"]), modeALink(["Q"])] };
    expect(rowPids(editor, card)).toEqual(["Q", markPid]);
    // Retired door: the card stores no such pid — a silent no-op.
    expect(removeTextObjectLink(card, markPid)).toBe(card);

    const s = store(card);
    await deleteRow(editor, s, markPid);

    expect(rowPids(editor, s.card)).toEqual(["Q"]);
    expect(buildResolveIndex(editor).anchorIdToParagraph.has(anchorId)).toBe(false);
    editor.destroy();
  });

  it("CONTROL — deleting the Mode-A sibling leaves the Mode-B link and its mark alone", async () => {
    const editor = mountDoc();
    const anchorId = highlight(editor);
    const s = store({ id: "c1", links: [modeBLink(anchorId, ["P"]), modeALink(["Q"])] });
    await deleteRow(editor, s, "Q");

    expect(s.card.links!.map((l) => l.id)).toEqual([anchorId]);
    expect(buildResolveIndex(editor).anchorIdToParagraph.get(anchorId)).toBe("P");
    expect(rowPids(editor, s.card)).toEqual(["P"]);
    editor.destroy();
  });

  // Task 1328 — a Mode-B link whose mark is DEAD is bound by its stored pids
  // (the rung-2b self-heal draws a row per live one), so its rows are sibling
  // ANCHORS, not one range. `sourceOf` used to answer `pid: null` for every
  // Mode-B row, so Delete on one dropped the whole link and every sibling
  // marker with it — no confirm, no card delete, zero anchors left.
  it("a DEAD-mark Mode-B link stored on [P, Q]: deleting the P marker keeps Q", async () => {
    const editor = mountDoc();
    const card = { id: "c1", links: [modeBLink("dead-anchor", ["P", "Q"])] };
    expect(rowPids(editor, card)).toEqual(["P", "Q"]);

    const s = store(card);
    await deleteRow(editor, s, "P");

    expect(s.card.links!.map((l) => l.id)).toEqual(["dead-anchor"]);
    const anchor = s.card.links![0].anchor;
    expect(anchor.type === "textObject" && anchor.textObjectIds).toEqual(["Q"]);
    expect(rowPids(editor, s.card), "the sibling marker still paints").toEqual(["Q"]);
    expect(s.del).not.toHaveBeenCalled();
    expect(s.confirm).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("CONTROL — a LIVE-mark Mode-B row still detaches the whole link (its range is the binding)", () => {
    const editor = mountDoc();
    const anchorId = highlight(editor);
    const card = { id: "c1", links: [modeBLink(anchorId, ["P", "Q"])] };
    const rows = buildMarginMarkerRows(card, buildCardAnchorPass(editor).resolve);
    expect(rows.map((r) => r.pid)).toEqual(["P"]);
    expect(rows[0].sources).toEqual([{ linkId: anchorId, pid: null, anchorId }]);
    editor.destroy();
  });

  it("CONTROL — a multi-pid Mode-A link loses just the one pid", async () => {
    const editor = mountDoc();
    const s = store({ id: "c1", links: [modeALink(["P", "Q"])] });
    await deleteRow(editor, s, "P");
    expect(rowPids(editor, s.card)).toEqual(["Q"]);
    editor.destroy();
  });
});

describe("detachAnchorSources — the transform behind the row", () => {
  const card = { id: "c1", links: [modeALink(["DEAD"], "snap"), modeALink(["Q"])] };

  it("a whole-link source (a RECOVERED row) drops its link even though the pid is not stored", () => {
    const out = detachAnchorSources(card, [{ linkId: "c1@DEAD", pid: null, anchorId: null }]);
    expect(out.links!.map((l) => l.id)).toEqual(["c1@Q"]);
  });

  it("a source whose link is gone is INERT — never re-bound onto another link", () => {
    expect(detachAnchorSources(card, [{ linkId: "nope", pid: null, anchorId: null }])).toBe(card);
    expect(detachAnchorSources(card, [{ linkId: "c1@Q", pid: "P", anchorId: null }])).toBe(card);
  });
});
