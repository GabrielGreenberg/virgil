// @vitest-environment jsdom
//
// Task 936 — the open-AI-request wash RE-ENTERS with its anchor.
//
// The wash is a decoration that forward-maps between repaints, and repaints
// were keyed only on the DESIRED set (`requestWashKey`: card ids + anchors).
// Deleting the washed paragraph (or a Mode-B span) drops the mapped band;
// Cmd+Z restores the same uuid / anchorId, so the key never changed and the
// wash stayed gone until reload. `useRequestWash` now also repaints when a
// STRUCTURAL emit brings back an anchor the set wants — and only then: a plain
// keystroke wakes nothing.

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { renderHook } from "@testing-library/react";
import { Editor, type Content } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { createLinkedAnchor, type Link } from "@/links/links";
import {
  useRequestWash,
  requestWashAnchorReentered,
  REQUEST_WASH_CHANNEL,
  type RequestWashCardLike,
} from "@/links/_shared/request-wash";
import { transientHighlightKeyFor } from "@/lib/tiptap/transient-highlight";
import { getBus } from "@/lib/tiptap/doc-structure";
import type { BlockEntry, AnchorEntry } from "@/lib/tiptap/doc-structure";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const PARA_UUID = "a1b2";
const OTHER_UUID = "c3d4";
const CARD_ID = "note-abc";
const PARA_TEXT = "The quick brown fox jumps.";
const OTHER_TEXT = "A second, unrelated paragraph.";

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const content: Content = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: PARA_UUID }, content: [{ type: "text", text: PARA_TEXT }] },
      { type: "paragraph", attrs: { uuid: OTHER_UUID }, content: [{ type: "text", text: OTHER_TEXT }] },
    ],
  };
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content,
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

function modeALink(uuid: string): Link {
  return {
    id: `link-${uuid}`,
    kind: "anchor",
    anchor: { type: "textObject", targetKind: "paragraph", textObjectIds: [uuid] },
    target: { type: "card", ref: { kind: "note", id: CARD_ID } },
    createdAt: "",
  };
}

function modeBLink(uuid: string, anchorId: string, snapshot: string): Link {
  return {
    id: `link-b-${uuid}`,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [uuid],
      textRange: { anchorId, textSnapshot: snapshot },
    },
    target: { type: "card", ref: { kind: "note", id: CARD_ID } },
    createdAt: "",
  };
}

function note(over: Partial<RequestWashCardLike> = {}): RequestWashCardLike {
  return { id: CARD_ID, kind: "note", aiRequest: true, links: [modeALink(PARA_UUID)], ...over };
}

function washedText(editor: Editor): string {
  const set = transientHighlightKeyFor(REQUEST_WASH_CHANNEL).getState(editor.state);
  if (!set) return "";
  return set
    .find()
    .map((d) => editor.state.doc.textBetween(d.from, d.to, "\n"))
    .join("");
}

const flush = () => new Promise<void>((r) => queueMicrotask(r));

/** Delete the first top-level block as ONE undoable transaction. */
function deleteFirstBlock(editor: Editor): void {
  const first = editor.state.doc.child(0);
  editor.view.dispatch(editor.state.tr.delete(0, first.nodeSize));
}

function mountHook(editor: Editor, cards: RequestWashCardLike[]) {
  return renderHook(() =>
    useRequestWash(editor as unknown as ReactEditor, cards, true),
  );
}

