// @vitest-environment jsdom
//
// Backlog #38 (W-C nit 2) — INTEGRATION pin for the footnote suppress-orphan
// seam, PLUS the per-doc isolation pin (FN-A2-03: orphans must not bleed across
// warm multi-doc keep-alive panes).
//
// The sibling unit test (footnote-orphan-suppress.test.tsx) fires the window
// events by hand, so it proves the consumer hook in isolation but takes the
// synchronous-ordering guarantee — "the latch is armed BEFORE the deferred
// orphan check runs" — on faith from source inspection. That ordering spans
// three decoupled pieces:
//
//   1. EditorPane's `handleDeleteFootnote` dispatches
//      `virgil-footnote-suppress-orphan` SYNCHRONOUSLY, then removes the atom.
//   2. footnote.ts's orphan-detector schedules `virgil-footnote-orphaned` via
//      `setTimeout(…, 0)` (a later macrotask) when a non-empty footnote
//      vanishes — carrying the ORIGINATING doc's id (the `docIdRef` config).
//   3. EditorPane's per-pane `useFootnoteOrphanBridges` consults its internal
//      latch on the suppress event and routes the orphaned event to its OWN
//      doc's store only (the `detail.docId === docId` filter).
//
// This test wires all three against a REAL editor (DocStructureObserver +
// Footnote, the orphan-detector's required substrate) and the REAL bridge hook,
// then asserts: (a) a deliberate delete is swallowed end-to-end, (b) an
// un-suppressed delete still orphans, and (c) two simultaneously-mounted panes
// (the keep-alive shape) each see ONLY their own doc's orphan.
//
// (The doc-structure barrel transitively imports `@/lib/storage`; vitest can't
// resolve its `require("@/lib/storage-fsa")`, so we stub the module wholesale.)
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
import type { OrphanedFootnote } from "@/lib/types";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { useFootnoteOrphanBridges } from "../footnote-sync";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Mount the REAL per-pane bridge hook with a state setter (EditorPane's
 *  wiring), exposing the live orphan list. The suppress latch is internal. */
function mountBridge(docId: string) {
  let current: OrphanedFootnote[] = [];
  const setOrphanedFootnotes = vi.fn(
    (updater: OrphanedFootnote[] | ((p: OrphanedFootnote[]) => OrphanedFootnote[])) => {
      current = typeof updater === "function" ? updater(current) : updater;
    },
  );
  renderHook(() =>
    useFootnoteOrphanBridges({ docId, store: { setOrphanedFootnotes } }),
  );
  return { getOrphans: () => current };
}

/** A real editor whose Footnote orphan-detector (footnote.ts) fires the
 *  deferred `virgil-footnote-orphaned` on a non-empty footnote teardown,
 *  tagged with `docId` (via the `docIdRef` config). */
function mountEditorWithFootnote(footnoteId: string, docId: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    // DocStructureObserver MUST be first (it produces the diff the orphan
    // detector reads) — the real extension ordering.
    extensions: [
      DocStructureObserver,
      StarterKit,
      Footnote.configure({ docIdRef: { current: docId } }),
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Body " },
            {
              type: "footnote",
              attrs: {
                footnoteId,
                number: 1,
                content: {
                  type: "doc",
                  content: [
                    { type: "paragraph", content: [{ type: "text", text: "non-empty note" }] },
                  ],
                },
              },
            },
            { type: "text", text: " end." },
          ],
        },
      ],
    },
  });
}

/** Faithful copy of EditorPane.handleDeleteFootnote: dispatch the suppress
 *  event SYNCHRONOUSLY (docId-tagged), then remove the atom (which schedules the
 *  deferred orphan event via the real orphan-detector). */
function handleDeleteFootnote(editor: Editor, id: string, docId: string) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-suppress-orphan", { detail: { footnoteId: id, docId } }),
  );
  deleteFootnoteAtom(editor);
}

/** Remove the (first) footnote atom from the doc — the user-backspace path. */
function deleteFootnoteAtom(editor: Editor) {
  let pos: number | null = null;
  editor.state.doc.descendants((node, p) => {
    if (pos != null) return false;
    if (node.type.name === "footnote") { pos = p; return false; }
    return true;
  });
  if (pos != null) editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
}

describe("footnote suppress-orphan seam — INTEGRATION (#38 W-C nit 2)", () => {
  it("deliberate delete: the suppress latch swallows the deferred orphan end-to-end", () => {
    const { getOrphans } = mountBridge("docA");
    const editor = mountEditorWithFootnote("fn-deliberate", "docA");

    act(() => {
      handleDeleteFootnote(editor, "fn-deliberate", "docA");
    });

    // The suppress producer ran synchronously and the deferred orphan event
    // hasn't fired yet, so no orphan exists.
    expect(getOrphans()).toEqual([]);

    // Flush the orphan-detector's setTimeout(…, 0). If the latch hadn't been
    // armed in time, this would resurrect the footnote as an orphan — so a still-
    // empty list proves the synchronous-arm-before-deferred-check ordering.
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(getOrphans()).toEqual([]);

    editor.destroy();
  });

  it("CONTROL — organic delete (no suppress) DOES orphan, proving the detector itself fires", () => {
    const { getOrphans } = mountBridge("docA");
    const editor = mountEditorWithFootnote("fn-organic", "docA");

    // Delete the atom WITHOUT the suppress producer (e.g. the user backspaced
    // the marker) — the orphan-detector should still fire and create a card.
    act(() => {
      deleteFootnoteAtom(editor);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    const orphans = getOrphans();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].footnoteId).toBe("fn-organic");

    editor.destroy();
  });
});

describe("per-doc orphan isolation under multi-doc keep-alive (FN-A2-03)", () => {
  it("two simultaneously-mounted panes each see ONLY their own doc's orphan", () => {
    // The keep-alive shape: two doc panes mounted at once, each with its own
    // per-doc orphan store + bridge. Pre-fix a single shell accumulator listened
    // to the window-level orphan event and co-mingled both docs' orphans.
    const paneA = mountBridge("docA");
    const paneB = mountBridge("docB");
    const editorA = mountEditorWithFootnote("fnA", "docA");
    const editorB = mountEditorWithFootnote("fnB", "docB");

    // Delete the callout in doc A (organic). The window event reaches BOTH
    // panes' listeners; only doc A's (matching docId) should accept it.
    act(() => {
      deleteFootnoteAtom(editorA);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(paneA.getOrphans().map((o) => o.footnoteId)).toEqual(["fnA"]);
    expect(paneB.getOrphans()).toEqual([]); // <-- no bleed into doc B

    // Now delete the callout in doc B.
    act(() => {
      deleteFootnoteAtom(editorB);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    // Each pane shows exactly its own orphan — never the other's.
    expect(paneA.getOrphans().map((o) => o.footnoteId)).toEqual(["fnA"]);
    expect(paneB.getOrphans().map((o) => o.footnoteId)).toEqual(["fnB"]);

    editorA.destroy();
    editorB.destroy();
  });
});
