// @vitest-environment jsdom
//
// Chip A fold (#47(1)) — the example-block par-title strip is GATED by the
// `cardContext` ExampleBlock option. On the MAIN surface the example keeps its
// hover-revealed "+T" add-button (and, when titled, the title text row). On a
// CARD / float surface `cardContext: true` suppresses the whole strip: the
// absolutely-positioned untitled "+T" sits ABOVE the block top, so on a card it
// would overlay the card header and collide with the card's own CardBodyTitle
// "+T". This pins BOTH directions of the gate at the NodeView level, building a
// real `buildEditorExtensions` editor over an exampleBlock (mirrors the
// example-item-body-readonly harness).
//
// The extension barrel transitively imports `@/lib/storage` (the known barrel/
// storage gotcha) — stub it wholesale; nothing here calls a storage fn.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = {};
  for (const name of STORAGE_FNS) mod[name] = name === "isDevStorage" ? false : vi.fn();
  return mod;
});

// jsdom has no ResizeObserver; some chrome paths measure with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function ctx(cardContext: boolean): EditorExtensionsCtx {
  return {
    surface: cardContext ? "float" : "main",
    editableRef: { current: true },
    cardContext,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

/** A single untitled exampleBlock (no `parTitle` → the +T add-button case). */
function exampleDoc(): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "exampleBlock",
        attrs: { uuid: "exblk001", number: 1, kind: "single" },
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Body." }] },
        ],
      },
    ],
  };
}

function buildWith(cardContext: boolean): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const ed = new Editor({
    element: el,
    extensions: buildEditorExtensions(ctx(cardContext)),
    content: exampleDoc(),
  });
  editors.push(ed);
  return ed;
}

describe("exampleBlock par-title gate (#47(1))", () => {
  it("cardContext:FALSE (main) — the example renders the par-title +T strip", () => {
    const ed = buildWith(/* cardContext */ false);
    const wrapper = ed.view.dom.querySelector(".expex-par-wrapper");
    expect(wrapper).not.toBeNull();
    // The +T affordance lives on the MAIN surface: the annotation strip exists,
    // and (untitled block) it carries the hover-revealed +T add-button.
    expect(wrapper!.querySelector(".par-title-annotation")).not.toBeNull();
    expect(wrapper!.querySelector(".par-title-add-btn")).not.toBeNull();
    expect(wrapper!.classList.contains("has-add-btn")).toBe(true);
  });

  it("cardContext:TRUE (card/float) — the strip is fully suppressed", () => {
    const ed = buildWith(/* cardContext */ true);
    const wrapper = ed.view.dom.querySelector(".expex-par-wrapper");
    expect(wrapper).not.toBeNull();
    // No annotation element painted at all — `titleAnnot` is null, so
    // `renderTitle()` early-returns: no +T, and the wrapper never carries the
    // has-add-btn / has-text classes the untitled-strip CSS keys off.
    expect(wrapper!.querySelector(".par-title-annotation")).toBeNull();
    expect(wrapper!.querySelector(".par-title-add-btn")).toBeNull();
    expect(wrapper!.classList.contains("has-add-btn")).toBe(false);
    expect(wrapper!.classList.contains("has-text")).toBe(false);
  });
});
