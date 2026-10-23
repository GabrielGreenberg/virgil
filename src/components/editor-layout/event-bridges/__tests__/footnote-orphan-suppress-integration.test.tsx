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

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook, act } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { OrphanedFootnote } from "@/lib/types";
import { Footnote } from "@/lib/tiptap/footnote";
import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
import { armFootnoteOrphanSuppress, useFootnoteOrphanBridges } from "../footnote-sync";
import { makeUnbridgingFootnoteDelete } from "@/cards/lifecycle/unbridging-footnote-delete";
import { commitRangeDelete } from "@/text-objects/delete-range";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";

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

/** EditorPane's footnote delete door, wired as EditorPane wires it: the REAL
 *  `makeUnbridgingFootnoteDelete` with the REAL `armFootnoteOrphanSuppress`
 *  scoped to the pane's doc (task 1116 — the latch lives in the door, so every
 *  entry point gets it). */
function footnoteDeleteDoor(docId: string) {
  return makeUnbridgingFootnoteDelete({
    unbridge: () => {},
    suppressOrphan: (id) => armFootnoteOrphanSuppress(id, docId),
  });
}

/** EditorPane.handleDeleteFootnote: the door, with the editor-handle splice as
 *  its `remove` (the splice schedules the deferred orphan event via the real
 *  orphan-detector). */
function handleDeleteFootnote(editor: Editor, id: string, docId: string) {
  footnoteDeleteDoor(docId)(id, () => deleteFootnoteAtom(editor));
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

describe("the latch expires — an arm no orphan consumes cannot swallow a later one (task 1255)", () => {
  it("unanchored-ref trash arms with nothing to consume it; a LATER genuine orphan of the same id is still recorded", () => {
    const { getOrphans } = mountBridge("docA");
    const editor = mountEditorWithFootnote("fn-reused", "docA");

    // EditorPane.handleDeleteUnanchoredFootnote: the door with a sidecar-ref
    // delete as its `remove` — no atom leaves the doc, so no orphan event fires
    // to consume the arm.
    act(() => {
      footnoteDeleteDoor("docA")("fn-reused", () => {});
    });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(getOrphans()).toEqual([]);

    // Later (undo has brought the atom back with the same id), the user
    // deletes the marker by typing — a genuine orphan.
    act(() => {
      deleteFootnoteAtom(editor);
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });

    const orphans = getOrphans();
    expect(orphans).toHaveLength(1);
    expect(orphans[0].footnoteId).toBe("fn-reused");

    editor.destroy();
  });

  it("an arm made synchronously AFTER the splice (archive's order) still swallows its own orphan", () => {
    const { getOrphans } = mountBridge("docA");
    const editor = mountEditorWithFootnote("fn-after", "docA");

    act(() => {
      deleteFootnoteAtom(editor);
      armFootnoteOrphanSuppress("fn-after", "docA");
    });
    act(() => {
      vi.runAllTimers();
    });
    expect(getOrphans()).toEqual([]);

    editor.destroy();
  });
});

describe("range Delete / Archive — the lifecycle registry's footnote delete (task 1116)", () => {
  /** A lifecycle API whose footnote `delete` is EditorPane's registry entry:
   *  the door with the sidecar ref delete as its `remove`. */
  function lifecycleFor(docId: string, refDelete: (id: string) => void): CardLifecycleApi {
    const door = footnoteDeleteDoor(docId);
    return {
      get: (kind) =>
        kind === "footnote"
          ? ({ clone: () => null, delete: (id: string) => door(id, refDelete) } as never)
          : null,
    };
  }

  it("a passage range-delete removes the ref and does NOT resurrect it as an orphan", () => {
    const { getOrphans } = mountBridge("docA");
    const editor = mountEditorWithFootnote("fn-range", "docA");
    const refDelete = vi.fn();

    act(() => {
      // The drag-handle Delete / range Archive commit: the range's tr lands
      // FIRST (scheduling the detector's deferred orphan event), then the
      // walker fires each card's lifecycle delete synchronously.
      const landed = commitRangeDelete(
        editor,
        0,
        editor.state.doc.content.size,
        lifecycleFor("docA", refDelete),
      );
      expect(landed).toBe(true);
    });
    expect(refDelete).toHaveBeenCalledWith("fn-range");

    act(() => {
      vi.runOnlyPendingTimers();
    });
    // Pre-fix: the registry entry never armed the latch, so the ref was gone
    // from footnotes.json AND an orphan card for the same id reappeared.
    expect(getOrphans()).toEqual([]);

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
