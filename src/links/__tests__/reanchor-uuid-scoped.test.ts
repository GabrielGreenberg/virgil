// @vitest-environment jsdom
//
// CHIP 6 — uuid-scoped, atom-aware `reanchorByText`.
//
// `reanchorByText(editor, kind, snapshot, anchorId, cardId, tint, paragraphUuid)`
// — when `paragraphUuid` is supplied and resolves to a live node, the text
// search is scoped to ONLY that paragraph (disambiguating duplicate/co-located
// snapshots the legacy doc-wide first-match would displace), and the char hit
// is mapped to doc positions with a per-CHILD offset walk that advances the doc
// pos by `nodeSize` for ALL children (incl. inline atoms) but the char index
// only for text — so `from`/`to` stay correct across an inline atom.
//
// Falls back to the legacy doc-wide search when the uuid is absent/unresolved.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRead = vi.fn();
const mockWrite = vi.fn();

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
  mod.readSidecar = (...a: unknown[]) => mockRead(...a);
  mod.readSidecarIfExists = (...a: unknown[]) => mockRead(...a);
  mod.writeSidecar = (...a: unknown[]) => mockWrite(...a);
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { reanchorByText } from "@/links/links";
import type { JSONContent } from "@tiptap/core";

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

function mountDoc(paras: Array<{ uuid: string; content: JSONContent[] }>): Editor {
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
        content: p.content,
      })),
    },
  });
}

/** The text spanned by the linkedAnchor mark with the given anchorId, plus the
 *  paragraph uuid it sits in. */
function markInfo(
  editor: Editor,
  anchorId: string,
): { text: string; uuid: string | null } {
  let text = "";
  let uuid: string | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph") {
      // Track the nearest enclosing paragraph as we descend.
      const end = pos + node.nodeSize;
      editor.state.doc.nodesBetween(pos, end, (inner) => {
        if (
          inner.isText &&
          inner.marks.some(
            (m) =>
              m.type.name === "linkedAnchor" && m.attrs.anchorId === anchorId,
          )
        ) {
          if (!uuid) uuid = (node.attrs.uuid as string) ?? null;
          text += inner.text ?? "";
        }
        return true;
      });
      return false; // don't double-walk children
    }
    return true;
  });
  return { text, uuid };
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
});

describe("reanchorByText — uuid scoping among duplicate snapshots", () => {
  it("lands in the stored paragraph (P2), NOT the doc-wide first match (P1)", () => {
    const editor = mountDoc([
      { uuid: "p1", content: [{ type: "text", text: "shared snapshot here" }] },
      { uuid: "p2", content: [{ type: "text", text: "shared snapshot here" }] },
    ]);

    const rec = reanchorByText(
      editor,
      "note",
      "shared snapshot",
      "anc-1",
      "card-1",
      null,
      "p2", // scope to the SECOND paragraph
    );
    expect(rec).not.toBeNull();
    expect(rec!.paragraphId).toBe("p2");

    const info = markInfo(editor, "anc-1");
    expect(info.text).toBe("shared snapshot");
    expect(info.uuid).toBe("p2"); // marked in P2, not P1
    editor.destroy();
  });

  it("falls back to the doc-wide first match when no uuid is supplied", () => {
    const editor = mountDoc([
      { uuid: "p1", content: [{ type: "text", text: "shared snapshot here" }] },
      { uuid: "p2", content: [{ type: "text", text: "shared snapshot here" }] },
    ]);

    const rec = reanchorByText(editor, "note", "shared snapshot", "anc-2");
    expect(rec).not.toBeNull();
    // Legacy behavior: first doc-wide match → P1.
    expect(rec!.paragraphId).toBe("p1");
    expect(markInfo(editor, "anc-2").uuid).toBe("p1");
    editor.destroy();
  });

  it("falls back to doc-wide search when the uuid is unresolved", () => {
    const editor = mountDoc([
      { uuid: "p1", content: [{ type: "text", text: "only here once" }] },
    ]);
    const rec = reanchorByText(
      editor,
      "note",
      "only here",
      "anc-3",
      undefined,
      null,
      "nonexistent-uuid",
    );
    // Unresolved uuid → legacy doc-wide path still finds it.
    expect(rec).not.toBeNull();
    expect(markInfo(editor, "anc-3").text).toBe("only here");
    editor.destroy();
  });
});

describe("reanchorByText — atom-aware range mapping", () => {
  it("maps a correct range when the snapshot spans an inline atom (footnote)", () => {
    // Paragraph: "go " + <footnote atom> + " here". The atom contributes no
    // text to `textContent` (= "go  here") but DOES occupy nodeSize=1 in the
    // doc. The offset walk must advance the doc pos across the atom so `from`
    // and `to` land on the right doc positions — not off by the atom's size.
    const editor = mountDoc([
      {
        uuid: "pA",
        content: [
          { type: "text", text: "go " },
          {
            type: "footnote",
            attrs: { footnoteId: "fn1", content: { type: "doc", content: [] } },
          },
          { type: "text", text: " here" },
        ],
      },
    ]);

    const snapshot = editor.state.doc.firstChild!.textContent; // "go  here"
    const rec = reanchorByText(
      editor,
      "note",
      snapshot,
      "anc-atom",
      "card-x",
      null,
      "pA",
    );
    expect(rec).not.toBeNull();
    expect(rec!.paragraphId).toBe("pA");

    // The mark covers BOTH text runs (the atom sits between them and carries no
    // mark, but the range spans the whole snapshot).
    const info = markInfo(editor, "anc-atom");
    expect(info.uuid).toBe("pA");
    // The marked text is the two text runs concatenated (atom contributes none).
    expect(info.text).toBe("go  here");
    editor.destroy();
  });

  it("maps a sub-range that starts after an inline atom", () => {
    // "go " + atom + " here now" — anchor only "here now" (after the atom).
    const editor = mountDoc([
      {
        uuid: "pB",
        content: [
          { type: "text", text: "go " },
          {
            type: "footnote",
            attrs: { footnoteId: "fn2", content: { type: "doc", content: [] } },
          },
          { type: "text", text: " here now" },
        ],
      },
    ]);

    const rec = reanchorByText(
      editor,
      "note",
      "here now",
      "anc-sub",
      "card-y",
      null,
      "pB",
    );
    expect(rec).not.toBeNull();
    const info = markInfo(editor, "anc-sub");
    expect(info.uuid).toBe("pB");
    expect(info.text).toBe("here now");
    editor.destroy();
  });
});
