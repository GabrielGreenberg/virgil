// @vitest-environment jsdom
//
// Task 700 — a highlight card displays the passage as it reads NOW.
//
// `HighlightCard` rendered `textRange.textSnapshot`, which is written only at
// create / re-anchor. The snapshot is the RECOVERY key `reanchorByText`
// searches with when the mark is lost — never display text — so an edit inside
// a highlight never reached its card (across reloads too), and a highlight the
// snapshot rung relocated to Mode-A read "empty highlight" while anchored.
//
// Pins:
//   1. `readLinkedAnchorText` reads the live marked words, bounded by the
//      DocStructure snapshot's mapped range, in the create path's currency.
//   2. `useLinkedAnchorText` follows an edit INSIDE the passage, and typing
//      leaves the bus `emitCount` flat (keystroke sanctity).
//   3. The real `HighlightCard` shows the live words, and a Mode-A-relocated
//      highlight shows its stored words instead of "empty highlight".
//   4. The load reconcile REFRESHES a stale `textSnapshot` from the live mark
//      (the chosen cadence: once per doc-open) and is idempotent.
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure/bus";
import { readLinkedAnchorText } from "@/lib/linked-anchor-range";
import { useLinkedAnchorText } from "@/links/_shared/useLinkedAnchorText";
import { EditorRefProvider } from "@/components/editor-layout/contexts/editor-ref";
import { HighlightCard } from "@/panels/Notes/HighlightCard";
import type { HighlightCard as HighlightCardData } from "@/lib/types";
import type { Link } from "@/links/_shared/types";
import { reconcileCardToResolved, type CardAnchorResolution } from "@/links/resolve-card-anchor";

afterEach(cleanup);

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

const ANCHOR = "hl-anchor-1";

/** "Intro alpha beta outro." with a linkedAnchor over "alpha beta". */
function mountHighlighted(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { uuid: "p0" }, content: [{ type: "text", text: "Other paragraph." }] },
        { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Intro alpha beta outro." }] },
      ],
    },
  });
  const { from, to } = findWords(editor, "alpha beta");
  const mark = editor.state.schema.marks.linkedAnchor.create({ anchorId: ANCHOR, kind: "highlight" });
  editor.view.dispatch(editor.state.tr.addMark(from, to, mark));
  return editor;
}

function findWords(editor: Editor, words: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const i = (node.text ?? "").indexOf(words);
    if (i >= 0) found = { from: pos + i, to: pos + i + words.length };
    return false;
  });
  if (!found) throw new Error(`no "${words}"`);
  return found;
}

/** Edit INSIDE the highlight, "alpha beta" → "alpha gamma": replace "bet"
 *  with "gamm", keeping the marked trailing "a" — the typed text inherits the
 *  mark exactly as a keystroke inside the passage does. */
function editInsideHighlight(editor: Editor) {
  const { from } = findWords(editor, "beta");
  editor.view.dispatch(editor.state.tr.insertText("gamm", from, from + 3));
}

function highlightCard(links: Link[]): HighlightCardData {
  return {
    kind: "highlight",
    id: "h1",
    createdAt: "2026-09-21",
    aiRequest: false,
    links,
  } as unknown as HighlightCardData;
}

function modeBLink(snapshot: string): Link {
  return {
    id: ANCHOR,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: ["p1"],
      textRange: { anchorId: ANCHOR, textSnapshot: snapshot },
    },
    target: { type: "card", ref: { kind: "highlight", id: "h1" } },
    createdAt: "",
  } as Link;
}

function wrapperFor(editor: Editor) {
  const value = {
    editorInstance: editor as unknown as ReactEditor,
    editorRef: { current: null },
    setOverrideEditor: () => {},
  };
  return ({ children }: { children: ReactNode }) => (
    <EditorRefProvider value={value}>{children}</EditorRefProvider>
  );
}

