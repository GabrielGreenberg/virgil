// @vitest-environment jsdom
//
// AnchorHighlightDecorator — the DEEP root fix for the listItem/heading
// hover-cull + hover-highlight-loss class.
//
// THE CLASS BUG: useAnchorHighlightReconciler used to paint
// data-card-selected / -hovered / -paragraph-kind / -margin-side onto the
// anchored block's live DOM element via RAW setAttribute. For a listItem /
// heading (data-uuid is a Decoration.node, no wrapper-guarded NodeView
// ignoreMutation), PM's MutationObserver sees the foreign attr as a node
// mutation and REDRAWS the node — detaching the old element and inserting a
// fresh one. The hover highlight is lost (lands on the detached element) and
// the margin marker is culled. THE FIX paints via a ProseMirror decoration
// (setAnchorHighlightTargets → meta-only tx → DecorationSet) so PM OWNS the
// attrs and never treats them as a foreign mutation → no redraw.
//
// These tests drive the REAL buildEditorExtensions("main") stack + a real
// Editor (the only faithful way — the preview's IO/RAF/redraw timing is
// unreliable for this). They exercise the plugin via setAnchorHighlightTargets,
// which is exactly the bridge the reconciler calls.
//
// (Storage stub guards the extension-barrel/@/lib/storage gotcha: the
// figure/graphics/tex NodeViews transitively import @/lib/storage.)
import { describe, it, expect, vi, afterEach } from "vitest";

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
import type { Decoration } from "@tiptap/pm/view";
import { act, renderHook } from "@testing-library/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import {
  anchorHighlightKey,
  setAnchorHighlightTargets,
  selectedAttrs,
  hoveredAttrs,
  type AnchorHighlightTarget,
} from "@/lib/tiptap/anchor-highlight-deco";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useAnchorHighlightReconciler } from "@/links/_shared/useAnchorHighlightReconciler";
import { cardStore } from "@/links/_shared/anchored-card-store";
import type { EntityCollectionSlots } from "@/cards/entity-collections";
import type { Link } from "@/links/_shared/types";

const LI_UUID = "li0001";
const PARA_UUID = "p00001";

function mainCtx(anchored: Set<string>): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: anchored },
    host: null,
  };
}

/** Build a doc with a bulletList(listItem) and a plain paragraph, both
 *  uuid-bearing, mounted on the real main stack. */
function mountEditor(): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(new Set([LI_UUID, PARA_UUID]))),
    content: {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              attrs: { uuid: LI_UUID },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "an item" }] },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          attrs: { uuid: PARA_UUID },
          content: [{ type: "text", text: "a plain paragraph here." }],
        },
      ],
    },
  });
  return { editor, element };
}

/** Find the start pos + nodeSize of the node bearing `uuid`. */
function nodeSpanByUuid(editor: Editor, uuid: string): { from: number; to: number } {
  let from = -1;
  let size = 0;
  editor.state.doc.descendants((node, pos) => {
    if (from !== -1) return false;
    if (node.attrs?.uuid === uuid) {
      from = pos;
      size = node.nodeSize;
      return false;
    }
    return true;
  });
  if (from === -1) throw new Error(`no node with uuid ${uuid}`);
  return { from, to: from + size };
}

/** The live decorations the plugin currently exposes, as {from,to,attrs}. */
function liveDecos(
  editor: Editor,
): Array<{ from: number; to: number; attrs: Record<string, string> }> {
  const set = anchorHighlightKey.getState(editor.state);
  if (!set) return [];
  return set
    .find()
    .map((d) => {
      const spec = d as Decoration & {
        from: number;
        to: number;
        type?: { attrs?: Record<string, string> };
      };
      return { from: spec.from, to: spec.to, attrs: spec.type?.attrs ?? {} };
    })
    .sort((a, b) => a.from - b.from);
}

/** The live DOM element for a uuid-bearing block. */
function domElForUuid(editor: Editor, uuid: string): HTMLElement {
  const el = editor.view.dom.querySelector(
    `[data-uuid="${uuid}"]`,
  ) as HTMLElement | null;
  if (!el) throw new Error(`no live DOM element for uuid ${uuid}`);
  return el;
}

