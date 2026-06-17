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

    // No change → no persist. Wait PAST the 300 ms usePersistentState
    // debounce (380 ms) — asserting inside the debounce window (the old
    // 50 ms) passed even WITH the bug, since the scheduled write had not
    // fired yet. With FIX 1 the no-op pass calls update() ZERO times, so
    // nothing is ever scheduled; this proves no write lands even after
    // the debounce would have flushed.
    await new Promise((r) => setTimeout(r, 380));
    expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["live0"]);
    expect(mockWrite).not.toHaveBeenCalled();
    editor.destroy();
  });

  // FIX 4 regression: pins the data-loss BLOCKER. If reconcileAnchors fires
  // BEFORE the sidecar read resolves and (as the buggy version did) calls
  // update() over the empty pre-load array, update() flips hasMutatedRef so
  // the pending loader bails `if (hasMutatedRef.current) return;` and the
  // on-disk cards are silently DROPPED for the session. FIX 1's
  // cards.length===0 early-bail keeps the pass from touching update() until
  // the cards have loaded, so the disk value still reaches state AND the
  // recovery still happens once cards are present.
  it("does NOT poison the loader when reconcile fires before the sidecar read resolves (deferred-load ordering)", async () => {
    beginDocPipeline("doc-deferred");

    // Defer the sidecar read: we control exactly when it resolves, AFTER
    // we have called reconcileAnchors over the not-yet-loaded (empty) state.
    let resolveRead: (raw: unknown) => void = () => {};
    const deferred = new Promise<unknown>((res) => {
      resolveRead = res;
    });
    mockRead.mockReturnValue(deferred);

    const editor = mountDoc([
      { uuid: "head0", text: "A heading line." },
      { uuid: "fresh", text: "The body of the note." },
    ]);

    const { result } = renderHook(() => useNotes("doc-deferred"));

    // Read is still pending → no cards yet.
    expect(result.current.notes.length).toBe(0);

    // Reconcile fires NOW, over the empty pre-load array. With the bug this
    // calls update() and poisons hasMutatedRef. FIX 1's early-bail means it
    // never touches update() — so the still-pending loader will still apply
    // the disk value.
    act(() => {
      result.current.reconcileAnchors(editor);
    });

    // Now the on-disk read resolves: a dead-UUID card whose snapshot matches
    // the live "fresh" paragraph.
    await act(async () => {
      resolveRead({
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
    });

    // (1) The on-disk cards STILL load into state — no hasMutatedRef
    // poisoning. State reaches the disk value, not the default.
    await waitFor(() => expect(result.current.notes.length).toBe(1));

    // (2) Recovery still occurs once cards are present: a second reconcile
    // (the EditorPane one-shot now fires post-load) rebinds the dead UUID to
    // the live one by snapshot.
    act(() => {
      result.current.reconcileAnchors(editor);
    });
    await waitFor(() =>
      expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["fresh"]),
    );

    editor.destroy();
  });
});
