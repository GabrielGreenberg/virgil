// @vitest-environment jsdom
//
// Task 346, the RIPPLE — and the most user-visible half of that fix.
//
// Before 346 a paragraph inside an `\ex`/`\pex` body minted its own uuid on
// every parse, so a card created against one has a `textObjectIds[0]` pointing
// at an id that (a) was already churning and (b) after the fix does not exist
// at all: the inner paragraph now defers its identity to its container.
//
// The question this suite answers is what happens to that card on the next
// open. The wrong answers are both silent — ORPHAN (the card detaches from
// text that is still right there) or a resolve to some UNRELATED paragraph
// that happens to share text. The right answer is RELOCATION to the container
// that now owns the identity, which is what the snapshot rung already does for
// every other id that goes missing.
//
// Driven against a REAL editor, because the whole mechanism is the resolve
// index built from a live doc.
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
import type { CardWithLinks } from "@/links/links";
import {
  buildResolveIndex,
  resolveCardAnchor,
  reconcileCardToResolved,
} from "@/links/resolve-card-anchor";
import { parseLatex } from "@/lib/latex-parser";
import { assignUuids } from "@/lib/latex-serializer";

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

const BODY_TEXT = "The example body sentence.";
const TEX = `\\documentclass{article}\n\\usepackage{expex}\n\n\\begin{document}\n\n\\ex\n${BODY_TEXT}\n\\xe\n\nUnrelated tail prose.\n\n\\end{document}\n`;

/** Mount the REAL editor over the REAL parse of an expex document. */
function mountFromTex(tex: string): Editor {
  const content = parseLatex(tex);
  assignUuids(content);
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: content as never,
  });
}

/** A legacy card: anchored by a uuid this fix removes, carrying the snapshot
 *  every Mode-A link stores beside it. */
function legacyCard(staleUuid: string, snapshot: string): CardWithLinks & {
  id: string;
  kind: string;
} {
  return {
    id: "card-1",
    kind: "note",
    links: [
      {
        id: "link-1",
        kind: "note",
        cardId: "card-1",
        anchor: {
          type: "textObject",
          targetKind: "paragraph",
          textObjectIds: [staleUuid],
          paragraphSnapshot: snapshot,
        },
      },
    ],
  } as never;
}

describe("a card anchored to a now-deferred example paragraph relocates", () => {
  it("does not ORPHAN — it resolves via the snapshot rung", () => {
    const editor = mountFromTex(TEX);
    const index = buildResolveIndex(editor);
    // The stale id is one an older build minted for the inner paragraph. It is
    // deliberately absent from the live doc — that IS the post-346 state.
    const card = legacyCard("dead", BODY_TEXT);
    const res = resolveCardAnchor(card, editor, index);
    expect(res.source, "the card orphaned instead of relocating").not.toBe(
      "orphan",
    );
    expect(res.paragraphId).toBeTruthy();
    editor.destroy();
  });

  it("relocates to the CONTAINER that now owns the identity", () => {
    const editor = mountFromTex(TEX);
    const index = buildResolveIndex(editor);
    const res = resolveCardAnchor(
      legacyCard("dead", BODY_TEXT),
      editor,
      index,
    );
    // Find what that uuid actually is in the live doc — it must be the
    // exampleBlock, not some unrelated paragraph and not the tail prose.
    let resolvedType: string | null = null;
    editor.state.doc.descendants((node) => {
      if ((node.attrs as { uuid?: string })?.uuid === res.paragraphId) {
        resolvedType = node.type.name;
      }
      return true;
    });
    expect(resolvedType).toBe("exampleBlock");
    editor.destroy();
  });

  it("the reconciler REWRITES the stale id, so the repair is durable", () => {
    // Otherwise the card would re-resolve by snapshot on every single open —
    // correct on screen, and permanently one edit away from orphaning if the
    // user rewords the sentence.
    const editor = mountFromTex(TEX);
    const index = buildResolveIndex(editor);
    const card = legacyCard("dead", BODY_TEXT);
    const res = resolveCardAnchor(card, editor, index);
    const { card: next, changed } = reconcileCardToResolved(card, res);
    expect(changed).toBe(true);
    const anchor = next.links?.[0]?.anchor;
    expect(anchor?.type).toBe("textObject");
    const ids =
      anchor && anchor.type === "textObject" ? anchor.textObjectIds : [];
    expect(ids[0]).toBe(res.paragraphId);
    expect(ids[0]).not.toBe("dead");
    editor.destroy();
  });

  it("the container's text is UNAMBIGUOUS now — the duplicate is gone", () => {
    // Pre-346 the inner paragraph AND its container both carried a uuid with
    // the SAME normalized text, so the snapshot index saw a duplicate key. That
    // ambiguity is what made `recoverOrphanedUuids`' fingerprint matching a
    // wrong-restore hazard. With the inner paragraph deferred there is exactly
    // one uuid-bearing node carrying this text.
    const editor = mountFromTex(TEX);
    let bearers = 0;
    editor.state.doc.descendants((node) => {
      const uuid = (node.attrs as { uuid?: string })?.uuid;
      if (uuid && node.textContent.trim() === BODY_TEXT) bearers += 1;
      return true;
    });
    expect(bearers, "container and inner paragraph both claim this text").toBe(1);
    editor.destroy();
  });
});