describe("useRequestWash — the wash re-enters with its anchor (task 936)", () => {
  it("Mode-A: delete the washed paragraph, undo → the wash is back in the same tick", async () => {
    const { editor, cleanup } = mount();
    const cards = [note()];
    const hook = mountHook(editor, cards);
    try {
      expect(washedText(editor)).toBe(PARA_TEXT);

      deleteFirstBlock(editor);
      await flush();
      expect(washedText(editor)).toBe("");

      editor.commands.undo();
      expect(editor.state.doc.child(0).attrs.uuid).toBe(PARA_UUID);
      await flush();
      expect(washedText(editor)).toBe(PARA_TEXT);
    } finally {
      hook.unmount();
      cleanup();
    }
  });

  it("Mode-B: delete the washed span's paragraph, undo → the span's wash is back", async () => {
    const { editor, cleanup } = mount();
    const from = PARA_TEXT.indexOf("quick brown") + 1;
    const rec = createLinkedAnchor(editor, "note", { from, to: from + "quick brown".length }, CARD_ID);
    expect(rec).not.toBeNull();
    const cards = [note({ links: [modeBLink(PARA_UUID, rec!.anchorId, "quick brown")] })];
    const hook = mountHook(editor, cards);
    try {
      expect(washedText(editor)).toBe("quick brown");

      deleteFirstBlock(editor);
      await flush();
      expect(washedText(editor)).toBe("");

      editor.commands.undo();
      await flush();
      expect(washedText(editor)).toBe("quick brown");
    } finally {
      hook.unmount();
      cleanup();
    }
  });

  it("typing wakes nothing: no structural emit, no repaint transaction", async () => {
    const { editor, cleanup } = mount();
    const hook = mountHook(editor, [note()]);
    try {
      const bus = getBus(editor as unknown as ReactEditor)!;
      const emitsBefore = bus.emitCount;
      const metaKey = transientHighlightKeyFor(REQUEST_WASH_CHANNEL);
      let repaints = 0;
      editor.on("transaction", ({ transaction }) => {
        if (transaction.getMeta(metaKey)) repaints++;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 5)),
      );
      for (const ch of "abc") editor.view.dispatch(editor.state.tr.insertText(ch));
      await flush();
      expect(bus.emitCount).toBe(emitsBefore);
      expect(repaints).toBe(0);
      // Region band: the typed text is inside the wash.
      expect(washedText(editor)).toContain("abc");
    } finally {
      hook.unmount();
      cleanup();
    }
  });

  it("an unrelated structural edit (deleting ANOTHER paragraph) does not repaint", async () => {
    const { editor, cleanup } = mount();
    const hook = mountHook(editor, [note()]);
    try {
      const metaKey = transientHighlightKeyFor(REQUEST_WASH_CHANNEL);
      let repaints = 0;
      editor.on("transaction", ({ transaction }) => {
        if (transaction.getMeta(metaKey)) repaints++;
      });
      const firstSize = editor.state.doc.child(0).nodeSize;
      const second = editor.state.doc.child(1);
      editor.view.dispatch(editor.state.tr.delete(firstSize, firstSize + second.nodeSize));
      editor.commands.undo();
      await flush();
      expect(repaints).toBe(0);
      expect(washedText(editor)).toBe(PARA_TEXT);
    } finally {
      hook.unmount();
      cleanup();
    }
  });
});

describe("requestWashAnchorReentered — answered from the diff alone", () => {
  const block = (uuid: string) => ({ uuid }) as unknown as BlockEntry;
  const anchor = (id: string) => ({ id }) as unknown as AnchorEntry;
  const empty = { addedBlocks: [], changedBlocks: [], addedAnchors: [] };

  it("is false for an empty diff and for a set with no open request", () => {
    expect(requestWashAnchorReentered(empty, [note()])).toBe(false);
    expect(
      requestWashAnchorReentered({ ...empty, addedBlocks: [block(PARA_UUID)] }, [note({ aiRequest: false })]),
    ).toBe(false);
  });

  it("matches a restored or MOVED block by uuid, and a restored span by anchorId", () => {
    const cards = [note()];
    expect(requestWashAnchorReentered({ ...empty, addedBlocks: [block(PARA_UUID)] }, cards)).toBe(true);
    expect(requestWashAnchorReentered({ ...empty, changedBlocks: [block(PARA_UUID)] }, cards)).toBe(true);
    expect(requestWashAnchorReentered({ ...empty, addedBlocks: [block(OTHER_UUID)] }, cards)).toBe(false);

    const b = [note({ links: [modeBLink(PARA_UUID, "r-1", "x")] })];
    expect(requestWashAnchorReentered({ ...empty, addedAnchors: [anchor("r-1")] }, b)).toBe(true);
    expect(requestWashAnchorReentered({ ...empty, addedAnchors: [anchor("r-2")] }, b)).toBe(false);
  });
});
