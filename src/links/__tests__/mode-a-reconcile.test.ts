// @vitest-environment jsdom
//
// Mode-A self-healing anchor reconcile (anchor-persistence bug, Lever 1).
//
// A Mode-A margin card anchors via a bare paragraph UUID. That UUID
// round-trips through the `.tex` only as a `%!v:` comment written by the
// 1500 ms autosave; if the write loses the race to a reload, the
// paragraph is re-minted a fresh UUID and the card silently orphans
// (gone from the margin, yet `isUnanchored` still reports anchored).
//
// These pins exercise the recovery machinery against the REAL main
// editor stack (so paragraphs carry a `uuid` attr exactly as in prod):
//   1. a Mode-A link write captures a snapshot;
//   2. reconcile: stored UUID matches NO live block but the snapshot
//      matches a paragraph → the card rebinds to the live UUID;
//   3. UUID-first: when the stored UUID still resolves, the snapshot is
//      NOT used to move it — even if another paragraph shares the text;
//   4. duplicated-text: the fallback never mis-binds when two paragraphs
//      share text and the UUID resolves;
//   5. legacy snapshot-less link is tolerated (no crash, UUID-only).
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
  captureParagraphSnapshot,
  findParagraphIdBySnapshot,
  isModeAOrphaned,
  reconcileModeAAnchors,
  type CardWithLinks,
} from "@/links/links";
import { buildResolveIndex } from "@/links/resolve-card-anchor";

/** The live-uuid set, read from the ONE index (task 369 retired the separate
 *  `collectLiveUuids` walk — the set is that index's key set). */
const liveUuids = (editor: Editor): Set<string> =>
  buildResolveIndex(editor).uuidToParagraph;

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

type NoteCard = CardWithLinks & { id: string; kind: "note" };

function noteCard(id: string): NoteCard {
  return { id, kind: "note" };
}