describe("AnchorHighlightDecorator — node decorations for hover/selection", () => {
  it("produces a node decoration with the right attrs for a HOVERED listItem, and clears on un-hover", () => {
    const { editor, element } = mountEditor();
    const span = nodeSpanByUuid(editor, LI_UUID);

    // Hover: a Mode-A listItem anchor for a `note` card → value "paragraph",
    // kind "note", side "right".
    const target: AnchorHighlightTarget = {
      shape: "node",
      from: span.from,
      to: span.to,
      attrs: hoveredAttrs({ value: "paragraph", kind: "note", side: "right" }, true),
    };
    setAnchorHighlightTargets(editor.view, [target]);

    const decos = liveDecos(editor);
    expect(decos).toHaveLength(1);
    expect(decos[0].from).toBe(span.from);
    expect(decos[0].to).toBe(span.to);
    expect(decos[0].attrs["data-card-hovered"]).toBe("paragraph");
    expect(decos[0].attrs["data-paragraph-kind"]).toBe("note");
    expect(decos[0].attrs["data-margin-side"]).toBe("right");
    expect(decos[0].attrs["data-card-selected"]).toBeUndefined();

    // Un-hover: empty target list clears the set.
    setAnchorHighlightTargets(editor.view, []);
    expect(liveDecos(editor)).toHaveLength(0);

    editor.destroy();
    element.remove();
  });

  it("produces a node decoration for a SELECTED paragraph with kind+side", () => {
    const { editor, element } = mountEditor();
    const span = nodeSpanByUuid(editor, PARA_UUID);

    setAnchorHighlightTargets(editor.view, [
      {
        shape: "node",
        from: span.from,
        to: span.to,
        attrs: selectedAttrs({ value: "paragraph", kind: "comment", side: "left" }),
      },
    ]);

    const decos = liveDecos(editor);
    expect(decos).toHaveLength(1);
    expect(decos[0].attrs["data-card-selected"]).toBe("paragraph");
    expect(decos[0].attrs["data-paragraph-kind"]).toBe("comment");
    expect(decos[0].attrs["data-margin-side"]).toBe("left");

    editor.destroy();
    element.remove();
  });

  it("paints the four attrs onto the live <li> DOM element (CSS would match)", () => {
    const { editor, element } = mountEditor();
    const span = nodeSpanByUuid(editor, LI_UUID);

    setAnchorHighlightTargets(editor.view, [
      {
        shape: "node",
        from: span.from,
        to: span.to,
        attrs: hoveredAttrs({ value: "paragraph", kind: "note", side: "right" }, true),
      },
    ]);

    const li = domElForUuid(editor, LI_UUID);
    // PM applied the node-decoration attrs to the live DOM element — the exact
    // element the [data-card-hovered="paragraph"] accent-rail CSS selects.
    expect(li.getAttribute("data-card-hovered")).toBe("paragraph");
    expect(li.getAttribute("data-paragraph-kind")).toBe("note");
    expect(li.getAttribute("data-margin-side")).toBe("right");

    editor.destroy();
    element.remove();
  });
});

