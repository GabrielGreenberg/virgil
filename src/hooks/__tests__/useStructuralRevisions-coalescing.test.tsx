// @vitest-environment jsdom
/**
 * useStructuralRevisions trailing-RAF coalescing (typing-latency fix 2c).
 *
 * A held-backspace across N blocks fires one structural bus emit per
 * block-merge transaction at key-repeat rate. Before the damper, every emit
 * ran a setRevs → an EditorPane/EditorLayout render + card-source re-derive
 * per repeat. The hook now accumulates bumped categories in a ref Set and
 * flushes ONE merged setRevs on the next animation frame.
 *
 * Pinned:
 *   1. a synchronous burst of structural emits → ONE render, with every
 *      touched category's counter advanced in that single flush;
 *   2. counters stay monotonic and per-category (a burst touching blocks +
 *      headings advances both);
 *   3. nothing flushes before the frame boundary;
 *   4. unmount cancels the pending flush (no post-unmount setState).
 */
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

import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import {
  createParagraphWithTitle,
  createHeadingWithLabel,
} from "@/lib/editor-extensions";
import { useStructuralRevisions } from "@/hooks/useStructuralRevisions";

// Deterministic frames: capture RAF callbacks, fire on demand.
let rafQueue: FrameRequestCallback[] = [];
const realRaf = globalThis.requestAnimationFrame;
const realCaf = globalThis.cancelAnimationFrame;

beforeEach(() => {
  rafQueue = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  }) as typeof globalThis.requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    rafQueue[id - 1] = () => {};
  }) as typeof globalThis.cancelAnimationFrame;
});

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCaf;
});

function frame() {
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(0);
}

function mountEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
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
      createParagraphWithTitle(),
      createHeadingWithLabel({}, { surface: "main" }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p0" },
          content: [{ type: "text", text: "Zero" }],
        },
        {
          type: "heading",
          attrs: { level: 1, uuid: "hB" },
          content: [{ type: "text", text: "Beta" }],
        },
        {
          type: "paragraph",
          attrs: { uuid: "p1" },
          content: [{ type: "text", text: "One" }],
        },
      ],
    },
  });
}

function insertParagraph(editor: Editor, uuid: string) {
  const para = editor.schema.nodes.paragraph.create(
    { uuid },
    editor.schema.text(`Para ${uuid}`),
  );
  editor.view.dispatch(
    editor.state.tr.insert(editor.state.doc.content.size, para),
  );
}

describe("useStructuralRevisions — trailing-RAF coalescing (2c)", () => {
  it("collapses a synchronous structural burst into ONE render with merged counters", () => {
    const editor = mountEditor();
    try {
      let renders = 0;
      const { result } = renderHook(() => {
        renders++;
        return useStructuralRevisions(editor);
      });
      const rendersAfterMount = renders;
      const blocksBefore = result.current.blocks;
      const headingsBefore = result.current.headings;

      act(() => {
        // Burst: three block inserts + one heading DELETE, all in one task
        // (the held-backspace shape). The delete drives removedHeadings +
        // removedBlocks — two categories in one burst.
        insertParagraph(editor, "pA");
        insertParagraph(editor, "pB");
        insertParagraph(editor, "pC");
        let hB = -1;
        let size = 0;
        let offset = 0;
        editor.state.doc.forEach((node) => {
          if (node.attrs?.uuid === "hB") {
            hB = offset;
            size = node.nodeSize;
          }
          offset += node.nodeSize;
        });
        editor.view.dispatch(editor.state.tr.delete(hB, hB + size));
      });

      // Nothing flushed before the frame boundary.
      expect(renders).toBe(rendersAfterMount);
      expect(result.current.blocks).toBe(blocksBefore);

      act(() => {
        frame();
      });

      // ONE flush: exactly one extra render, both touched categories
      // advanced by one (the burst collapsed).
      expect(renders).toBe(rendersAfterMount + 1);
      expect(result.current.blocks).toBe(blocksBefore + 1);
      expect(result.current.headings).toBe(headingsBefore + 1);
    } finally {
      editor.destroy();
    }
  });

  it("separate frames flush separately (counters stay monotonic across bursts)", () => {
    const editor = mountEditor();
    try {
      const { result } = renderHook(() => useStructuralRevisions(editor));
      const before = result.current.blocks;

      act(() => {
        insertParagraph(editor, "pX");
        frame();
      });
      expect(result.current.blocks).toBe(before + 1);

      act(() => {
        insertParagraph(editor, "pY");
        frame();
      });
      expect(result.current.blocks).toBe(before + 2);
    } finally {
      editor.destroy();
    }
  });

  it("unmount cancels the pending flush — no post-unmount setState", () => {
    const editor = mountEditor();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { unmount } = renderHook(() => useStructuralRevisions(editor));
      act(() => {
        insertParagraph(editor, "pZ");
      });
      unmount();
      act(() => {
        frame();
      });
      // React logs an error on setState-after-unmount; none may appear.
      const complained = errSpy.mock.calls.some((args) =>
        String(args[0]).includes("unmounted"),
      );
      expect(complained).toBe(false);
    } finally {
      errSpy.mockRestore();
      editor.destroy();
    }
  });
});
