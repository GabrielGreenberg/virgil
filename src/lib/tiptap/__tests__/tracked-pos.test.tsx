// @vitest-environment jsdom
//
// Task 1190 — the create-at-caret popover's insertion point FOLLOWS the
// document while the popover is open.
//
// The citation / `\ref` create popover captures a position when it opens and
// inserts on a later pick. Before 1190 that was a raw number: an edit landing
// earlier in the same editor while the user chose citekeys (an agent write
// reloaded into the view, a code-pane re-parse, an embedded card's write-back)
// shifted the text under it, and the `\cite` landed N characters away —
// mid-word, or in another paragraph — because the insert primitive only CLAMPS.
//
//   1. `trackPos` — maps through every applied transaction (and its appended
//      ones); a selection move leaves it alone; a deletion of the spot itself
//      nulls it; `dispose()` stops following.
//   2. The REAL bridge (`useMarkerClickBridges`) turns the trigger event's
//      `pos` into a tracker started at open, so a commit through
//      `insertInlineAtom` at `at.get()` lands at P+N after an N-char insert
//      before P — and refuses (no doc change) once P's text was deleted.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { act } from "react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Citation } from "@/lib/tiptap/citation";
import { trackPos, trackRange } from "@/lib/tiptap/tracked-pos";
import { insertInlineAtom } from "@/lib/tiptap/insert-inline-atom";
import { useMarkerClickBridges } from "@/components/editor-layout/event-bridges/marker-clicks";
import {
  ATOM_CREATE_POPOVER_EVENT,
  type AtomCreateSession,
} from "@/lib/actions/atom-create";
import { defaultCardStore } from "@/links/_shared/anchored-card-store";

const editors: Editor[] = [];

function mount(text = "hello world"): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, Citation],
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) if (!e.isDestroyed) e.destroy();
});

/** An edit that does not come from the popover — an agent/reload/re-parse
 *  write landing while it is open. */
function insertTextAt(editor: Editor, pos: number, text: string) {
  editor.view.dispatch(editor.state.tr.insertText(text, pos));
}

describe("trackPos (task 1190)", () => {
  it("maps through an insertion BEFORE the spot", () => {
    const editor = mount();
    const at = trackPos(editor, 7); // "hello |world"
    insertTextAt(editor, 1, "oh, ");
    expect(at.get()).toBe(11);
    expect(editor.state.doc.textBetween(1, at.get()!)).toBe("oh, hello ");
    at.dispose();
  });

  it("ignores an insertion AFTER the spot and a selection move", () => {
    const editor = mount();
    const at = trackPos(editor, 4);
    insertTextAt(editor, 10, "!!");
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    expect(at.get()).toBe(4);
    at.dispose();
  });

  it("stays glued to the text BEFORE it when content lands exactly at the spot", () => {
    const editor = mount();
    const at = trackPos(editor, 6); // "hello| world"
    insertTextAt(editor, 6, "XYZ");
    expect(at.get()).toBe(6);
    at.dispose();
  });

  it("is null once the spot itself is deleted (both sides removed)", () => {
    const editor = mount();
    const at = trackPos(editor, 6);
    editor.view.dispatch(editor.state.tr.delete(3, 9));
    expect(at.get()).toBeNull();
    // and stays null — a later insert cannot resurrect a deleted spot
    insertTextAt(editor, 1, "again ");
    expect(at.get()).toBeNull();
    at.dispose();
  });

  it("a whole-document replacement (reload / re-parse) nulls it", () => {
    const editor = mount();
    const at = trackPos(editor, 6);
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "a different paper" }] }],
    });
    expect(at.get()).toBeNull();
    at.dispose();
  });

  it("a deletion that merely ENDS at the spot leaves it at the deletion's edge", () => {
    const editor = mount();
    const at = trackPos(editor, 6); // "hello| world"
    editor.view.dispatch(editor.state.tr.delete(1, 6)); // remove "hello"
    expect(at.get()).toBe(1);
    at.dispose();
  });

  it("subscribes only while live: dispose() unsubscribes and stops following", () => {
    const editor = mount();
    const on = vi.spyOn(editor, "on");
    const off = vi.spyOn(editor, "off");
    const at = trackPos(editor, 7);
    expect(on).toHaveBeenCalledWith("transaction", expect.any(Function));
    const handler = on.mock.calls.find((c) => c[0] === "transaction")![1];
    at.dispose();
    expect(off).toHaveBeenCalledWith("transaction", handler);
    insertTextAt(editor, 1, "oh, ");
    expect(at.get()).toBe(7);
    at.dispose(); // idempotent
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("answers null once its editor is destroyed", () => {
    const editor = mount();
    const at = trackPos(editor, 7);
    editor.destroy();
    expect(at.get()).toBeNull();
    at.dispose();
  });
});

