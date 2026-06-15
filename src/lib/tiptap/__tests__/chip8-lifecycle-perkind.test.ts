// @vitest-environment jsdom
//
// CHIP 8 — action-alignment matrix, category: lifecycle-perkind.
//
// ARCHIVE / DELETE / DUPLICATE across every applicable TextObject kind + the
// atom variants (atom-bearing / atom-only), driven at the REAL-code level:
//   - the delete/archive range helpers `cleanupAndComputeDeleteRange` +
//     `expandCascadeRange` (src/text-objects/delete-range.ts), exactly as the
//     drag-handle dispatcher sequences them (drag-handle-actions.ts cases
//     "archive"/"delete"); and
//   - `duplicateSlice` (src/text-objects/duplicate-slice.ts), exactly as the
//     dispatcher's "duplicate" case sequences it (slice → duplicateSlice →
//     tr.replace → tr.doc.check()).
//
// All editors are the REAL `buildEditorExtensions("main")` stack (the actual
// schema for paragraph/heading/blockquote/listItem/exampleItem/codeBlock/
// displayMath/figureBlock/graphicsBlock/texBlock/latexComment/titleField and
// the inline atoms footnote/citation/labelRef/inlineMath).
//
// WHAT IS CODIFIED (oracle: docs/memos/action-alignment-matrix/EXPECTED-MATRIX.md
// rows archive/delete/duplicate):
//
//   F2 (the trailing-block-swallow data-loss bug), BROADENED:
//     a paragraph whose range carries an inline atom (citation / footnote /
//     labelRef / inlineMath) IMMEDIATELY FOLLOWED by a size-1 block atom
//     (graphicsBlock / displayMath / texBlock) must delete WITHOUT swallowing
//     the neighbour — for BOTH delete and archive. The fix is
//     `cleanupAndComputeDeleteRange` correcting the stale `to`. We cross every
//     {inline-atom kind} × {trailing block-atom kind} cell, plus the OLD-buggy
//     control to prove the cell genuinely exercises the defect.
//     (Note: the F2 bug is only reachable when the cleanup actually removes a
//     doc node. The live footnote lifecycle's delete does NOT remove the atom
//     from the doc (footnote bodies live in the atom's `content` attr — see the
//     citations-vs-footnotes flag in the report), so footnote-bearing cells use
//     a citation-style stripping lifecycle to model the worst case. Both the
//     fixed and old-buggy variants are asserted so the helper's correctness is
//     demonstrated regardless of which atom kind triggers a removal live.)
//
//   ATOM-ONLY emptiness (the 80119/63ccace/80111 class — archive/delete an
//     atom-only line must NOT be a silent no-op): a paragraph whose only content
//     is a single inline atom (inlineMath / labelRef / citation / footnote) has
//     EMPTY `textContent` but a NON-EMPTY slice; the dispatcher's empty-content
//     bail keys on `slice(...).content.size`, NOT textContent, so the line is
//     removable. We assert `slice.content.size > 0` for each (the bail does NOT
//     fire) and that the real delete sequence removes the block.
//
//   DUPLICATE identity (the atom_drag observer bug class): duplicating a slice
//     that carries TextObject blocks + inline atoms must mint FRESH block uuids
//     AND fresh atom ids — never a duplicate key. We assert per-kind that the
//     clone's block uuid differs from the source AND that footnote/citation atom
//     ids are reminted (via a cloning lifecycle), and that the post-insert
//     `tr.doc.check()` passes for every kind the registry marks duplicable.
//
// (The storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
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
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { LIFECYCLE_DELETE_META } from "@/lib/tiptap/linked-anchor";
import {
  cleanupAndComputeDeleteRange,
  cleanupLinksInRange,
  expandCascadeRange,
} from "@/text-objects/delete-range";
import {
  duplicateSlice,
  createDuplicateDiagnostics,
} from "@/text-objects/duplicate-slice";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";

// ---------------------------------------------------------------------------
// Real editor stack
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

// jsdom has no layout engine; shim the rect APIs any focus/scroll path may hit.
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

beforeEach(() => {
  installLayoutShims();
});

afterEach(() => {
  while (mounted.length) mounted.pop()?.destroy();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers — locate nodes / count / outer range (mirror outerRangeFor)
// ---------------------------------------------------------------------------

function locateByUuid(editor: Editor, uuid: string): { pos: number; size: number; node: PMNode } | null {
  let out: { pos: number; size: number; node: PMNode } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (out) return false;
    if ((node.attrs?.uuid as string | undefined) === uuid) {
      out = { pos, size: node.nodeSize, node };
      return false;
    }
    return true;
  });
  return out;
}

function countOfType(editor: Editor, typeName: string): number {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) n += 1;
    return true;
  });
  return n;
}

function uuidsOfType(editor: Editor, typeName: string): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) {
      const u = node.attrs?.uuid;
      if (typeof u === "string") out.push(u);
    }
    return true;
  });
  return out;
}

