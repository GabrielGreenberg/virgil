// @vitest-environment jsdom
//
// Hook-level pin for the Mode-A reconcile persist path (anchor-persistence
// bug, Lever 1). Proves that useNotes.reconcileAnchors(editor):
//   - rebinds a card whose stored UUID is dead but whose snapshot matches a
//     live paragraph, AND persists the rewrite (writeSidecar fires);
//   - is a no-op (no write) when there is nothing to change.
//
// Drives the REAL main editor stack so paragraphs carry a `uuid` attr.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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
import { useNotes } from "../useNotes";
import { getLinkedTextObjectIds } from "@/links/links";
import {
  beginDocPipeline,
  __resetForTests,
} from "@/lib/multi-window/doc-pipeline";

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

function mountDoc(paras: Array<{ uuid: string; text: string }>): Editor {
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
        content: [{ type: "text", text: p.text }],
      })),
    },
  });
}

beforeEach(() => {
  mockRead.mockReset();
  mockWrite.mockReset();
  mockWrite.mockResolvedValue(undefined);
  __resetForTests();
});

describe("useNotes.reconcileAnchors persist path", () => {
  it("rebinds a dead-UUID card to the live UUID by snapshot AND persists", async () => {
    beginDocPipeline("doc-rb");
    // Loaded note: anchored to the now-dead UUID "stale", snapshot matches
    // the live paragraph "fresh".
    mockRead.mockResolvedValue({
      cards: [
        {
          id: "n1",
          kind: "note",
          links: [
            {
              id: "n1@stale",
              kind: "anchor",
              anchor: {
                type: "textObject",
                targetKind: "paragraph",
                textObjectIds: ["stale"],
                margin: { side: "right" },
                paragraphSnapshot: "The body of the note.",
              },
              target: { type: "card", ref: { kind: "note", id: "n1" } },
              createdAt: "",
            },
          ],
        },
      ],
    });

    const editor = mountDoc([
      { uuid: "head0", text: "A heading line." },
      { uuid: "fresh", text: "The body of the note." },
    ]);

    const { result } = renderHook(() => useNotes("doc-rb"));
    await waitFor(() => expect(result.current.notes.length).toBe(1));
    // Pre-reconcile: still bound to the dead UUID.
    expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["stale"]);
    mockWrite.mockClear();

    act(() => {
      result.current.reconcileAnchors(editor);
    });

    // Rebound in memory to the live UUID.
    await waitFor(() =>
      expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["fresh"]),
    );
    // Persisted (writeSidecar fired for notes.json).
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    editor.destroy();
  });

  it("is a no-op (no write) when every Mode-A anchor already resolves and snapshot is current", async () => {
    beginDocPipeline("doc-noop");
    mockRead.mockResolvedValue({
      cards: [
        {
          id: "n1",
          kind: "note",
          links: [
            {
              id: "n1@live0",
              kind: "anchor",
              anchor: {
                type: "textObject",
                targetKind: "paragraph",
                textObjectIds: ["live0"],
                margin: { side: "right" },
                paragraphSnapshot: "Still here.",
              },
              target: { type: "card", ref: { kind: "note", id: "n1" } },
              createdAt: "",
            },
          ],
        },
      ],
    });

    const editor = mountDoc([{ uuid: "live0", text: "Still here." }]);
    const { result } = renderHook(() => useNotes("doc-noop"));
    await waitFor(() => expect(result.current.notes.length).toBe(1));
    mockWrite.mockClear();

    act(() => {
      result.current.reconcileAnchors(editor);
    });

    // No change → no persist. (Give the debounced writer a beat.)
    await new Promise((r) => setTimeout(r, 50));
    expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["live0"]);
    expect(mockWrite).not.toHaveBeenCalled();
    editor.destroy();
  });
});
