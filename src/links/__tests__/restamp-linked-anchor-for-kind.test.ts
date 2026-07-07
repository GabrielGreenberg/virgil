// @vitest-environment jsdom
//
// Task 2026-07-06-073 — a card MORPH restamps its in-doc `linkedAnchor` mark's
// KIND-DERIVED presentation IMMEDIATELY (no reload needed).
//
// The bug: `convertCardWithRemap`'s morph flipped only the sidecar record; the
// in-doc mark kept its OLD `tintColor` + `data-link-card` token until a full
// document reload re-stamped it via `reapplyModeBAnchors`. So a note→highlight
// morph produced an INVISIBLE highlight (the amber band, painted solely by
// `tintColor`, never appeared), and every morph left a stale token.
//
// `restampLinkedAnchorForKind` is the fix: it authoritatively re-derives the
// mark's `kind` / `data-link-card` token / `tintColor` from the NEW spine
// CardKind, using the SAME `defaultTintForLinkedAnchorKind` SSOT the create +
// reload paths use — so the morphed mark is byte-identical to a reloaded one.
//
// The storage mock mirrors linked-anchor-kind-roundtrip.test.ts (the editor
// extension barrel transitively imports `@/lib/storage`).
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
import type { JSONContent } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  restampLinkedAnchorForKind,
  type CardWithLinks,
} from "@/links/links";
import { defaultTintForLinkedAnchorKind } from "@/cards/legacy-token-crosswalk";
import { buildModeBReapplyRecords } from "@/links/_shared/reapply-mode-b-anchors";
import { linkedAnchorRenderAttrs } from "@/lib/tiptap/linked-anchor-attrs";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

/** Mount a one-paragraph doc whose middle run carries a `linkedAnchor` mark with
 *  the given starting attrs — a realistic just-created / just-loaded mark. */
function mountDocWithMark(attrs: {
  anchorId: string;
  kind: string;
  linkCard?: string;
  tintColor?: string | null;
}): Editor {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { uuid: "p001" },
        content: [
          { type: "text", text: "before " },
          {
            type: "text",
            text: "the span",
            marks: [
              {
                type: "linkedAnchor",
                attrs: {
                  anchorId: attrs.anchorId,
                  kind: attrs.kind,
                  linkId: attrs.anchorId,
                  linkKind: "anchor",
                  linkCard: attrs.linkCard ?? "",
                  tintColor: attrs.tintColor ?? null,
                },
              },
            ],
          },
          { type: "text", text: " after" },
        ],
      },
    ],
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: doc,
  });
}

function markAttrsFor(
  editor: Editor,
  anchorId: string,
): Record<string, unknown> | null {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (attrs) return false;
    if (!node.isText) return true;
    for (const m of node.marks) {
      if (m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId) {
        attrs = m.attrs as Record<string, unknown>;
        return false;
      }
    }
    return true;
  });
  return attrs;
}

function markRunCountFor(editor: Editor, anchorId: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      n += 1;
    }
    return true;
  });
  return n;
}

function markedTextFor(editor: Editor, anchorId: string): string {
  let out = "";
  editor.state.doc.descendants((node) => {
    if (
      node.isText &&
      node.marks.some(
        (m) => m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
      )
    ) {
      out += node.text ?? "";
    }
    return true;
  });
  return out;
}

/** A minimal highlight `CardWithLinks` carrying a Mode-B `linkedRange` anchor,
 *  so the reload record-builder derives its tint from the SAME SSOT. */
function highlightCard(anchorId: string, id: string): CardWithLinks {
  return {
    id,
    links: [
      {
        id: anchorId,
        kind: "anchor",
        anchor: {
          type: "textObject",
          targetKind: "linkedRange",
          textObjectIds: ["p001"],
          margin: { side: "right" },
          textRange: { anchorId, textSnapshot: "the span" },
        },
        target: { type: "card", ref: { kind: "highlight", id } },
        createdAt: "",
      },
    ],
  };
}