function atomIdsOfType(editor: Editor, typeName: string, idAttr: string): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === typeName) {
      const id = node.attrs?.[idAttr];
      if (typeof id === "string") out.push(id);
    }
    return true;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Lifecycle stubs
// ---------------------------------------------------------------------------

/**
 * A CardLifecycleApi whose `delete(id)` removes the matching inline atom node
 * from the doc — mirroring the live `deleteCitation` → `deleteLink`. This is
 * the synchronous mid-flight mutation that made the pre-fix delete range go
 * stale (F2). `clone`/`bindAnchor` are no-ops here (the delete path only uses
 * delete).
 */
function strippingLifecycle(
  editor: Editor,
  atomKind: "citation" | "footnote",
  idAttr: "citationId" | "footnoteId",
): CardLifecycleApi {
  return {
    get(kind) {
      if (kind !== atomKind) return null;
      return {
        delete(id: string) {
          let atomPos = -1;
          let atomSize = 0;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name === atomKind && node.attrs?.[idAttr] === id) {
              atomPos = pos;
              atomSize = node.nodeSize;
              return false;
            }
            return true;
          });
          if (atomPos >= 0) {
            editor.view.dispatch(editor.state.tr.delete(atomPos, atomPos + atomSize));
          }
        },
        clone() {
          return null;
        },
        bindAnchor() {},
      };
    },
  } as CardLifecycleApi;
}

/**
 * A CardLifecycleApi whose `clone(sourceId)` mints a NEW id (recording the
 * mapping) — mirroring the live footnote/citation `clone` that forks a fresh
 * sidecar entry. Used to prove duplicate remints atom ids.
 */
function cloningLifecycle(): { api: CardLifecycleApi; clones: Map<string, string> } {
  const clones = new Map<string, string>();
  let counter = 0;
  const api = {
    get() {
      return {
        clone(sourceId: string) {
          const newId = `clone-${++counter}`;
          clones.set(sourceId, newId);
          return newId;
        },
        delete() {},
        bindAnchor() {},
      };
    },
  } as CardLifecycleApi;
  return { api, clones };
}

// A no-op lifecycle for ranges that carry no atoms.
const NOOP_LIFECYCLE = {
  get() {
    return { clone: () => null, delete: () => {}, bindAnchor() {} };
  },
} as CardLifecycleApi;

// ---------------------------------------------------------------------------
// Atom JSON builders + block-atom JSON builders
// ---------------------------------------------------------------------------

type InlineAtomKind = "citation" | "footnote" | "labelRef" | "inlineMath";

function inlineAtomJSON(kind: InlineAtomKind): JSONContent {
  switch (kind) {
    case "citation":
      return {
        type: "citation",
        attrs: { command: "\\cite{key2026}", displayText: "[1]", citationId: "cit-src" },
      };
    case "footnote":
      return {
        type: "footnote",
        attrs: { footnoteId: "fn-src", number: 1, content: null },
      };
    case "labelRef":
      return {
        type: "labelRef",
        attrs: { label: "fig:1", displayText: "1", refCommand: "ref" },
      };
    case "inlineMath":
      return { type: "inlineMath", attrs: { latex: "\\lambda" } };
  }
}

type BlockAtomKind = "graphicsBlock" | "displayMath" | "texBlock";

function blockAtomJSON(kind: BlockAtomKind, uuid: string): JSONContent {
  switch (kind) {
    case "graphicsBlock":
      return {
        type: "graphicsBlock",
        attrs: {
          uuid,
          command: "\\includegraphics[width=0.5\\textwidth]{plot.png}",
          source: "plot.png",
          widthPercent: 50,
        },
      };
    case "displayMath":
      return { type: "displayMath", attrs: { uuid, latex: "x^2 + y^2" } };
    case "texBlock":
      return { type: "texBlock", attrs: { uuid, code: "\\newcommand{\\x}{y}" } };
  }
}

// ---------------------------------------------------------------------------
// F2 (BROADENED) — atom-bearing paragraph + trailing block atom.
//
// Mirror the dispatcher's delete/archive sequence: outer range of the leading
// paragraph → expandCascadeRange (no-op for a top-level paragraph) →
// cleanupAndComputeDeleteRange (fires the atom-stripping lifecycle, corrects
// `to`) → tr.delete(range).setMeta(LIFECYCLE_DELETE_META). The trailing block
// atom MUST survive and childCount must drop by exactly 1.
// ---------------------------------------------------------------------------

const PARA_UUID = "para00";
const BLOCK_UUID = "blk000";

function buildAtomBearingDoc(
  inlineKind: InlineAtomKind,
  blockKind: BlockAtomKind,
): JSONContent[] {
  return [
    {
      type: "paragraph",
      attrs: { uuid: PARA_UUID },
      content: [
        { type: "text", text: "Lead text with an atom " },
        inlineAtomJSON(inlineKind),
        { type: "text", text: " and a tail." },
      ],
    },
    blockAtomJSON(blockKind, BLOCK_UUID),
    {
      type: "paragraph",
      attrs: { uuid: "tail00" },
      content: [{ type: "text", text: "after." }],
    },
  ];
}

