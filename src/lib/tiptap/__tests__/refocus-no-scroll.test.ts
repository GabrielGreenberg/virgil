// @vitest-environment jsdom
/**
 * Task 486 — a REFOCUS is a focus, not a navigation.
 *
 * Gabriel, from a real paper: *"after you add a label to a section, the scroll
 * jumps."* The heading NodeView's label input committed with a bare
 * `nodeEditor.commands.focus()`, and TipTap's `focus()` schedules — one frame
 * later — an `editor.commands.scrollIntoView()` on whatever the SELECTION is by
 * then. The label edit happens AT A NODE resolved by uuid/position and never
 * touches the selection, so that deferred scroll chased the user's STALE caret,
 * pages away from the heading being labelled.
 *
 * ## Why no pre-486 suite could see this
 *
 * `render-annot-bail.test.ts` drives the same NodeView and asserts the
 * ANNOTATION DOM; `structural-edit.test.ts` drives the label WRITE through
 * `editEditorNodeByUuid`, one layer below the NodeView, where the refocus does
 * not exist at all. Neither has a caret parked anywhere, and neither observes a
 * transaction's `scrolledIntoView` flag — so "the commit scheduled a scroll" is
 * unrepresentable in both.
 *
 * ## What the harness can see HONESTLY
 *
 * jsdom has no layout, so `scrollTop` is synthetic and PM's own scroll math is
 * a no-op there. The thing that is real and observable is the DISPATCH: a
 * transaction carrying ProseMirror's `scrolledIntoView` flag. That flag IS the
 * scroll request — `Transaction#scrollIntoView()` sets it and
 * `EditorView#updateState` acts on it — so counting flagged transactions is
 * counting scroll requests, not a proxy for them. The CANARY leg below fires a
 * bare `focus()` through the identical harness and asserts the probe sees one,
 * so a green defect leg can never mean "the probe is blind".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Same storage stub as `render-annot-bail.test.ts` — the extension barrel pulls
// @/lib/storage transitively and vitest can't resolve its backend require.
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
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import {
  createHeadingWithLabel,
  createParagraphWithTitle,
} from "@/lib/editor-extensions";
import { refocusEditor } from "@/lib/tiptap/refocus-editor";

/**
 * `focus()`'s scroll is DEFERRED into a `requestAnimationFrame`, so the frame
 * has to run for the defect to be observable at all. A queue-and-flush stub is
 * deterministic where jsdom's real rAF is not — and it is also what lets the
 * leg prove the frame RAN (`flushFrames()` returns how many it drained), so a
 * green result can't come from a frame that never fired.
 */
let frames: FrameRequestCallback[] = [];
let realRaf: typeof requestAnimationFrame;

/**
 * jsdom implements no layout, and `Range` there has no `getClientRects` at all
 * — so ProseMirror's `scrollToSelection` THROWS rather than scrolling. That is
 * itself proof the scroll was attempted, but a throw is a worse signal than a
 * count: it aborts the dispatch before the `transaction` event can report, and
 * it would make the defect legs fail for the wrong reason. A zero-rect shim
 * lets PM's scroll math run to completion harmlessly, so every leg reads the
 * same probe — the `scrolledIntoView` FLAG on the dispatched transaction.
 */
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON() { return this; },
} as DOMRect;

function installLayoutShim() {
  const list = Object.assign([ZERO_RECT], { item: () => ZERO_RECT }) as unknown as DOMRectList;
  for (const proto of [Range.prototype, Text.prototype as unknown as Range]) {
    if (typeof (proto as { getClientRects?: unknown }).getClientRects !== "function") {
      (proto as { getClientRects?: unknown }).getClientRects = () => list;
    }
    if (typeof (proto as { getBoundingClientRect?: unknown }).getBoundingClientRect !== "function") {
      (proto as { getBoundingClientRect?: unknown }).getBoundingClientRect = () => ZERO_RECT;
    }
  }
}

beforeEach(() => {
  installLayoutShim();
  frames = [];
  realRaf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  }) as typeof requestAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
});

function flushFrames(): number {
  let ran = 0;
  // A frame may schedule another (the input's own focus frame does not, but
  // `delayedFocus` is itself scheduled from one in some code paths) — drain
  // until quiet, bounded so a pathological loop fails loudly rather than hangs.
  for (let round = 0; round < 10 && frames.length; round++) {
    const batch = frames;
    frames = [];
    for (const cb of batch) { cb(0); ran++; }
  }
  return ran;
}

function buildEditor(label: string | null = null) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        heading: false,
        paragraph: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        codeBlock: false,
        dropcursor: false,
      }),
      DocStructureObserver,
      // StarterKit's `paragraph` is off (the app replaces it), so the schema has
      // no block type at all without this — the doc silently degrades to an
      // `<hr>` and no NodeView ever mounts.
      createParagraphWithTitle(),
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, uuid: "h-1", label },
          content: [{ type: "text", text: "Introduction" }],
        },
        // Distance: the caret is parked in the LAST paragraph, far from the
        // heading whose label is being committed. That gap is the whole defect
        // — a scroll to the caret is a scroll away from the edit.
        ...Array.from({ length: 12 }, (_, i) => ({
          type: "paragraph" as const,
          content: [{ type: "text", text: `Body paragraph number ${i}.` }],
        })),
      ],
    },
  });
  return { editor, el };
}