describe("task 700 — live highlight text", () => {
  it("readLinkedAnchorText reads the live marked words, bounded by the structure range", () => {
    const editor = mountHighlighted();
    const entry = getBus(editor)!.structure.anchors.get(ANCHOR)!;
    expect(entry).toBeTruthy();
    expect(readLinkedAnchorText(editor.state.doc, ANCHOR, entry)).toBe("alpha beta");
    editInsideHighlight(editor);
    const mapped = getBus(editor)!.structure.anchors.get(ANCHOR)!;
    expect(readLinkedAnchorText(editor.state.doc, ANCHOR, mapped)).toBe("alpha gamma");
    // Unbounded read agrees.
    expect(readLinkedAnchorText(editor.state.doc, ANCHOR)).toBe("alpha gamma");
    expect(readLinkedAnchorText(editor.state.doc, "nope")).toBeNull();
    editor.destroy();
  });

  it("useLinkedAnchorText follows an edit inside the passage; typing leaves emitCount flat", () => {
    const editor = mountHighlighted();
    const { result } = renderHook(() => useLinkedAnchorText(ANCHOR), { wrapper: wrapperFor(editor) });
    expect(result.current).toBe("alpha beta");

    const before = getBus(editor)!.emitCount;
    act(() => editInsideHighlight(editor));
    expect(result.current).toBe("alpha gamma");

    // Plain typing elsewhere: no structural emit, text unchanged.
    act(() => {
      const { to } = findWords(editor, "Other paragraph");
      editor.view.dispatch(editor.state.tr.insertText("xyz", to));
    });
    expect(result.current).toBe("alpha gamma");
    expect(getBus(editor)!.emitCount).toBe(before);
    editor.destroy();
  });

  it("the HighlightCard body shows the LIVE words, not the frozen snapshot", () => {
    const editor = mountHighlighted();
    const card = highlightCard([modeBLink("alpha beta")]);
    const { container } = render(
      <HighlightCard
        card={card}
        selected={false}
        onSetAiRequest={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />,
      { wrapper: wrapperFor(editor) },
    );
    expect(container.textContent).toContain("alpha beta");
    act(() => editInsideHighlight(editor));
    expect(container.textContent).toContain("alpha gamma");
    expect(container.textContent).not.toContain("alpha beta");
    editor.destroy();
  });

  it("a Mode-A-relocated highlight shows its stored words, not 'empty highlight'", () => {
    const card = highlightCard([
      {
        id: "h1@p1",
        kind: "anchor",
        anchor: {
          type: "textObject",
          targetKind: "paragraph",
          textObjectIds: ["p1"],
          paragraphSnapshot: "alpha beta",
        },
        target: { type: "card", ref: { kind: "highlight", id: "h1" } },
        createdAt: "",
      } as Link,
    ]);
    const { container } = render(
      <HighlightCard
        card={card}
        selected={false}
        onSetAiRequest={() => {}}
        onDelete={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(container.textContent).toContain("alpha beta");
    expect(container.textContent).not.toContain("empty highlight");
  });

  it("the load reconcile refreshes a stale textSnapshot from the live mark, idempotently", () => {
    const card = highlightCard([modeBLink("alpha beta")]);
    const res: CardAnchorResolution = { paragraphId: "p1", mode: "B", source: "mark", linkIndex: 0 };
    const first = reconcileCardToResolved(card, res, { liveMarkText: "alpha gamma" });
    expect(first.changed).toBe(true);
    const link = first.card.links[0];
    expect(link.anchor.type === "textObject" && link.anchor.textRange?.textSnapshot).toBe("alpha gamma");
    const second = reconcileCardToResolved(first.card, res, { liveMarkText: "alpha gamma" });
    expect(second.changed).toBe(false);
    // An empty live read never overwrites; no opts is the old no-op.
    expect(reconcileCardToResolved(card, res, { liveMarkText: "" }).changed).toBe(false);
    expect(reconcileCardToResolved(card, res).changed).toBe(false);
  });
});