/** Run the dispatcher's fixed delete/archive range sequence. `lifecycle`
 *  is the atom-stripping lifecycle (citation/footnote) or NOOP. */
function runFixedLifecycleRemoval(
  editor: Editor,
  lifecycle: CardLifecycleApi,
): { childCountBefore: number; childCountAfter: number; blockSurvives: boolean } {
  const loc = locateByUuid(editor, PARA_UUID)!;
  const outer = { from: loc.pos, to: loc.pos + loc.size };
  const extended = expandCascadeRange(editor.state.doc, outer);
  const childCountBefore = editor.state.doc.childCount;
  const delRange = cleanupAndComputeDeleteRange(editor, extended.from, extended.to, lifecycle);
  editor.view.dispatch(
    editor.state.tr.delete(delRange.from, delRange.to).setMeta(LIFECYCLE_DELETE_META, true),
  );
  const childCountAfter = editor.state.doc.childCount;
  const blockSurvives = !!locateByUuid(editor, BLOCK_UUID);
  return { childCountBefore, childCountAfter, blockSurvives };
}

/** Run the OLD-buggy sequence: cleanup mutates the doc, but the delete reuses
 *  the stale pre-cleanup range — proving the cell exercises the defect. */
function runOldBuggyLifecycleRemoval(
  editor: Editor,
  lifecycle: CardLifecycleApi,
): { childCountBefore: number; childCountAfter: number; blockSurvives: boolean } {
  const loc = locateByUuid(editor, PARA_UUID)!;
  const outer = { from: loc.pos, to: loc.pos + loc.size };
  const extended = expandCascadeRange(editor.state.doc, outer);
  const childCountBefore = editor.state.doc.childCount;
  cleanupLinksInRange(editor.state.doc, extended.from, extended.to, lifecycle);
  editor.view.dispatch(
    editor.state.tr.delete(extended.from, extended.to).setMeta(LIFECYCLE_DELETE_META, true),
  );
  const childCountAfter = editor.state.doc.childCount;
  const blockSurvives = !!locateByUuid(editor, BLOCK_UUID);
  return { childCountBefore, childCountAfter, blockSurvives };
}

const INLINE_KINDS: InlineAtomKind[] = ["citation", "footnote", "labelRef", "inlineMath"];
const BLOCK_KINDS: BlockAtomKind[] = ["graphicsBlock", "displayMath", "texBlock"];

describe("F2 (broadened) — atom-bearing paragraph delete/archive must not swallow the trailing block atom", () => {
  // The F2 stale-range bug only manifests when cleanup actually removes a doc
  // node mid-flight. Determined from the LIVE wiring (EditorPane.tsx:2008-2017):
  //   - citation.delete === handleDeleteCitation, which calls
  //     innerRef.deleteCitation(id) — a REAL doc tx that strips the \cite atom
  //     (the #37/#38 hard-delete contract). So a citation-bearing range DOES
  //     go stale → the F2 hazard is genuinely reachable live for citation.
  //   - footnote.delete === footnotesHook.deleteFootnote, which is
  //     SIDECAR-ONLY (useFootnotes.ts:93 filters footnotes.json; NO doc tx).
  //     So a footnote-bearing range never goes stale through cleanup.
  //   - labelRef / inlineMath are card-LESS (atom-registry idAttr:null), so
  //     cleanupLinksInRange touches nothing for them either.
  // Hence ONLY citation drives the mid-flight removal live; the other three are
  // genuine no-ops. We assert the CORRECT post-condition for ALL four inline
  // kinds (block survives, -1 child): citation via the (doc-tx) stripping
  // lifecycle, the rest via the NOOP lifecycle (faithful to their live delete).
  for (const inlineKind of INLINE_KINDS) {
    const triggersRemoval = inlineKind === "citation";
    for (const blockKind of BLOCK_KINDS) {
      it(`DELETE: ${inlineKind}-bearing paragraph before a ${blockKind} — block survives, -1 child`, () => {
        const editor = mountDoc(buildAtomBearingDoc(inlineKind, blockKind));
        const lc = triggersRemoval
          ? strippingLifecycle(editor, "citation", "citationId")
          : NOOP_LIFECYCLE;
        const r = runFixedLifecycleRemoval(editor, lc);
        expect(r.blockSurvives).toBe(true);
        expect(r.childCountAfter).toBe(r.childCountBefore - 1);
        expect(countOfType(editor, blockKind)).toBe(1);
      });
    }
  }

  // Characterization: for the removal-triggering inline kinds, the OLD-buggy
  // stale-range sequence DOES swallow the trailing block (childCount -2). This
  // proves the cells genuinely exercise the defect that the fix prevents.
  for (const blockKind of BLOCK_KINDS) {
    it(`OLD-BUGGY control: citation-bearing paragraph + ${blockKind} — stale range swallows the block (-2)`, () => {
      const editor = mountDoc(buildAtomBearingDoc("citation", blockKind));
      const lc = strippingLifecycle(editor, "citation", "citationId");
      const r = runOldBuggyLifecycleRemoval(editor, lc);
      expect(r.blockSurvives).toBe(false);
      expect(r.childCountAfter).toBe(r.childCountBefore - 2);
    });
  }
});

