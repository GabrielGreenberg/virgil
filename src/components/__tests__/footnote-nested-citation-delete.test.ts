// @vitest-environment jsdom
//
// Backlog #38 — a footnote-NESTED `\cite` must not resurrect on reload after
// its card is deleted.
//
// Chip W-C (#37) fixed deletion for TOP-LEVEL `\cite` atoms (deleteLink removes
// the doc atom + the sidecar entry). But a `\cite` living inside a footnote's
// `attrs.content` is NOT a top-level doc atom, so `findInlineAtomPos` / the
// `deleteLink` primitive no-op on it — yet `getCitations()` (via
// `walkJsonContentForCitations`) DOES collect footnote-nested cites into the
// panel set, so on the next mount the surviving nested `\cite` re-derives the
// just-deleted card. The fix (option i): `stripFootnoteNestedCitation` rewrites
// the host footnote's `attrs.content` to drop the nested cite, closing the
// resurrection source.
//
// These pins drive the REAL `stripFootnoteNestedCitation` /
// `removeCitationFromJsonContent` / `walkJsonContentForCitations` (extracted to
// citation-doc-ops.ts) against a real Editor mounting StarterKit + Citation +
// Footnote, the same way citation-hard-delete.test.ts mounts for #37.
//
// (`@/links/links` and the Editor chain pull a few `@/` modules; the storage
// stub guards against the barrel/storage gotcha.)
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
import {
  walkJsonContentForCitations,
  removeCitationFromJsonContent,
  stripFootnoteNestedCitation,
} from "../citation-doc-ops";

const NESTED_ID = "cit-nested-1";

/** The footnote-content collector the editor handle uses (getCitations).
 *  ProseMirror's descendants won't enter a footnote's attrs.content, so the
 *  reload-time panel set is rebuilt by walking each footnote's content. This
 *  mirrors `EditorHandle.getCitations` for the footnote branch. */
function collectAllCitationIds(editor: Editor): Set<string> {
  const ids = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.type.name === "citation") ids.add(node.attrs.citationId as string);
    if (node.type.name === "footnote" && node.attrs.content) {
      walkJsonContentForCitations(
        node.attrs.content as JSONContent,
        (cit) => ids.add(cit.citationId),
      );
    }
    return true;
  });
  return ids;
}

function mountWithNestedCite(
  citationId: string,
  editable = true,
): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable,
    extensions: [StarterKit, Citation, Footnote],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body text" },
            {
              type: "footnote",
              attrs: {
                footnoteId: "fn-1",
                number: 1,
                // The `\cite` lives INSIDE the footnote's content literal.
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        { type: "text", text: "see also " },
                        {
                          type: "citation",
                          attrs: {
                            citationId,
                            command: "\\cite{jones2019}",
                            displayText: "Jones 2019",
                          },
                        },
                        { type: "text", text: " on this point" },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  });
}

describe("footnote-nested citation delete (#38)", () => {
  it("the nested cite IS collected before delete (the resurrection source)", () => {
    const editor = mountWithNestedCite(NESTED_ID);
    expect(collectAllCitationIds(editor)).toContain(NESTED_ID);
    editor.destroy();
  });

  it("stripFootnoteNestedCitation removes it from the host footnote's content", () => {
    const editor = mountWithNestedCite(NESTED_ID);
    const touched = stripFootnoteNestedCitation(editor, NESTED_ID);
    expect(touched).toBe(1); // one host footnote rewritten

    // The footnote node survives and its surrounding prose is intact…
    let fnContent: JSONContent | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "footnote") fnContent = node.attrs.content as JSONContent;
      return true;
    });
    expect(fnContent).not.toBeNull();
    // …but the nested cite is gone.
    const survivors: string[] = [];
    walkJsonContentForCitations(fnContent, (c) => survivors.push(c.citationId));
    expect(survivors).not.toContain(NESTED_ID);
    expect(survivors).toHaveLength(0);

    editor.destroy();
  });

  it("RELOAD SIMULATION: after delete, re-deriving the panel set does NOT resurrect the card", () => {
    const editor = mountWithNestedCite(NESTED_ID);
    expect(collectAllCitationIds(editor)).toContain(NESTED_ID); // present pre-delete

    stripFootnoteNestedCitation(editor, NESTED_ID);

    // Serialize the post-delete doc and re-mount from it — the reload path.
    const persisted = editor.state.doc.toJSON();
    editor.destroy();

    const reloadEl = document.createElement("div");
    document.body.appendChild(reloadEl);
    const reloaded = new Editor({
      element: reloadEl,
      editable: true,
      extensions: [StarterKit, Citation, Footnote],
      content: persisted,
    });
    // The crux: the deleted card does NOT re-derive from the reloaded doc.
    expect(collectAllCitationIds(reloaded)).not.toContain(NESTED_ID);
    reloaded.destroy();
  });

  it("leaves OTHER nested cites in the same footnote untouched", () => {
    const editor = mountWithNestedCite(NESTED_ID);
    // Inject a second, unrelated nested cite into the footnote content.
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "footnote") return true;
      const c = node.attrs.content as JSONContent;
      const para = c.content?.[0] as JSONContent;
      para.content?.push({
        type: "citation",
        attrs: { citationId: "keep-me", command: "\\cite{other}", displayText: "Other" },
      });
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, content: c }),
      );
      return false;
    });
    expect(collectAllCitationIds(editor)).toContain("keep-me");

    stripFootnoteNestedCitation(editor, NESTED_ID);

    const ids = collectAllCitationIds(editor);
    expect(ids).not.toContain(NESTED_ID); // target removed
    expect(ids).toContain("keep-me"); // sibling preserved
    editor.destroy();
  });

  it("read-only doc: the rewrite is filtered by the readOnlyEnforcer (nested cite NOT removed)", () => {
    // A collaborator / partner-claimed doc must not be mutated. The real
    // readOnlyEnforcer lives in buildEditorExtensions, but its contract is
    // simple: filter out doc-changing transactions that lack the
    // `ignoreReadOnly` meta. `stripFootnoteNestedCitation` emits exactly such a
    // tx (a real attrs change, no meta), so a read-only enforcer would drop it
    // and the nested cite would survive. We emulate the enforcer by blocking
    // doc-changing, unmetaed dispatches.
    const editor = mountWithNestedCite(NESTED_ID);
    const realDispatch = editor.view.dispatch.bind(editor.view);
    editor.view.dispatch = ((tr: Parameters<typeof realDispatch>[0]) => {
      if (tr.docChanged && !tr.getMeta("ignoreReadOnly")) return; // enforcer blocks
      realDispatch(tr);
    }) as typeof editor.view.dispatch;

    stripFootnoteNestedCitation(editor, NESTED_ID);

    // The transaction was blocked → the nested cite is still present.
    expect(collectAllCitationIds(editor)).toContain(NESTED_ID);
    editor.destroy();
  });

  it("removeCitationFromJsonContent is pure and reports removal accurately", () => {
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x " },
            { type: "citation", attrs: { citationId: "a", command: "", displayText: "" } },
            { type: "citation", attrs: { linkId: "b", command: "", displayText: "" } },
          ],
        },
      ],
    };
    const snapshot = JSON.stringify(content);

    const hit = removeCitationFromJsonContent(content, "a");
    expect(hit.removed).toBe(true);
    expect(JSON.stringify(content)).toBe(snapshot); // input untouched (pure)

    // Matches the unified linkId attr too.
    expect(removeCitationFromJsonContent(content, "b").removed).toBe(true);

    const miss = removeCitationFromJsonContent(content, "nope");
    expect(miss.removed).toBe(false);
  });
});
