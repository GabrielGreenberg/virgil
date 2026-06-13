// @vitest-environment jsdom
//
// Backlog #38 (W-C nit 2) — INTEGRATION pin for the footnote suppress-orphan
// seam.
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
//      vanishes.
//   3. EditorLayout's `useFootnoteSyncBridges` arms `suppressOrphanRef` on the
//      suppress event and consults it when the orphaned event arrives.
//
// This test wires all three against a REAL editor (DocStructureObserver +
// Footnote, the orphan-detector's required substrate) and the REAL bridge hook,
// then asserts: (a) the latch is armed the instant the producer returns —
// before any timer flush — and (b) after flushing the deferred orphan event, NO
// orphan card resurrects. A control proves an UN-suppressed delete still
// orphans, so the suppression — not a broken detector — is what swallows it.
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
import { useRef } from "react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { OrphanedFootnote } from "@/lib/types";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { useFootnoteSyncBridges } from "../footnote-sync";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Mount the REAL bridge hook with a real ref + state setter (EditorLayout's
 *  wiring), exposing the latch and the live orphan list. */
function mountBridge() {
  let current: OrphanedFootnote[] = [];
  const setOrphanedFootnotes = vi.fn(
    (updater: OrphanedFootnote[] | ((p: OrphanedFootnote[]) => OrphanedFootnote[])) => {
      current = typeof updater === "function" ? updater(current) : updater;
    },
  );
  const deleteSnippet = vi.fn();
  const hook = renderHook(() => {
    const suppressOrphanRef = useRef<Set<string>>(new Set());
    useFootnoteSyncBridges({ suppressOrphanRef, setOrphanedFootnotes, deleteSnippet });
    return suppressOrphanRef;
  });
  return { suppressRef: hook.result.current, getOrphans: () => current };
}

/** A real editor whose Footnote orphan-detector (footnote.ts) fires the
 *  deferred `virgil-footnote-orphaned` on a non-empty footnote teardown. */
function mountEditorWithFootnote(footnoteId: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    editable: true,
    // DocStructureObserver MUST be first (it produces the diff the orphan
    // detector reads) — the real extension ordering.
    extensions: [DocStructureObserver, StarterKit, Footnote],
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
 *  event SYNCHRONOUSLY, then remove the atom (which schedules the deferred
 *  orphan event via the real orphan-detector). */
function handleDeleteFootnote(editor: Editor, id: string) {
  window.dispatchEvent(
    new CustomEvent("virgil-footnote-suppress-orphan", { detail: { footnoteId: id } }),
  );
  // Remove the footnote atom from the doc (deleteFootnote's effect).
  let pos: number | null = null;
  editor.state.doc.descendants((node, p) => {
    if (pos != null) return false;
    if (node.type.name === "footnote" && node.attrs.footnoteId === id) {
      pos = p;
      return false;
    }
    return true;
  });
  if (pos != null) editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
}

describe("footnote suppress-orphan seam — INTEGRATION (#38 W-C nit 2)", () => {
  it("deliberate delete: the latch is armed BEFORE the deferred orphan fires, and no orphan resurrects", () => {
    const { suppressRef, getOrphans } = mountBridge();
    const editor = mountEditorWithFootnote("fn-deliberate");

    act(() => {
      handleDeleteFootnote(editor, "fn-deliberate");
    });

    // Ordering guarantee #1: the latch is armed SYNCHRONOUSLY by the producer —
    // it is set before any timer is flushed (the deferred orphan check hasn't
    // run yet).
    expect(suppressRef.current.has("fn-deliberate")).toBe(true);
    expect(getOrphans()).toEqual([]); // orphan event hasn't fired yet either

    // Now flush the orphan-detector's setTimeout(…, 0): the deferred
    // `virgil-footnote-orphaned` arrives and finds the latch armed.
    act(() => {
      vi.runOnlyPendingTimers();
    });

    // Ordering guarantee #2: no orphan card resurrected, and the latch was
    // consumed (one-shot).
    expect(getOrphans()).toEqual([]);
    expect(suppressRef.current.has("fn-deliberate")).toBe(false);

    editor.destroy();
  });

  it("CONTROL — organic delete (no suppress) DOES orphan, proving the detector itself fires", () => {
    const { getOrphans } = mountBridge();
    const editor = mountEditorWithFootnote("fn-organic");

    // Delete the atom WITHOUT the suppress producer (e.g. the user backspaced
    // the marker) — the orphan-detector should still fire and create a card.
    act(() => {
      let pos: number | null = null;
      editor.state.doc.descendants((node, p) => {
        if (pos != null) return false;
        if (node.type.name === "footnote") { pos = p; return false; }
        return true;
      });
      if (pos != null) editor.view.dispatch(editor.state.tr.delete(pos, pos + 1));
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