describe("AnchorHighlightDecorator — ROOT PROOF: no node redraw on hover", () => {
  it("hovering a listItem-anchored card does NOT swap/redraw the <li> DOM element", () => {
    const { editor, element } = mountEditor();
    const span = nodeSpanByUuid(editor, LI_UUID);

    const before = domElForUuid(editor, LI_UUID);
    expect(before.isConnected).toBe(true);

    // Paint hover via the decoration (the fix).
    setAnchorHighlightTargets(editor.view, [
      {
        shape: "node",
        from: span.from,
        to: span.to,
        attrs: hoveredAttrs({ value: "paragraph", kind: "note", side: "right" }, true),
      },
    ]);
    // Flush the domObserver before re-reading the DOM (mirrors the CONTRAST
    // test below). Without this flush a cold first process can observe a
    // pending mutation AFTER the `after` read, producing a flaky pass/fail; we
    // force the view to drain any queued DOM mutation here so the assertion
    // sees the steady state. (The whole point is that the decoration path
    // queues NO redraw-triggering mutation — so the flush is a no-op for the
    // fix, but it removes the timing nondeterminism the review hit.)
    (editor.view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();

    const after = domElForUuid(editor, LI_UUID);
    // The SAME element is still in the tree — no detach, no fresh insert. This
    // is the whole point: a decoration is owned by PM, so the foreign-attr
    // MutationObserver redraw never fires.
    expect(after).toBe(before);
    expect(before.isConnected).toBe(true);
    expect(after.getAttribute("data-card-hovered")).toBe("paragraph");

    editor.destroy();
    element.remove();
  });

  it("CONTRAST — RAW setAttribute on the same <li> DOES trigger a redraw (the old bug)", () => {
    const { editor, element } = mountEditor();
    const before = domElForUuid(editor, LI_UUID);
    expect(before.isConnected).toBe(true);

    // Reproduce the LEGACY raw-setAttribute path: PM treats the foreign attr
    // as a node mutation and redraws the listItem, detaching `before`.
    before.setAttribute("data-card-hovered", "paragraph");
    // Force the view to flush the pending DOM mutation it observed.
    editor.view.dispatch(editor.state.tr); // no-op tx flushes the MutationObserver
    // The view re-reads DOM on the next microtask; nudge it.
    (editor.view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();

    const after = domElForUuid(editor, LI_UUID);
    // The legacy path swaps the element (fresh node) — `after !== before` OR
    // `before` is detached. Either proves the redraw the fix eliminates.
    const swappedOrDetached = after !== before || !before.isConnected;
    expect(swappedOrDetached).toBe(true);

    editor.destroy();
    element.remove();
  });
});

describe("AnchorHighlightDecorator — keystroke sanctity", () => {
  it("typing does NOT rebuild the decoration set (maps it, no recompute) and fires no structural emit", () => {
    const { editor, element } = mountEditor();
    const span = nodeSpanByUuid(editor, PARA_UUID);

    // Paint a hover decoration first.
    setAnchorHighlightTargets(editor.view, [
      {
        shape: "node",
        from: span.from,
        to: span.to,
        attrs: hoveredAttrs({ value: "paragraph", kind: "note", side: "right" }, true),
      },
    ]);
    const setBefore = anchorHighlightKey.getState(editor.state);
    expect(setBefore?.find()).toHaveLength(1);

    const bus = getBus(editor);
    const emitBefore = bus?.emitCount ?? 0;

    // Type a character INSIDE the listItem text (structurally-null keystroke).
    // The deco set must be position-mapped, never rebuilt — and no structural
    // bus emit may fire.
    const liSpan = nodeSpanByUuid(editor, LI_UUID);
    // pos just inside the listItem's paragraph text:
    const insertAt = liSpan.from + 2;
    editor.view.dispatch(editor.state.tr.insertText("X", insertAt));

    const emitAfter = bus?.emitCount ?? 0;
    // Keystroke sanctity: no structural emit on a plain in-paragraph insert.
    expect(emitAfter).toBe(emitBefore);

    // The decoration survived (mapped forward), still 1, and shifted by the
    // insert (the PARA decoration was AFTER the insert site).
    const setAfter = anchorHighlightKey.getState(editor.state);
    const found = setAfter?.find() ?? [];
    expect(found).toHaveLength(1);
    const d = found[0] as Decoration & { from: number };
    // The paragraph decoration started at span.from; an insert of 1 char
    // earlier in the doc shifts it right by 1.
    expect(d.from).toBe(span.from + 1);

    editor.destroy();
    element.remove();
  });

  it("the bridge dispatch is a meta-only transaction (no doc change, no structural emit)", () => {
    const { editor, element } = mountEditor();
    const span = nodeSpanByUuid(editor, PARA_UUID);

    const bus = getBus(editor);
    const emitBefore = bus?.emitCount ?? 0;
    const docBefore = editor.state.doc;

    setAnchorHighlightTargets(editor.view, [
      {
        shape: "node",
        from: span.from,
        to: span.to,
        attrs: hoveredAttrs({ value: "paragraph", kind: "note", side: "right" }, true),
      },
    ]);

    // No doc change, no structural emit — the painting tx is meta-only.
    expect(editor.state.doc).toBe(docBefore);
    expect(bus?.emitCount ?? 0).toBe(emitBefore);

    editor.destroy();
    element.remove();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Mode-B (text-range / `linkedAnchor`) REGRESSION GUARD.
//
// THE BUG the 6949dd3 deco rewrite introduced (now fixed): routing a text-range
// anchor through `Decoration.inline` made PM wrap the TEXT node in a FRESH inner
// <span> (TextViewDesc applyOuterDeco, needsWrap for nodeType 3), so the
// `data-card-hovered` attr landed on a CHILD of `.linked-anchor`, not on
// `.linked-anchor` itself. The consuming CSS requires attr+class on the SAME
// element (`.linked-anchor[data-card-hovered="true"]`), so the in-text wash
// never painted.
//
// THE FIX: Mode-B stays on the reconciler's RAW setAttribute path — the attr is
// written directly onto the `.linked-anchor` span (`resolved.domEl`). This
// drives the REAL `useAnchorHighlightReconciler` against a real editor carrying
// a `linkedAnchor` mark, with a `note` whose `links[]` is the Mode-B anchor, and
// asserts the attr lands on `.linked-anchor` itself — the CSS contract.
//
// TEMP-REVERT TOOTH: re-routing Mode-B back through `Decoration.inline` (the
// 6949dd3 regression) makes `.linked-anchor` itself carry NO `data-card-hovered`
// (it's on the wrapper child) → this test goes RED.
// ───────────────────────────────────────────────────────────────────────────

const RANGE_ANCHOR_ID = "rng0001";
const NOTE_ID = "note-mb-1";
const RANGE_PARA_UUID = "pmb0001";

/** Mount a real main-stack editor with one paragraph whose middle word carries
 *  a `linkedAnchor` mark (anchorId = RANGE_ANCHOR_ID, kind "note"), so the
 *  rendered span is `.linked-anchor[data-link-id="rng0001"]` — exactly what
 *  `resolveLink` queries for a Mode-B text-range. */
function mountEditorWithLinkedAnchor(): { editor: Editor; element: HTMLElement } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx(new Set([RANGE_PARA_UUID]))),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: RANGE_PARA_UUID },
          content: [{ type: "text", text: "before anchored after" }],
        },
      ],
    },
  });
  // Stamp a `linkedAnchor` mark over "anchored" (chars 7..15 of the text → PM
  // positions: para opens at 0, text starts at pos 1, so "anchored" is [8, 16)).
  const markType = editor.schema.marks.linkedAnchor;
  if (!markType) throw new Error("linkedAnchor mark missing from the main stack");
  const from = 8;
  const to = 16;
  const mark = markType.create({
    anchorId: RANGE_ANCHOR_ID,
    linkId: RANGE_ANCHOR_ID,
    kind: "note",
    linkKind: "anchor",
    linkCard: "note:",
  });
  editor.view.dispatch(editor.state.tr.addMark(from, to, mark));
  return { editor, element };
}

