// @vitest-environment jsdom
//
// Chip #37 — the citation hard-delete contract.
//
// `deleteCitation` USED to be a sidecar-state filter only: it dropped the
// citations.json entry but left the `\cite` atom in the doc. EditorPane's
// once-per-mount `syncFromEditor` then rebuilt the entry from the surviving
// atom, so the deleted card resurrected on reload. The fix routes every UI
// delete through a compound handler that removes BOTH the in-doc atom (via
// the `deleteLink` primitive — the same one `deleteFootnote` uses) AND the
// sidecar entry.
//
// These pins exercise the editor-side half (the load-bearing one, since the
// sidecar filter was never in doubt) against the REAL Citation node schema:
//   1. an anchored `\cite` atom: deleteLink removes it from the doc.
//   2. a draft / unanchored citation (no atom in the doc): deleteLink is a
//      structural no-op (the doc is byte-identical), while the sidecar entry
//      is still dropped — so the compound delete works for drafts too.
//
// Editor mounts under jsdom the same way editor-extensions.test.ts /
// math-surface-gate.test.ts do. Citation + Footnote are import-light (no
// `@/lib/storage` chain), but `@/links/links` pulls a few `@/` modules; the
// storage stub guards against the barrel/storage gotcha just in case.
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
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { deleteLink, type Link as VirgilLink } from "@/links/links";

const CIT_ID = "cit-anchored-1";

function citationLink(id: string): VirgilLink {
  return {
    id,
    kind: "citation",
    anchor: { type: "inline-atom", nodeName: "citation", pos: null },
    target: { type: "card", ref: { kind: "citation", id } },
    createdAt: "",
  };
}

function countCitationAtoms(editor: Editor): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") n++;
    return true;
  });
  return n;
}

function mountWithCitation(citationId: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: [StarterKit, Citation],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            {
              type: "citation",
              attrs: {
                citationId,
                command: "\\cite{smith2020}",
                displayText: "Smith 2020",
              },
            },
            { type: "text", text: "." },
          ],
        },
      ],
    },
  });
}

function mountPlain(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: [StarterKit, Citation],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "No cite here." }] }],
    },
  });
}

describe("citation hard-delete contract (#37)", () => {
  it("deleteLink removes the anchored \\cite atom from the doc", () => {
    const editor = mountWithCitation(CIT_ID);
    expect(countCitationAtoms(editor)).toBe(1);

    // The sidecar half (mirrors useCitations.deleteCitation: filter by id).
    let sidecar = [{ id: CIT_ID }, { id: "other" }];

    // Compound delete: doc tx first, then the sidecar filter.
    deleteLink(editor, citationLink(CIT_ID));
    sidecar = sidecar.filter((c) => c.id !== CIT_ID);

    // Atom gone from the live doc, the unrelated text preserved.
    expect(countCitationAtoms(editor)).toBe(0);
    expect(editor.state.doc.textContent).toBe("See .");
    // Sidecar entry gone too; the unrelated entry survives.
    expect(sidecar).toEqual([{ id: "other" }]);

    editor.destroy();
  });

  it("draft / unanchored citation: deleteLink no-ops the doc tx but the entry still clears", () => {
    const editor = mountPlain();
    const before = editor.state.doc.toJSON();
    expect(countCitationAtoms(editor)).toBe(0);

    let sidecar = [{ id: "draft-1" }, { id: "keep" }];

    // No atom in the doc → findInlineAtomPos returns null → deleteLink is a
    // structural no-op. The compound handler still drops the sidecar entry.
    deleteLink(editor, citationLink("draft-1"));
    sidecar = sidecar.filter((c) => c.id !== "draft-1");

    // Doc byte-identical (the robust no-op oracle), entry cleared.
    expect(editor.state.doc.toJSON()).toEqual(before);
    expect(sidecar).toEqual([{ id: "keep" }]);

    editor.destroy();
  });

  it("deleteLink matches by citationId, not just linkId", () => {
    // The sidecar id equals the atom's citationId (syncFromEditor maps
    // ec.citationId -> ref.id), and findInlineAtomPos matches either attr.
    const editor = mountWithCitation("by-citation-id");
    expect(countCitationAtoms(editor)).toBe(1);
    deleteLink(editor, citationLink("by-citation-id"));
    expect(countCitationAtoms(editor)).toBe(0);
    editor.destroy();
  });
});
