// @vitest-environment jsdom
//
// RC-A+D integration pins — the resolver-driven load reconcile, driven
// through the REAL panel hooks (useNotes / useTodos) and the REAL
// `useReconcileModeAAnchors` data-loss-safe shell.
//
// Covers (combined chip RC-A+D):
//   - RC3 reload-sim: a dead stored uuid + matching snapshot rewrites
//     textObjectIds[0] to the live uuid AND persists.
//   - Idempotency E2E (open-verification #5): running the load pass twice
//     yields zero writes on the 2nd pass (no save loop).
//   - Data-loss-safe shell (teeth): a reconcile fired BEFORE the sidecar
//     read resolves must NOT drop the on-disk cards.
//   - AUGMENTATION 1 (backfill): a uuid-resolved card MISSING a snapshot
//     gets `paragraphSnapshot === normalize(live text)`.
//   - AUGMENTATION 2 (HYBRID CLEANUP): a re-anchored Mode-B todo's
//     dead-mark linkedRange link is stripped → single clean Mode-A link,
//     getTextAnchor === null.
//
// Drives the real main editor stack so paragraphs carry `uuid` attrs and
// linkedAnchor marks exactly as in prod.
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
import { useTodos } from "../useTodos";
import { getLinkedTextObjectIds, getTextAnchor } from "@/links/links";
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

// ===========================================================================
// RC3 reload-sim + idempotency
// ===========================================================================

describe("RC-A resolver-driven reconcile — RC3 reload-sim + idempotency", () => {
  it("rewrites textObjectIds[0] from a DEAD stored uuid to the live uuid via snapshot (RC3)", async () => {
    beginDocPipeline("rca-rc3");
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

    const { result } = renderHook(() => useNotes("rca-rc3"));
    await waitFor(() => expect(result.current.notes.length).toBe(1));
    expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["stale"]);
    mockWrite.mockClear();

    act(() => result.current.reconcileAnchors(editor));

    await waitFor(() =>
      expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["fresh"]),
    );
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    editor.destroy();
  });

  it("idempotency E2E: a 2nd load pass writes ZERO times (no save loop)", async () => {
    beginDocPipeline("rca-idem");
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

    const { result } = renderHook(() => useNotes("rca-idem"));
    await waitFor(() => expect(result.current.notes.length).toBe(1));

    // First pass: heals the dead uuid → write.
    act(() => result.current.reconcileAnchors(editor));
    await waitFor(() =>
      expect(getLinkedTextObjectIds(result.current.notes[0])).toEqual(["fresh"]),
    );
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());

    // Let the first pass's debounced write flush, then clear the counter.
    await new Promise((r) => setTimeout(r, 380));
    mockWrite.mockClear();

    // Second pass over the now-healed cards: every card resolves via the
    // uuid rung with an already-canonical snapshot → changed:false for all →
    // the shell calls update() ZERO times → no write even past the debounce.
    act(() => result.current.reconcileAnchors(editor));
    await new Promise((r) => setTimeout(r, 380));
    expect(mockWrite).not.toHaveBeenCalled();
    editor.destroy();
  });
});

// ===========================================================================
// Data-loss-safe shell (teeth)
// ===========================================================================

describe("RC-A reconcile — data-loss-safe shell (teeth)", () => {
  it("reconcile firing BEFORE the sidecar read resolves does NOT drop on-disk cards", async () => {
    beginDocPipeline("rca-dataloss");

    let resolveRead: (raw: unknown) => void = () => {};
    const deferred = new Promise<unknown>((res) => {
      resolveRead = res;
    });
    mockRead.mockReturnValue(deferred);

    const editor = mountDoc([
      { uuid: "head0", text: "A heading line." },
      { uuid: "fresh", text: "The body of the note." },
    ]);

    const { result } = renderHook(() => useNotes("rca-dataloss"));
    // Read still pending → no cards.
    expect(result.current.notes.length).toBe(0);

    // Fire reconcile over the empty pre-load array. The shell's
    // cards.length===0 early-bail must keep it from touching update() (which
    // would poison hasMutatedRef and make the pending loader drop the disk
    // cards). Temp-revert the guard → this assertion goes RED.
    act(() => result.current.reconcileAnchors(editor));

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

    // The on-disk card STILL loads — not dropped by a poisoned loader.
    await waitFor(() => expect(result.current.notes.length).toBe(1));
    editor.destroy();
  });
});

