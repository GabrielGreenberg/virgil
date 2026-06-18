// @vitest-environment jsdom
//
// BIB-F3-01 / CI-F3-01 — jump-to-citation for a `\cite` that lives ONLY inside
// a footnote body.
//
// `resolveLink` used to route through a descendants-only `findInlineAtomPos`,
// which (by ProseMirror design) cannot enter a footnote atom's `attrs.content`
// JSONContent literal. So a citation cited only inside a `\footnote{...\cite}`
// resolved to null → the jump arrow no-op'd. The T3/C10 fix makes `resolveLink`
// delegate to `findInlineAtomPosDeep`: a top-level atom resolves IDENTICALLY to
// before, but a footnote-nested atom now resolves to the HOST footnote marker
// (the only scrollable target — the nested atom has no own DOM).
//
// These pins drive the REAL `resolveLink` against an Editor mounting
// StarterKit + Citation + Footnote. The storage stub guards the barrel/storage
// gotcha (`@/links/links` pulls a few `@/` modules).
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
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { Footnote } from "@/lib/tiptap/footnote";
import { resolveLink, type Link as VirgilLink } from "@/links/links";

const TOP_ID = "cit-top";
const NESTED_ID = "cit-nested";
const HOST_FN_ID = "fn-host";

function citationLink(id: string): VirgilLink {
  return {
    id,
    kind: "citation",
    anchor: { type: "inline-atom", nodeName: "citation", pos: null },
    target: { type: "card", ref: { kind: "citation", id } },
    createdAt: "",
  };
}

/** doc: a TOP-LEVEL `\cite{smith}` in the body + a footnote whose body holds a
 *  DIFFERENT nested `\cite{jones}`. */
function mountDoc(): Editor {
  const footnoteBody: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "see also " },
          {
            type: "citation",
            attrs: {
              citationId: NESTED_ID,
              command: "\\cite{jones2019}",
              displayText: "Jones 2019",
            },
          },
        ],
      },
    ],
  };
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    extensions: [StarterKit, Citation, Footnote],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Top " },
            {
              type: "citation",
              attrs: {
                citationId: TOP_ID,
                command: "\\cite{smith2020}",
                displayText: "Smith 2020",
              },
            },
            { type: "text", text: " body" },
            {
              type: "footnote",
              attrs: { footnoteId: HOST_FN_ID, number: 1, content: footnoteBody },
            },
          ],
        },
      ],
    },
  });
}

describe("resolveLink — footnote-nested citation (BIB-F3-01 / CI-F3-01)", () => {
  it("a TOP-LEVEL cite resolves to its own atom (unchanged behavior)", () => {
    const editor = mountDoc();
    const res = resolveLink(editor, citationLink(TOP_ID));
    if (!res || res.kind !== "inline-atom") throw new Error("expected an inline-atom resolution");
    const node = editor.state.doc.nodeAt(res.pos);
    expect(node?.type.name).toBe("citation");
    expect(node?.attrs.citationId).toBe(TOP_ID);
    editor.destroy();
  });

  it("a FOOTNOTE-NESTED cite resolves to the HOST footnote marker (was a no-op)", () => {
    const editor = mountDoc();
    const res = resolveLink(editor, citationLink(NESTED_ID));
    // Pre-fix: null (jump dead). Post-fix: the host footnote.
    if (!res || res.kind !== "inline-atom") throw new Error("expected an inline-atom resolution");
    const node = editor.state.doc.nodeAt(res.pos);
    expect(node?.type.name).toBe("footnote");
    expect(node?.attrs.footnoteId).toBe(HOST_FN_ID);
    // The DOM target is the host footnote's superscript marker. The footnote
    // uses a custom nodeView whose span carries `data-footnote-id` (NOT
    // data-link-id — that's only on the renderHTML fallback), so resolveLink
    // falls back to view.nodeDOM(pos) and hands back the marker span.
    expect(res.domEl).not.toBeNull();
    expect(res.domEl?.classList.contains("footnote-marker")).toBe(true);
    expect(res.domEl?.getAttribute("data-footnote-id")).toBe(HOST_FN_ID);
    editor.destroy();
  });

  it("a cite that is nowhere resolves to null", () => {
    const editor = mountDoc();
    expect(resolveLink(editor, citationLink("ghost"))).toBeNull();
    editor.destroy();
  });
});
