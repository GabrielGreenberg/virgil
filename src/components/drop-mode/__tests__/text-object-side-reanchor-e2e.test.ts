// @vitest-environment jsdom
//
// CHIP-A — the highest-value tooth: a real-`new Editor` end-to-end proof that
// re-anchoring a SELECTION-origin (Mode-B `linkedRange`) NOTE CONVERTS it to a
// clean Mode-A `paragraph` link with a NON-NULL `paragraphSnapshot`, captured
// live from `ctx.mainEditor` at re-anchor time.
//
// Why this exists: the landed unit test (`text-object-side-reanchor.test.ts`)
// feeds a `null` ctx.mainEditor, so `captureParagraphSnapshot` always returns
// null there — a harness artifact. The make-or-break claim CHIP-A must prove is
// that, against a LIVE editor (the production shape — `ctx.mainEditor` is a live
// getter in `DropModeProvider.tsx`), the snapshot lands NON-NULL.
//
// The test drives the REAL spec `applyDrop` against a hand-rolled
// `ParagraphAnchorApi` whose mutators compose the REAL `links.ts` pure
// functions over a single mutable card object — exactly the way `useNotes`
// wires them (addTextObjectLink / removeTextObjectLink / clearTextAnchorLink /
// preserveModeBAnchor). So the full RC1 chain is exercised: a Mode-B card +
// in-doc mark → re-anchor commit → clean Mode-A link + non-null snapshot +
// getTextAnchor === null.
//
// The storage stub guards the extension-barrel/@/lib/storage gotcha (the
// figure/graphics/tex NodeViews transitively import @/lib/storage).
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  addTextObjectLink,
  clearTextAnchorLink,
  createLinkedAnchor,
  getLinkedTextObjectIds,
  getTextAnchor,
  removeLinkedAnchor,
  removeTextObjectLink,
  setTextAnchorLink,
  type CardWithLinks,
} from "@/links/links";
import { textObjectSideReanchorSpec } from "../util/text-object-side-reanchor";
import { buildFloatKey } from "@/floats/float-key";
import type { DropCtx, ParagraphAnchorApi, Placement } from "../types";
import type { OriginalAnchor } from "@/lib/types";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

/** Mount the real main stack with the given paragraphs (uuid + text). */
function mountDoc(paras: Array<{ uuid: string; text: string }>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: paras.map((p) => ({
        type: "paragraph",
        attrs: { uuid: p.uuid },
        content: [{ type: "text", text: p.text }],
      })),
    },
  });
}

type NoteCard = CardWithLinks & {
  id: string;
  kind: "note";
  originalAnchor?: OriginalAnchor;
};

/**
 * A `ParagraphAnchorApi` backed by a single live card object, composing the
 * REAL `links.ts` pure functions — the production wiring (`useNotes`) in
 * miniature. The card is mutated in place across the applyDrop sequence so a
 * follow-up `getAnchorTextObjectIds` reads the post-mutation state, matching
 * the React functional-update composition the live hook relies on.
 */
function noteApi(
  cardRef: { card: NoteCard },
  editor: Editor,
): ParagraphAnchorApi {
  return {
    exists: (id) => cardRef.card.id === id,
    getAnchorTextObjectIds: (id) =>
      cardRef.card.id === id ? getLinkedTextObjectIds(cardRef.card) : [],
    addTextObjectLink: (id, pid, targetKind, snapshot) => {
      if (cardRef.card.id !== id) return;
      cardRef.card = addTextObjectLink(
        cardRef.card,
        "note",
        pid,
        targetKind,
        snapshot,
      ) as NoteCard;
    },
    removeTextObjectLink: (id, pid) => {
      if (cardRef.card.id !== id) return;
      cardRef.card = removeTextObjectLink(cardRef.card, pid) as NoteCard;
    },
    preserveModeBAnchor: (id) => {
      if (cardRef.card.id !== id) return null;
      const ta = getTextAnchor(cardRef.card);
      if (!ta) return null;
      cardRef.card = {
        ...cardRef.card,
        originalAnchor: {
          droppedAt: new Date().toISOString(),
          anchorId: ta.anchorId,
          textSnapshot: ta.anchorText,
          paragraphIds: getLinkedTextObjectIds(cardRef.card),
        },
      };
      return ta.anchorId;
    },
    clearModeB: (id) => {
      if (cardRef.card.id !== id) return;
      cardRef.card = clearTextAnchorLink(cardRef.card, "note") as NoteCard;
    },
  };
}

function paragraphSide(paragraphId: string): Placement {
  return { kind: "paragraph-side", paragraphId } as unknown as Placement;
}

function ctxWithNotes(api: ParagraphAnchorApi, editor: Editor): DropCtx {
  return { notes: api, mainEditor: editor } as unknown as DropCtx;
}

function noteSpec() {
  return textObjectSideReanchorSpec({
    kindLabel: "note",
    getApi: (ctx) => ctx.notes,
  });
}