// ===========================================================================
// AUGMENTATION 1 — editor-aware snapshot backfill
// ===========================================================================

describe("RC-A reconcile — AUGMENTATION 1: backfill missing snapshot", () => {
  it("a uuid-resolved card MISSING a snapshot gets normalize(live text)", async () => {
    beginDocPipeline("rca-backfill");
    // Live uuid, but NO paragraphSnapshot stored (legacy snapshot-less link).
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
                // no paragraphSnapshot
              },
              target: { type: "card", ref: { kind: "note", id: "n1" } },
              createdAt: "",
            },
          ],
        },
      ],
    });

    // Live paragraph has SLOPPY whitespace; backfill must store NORMALIZED.
    const editor = mountDoc([{ uuid: "live0", text: "The   live   body. " }]);
    const { result } = renderHook(() => useNotes("rca-backfill"));
    await waitFor(() => expect(result.current.notes.length).toBe(1));

    act(() => result.current.reconcileAnchors(editor));

    await waitFor(() => {
      const link = result.current.notes[0].links?.[0];
      if (link?.anchor.type !== "textObject") throw new Error("textObject");
      expect(link.anchor.paragraphSnapshot).toBe("The live body.");
    });
    editor.destroy();
  });
});

// ===========================================================================
// AUGMENTATION 2 — HYBRID CLEANUP (re-anchored Mode-B todo)
// ===========================================================================

describe("RC-A reconcile — AUGMENTATION 2: hybrid cleanup (todo)", () => {
  it("strips a dead-mark linkedRange link → single clean Mode-A link, getTextAnchor null", async () => {
    beginDocPipeline("rca-hybrid");
    // The inert hybrid a re-anchored Mode-B todo leaves behind: a
    // linkedRange link whose mark anchorId is DEAD (never applied in the
    // live doc) + a clean Mode-A link on the new paragraph P_new.
    mockRead.mockResolvedValue({
      items: [
        {
          id: "t1",
          text: "a todo",
          done: false,
          aiRequest: false,
          createdAt: "",
          links: [
            {
              id: "t1@dead",
              kind: "anchor",
              anchor: {
                type: "textObject",
                targetKind: "linkedRange",
                textObjectIds: [],
                margin: { side: "right" },
                textRange: { anchorId: "anc-dead", textSnapshot: "old span" },
              },
              target: { type: "card", ref: { kind: "todo", id: "t1" } },
              createdAt: "",
            },
            {
              id: "t1@pnew",
              kind: "anchor",
              anchor: {
                type: "textObject",
                targetKind: "paragraph",
                textObjectIds: ["pnew0"],
                margin: { side: "right" },
                paragraphSnapshot: "The new home paragraph.",
              },
              target: { type: "card", ref: { kind: "todo", id: "t1" } },
              createdAt: "",
            },
          ],
        },
      ],
    });

    const editor = mountDoc([
      { uuid: "head0", text: "A heading line." },
      { uuid: "pnew0", text: "The new home paragraph." },
    ]);

    const { result } = renderHook(() => useTodos("rca-hybrid"));
    await waitFor(() => expect(result.current.items.length).toBe(1));
    // Pre-reconcile: the dead-mark linkedRange link still gives a textAnchor.
    expect(getTextAnchor(result.current.items[0])).not.toBeNull();

    act(() => result.current.reconcileAnchors(editor));

    await waitFor(() => {
      const todo = result.current.items[0];
      // Single clean Mode-A link, no surviving textRange.
      expect(todo.links).toHaveLength(1);
      const link = todo.links?.[0];
      if (link?.anchor.type !== "textObject") throw new Error("textObject");
      expect(link.anchor.targetKind).toBe("paragraph");
      expect(link.anchor.textObjectIds).toEqual(["pnew0"]);
      expect(getTextAnchor(todo)).toBeNull();
    });
    editor.destroy();
  });
});