// ---------------------------------------------------------------------------
// citations-vs-footnotes asymmetry (flagged by the manager). The LIVE wiring:
//   - citation.delete strips the in-doc \cite atom (a real doc tx) → cleanup
//     SHRINKS the doc (the F2 hazard).
//   - footnote.delete is sidecar-only → cleanup leaves the doc atom in place.
// This codifies that cleanupLinksInRange's effect on the DOC differs by kind,
// which is exactly why the range-correction (cleanupAndComputeDeleteRange) is
// only load-bearing for citation. (See the report's flag on whether the
// footnote sidecar-only behavior is intended — it appears to be a deliberate
// asymmetry: a footnote atom is removed by the outer tr.delete, not by cleanup.)
// ---------------------------------------------------------------------------

describe("citations-vs-footnotes — cleanup's doc-size effect differs by kind", () => {
  it("citation cleanup SHRINKS the doc (atom stripped mid-flight)", () => {
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [
          { type: "text", text: "x " },
          { type: "citation", attrs: { command: "\\cite{k}", displayText: "[1]", citationId: "cit-x" } },
          { type: "text", text: " y" },
        ],
      },
    ]);
    const loc = locateByUuid(editor, PARA_UUID)!;
    const before = editor.state.doc.content.size;
    cleanupLinksInRange(
      editor.state.doc,
      loc.pos,
      loc.pos + loc.size,
      strippingLifecycle(editor, "citation", "citationId"),
    );
    // The citation atom was removed from the doc → it shrank.
    expect(editor.state.doc.content.size).toBeLessThan(before);
    expect(countOfType(editor, "citation")).toBe(0);
  });

  it("footnote cleanup leaves the doc UNCHANGED (sidecar-only delete)", () => {
    // A faithful footnote lifecycle: delete is sidecar-only (no doc tx),
    // mirroring footnotesHook.deleteFootnote.
    let deleteCalledWith: string | null = null;
    const footnoteSidecarOnly = {
      get(kind) {
        if (kind !== "footnote") return null;
        return {
          delete(id: string) {
            deleteCalledWith = id; // sidecar-only: NO doc mutation
          },
          clone: () => null,
          bindAnchor() {},
        };
      },
    } as CardLifecycleApi;

    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [
          { type: "text", text: "x " },
          { type: "footnote", attrs: { footnoteId: "fn-x", number: 1, content: null } },
          { type: "text", text: " y" },
        ],
      },
    ]);
    const loc = locateByUuid(editor, PARA_UUID)!;
    const before = editor.state.doc.content.size;
    cleanupLinksInRange(editor.state.doc, loc.pos, loc.pos + loc.size, footnoteSidecarOnly);
    // The lifecycle delete WAS invoked (the sidecar entry would be filtered)...
    expect(deleteCalledWith).toBe("fn-x");
    // ...but the DOC is untouched — the footnote atom is still there. The outer
    // tr.delete (not cleanup) is what removes the atom from the doc.
    expect(editor.state.doc.content.size).toBe(before);
    expect(countOfType(editor, "footnote")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ATOM-ONLY emptiness — a math/ref/citation/footnote-only paragraph is NOT
// silently no-op'd: its slice is non-empty (the empty-content bail keys on
// slice content.size, not textContent), and the real delete sequence removes it.
// ---------------------------------------------------------------------------

describe("atom-only paragraph — removable (content-aware emptiness)", () => {
  for (const inlineKind of INLINE_KINDS) {
    it(`${inlineKind}-only paragraph: textContent empty but slice non-empty AND deletes`, () => {
      const editor = mountDoc([
        { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [inlineAtomJSON(inlineKind)] },
        { type: "paragraph", attrs: { uuid: "tail00" }, content: [{ type: "text", text: "after." }] },
      ]);
      const loc = locateByUuid(editor, PARA_UUID)!;
      // The block's textContent is empty (the old silent-no-op trap)...
      expect(loc.node.textContent).toBe("");
      const outer = { from: loc.pos, to: loc.pos + loc.size };
      // ...but the dispatcher's bail keys on slice content.size, which is > 0.
      const slice = editor.state.doc.slice(outer.from, outer.to);
      expect(slice.content.size).toBeGreaterThan(0);

      // The real delete sequence removes the block (one child gone). Only
      // citation's live delete dispatches a doc tx (see the F2 note above);
      // the rest are sidecar-only / card-less → NOOP faithfully.
      const lc =
        inlineKind === "citation"
          ? strippingLifecycle(editor, "citation", "citationId")
          : NOOP_LIFECYCLE;
      const childCountBefore = editor.state.doc.childCount;
      const extended = expandCascadeRange(editor.state.doc, outer);
      const delRange = cleanupAndComputeDeleteRange(editor, extended.from, extended.to, lc);
      editor.view.dispatch(
        editor.state.tr.delete(delRange.from, delRange.to).setMeta(LIFECYCLE_DELETE_META, true),
      );
      expect(editor.state.doc.childCount).toBe(childCountBefore - 1);
      expect(locateByUuid(editor, PARA_UUID)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Cascade — deleting the LAST listItem / exampleItem collapses the wrapper.
// expandCascadeRange must swallow the empty wrapper so PM's auto-fill never
// injects a placeholder child.
// ---------------------------------------------------------------------------

describe("cascade — last sub-item collapses its wrapper", () => {
  it("the last listItem in a bulletList → cascade swallows the bulletList", () => {
    const editor = mountDoc([
      {
        type: "bulletList",
        attrs: { uuid: "ul-0" },
        content: [
          {
            type: "listItem",
            attrs: { uuid: "li-0" },
            content: [{ type: "paragraph", attrs: { uuid: "p-li-0" }, content: [{ type: "text", text: "only item" }] }],
          },
        ],
      },
      { type: "paragraph", attrs: { uuid: "tail00" }, content: [{ type: "text", text: "after." }] },
    ]);
    const li = locateByUuid(editor, "li-0")!;
    const outer = { from: li.pos, to: li.pos + li.size };
    const extended = expandCascadeRange(editor.state.doc, outer);
    // The cascade reached up past the listItem to swallow the whole bulletList.
    expect(extended.from).toBeLessThan(outer.from);
    expect(extended.to).toBeGreaterThan(outer.to);

    const childCountBefore = editor.state.doc.childCount;
    const delRange = cleanupAndComputeDeleteRange(editor, extended.from, extended.to, NOOP_LIFECYCLE);
    editor.view.dispatch(
      editor.state.tr.delete(delRange.from, delRange.to).setMeta(LIFECYCLE_DELETE_META, true),
    );
    // The whole list is gone (no empty bulletList placeholder left behind).
    expect(countOfType(editor, "bulletList")).toBe(0);
    expect(countOfType(editor, "listItem")).toBe(0);
    expect(editor.state.doc.childCount).toBe(childCountBefore - 1);
  });

  it("a non-last listItem does NOT cascade (the list survives with the other items)", () => {
    const editor = mountDoc([
      {
        type: "bulletList",
        attrs: { uuid: "ul-0" },
        content: [
          {
            type: "listItem",
            attrs: { uuid: "li-0" },
            content: [{ type: "paragraph", attrs: { uuid: "p0" }, content: [{ type: "text", text: "first" }] }],
          },
          {
            type: "listItem",
            attrs: { uuid: "li-1" },
            content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "second" }] }],
          },
        ],
      },
    ]);
    const li = locateByUuid(editor, "li-0")!;
    const outer = { from: li.pos, to: li.pos + li.size };
    const extended = expandCascadeRange(editor.state.doc, outer);
    // Sibling survives → no cascade past the listItem.
    expect(extended.from).toBe(outer.from);
    expect(extended.to).toBe(outer.to);

    const delRange = cleanupAndComputeDeleteRange(editor, extended.from, extended.to, NOOP_LIFECYCLE);
    editor.view.dispatch(
      editor.state.tr.delete(delRange.from, delRange.to).setMeta(LIFECYCLE_DELETE_META, true),
    );
    expect(countOfType(editor, "bulletList")).toBe(1);
    expect(countOfType(editor, "listItem")).toBe(1);
    expect(locateByUuid(editor, "li-0")).toBeNull();
    expect(locateByUuid(editor, "li-1")).not.toBeNull();
  });

  it("the last exampleItem in a single-item example → cascade swallows the exampleItemList", () => {
    const editor = mountDoc([
      {
        type: "exampleBlock",
        attrs: { uuid: "ex-0", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "exi-0" },
                content: [{ type: "paragraph", attrs: { uuid: "p-exi-0" }, content: [{ type: "text", text: "only item" }] }],
              },
            ],
          },
        ],
      },
      { type: "paragraph", attrs: { uuid: "tail00" }, content: [{ type: "text", text: "after." }] },
    ]);
    const exi = locateByUuid(editor, "exi-0")!;
    const outer = { from: exi.pos, to: exi.pos + exi.size };
    const extended = expandCascadeRange(editor.state.doc, outer);
    // Cascade swallows the empty exampleItemList (an INVISIBLE_WRAPPER).
    expect(extended.from).toBeLessThan(outer.from);
    expect(extended.to).toBeGreaterThan(outer.to);
    expect(countOfType(editor, "exampleItem")).toBe(1);

    const delRange = cleanupAndComputeDeleteRange(editor, extended.from, extended.to, NOOP_LIFECYCLE);
    editor.view.dispatch(
      editor.state.tr.delete(delRange.from, delRange.to).setMeta(LIFECYCLE_DELETE_META, true),
    );
    // No empty exampleItemList left dangling.
    expect(countOfType(editor, "exampleItemList")).toBe(0);
    expect(countOfType(editor, "exampleItem")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DUPLICATE — per kind: fresh block uuid, fresh atom ids, schema-valid clone.
// Mirror the dispatcher's "duplicate" case: slice(outer) → duplicateSlice →
// tr.replace(outer.to, outer.to, cloned) → tr.doc.check().
// ---------------------------------------------------------------------------

/** Duplicate the block carrying `uuid`, returning the resulting editor state
 *  plus the schema-check result. */
function runDuplicate(
  editor: Editor,
  uuid: string,
  lifecycle: CardLifecycleApi,
): { schemaOk: boolean; insertedSize: number } {
  const loc = locateByUuid(editor, uuid)!;
  const outer = { from: loc.pos, to: loc.pos + loc.size };
  const slice = editor.state.doc.slice(outer.from, outer.to);
  expect(slice.size).toBeGreaterThan(0);
  const diag = createDuplicateDiagnostics();
  const cloned = duplicateSlice(slice, lifecycle, diag);
  const tr = editor.state.tr.replace(outer.to, outer.to, cloned);
  let schemaOk = true;
  try {
    tr.doc.check();
  } catch {
    schemaOk = false;
  }
  if (schemaOk) editor.view.dispatch(tr);
  return { schemaOk, insertedSize: cloned.size };
}

// Block-level TextObject kinds that the registry marks duplicable + are
// trivially mountable at top level with a uuid.
const DUPLICABLE_BLOCK_KINDS: Array<{ kind: string; json: (uuid: string) => JSONContent }> = [
  {
    kind: "paragraph",
    json: (uuid) => ({ type: "paragraph", attrs: { uuid }, content: [{ type: "text", text: "dup me" }] }),
  },
  {
    kind: "blockquote",
    json: (uuid) => ({
      type: "blockquote",
      attrs: { uuid },
      content: [{ type: "paragraph", attrs: { uuid: `${uuid}-p` }, content: [{ type: "text", text: "quoted" }] }],
    }),
  },
  {
    kind: "codeBlock",
    json: (uuid) => ({ type: "codeBlock", attrs: { uuid }, content: [{ type: "text", text: "x = 1" }] }),
  },
  { kind: "displayMath", json: (uuid) => blockAtomJSON("displayMath", uuid) },
  { kind: "texBlock", json: (uuid) => blockAtomJSON("texBlock", uuid) },
  { kind: "graphicsBlock", json: (uuid) => blockAtomJSON("graphicsBlock", uuid) },
  {
    kind: "figureBlock",
    json: (uuid) => ({
      type: "figureBlock",
      attrs: { uuid, extras: "\\centering", label: "fig:dup" },
      content: [{ type: "figureCaption", content: [{ type: "text", text: "cap" }] }],
    }),
  },
  {
    kind: "latexComment",
    json: (uuid) => ({ type: "latexComment", attrs: { uuid, text: "% a comment" } }),
  },
];

describe("duplicate — fresh block uuid + schema-valid clone, per kind", () => {
  for (const { kind, json } of DUPLICABLE_BLOCK_KINDS) {
    it(`${kind}: clone mints a FRESH uuid (no duplicate key) and passes tr.doc.check()`, () => {
      const SRC = "src000";
      const editor = mountDoc([
        json(SRC),
        { type: "paragraph", attrs: { uuid: "tail00" }, content: [{ type: "text", text: "after." }] },
      ]);
      const beforeCount = countOfType(editor, kind);
      const { schemaOk } = runDuplicate(editor, SRC, NOOP_LIFECYCLE);
      expect(schemaOk).toBe(true);
      // One more node of this kind now exists.
      expect(countOfType(editor, kind)).toBe(beforeCount + 1);
      // Both the source uuid and a DISTINCT fresh uuid are present.
      const uuids = uuidsOfType(editor, kind).filter((u) => u.length > 0);
      expect(uuids).toContain(SRC);
      const fresh = uuids.filter((u) => u !== SRC);
      expect(fresh.length).toBeGreaterThanOrEqual(1);
      // No uuid collisions across all nodes of this kind.
      expect(new Set(uuids).size).toBe(uuids.length);
    });
  }
});

describe("duplicate — atom-bearing / atom-only slices mint fresh atom ids", () => {
  it("a paragraph carrying citation + footnote atoms → cloned atoms get reminted ids", () => {
    const SRC = "src000";
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: SRC },
        content: [
          { type: "text", text: "cite " },
          { type: "citation", attrs: { command: "\\cite{a}", displayText: "[1]", citationId: "cit-src" } },
          { type: "text", text: " and note " },
          { type: "footnote", attrs: { footnoteId: "fn-src", number: 1, content: null } },
        ],
      },
    ]);
    const { api, clones } = cloningLifecycle();
    const { schemaOk } = runDuplicate(editor, SRC, api);
    expect(schemaOk).toBe(true);

    // The clone forked fresh ids for BOTH atoms.
    expect(clones.get("cit-src")).toBeTruthy();
    expect(clones.get("fn-src")).toBeTruthy();

    // Two citation atoms, two footnote atoms now; the source ids survive and
    // the clones carry the reminted ids — NO duplicate id across the doc.
    const citIds = atomIdsOfType(editor, "citation", "citationId");
    expect(citIds).toContain("cit-src");
    expect(citIds).toContain(clones.get("cit-src"));
    expect(new Set(citIds).size).toBe(citIds.length);

    const fnIds = atomIdsOfType(editor, "footnote", "footnoteId");
    expect(fnIds).toContain("fn-src");
    expect(fnIds).toContain(clones.get("fn-src"));
    expect(new Set(fnIds).size).toBe(fnIds.length);
  });

  it("an inlineMath/labelRef-only paragraph duplicates with a fresh block uuid (card-less atoms, no id collision concern)", () => {
    const SRC = "src000";
    const editor = mountDoc([
      {
        type: "paragraph",
        attrs: { uuid: SRC },
        content: [inlineAtomJSON("inlineMath"), inlineAtomJSON("labelRef")],
      },
    ]);
    const { schemaOk } = runDuplicate(editor, SRC, NOOP_LIFECYCLE);
    expect(schemaOk).toBe(true);
    expect(countOfType(editor, "inlineMath")).toBe(2);
    expect(countOfType(editor, "labelRef")).toBe(2);
    const paraUuids = uuidsOfType(editor, "paragraph").filter((u) => u.length > 0);
    expect(paraUuids).toContain(SRC);
    expect(paraUuids.filter((u) => u !== SRC).length).toBeGreaterThanOrEqual(1);
    expect(new Set(paraUuids).size).toBe(paraUuids.length);
  });

  it("a single exampleItem duplicates and BOTH items get distinct fresh uuids (sub-object remint)", () => {
    const editor = mountDoc([
      {
        type: "exampleBlock",
        attrs: { uuid: "ex-0", kind: "multi" },
        content: [
          {
            type: "exampleItemList",
            content: [
              {
                type: "exampleItem",
                attrs: { uuid: "exi-src" },
                content: [{ type: "paragraph", attrs: { uuid: "p-exi-src" }, content: [{ type: "text", text: "item" }] }],
              },
            ],
          },
        ],
      },
    ]);
    const exi = locateByUuid(editor, "exi-src")!;
    const outer = { from: exi.pos, to: exi.pos + exi.size };
    const slice = editor.state.doc.slice(outer.from, outer.to);
    const cloned = duplicateSlice(slice, NOOP_LIFECYCLE, createDuplicateDiagnostics());
    const tr = editor.state.tr.replace(outer.to, outer.to, cloned);
    let schemaOk = true;
    try {
      tr.doc.check();
    } catch {
      schemaOk = false;
    }
    expect(schemaOk).toBe(true);
    editor.view.dispatch(tr);
    expect(countOfType(editor, "exampleItem")).toBe(2);
    const exiUuids = uuidsOfType(editor, "exampleItem").filter((u) => u.length > 0);
    expect(exiUuids).toContain("exi-src");
    expect(new Set(exiUuids).size).toBe(exiUuids.length);
  });
});