describe("Mode-A self-healing reconcile", () => {
  it("captures a paragraph snapshot when a Mode-A link is written", () => {
    const editor = mountDoc([{ uuid: "aaaa", text: "The first paragraph." }]);
    const snap = captureParagraphSnapshot(editor, "aaaa");
    expect(snap).toBe("The first paragraph.");

    const card = addTextObjectLink(noteCard("n1"), "note", "aaaa", "paragraph", snap);
    const link = card.links?.[0];
    expect(link).toBeDefined();
    if (link?.anchor.type !== "textObject") throw new Error("expected textObject");
    expect(link.anchor.textObjectIds).toEqual(["aaaa"]);
    expect(link.anchor.paragraphSnapshot).toBe("The first paragraph.");
    editor.destroy();
  });

  it("rebinds a card whose UUID matches no live block but whose snapshot matches", () => {
    // Card was anchored to "stale" with snapshot "The body of the note.";
    // on reload the paragraph was re-minted "fresh" — UUID no longer resolves.
    const editor = mountDoc([
      { uuid: "head0", text: "A heading-ish line." },
      { uuid: "fresh", text: "The body of the note." },
    ]);
    let card = addTextObjectLink(
      noteCard("n1"),
      "note",
      "stale",
      "paragraph",
      "The body of the note.",
    );
    // Sanity: the stored UUID is dead.
    const live = liveUuids(editor);
    expect(live.has("stale")).toBe(false);
    expect(isModeAOrphaned(card, live)).toBe(true);

    const res = reconcileModeAAnchors(card, editor, live);
    expect(res.changed).toBe(true);
    card = res.card as NoteCard;
    const link = card.links?.[0];
    if (link?.anchor.type !== "textObject") throw new Error("expected textObject");
    expect(link.anchor.textObjectIds).toEqual(["fresh"]);
    // No longer orphaned after the rebind.
    expect(isModeAOrphaned(card, liveUuids(editor))).toBe(false);
    editor.destroy();
  });

  it("UUID-first: a still-live UUID is NOT moved by a same-text sibling (refresh only)", () => {
    // Two paragraphs share the exact text; the card's UUID points at the
    // SECOND one and still resolves. The snapshot must NOT pull it onto the
    // first (indexOf/first-match would). Instead, only the snapshot is
    // (re)written — the binding stays put.
    const editor = mountDoc([
      { uuid: "dup-a", text: "Shared duplicated body." },
      { uuid: "dup-b", text: "Shared duplicated body." },
    ]);
    const card = addTextObjectLink(
      noteCard("n1"),
      "note",
      "dup-b",
      "paragraph",
      // Deliberately stale/empty snapshot to prove backfill happens AND
      // the binding doesn't move to the earlier same-text paragraph.
      "",
    );
    const live = liveUuids(editor);
    const res = reconcileModeAAnchors(card, editor, live);
    const link = res.card.links?.[0];
    if (link?.anchor.type !== "textObject") throw new Error("expected textObject");
    // Still anchored to dup-b — never moved to dup-a.
    expect(link.anchor.textObjectIds).toEqual(["dup-b"]);
    // Snapshot backfilled from the live paragraph.
    expect(link.anchor.paragraphSnapshot).toBe("Shared duplicated body.");
    editor.destroy();
  });

  it("duplicated-text fallback: dead UUID + ambiguous snapshot binds first match, live UUID never overridden", () => {
    // The card's UUID is dead; two paragraphs share the snapshot text.
    // findParagraphIdBySnapshot returns the FIRST (documented first-match);
    // crucially this only fires because the UUID was dead — a live UUID is
    // never overridden (proved by the previous test).
    const editor = mountDoc([
      { uuid: "first0", text: "Ambiguous shared text." },
      { uuid: "secnd0", text: "Ambiguous shared text." },
    ]);
    expect(findParagraphIdBySnapshot(editor, "Ambiguous shared text.")).toBe("first0");

    const card = addTextObjectLink(
      noteCard("n1"),
      "note",
      "deadid",
      "paragraph",
      "Ambiguous shared text.",
    );
    const res = reconcileModeAAnchors(card, editor, liveUuids(editor));
    const link = res.card.links?.[0];
    if (link?.anchor.type !== "textObject") throw new Error("expected textObject");
    expect(link.anchor.textObjectIds).toEqual(["first0"]);
    editor.destroy();
  });

  it("tolerates a legacy snapshot-less link (no crash, UUID-only behavior)", () => {
    // A legacy Mode-A link with NO paragraphSnapshot.
    const editorLive = mountDoc([{ uuid: "live0", text: "Still here." }]);
    const liveCard = addTextObjectLink(noteCard("n1"), "note", "live0"); // no snapshot
    const link0 = liveCard.links?.[0];
    if (link0?.anchor.type !== "textObject") throw new Error("expected textObject");
    expect(link0.anchor.paragraphSnapshot).toBeUndefined();

    // (a) UUID still resolves → backfills snapshot, does not move.
    const r1 = reconcileModeAAnchors(liveCard, editorLive, liveUuids(editorLive));
    const l1 = r1.card.links?.[0];
    if (l1?.anchor.type !== "textObject") throw new Error("expected textObject");
    expect(l1.anchor.textObjectIds).toEqual(["live0"]);
    expect(l1.anchor.paragraphSnapshot).toBe("Still here.");
    editorLive.destroy();

    // (b) UUID dead AND no snapshot → left untouched (cannot recover), and
    //     surfaces as orphaned. No crash.
    const editorGone = mountDoc([{ uuid: "other0", text: "Unrelated." }]);
    const deadCard = addTextObjectLink(noteCard("n2"), "note", "gone00"); // no snapshot
    const live = liveUuids(editorGone);
    const r2 = reconcileModeAAnchors(deadCard, editorGone, live);
    expect(r2.changed).toBe(false);
    expect(isModeAOrphaned(r2.card, live)).toBe(true);
    editorGone.destroy();
  });
});