describe("restampLinkedAnchorForKind — a card morph makes the in-doc mark agree immediately", () => {
  it("note → highlight paints the amber band (tintColor #fbbf24) + highlight token, no reload", () => {
    // A freshly-created Mode-B note: no tint, note token.
    const editor = mountDocWithMark({
      anchorId: "n1",
      kind: "note",
      linkCard: "note:n1",
      tintColor: null,
    });
    expect(markAttrsFor(editor, "n1")?.tintColor ?? null).toBe(null);

    restampLinkedAnchorForKind(editor, "n1", "highlight", "n1");

    const attrs = markAttrsFor(editor, "n1");
    expect(attrs?.kind).toBe("highlight");
    expect(attrs?.tintColor).toBe("#fbbf24"); // the visible amber band
    expect(attrs?.linkCard).toBe("highlight:n1");
    expect(linkedAnchorRenderAttrs(attrs ?? {})["data-link-card"]).toBe(
      "highlight:n1",
    );
    // Re-stamped IN PLACE: same range/text, exactly one run (no duplicate mark).
    expect(markedTextFor(editor, "n1")).toBe("the span");
    expect(markRunCountFor(editor, "n1")).toBe(1);
    editor.destroy();
  });

  it("highlight → note CLEARS the tint band (no orphan amber) + reverts the token", () => {
    const editor = mountDocWithMark({
      anchorId: "h1",
      kind: "highlight",
      linkCard: "highlight:h1",
      tintColor: "#fbbf24",
    });
    expect(markAttrsFor(editor, "h1")?.tintColor).toBe("#fbbf24");

    restampLinkedAnchorForKind(editor, "h1", "note", "h1");

    const attrs = markAttrsFor(editor, "h1");
    expect(attrs?.kind).toBe("note");
    expect(attrs?.tintColor ?? null).toBe(null); // band gone
    expect(attrs?.linkCard).toBe("note:h1");
    expect(linkedAnchorRenderAttrs(attrs ?? {})["data-link-card"]).toBe(
      "note:h1",
    );
    expect(markRunCountFor(editor, "h1")).toBe(1);
    editor.destroy();
  });

  it("the morph tint and the reload (reapply-mode-b-anchors) tint converge on ONE SSOT", () => {
    // Morph path: restamp a note → highlight, read the resulting tint.
    const editor = mountDocWithMark({
      anchorId: "c1",
      kind: "note",
      linkCard: "note:c1",
      tintColor: null,
    });
    restampLinkedAnchorForKind(editor, "c1", "highlight", "c1");
    const morphTint = markAttrsFor(editor, "c1")?.tintColor;

    // Reload path: the record-builder derives the same highlight's tint.
    const records = buildModeBReapplyRecords({
      notes: [],
      todoItems: [],
      comments: [],
      cutterCards: [],
      reports: [],
      highlights: [highlightCard("c1", "c1")],
    });
    const reloadTint = records.find((r) => r.anchorId === "c1")?.tintColor;

    // Both equal the single crosswalk SSOT — no drift possible.
    expect(morphTint).toBe(defaultTintForLinkedAnchorKind("highlight"));
    expect(reloadTint).toBe(defaultTintForLinkedAnchorKind("highlight"));
    expect(morphTint).toBe(reloadTint);
    editor.destroy();
  });

  it("is GENERIC off the target kind — a revision-comment → revision-suggestion morph refreshes the stale token", () => {
    // The bug CLASS beyond note/highlight: a morph left the data-link-card token
    // naming the OLD kind. Restamp corrects it (tint stays null both ways).
    const editor = mountDocWithMark({
      anchorId: "r1",
      kind: "revision",
      linkCard: "revision-comment:r1",
      tintColor: null,
    });
    restampLinkedAnchorForKind(editor, "r1", "revision-suggestion", "r1");

    const attrs = markAttrsFor(editor, "r1");
    expect(attrs?.linkCard).toBe("revision-suggestion:r1");
    expect(attrs?.kind).toBe("revision"); // both revision spine kinds fold to "revision"
    expect(attrs?.tintColor ?? null).toBe(null);
    expect(markRunCountFor(editor, "r1")).toBe(1);
    editor.destroy();
  });

  it("is a graceful no-op when the anchorId is not in the doc", () => {
    const editor = mountDocWithMark({
      anchorId: "keep",
      kind: "note",
      linkCard: "note:keep",
      tintColor: null,
    });
    expect(() =>
      restampLinkedAnchorForKind(editor, "missing", "highlight", "missing"),
    ).not.toThrow();
    // The existing mark is untouched.
    expect(markAttrsFor(editor, "keep")?.kind).toBe("note");
    editor.destroy();
  });
});