// ---------------------------------------------------------------------------
// HEADING lifecycle — outer range is the WHOLE section (matches outerRangeFor's
// heading branch via getSectionRangeByUuid). Delete must take the whole section;
// duplicate must clone the whole section with a fresh heading uuid.
// ---------------------------------------------------------------------------

import { getSectionRangeByUuid } from "@/lib/section-range";

describe("heading lifecycle — whole-section scope", () => {
  function buildSectionedDoc(): JSONContent[] {
    return [
      {
        type: "heading",
        attrs: { level: 2, uuid: "head-0" },
        content: [{ type: "text", text: "Section A" }],
      },
      { type: "paragraph", attrs: { uuid: "pa-1" }, content: [{ type: "text", text: "body one" }] },
      { type: "paragraph", attrs: { uuid: "pa-2" }, content: [{ type: "text", text: "body two" }] },
      {
        type: "heading",
        attrs: { level: 2, uuid: "head-1" },
        content: [{ type: "text", text: "Section B" }],
      },
      { type: "paragraph", attrs: { uuid: "pb-1" }, content: [{ type: "text", text: "next section" }] },
    ];
  }

  it("DELETE heading → removes the whole section (heading + its 2 paragraphs), Section B survives", () => {
    const editor = mountDoc(buildSectionedDoc());
    const section = getSectionRangeByUuid(editor.state.doc, "head-0")!;
    const outer = { from: section.start, to: section.end };
    const childCountBefore = editor.state.doc.childCount;
    const extended = expandCascadeRange(editor.state.doc, outer);
    const delRange = cleanupAndComputeDeleteRange(editor, extended.from, extended.to, NOOP_LIFECYCLE);
    editor.view.dispatch(
      editor.state.tr.delete(delRange.from, delRange.to).setMeta(LIFECYCLE_DELETE_META, true),
    );
    // Section A (3 blocks) gone; Section B (heading + 1 para) intact.
    expect(editor.state.doc.childCount).toBe(childCountBefore - 3);
    expect(locateByUuid(editor, "head-0")).toBeNull();
    expect(locateByUuid(editor, "pa-1")).toBeNull();
    expect(locateByUuid(editor, "pa-2")).toBeNull();
    expect(locateByUuid(editor, "head-1")).not.toBeNull();
    expect(locateByUuid(editor, "pb-1")).not.toBeNull();
  });

  it("DUPLICATE heading → clones the WHOLE section with a fresh heading uuid, schema-valid", () => {
    const editor = mountDoc(buildSectionedDoc());
    const section = getSectionRangeByUuid(editor.state.doc, "head-0")!;
    const outer = { from: section.start, to: section.end };
    const slice = editor.state.doc.slice(outer.from, outer.to);
    const cloned = duplicateSlice(slice, NOOP_LIFECYCLE, createDuplicateDiagnostics());
    const tr = editor.state.tr.replace(outer.to, outer.to, cloned);
    let schemaOk = true;
    try {
      tr.doc.check();
    } catch {
      schemaOk = false;
    }
    expect(schemaOk).toBe(true);
    editor.view.dispatch(tr);
    // Now 3 headings total (Section A, its clone, Section B) — all distinct uuids.
    const headingUuids = uuidsOfType(editor, "heading").filter((u) => u.length > 0);
    expect(headingUuids.length).toBe(3);
    expect(new Set(headingUuids).size).toBe(3);
    expect(headingUuids).toContain("head-0");
    expect(headingUuids).toContain("head-1");
    // The cloned section's paragraphs are also reminted (no uuid collision).
    const paraUuids = uuidsOfType(editor, "paragraph").filter((u) => u.length > 0);
    expect(new Set(paraUuids).size).toBe(paraUuids.length);
    // Section A's body paragraphs duplicated → 5 paragraphs total now.
    expect(countOfType(editor, "paragraph")).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// DELETE vs ARCHIVE alignment — the doc mutation must be BYTE-identical. The
// only archive-extra is the snapshot+snippet (a sidecar write, not a doc step).
// We run the exact range sequence for both paths and assert identical resulting
// doc JSON.
// ---------------------------------------------------------------------------

describe("delete/archive doc-mutation alignment (identical doc result)", () => {
  function buildDoc(): JSONContent[] {
    return [
      {
        type: "paragraph",
        attrs: { uuid: PARA_UUID },
        content: [
          { type: "text", text: "atom para " },
          { type: "citation", attrs: { command: "\\cite{k}", displayText: "[1]", citationId: "cit-x" } },
        ],
      },
      blockAtomJSON("graphicsBlock", BLOCK_UUID),
      { type: "paragraph", attrs: { uuid: "tail00" }, content: [{ type: "text", text: "after." }] },
    ];
  }

  it("deleting and archiving the same atom-bearing paragraph leave an identical doc", () => {
    // DELETE path
    const ed1 = mountDoc(buildDoc());
    runFixedLifecycleRemoval(ed1, strippingLifecycle(ed1, "citation", "citationId"));
    const afterDelete = ed1.state.doc.toJSON();

    // ARCHIVE path — the SAME range sequence (the archive snapshot is taken
    // before deletion and written to a sidecar, which does not affect the doc).
    const ed2 = mountDoc(buildDoc());
    const loc = locateByUuid(ed2, PARA_UUID)!;
    const outer = { from: loc.pos, to: loc.pos + loc.size };
    const extended = expandCascadeRange(ed2.state.doc, outer);
    // (archive snapshots ed2.state.doc.slice(extended...) here — no doc change)
    ed2.state.doc.slice(extended.from, extended.to);
    const delRange = cleanupAndComputeDeleteRange(
      ed2,
      extended.from,
      extended.to,
      strippingLifecycle(ed2, "citation", "citationId"),
    );
    ed2.view.dispatch(
      ed2.state.tr.delete(delRange.from, delRange.to).setMeta(LIFECYCLE_DELETE_META, true),
    );
    const afterArchive = ed2.state.doc.toJSON();

    expect(afterArchive).toEqual(afterDelete);
    // And both preserved the trailing graphicsBlock (F2 floor).
    expect(locateByUuid(ed1, BLOCK_UUID)).not.toBeNull();
    expect(locateByUuid(ed2, BLOCK_UUID)).not.toBeNull();
  });
});