describe("CHIP-A E2E — Mode-B selection-note re-anchor converts to clean Mode-A", () => {
  it("lands a clean paragraph link with a NON-NULL snapshot and getTextAnchor === null", () => {
    // P_old carries the selection; P_new is the drop target.
    const editor = mountDoc([
      { uuid: "pold", text: "The original selected sentence lived here." },
      { uuid: "pnew", text: "The brand new paragraph the note moves to." },
    ]);

    // Build a Mode-B selection-note: a `linkedAnchor` mark over a range in
    // P_old plus a `linkedRange` link on the card carrying that anchorId.
    const rec = createLinkedAnchor(
      editor,
      "note",
      { from: 2, to: 12 }, // a range inside P_old
      "note1",
    );
    expect(rec).not.toBeNull();
    const anchorId = rec!.anchorId;

    let card: NoteCard = { id: "note1", kind: "note" };
    card = setTextAnchorLink(card, "note", anchorId, rec!.text) as NoteCard;

    // Sanity: the card is a single Mode-B `linkedRange` link before the drop.
    expect(getTextAnchor(card)).not.toBeNull();
    {
      const link = card.links?.[0];
      if (link?.anchor.type !== "textObject") throw new Error("expected textObject");
      expect(link.anchor.targetKind).toBe("linkedRange");
      expect(link.anchor.paragraphSnapshot).toBeUndefined();
    }
    // The mark is live in the doc.
    expect(editor.getHTML()).toContain(anchorId);

    // Drive the REAL re-anchor commit onto P_new.
    const cardRef = { card };
    const api = noteApi(cardRef, editor);
    const spec = noteSpec();
    const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "note1" });

    spec.applyDrop(paragraphSide("pnew"), CARD_KEY, ctxWithNotes(api, editor));

    const result = cardRef.card;

    // 1) The card is now a clean Mode-A `paragraph` link on P_new.
    const links = result.links ?? [];
    expect(links.length).toBe(1);
    const link = links[0];
    if (link.anchor.type !== "textObject") throw new Error("expected textObject");
    expect(link.anchor.targetKind).toBe("paragraph");
    expect(link.anchor.textObjectIds).toEqual(["pnew"]);

    // 2) THE MAKE-OR-BREAK: the snapshot is NON-NULL, captured live from the
    //    real editor's P_new text (not the harness-artifact null).
    expect(link.anchor.paragraphSnapshot).toBe(
      "The brand new paragraph the note moves to.",
    );
    expect(link.anchor.paragraphSnapshot).toBeTruthy();

    // 3) The Mode-B anchor is gone — no `linkedRange` link survives.
    expect(getTextAnchor(result)).toBeNull();

    // 4) The lost range was preserved onto originalAnchor (preserveModeBAnchor).
    expect(result.originalAnchor?.anchorId).toBe(anchorId);

    // 5) The in-doc mark was stripped (removeLinkedAnchor ran).
    expect(editor.getHTML()).not.toContain(anchorId);

    editor.destroy();
  });

  it("the unanchored→anchored note path (no surviving Mode-B link) still lands a non-null snapshot", () => {
    // A note with no existing anchor at all (links: []). The re-anchor must
    // still capture the live snapshot and write a clean Mode-A link — clearModeB
    // is a no-op here (no textRange to convert).
    const editor = mountDoc([
      { uuid: "ponly", text: "A solitary paragraph awaiting a note." },
    ]);
    const cardRef = { card: { id: "note2", kind: "note" } as NoteCard };
    const api = noteApi(cardRef, editor);
    const spec = noteSpec();
    const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "note2" });

    spec.applyDrop(paragraphSide("ponly"), CARD_KEY, ctxWithNotes(api, editor));

    const link = cardRef.card.links?.[0];
    if (link?.anchor.type !== "textObject") throw new Error("expected textObject");
    expect(link.anchor.targetKind).toBe("paragraph");
    expect(link.anchor.textObjectIds).toEqual(["ponly"]);
    expect(link.anchor.paragraphSnapshot).toBe(
      "A solitary paragraph awaiting a note.",
    );
    expect(getTextAnchor(cardRef.card)).toBeNull();
    editor.destroy();
  });

  // TEETH: with the fold-gate temp-reverted (modeBIdx no longer forced to -1
  // for targetKind 'paragraph') AND clearModeB removed, addTextObjectLink would
  // fold pnew into the surviving linkedRange link and drop the snapshot. This
  // test documents the asserted post-fix invariant the revert would break:
  // a clean paragraph link with a snapshot. (Run the revert manually to see RED.)
  it("[teeth-doc] post-fix invariant: link is paragraph-kind WITH a snapshot, not a folded linkedRange", () => {
    const editor = mountDoc([
      { uuid: "px", text: "Selection paragraph." },
      { uuid: "py", text: "Target paragraph for the teeth check." },
    ]);
    const rec = createLinkedAnchor(editor, "note", { from: 2, to: 10 }, "note3");
    let card: NoteCard = { id: "note3", kind: "note" };
    card = setTextAnchorLink(card, "note", rec!.anchorId, rec!.text) as NoteCard;
    const cardRef = { card };
    const spec = noteSpec();
    const CARD_KEY = buildFloatKey({ domain: "card", kind: "note", id: "note3" });
    spec.applyDrop(
      paragraphSide("py"),
      CARD_KEY,
      ctxWithNotes(noteApi(cardRef, editor), editor),
    );
    const link = cardRef.card.links?.[0];
    if (link?.anchor.type !== "textObject") throw new Error("expected textObject");
    // The two assertions a temp-revert of the fold-gate + clearModeB would break:
    expect(link.anchor.targetKind).toBe("paragraph"); // not "linkedRange"
    expect(link.anchor.paragraphSnapshot).toBe(
      "Target paragraph for the teeth check.",
    ); // not undefined (dropped by the fold)
    editor.destroy();
  });
});
