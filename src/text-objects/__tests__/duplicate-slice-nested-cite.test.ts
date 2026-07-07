// @vitest-environment jsdom
//
// Task 080 — Duplicating a paragraph whose footnote body holds a nested `\cite`
// must re-identify that nested cite (fresh citationId + a freshly-cloned
// CitationRef), NOT strand the clone on the source's citation identity.
//
// A footnote is an inline ATOM whose rich body lives in `attrs.content` (a
// JSONContent blob), NOT in PM child nodes — so `node.content.size` is 0 and
// the duplicate walker never recursed into it. `newAttrs = { ...node.attrs }`
// copied `attrs.content` verbatim, so a `\cite` inside the footnote kept the
// SOURCE's citationId with no cloned CitationRef. Two footnotes then shared one
// citation identity → a duplicate-id sidecar (getCitations walks the blob) and a
// delete that struck both footnotes. The fix teaches the walker to descend into
// the content blob via `remintNestedAtomIds` and clone each nested atom's
// sidecar, exactly as it does for a top-level atom.
//
// Two contracts pinned:
//   A. PURE HELPER — `remintNestedAtomIds` remints a nested cite id, leaves
//      non-cloneable atoms (inlineMath) alone, and never mutates its input.
//   B. LIVE DUPLICATE — `duplicateSlice` over a real slice containing a footnote
//      atom whose body holds a nested cite yields a clone whose nested cite has
//      a NEW citationId backed by a citation.clone(sourceId) call; the source
//      blob is untouched.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import type { Node as PMNode } from "@tiptap/pm/model";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import {
  duplicateSlice,
  createDuplicateDiagnostics,
} from "@/text-objects/duplicate-slice";
import { remintNestedAtomIds } from "@/lib/inline-content";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";

const SHORT_ID = /^[0-9a-f]{4}$/;

// ---------------------------------------------------------------------------
// A. PURE HELPER
// ---------------------------------------------------------------------------

describe("remintNestedAtomIds — the write-side blob re-identifier", () => {
  const blobWithCite = (): JSONContent => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "see " },
          {
            type: "citation",
            attrs: { citationId: "AAAA", command: "\\cite{smith}", displayText: "Smith" },
          },
          { type: "text", text: " and " },
          { type: "inlineMath", attrs: { latex: "x^2" } },
        ],
      },
    ],
  });

  it("remints a nested citation id and reports the remap", () => {
    const source = blobWithCite();
    const { content, remapped } = remintNestedAtomIds(source, (typeName, oldId) =>
      typeName === "citation" && oldId === "AAAA" ? "BBBB" : null,
    );
    const cite = (content.content![0].content![1] as JSONContent).attrs!;
    expect(cite.citationId).toBe("BBBB");
    // Non-id attrs are preserved.
    expect(cite.command).toBe("\\cite{smith}");
    expect(remapped).toEqual([{ typeName: "citation", oldId: "AAAA", newId: "BBBB" }]);
  });

  it("leaves a non-cloneable atom (inlineMath) untouched", () => {
    const { content, remapped } = remintNestedAtomIds(blobWithCite(), () => null);
    // remint always returns null → nothing changed → same reference back.
    expect(remapped).toHaveLength(0);
    const math = (content.content![0].content![3] as JSONContent).attrs!;
    expect(math.latex).toBe("x^2");
  });

  it("never mutates its input (purity)", () => {
    const source = blobWithCite();
    const snapshot = JSON.parse(JSON.stringify(source));
    remintNestedAtomIds(source, () => "ZZZZ");
    expect(source).toEqual(snapshot);
  });

  it("rewrites the unified linkId in lock-step with citationId", () => {
    const source: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "citation", attrs: { citationId: "AAAA", linkId: "AAAA", command: "\\cite{x}" } },
          ],
        },
      ],
    };
    const { content } = remintNestedAtomIds(source, () => "CCCC");
    const cite = (content.content![0].content![0] as JSONContent).attrs!;
    expect(cite.citationId).toBe("CCCC");
    expect(cite.linkId).toBe("CCCC");
  });
});

// ---------------------------------------------------------------------------
// B. LIVE DUPLICATE — real slice with a footnote atom holding a nested cite.
// ---------------------------------------------------------------------------

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

const mounted: Editor[] = [];
function mountDoc(content: JSONContent[]): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: { type: "doc", content },
  });
  mounted.push(editor);
  return editor;
}

const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

beforeEach(() => installLayoutShims());
afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A stub lifecycle that records every clone(sourceId) call per kind and mints
 *  a predictable new id, so the test can assert WHICH nested atoms were cloned. */
function recordingLifecycle() {
  const calls: Record<string, string[]> = { citation: [], footnote: [] };
  let n = 0;
  const api: CardLifecycleApi = {
    get(kind) {
      if (kind !== "citation" && kind !== "footnote") return null;
      return {
        clone(sourceId: string) {
          calls[kind].push(sourceId);
          // Deterministic 4-char mints, distinct from the source ids ("aaaa"/"fn01").
          return `${kind[0]}${String(n++).padStart(3, "0")}`;
        },
        delete() {},
        bindAnchor() {},
      };
    },
  };
  return { api, calls };
}