/** Park the caret in the LAST paragraph — the "stale caret" of the report. */
function parkCaretFarAway(editor: Editor): number {
  const pos = editor.state.doc.content.size - 2;
  editor.commands.setTextSelection(pos);
  return editor.state.selection.from;
}

/** Count transactions carrying ProseMirror's scroll request. */
function watchScrollRequests(editor: Editor): () => number {
  let n = 0;
  editor.on("transaction", ({ transaction }) => {
    if (transaction.scrolledIntoView) n++;
  });
  return () => n;
}

const annotOf = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-uuid="h-1"] .heading-annotation')!;

/** Drive the REAL affordance: click the label chip, type, press Enter. */
function commitLabelViaInput(el: HTMLElement, value: string): void {
  const annot = annotOf(el);
  const opener =
    annot.querySelector<HTMLElement>(".heading-label-add") ??
    annot.querySelector<HTMLElement>(".heading-label-text")!;
  opener.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  const input = annot.querySelector<HTMLInputElement>("input.heading-label-input")!;
  expect(input).not.toBeNull();
  input.value = value;
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
  );
}

describe("task 486 — a chrome commit refocuses without repositioning", () => {
  it("CANARY: the probe can see a scroll request — a bare focus() schedules one", () => {
    const { editor } = buildEditor();
    try {
      const scrolls = watchScrollRequests(editor);
      parkCaretFarAway(editor);
      editor.commands.focus();
      expect(flushFrames()).toBeGreaterThan(0);
      expect(scrolls()).toBeGreaterThan(0);
    } finally {
      editor.destroy();
    }
  });

  it("the door refocuses and schedules NO scroll", () => {
    const { editor } = buildEditor();
    try {
      const scrolls = watchScrollRequests(editor);
      parkCaretFarAway(editor);
      refocusEditor(editor);
      expect(flushFrames()).toBeGreaterThan(0);
      expect(scrolls()).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("ADDING a label from the strip requests no scroll, and the caret does not move", () => {
    const { editor, el } = buildEditor(null);
    try {
      const parked = parkCaretFarAway(editor);
      const scrolls = watchScrollRequests(editor);

      commitLabelViaInput(el, "sec:intro");
      flushFrames();

      // The edit landed …
      expect(editor.state.doc.firstChild!.attrs.label).toBe("sec:intro");
      // … the caret is still where the user left it …
      expect(editor.state.selection.from).toBe(parked);
      // … and nothing asked the document to move.
      expect(scrolls()).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("RENAMING a label requests no scroll", () => {
    const { editor, el } = buildEditor("sec:old");
    try {
      const parked = parkCaretFarAway(editor);
      const scrolls = watchScrollRequests(editor);

      commitLabelViaInput(el, "sec:new");
      flushFrames();

      expect(editor.state.doc.firstChild!.attrs.label).toBe("sec:new");
      expect(editor.state.selection.from).toBe(parked);
      expect(scrolls()).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("REMOVING a label requests no scroll", () => {
    const { editor, el } = buildEditor("sec:old");
    try {
      const parked = parkCaretFarAway(editor);
      const scrolls = watchScrollRequests(editor);

      commitLabelViaInput(el, "   ");
      flushFrames();

      expect(editor.state.doc.firstChild!.attrs.label).toBeNull();
      expect(editor.state.selection.from).toBe(parked);
      expect(scrolls()).toBe(0);
    } finally {
      editor.destroy();
    }
  });

  it("focus STILL returns to the editor — only the scroll side effect goes", () => {
    const { editor, el } = buildEditor(null);
    try {
      const focusSpy = vi.spyOn(editor.view, "focus");
      parkCaretFarAway(editor);
      commitLabelViaInput(el, "sec:intro");
      flushFrames();
      // `delayedFocus` calls `view.focus()` inside its frame whether or not the
      // scroll is suppressed — that is the half the site's comment is about
      // ("keeps the user in the popout"), and it must survive the fix.
      expect(focusSpy).toHaveBeenCalled();
    } finally {
      editor.destroy();
    }
  });

  it("a commit that CHANGES NOTHING (same label re-entered) is inert either way", () => {
    const { editor, el } = buildEditor("sec:same");
    try {
      const parked = parkCaretFarAway(editor);
      const scrolls = watchScrollRequests(editor);
      commitLabelViaInput(el, "sec:same");
      flushFrames();
      expect(editor.state.doc.firstChild!.attrs.label).toBe("sec:same");
      expect(editor.state.selection.from).toBe(parked);
      expect(scrolls()).toBe(0);
    } finally {
      editor.destroy();
    }
  });
});