/** TipTap flips `editor.isInitialized` to true in a deferred `setTimeout(0)`
 *  after the `create` event (see @tiptap/core Editor.createView). The
 *  reconciler's `editorReady` guard requires it, so await that tick (inside
 *  `act`, since the store-subscribed hook may re-render) before driving hover. */
async function waitForEditorInit(editor: Editor): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  if (!editor.isInitialized) throw new Error("editor never initialized");
}

/** A `note` collection carrying a single Mode-B (`linkedRange`) anchor link
 *  pointing at RANGE_ANCHOR_ID — the shape `findEntity`/`resolveLink` read. */
function modeBNoteCollections(): EntityCollectionSlots {
  const link: Link = {
    id: "lnk-mb-1",
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [RANGE_PARA_UUID],
      margin: { side: "right" },
      textRange: { anchorId: RANGE_ANCHOR_ID, textSnapshot: "anchored" },
    },
    target: { type: "card", ref: { kind: "note", id: NOTE_ID } },
    createdAt: "",
  };
  return {
    notes: [{ id: NOTE_ID, links: [link] }],
    highlights: [],
    cutterCards: [],
    comments: [],
    todoItems: [],
    archiveSnippets: [],
    reportCards: [],
    examples: [],
  };
}

describe("AnchorHighlightDecorator — Mode-B (text-range) raw-attr regression guard", () => {
  afterEach(() => {
    // The reconciler reads the module-scope cardStore; reset it between tests.
    act(() => {
      cardStore.setHover(null);
      cardStore.clearSelection();
    });
  });

  it("hovering a selection-anchored note paints data-card-hovered on `.linked-anchor` ITSELF (CSS contract)", async () => {
    const { editor, element } = mountEditorWithLinkedAnchor();
    const collections = modeBNoteCollections();

    // Sanity: the mark rendered a `.linked-anchor` span carrying the anchorId.
    const span = editor.view.dom.querySelector(".linked-anchor") as HTMLElement | null;
    expect(span).toBeTruthy();
    expect(span!.getAttribute("data-link-id")).toBe(RANGE_ANCHOR_ID);
    // Pre-hover: no highlight attr.
    expect(span!.getAttribute("data-card-hovered")).toBeNull();

    // Mount the REAL reconciler, then drive a hover on the note card. Wait for
    // the editor's deferred `create` tick first so `editor.isInitialized` is
    // true (the reconciler's `editorReady` guard requires it).
    const recon = renderHook(() =>
      useAnchorHighlightReconciler({ editor, collections }),
    );
    await waitForEditorInit(editor);
    act(() => {
      cardStore.setHover({ kind: "note", id: NOTE_ID });
    });

    // The attr MUST be on `.linked-anchor` itself (what
    // `.linked-anchor[data-card-hovered="true"]` selects), NOT a wrapper child.
    const after = editor.view.dom.querySelector(".linked-anchor") as HTMLElement;
    expect(after.getAttribute("data-card-hovered")).toBe("true");
    // And no inner child carries it instead (the Decoration.inline failure
    // mode the temp-revert tooth reproduces).
    expect(after.querySelector("[data-card-hovered]")).toBeNull();

    // Un-hover clears it (clear-on-unhover sweep).
    act(() => {
      cardStore.setHover(null);
    });
    expect(
      (editor.view.dom.querySelector(".linked-anchor") as HTMLElement).getAttribute(
        "data-card-hovered",
      ),
    ).toBeNull();

    recon.unmount();
    editor.destroy();
    element.remove();
  });

  it("SELECTING a selection-anchored note paints data-card-selected on `.linked-anchor` itself", async () => {
    const { editor, element } = mountEditorWithLinkedAnchor();
    const collections = modeBNoteCollections();

    const recon = renderHook(() =>
      useAnchorHighlightReconciler({ editor, collections }),
    );
    await waitForEditorInit(editor);
    act(() => {
      cardStore.select({ kind: "note", id: NOTE_ID });
    });

    const span = editor.view.dom.querySelector(".linked-anchor") as HTMLElement;
    expect(span.getAttribute("data-card-selected")).toBe("true");

    recon.unmount();
    editor.destroy();
    element.remove();
  });

  it("does NOT route Mode-B through the decoration plugin (no inline deco emitted)", async () => {
    const { editor, element } = mountEditorWithLinkedAnchor();
    const collections = modeBNoteCollections();

    const recon = renderHook(() =>
      useAnchorHighlightReconciler({ editor, collections }),
    );
    await waitForEditorInit(editor);
    act(() => {
      cardStore.setHover({ kind: "note", id: NOTE_ID });
    });

    // The raw path painted the span (so the hover IS live) …
    expect(
      (editor.view.dom.querySelector(".linked-anchor") as HTMLElement).getAttribute(
        "data-card-hovered",
      ),
    ).toBe("true");
    // … yet the deco plugin set stays EMPTY for a pure Mode-B hover — the range
    // is painted by raw setAttribute, not a decoration. (If a future change
    // re-introduced an inline decoration, this set would be non-empty.)
    const set = anchorHighlightKey.getState(editor.state);
    expect(set?.find() ?? []).toHaveLength(0);

    recon.unmount();
    editor.destroy();
    element.remove();
  });
});