describe("the create popover commits at the TRACKED position (task 1190)", () => {
  function openCreate(editor: Editor, pos: number): AtomCreateSession {
    const setAtomCreateRequest = vi.fn();
    renderHook(() =>
      useMarkerClickBridges({
        prefsRef: { current: { placements: [], activeLeft: "notes", activeRight: "todo" } },
        setActiveLeft: vi.fn(),
        setActiveRight: vi.fn(),
        setActiveHalf: vi.fn(),
        tryScrollOmniEntry: vi.fn(() => true),
        getOmniEnabled: vi.fn(() => new Set()),
        setSelectedFootnoteId: vi.fn(),
        setSelectedCitationId: vi.fn(),
        setSelectedErrorId: vi.fn(),
        setActiveRef: vi.fn(),
        setAtomCreateRequest,
        setActiveMath: vi.fn(),
        setActiveFigure: vi.fn(),
        getActiveCardStore: () => defaultCardStore,
        getActiveDocId: () => "doc-A",
      } as unknown as Parameters<typeof useMarkerClickBridges>[0]),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent(ATOM_CREATE_POPOVER_EVENT, {
          detail: { kind: "citation", rect: new DOMRect(0, 0, 0, 10), pos, editor },
        }),
      );
    });
    expect(setAtomCreateRequest).toHaveBeenCalledTimes(1);
    const session = setAtomCreateRequest.mock.calls[0][0] as AtomCreateSession;
    // No raw number survives into the open state — nothing can read it stale.
    expect("pos" in session).toBe(false);
    return session;
  }

  const ATTRS = { citationId: "cit-1190", command: "\\cite{k}", displayText: "" };

  it("an N-char insert before P while the popover is open lands the atom at P+N", () => {
    const editor = mount();
    const P = 7; // "hello |world"
    const session = openCreate(editor, P);
    insertTextAt(editor, 1, "oh, "); // N = 4
    const at = session.at.get();
    expect(at).toBe(P + 4);
    const landed = insertInlineAtom({ editor, type: "citation", attrs: ATTRS, at: at! });
    expect(landed.refused).toBe(false);
    expect(editor.state.doc.nodeAt(P + 4)?.type.name).toBe("citation");
    // the atom sits before "world" — the text the user invoked at — not 4
    // characters into it
    expect(editor.state.doc.textBetween(P + 5, P + 10)).toBe("world");
    session.at.dispose();
  });

  it("refuses with no doc change once the spot's text was deleted", () => {
    const editor = mount();
    const session = openCreate(editor, 7);
    editor.view.dispatch(editor.state.tr.delete(4, 10));
    const before = editor.state.doc;
    // EditorLayout's commit reads the tracker and refuses on null before any
    // insert — the primitive is never reached with a guessed position.
    expect(session.at.get()).toBeNull();
    expect(editor.state.doc).toBe(before);
    session.at.dispose();
  });
});

// Task 1314: the text-colour popover's stash — a SELECTION range that follows.
describe("trackRange (task 1314)", () => {
  it("an insertion before the range shifts both ends: the pick colours the text that was selected", () => {
    const ed = mount("hello world");
    // "world" = 7..12
    const r = trackRange(ed, 7, 12);
    ed.commands.insertContentAt(1, "abc");
    expect(r.get()).toEqual({ from: 10, to: 15 });
    expect(ed.state.doc.textBetween(10, 15)).toBe("world");
    r.dispose();
  });

  it("text typed exactly at either end lands OUTSIDE the range", () => {
    const ed = mount("hello world");
    const r = trackRange(ed, 7, 12);
    ed.commands.insertContentAt(12, "!");
    ed.commands.insertContentAt(7, "_");
    expect(r.get()).toEqual({ from: 8, to: 13 });
    expect(ed.state.doc.textBetween(8, 13)).toBe("world");
    r.dispose();
  });

  it("is null once the selected text is deleted — the commit refuses rather than colour the live selection", () => {
    const ed = mount("hello world");
    const r = trackRange(ed, 7, 12);
    ed.view.dispatch(ed.state.tr.delete(6, 12));
    expect(r.get()).toBeNull();
    r.dispose();
  });
});