/** Find the first footnote node in a fragment/slice and return its attrs. */
function firstFootnoteAttrs(node: PMNode): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null;
  node.descendants((n) => {
    if (found) return false;
    if (n.type.name === "footnote") {
      found = n.attrs as Record<string, unknown>;
      return false;
    }
    return true;
  });
  return found;
}

function nestedCiteId(footnoteAttrs: Record<string, unknown>): string | undefined {
  const blob = footnoteAttrs.content as JSONContent | null;
  let id: string | undefined;
  const walk = (nn: JSONContent) => {
    if (id) return;
    if (nn.type === "citation") id = nn.attrs?.citationId as string | undefined;
    nn.content?.forEach(walk);
  };
  if (blob) walk(blob);
  return id;
}

describe("duplicateSlice — a footnote-nested cite is re-identified on Duplicate", () => {
  const SRC_FOOTNOTE_ID = "fn01";
  const SRC_CITE_ID = "aaaa";

  function footnoteParaJSON(): JSONContent {
    return {
      type: "paragraph",
      attrs: { uuid: "p001" },
      content: [
        { type: "text", text: "Body" },
        {
          type: "footnote",
          attrs: {
            footnoteId: SRC_FOOTNOTE_ID,
            number: 1,
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "see " },
                    {
                      type: "citation",
                      attrs: {
                        citationId: SRC_CITE_ID,
                        command: "\\cite{smith}",
                        displayText: "Smith",
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    };
  }

  it("clones the nested CitationRef and gives the clone a fresh citationId (source untouched)", () => {
    const editor = mountDoc([
      footnoteParaJSON(),
      { type: "paragraph", attrs: { uuid: "ffff" }, content: [{ type: "text", text: "after." }] },
    ]);

    // Sanity: the mounted source footnote kept its nested cite id in attrs.content.
    const srcAttrs = firstFootnoteAttrs(editor.state.doc)!;
    expect(nestedCiteId(srcAttrs)).toBe(SRC_CITE_ID);

    // Slice the first paragraph (the one carrying the footnote) and duplicate it.
    let loc: { pos: number; size: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (loc) return false;
      if (node.attrs?.uuid === "p001") { loc = { pos, size: node.nodeSize }; return false; }
      return true;
    });
    const { from, to } = { from: loc!.pos, to: loc!.pos + loc!.size };
    const slice = editor.state.doc.slice(from, to);

    const { api, calls } = recordingLifecycle();
    const diag = createDuplicateDiagnostics();
    const cloned = duplicateSlice(slice, api, diag);

    // The nested cite's sidecar was cloned from the SOURCE id...
    expect(calls.citation).toContain(SRC_CITE_ID);
    // ...and the footnote atom itself was cloned too (top-level atom branch).
    expect(calls.footnote).toContain(SRC_FOOTNOTE_ID);

    // The clone's footnote body carries a NEW citationId, not the source's.
    const cloneAttrs = firstFootnoteAttrs(cloned.content.child(0))!;
    const cloneCiteId = nestedCiteId(cloneAttrs);
    expect(cloneCiteId).toBeTruthy();
    expect(cloneCiteId).not.toBe(SRC_CITE_ID);

    // And the clone's footnote id is fresh too.
    expect(cloneAttrs.footnoteId).not.toBe(SRC_FOOTNOTE_ID);

    // The SOURCE doc's footnote body still holds the original cite id — the
    // walker is pure w.r.t. the source (no shared-blob mutation).
    const srcAfter = firstFootnoteAttrs(editor.state.doc)!;
    expect(nestedCiteId(srcAfter)).toBe(SRC_CITE_ID);

    // No orphan diagnostic — every nested atom had a cloneable sidecar.
    expect(diag.codes.has("orphan-inline-atom")).toBe(false);
  });

  it("emits an orphan diagnostic when the nested cite's sidecar can't be cloned", () => {
    const editor = mountDoc([footnoteParaJSON()]);
    let loc: { pos: number; size: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (loc) return false;
      if (node.attrs?.uuid === "p001") { loc = { pos, size: node.nodeSize }; return false; }
      return true;
    });
    const slice = editor.state.doc.slice(loc!.pos, loc!.pos + loc!.size);

    // Lifecycle whose citation.clone returns null (source id missing).
    const api: CardLifecycleApi = {
      get(kind) {
        if (kind === "footnote") return { clone: () => "fn99", delete() {}, bindAnchor() {} };
        if (kind === "citation") return { clone: () => null, delete() {}, bindAnchor() {} };
        return null;
      },
    };
    const diag = createDuplicateDiagnostics();
    duplicateSlice(slice, api, diag);
    expect(diag.codes.has("orphan-inline-atom")).toBe(true);
  });
});
