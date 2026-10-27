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
//   2. `useLinkedAnchorPassage` follows an edit INSIDE the passage, and typing
//      leaves the bus `emitCount` flat (keystroke sanctity).
//   3. The real `HighlightCard` shows the live words, and a Mode-A-relocated
//      highlight shows its stored words instead of "empty highlight".
//   4. (task 1324) The card quotes the RICH live slice: inline atoms
//      (citation, inline math) and marks survive in the expanded quote and
//      the collapsed cue, and the 80×lines clamp exists once.
//   5. The load reconcile REFRESHES a stale `textSnapshot` from the live mark
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
import { useLinkedAnchorPassage } from "@/links/_shared/useLinkedAnchorPassage";
import { clampCompressedText, makeCompressedSummary } from "@/components/panel-primitives";
import { capturedPassageOneLine } from "@/panels/_shared/captured-passage";
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

  it("useLinkedAnchorPassage follows an edit inside the passage; typing leaves emitCount flat", () => {
    const editor = mountHighlighted();
    const { result } = renderHook(() => useLinkedAnchorPassage(ANCHOR)?.text ?? null, { wrapper: wrapperFor(editor) });
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

/** "Intro alpha <em>beta</em> \\citep{k} $x$ gamma outro." with a linkedAnchor
 *  over "alpha … gamma" — the passage holds a mark and two inline atoms. */
function mountRichHighlighted(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p1" },
          content: [
            { type: "text", text: "Intro alpha " },
            { type: "text", text: "beta", marks: [{ type: "italic" }] },
            { type: "text", text: " " },
            { type: "citation", attrs: { command: "citep", displayText: "Smith 2020", citationId: "c1" } },
            { type: "text", text: " " },
            { type: "inlineMath", attrs: { latex: "x" } },
            { type: "text", text: " gamma outro." },
          ],
        },
      ],
    },
  });
  const from = findWords(editor, "alpha").from;
  const to = findWords(editor, "gamma").to;
  const mark = editor.state.schema.marks.linkedAnchor.create({ anchorId: ANCHOR, kind: "highlight" });
  editor.view.dispatch(editor.state.tr.addMark(from, to, mark));
  return editor;
}

describe("task 1324 — a highlight quotes its passage with atoms and marks", () => {
  it("the live passage keeps the citation, the math and the italic; the plain key stays textBetween", () => {
    const editor = mountRichHighlighted();
    const { result } = renderHook(() => useLinkedAnchorPassage(ANCHOR), { wrapper: wrapperFor(editor) });
    const live = result.current!;
    // Recovery currency unchanged (task 700): atoms contribute nothing.
    expect(live.text).toBe("alpha beta   gamma");
    const json = JSON.stringify(live.content);
    expect(json).toContain('"citation"');
    expect(json).toContain('"inlineMath"');
    expect(json).toContain('"italic"');
    // The doc-only anchor mark never reaches a card body.
    expect(json).not.toContain("linkedAnchor");
    // The collapsed projection reads the citation's display text.
    expect(capturedPassageOneLine({ latex: live.text, content: live.content })).toBe(
      "alpha beta Smith 2020 $x$ gamma",
    );
    editor.destroy();
  });

  it("typing in the block OUTSIDE the mark keeps the same passage object (no re-render, no re-capture)", () => {
    const editor = mountRichHighlighted();
    const { result } = renderHook(() => useLinkedAnchorPassage(ANCHOR), { wrapper: wrapperFor(editor) });
    const first = result.current;
    const before = getBus(editor)!.emitCount;
    act(() => {
      const { to } = findWords(editor, "outro");
      editor.view.dispatch(editor.state.tr.insertText("zz", to));
    });
    expect(result.current).toBe(first);
    expect(getBus(editor)!.emitCount).toBe(before);
    editor.destroy();
  });

  it("the collapsed cue and the expanded quote both show every word, and an edit inside reaches both", () => {
    const editor = mountRichHighlighted();
    const card = highlightCard([modeBLink("alpha beta   gamma")]);
    const props = {
      card,
      selected: false,
      onSetAiRequest: () => {},
      onDelete: () => {},
      onSelect: () => {},
    };
    const collapsed = render(<HighlightCard {...props} />, { wrapper: wrapperFor(editor) });
    expect(collapsed.container.textContent).toContain("alpha beta Smith 2020 $x$ gamma");
    collapsed.unmount();

    const expanded = render(<HighlightCard {...props} isPoppedOut />, { wrapper: wrapperFor(editor) });
    const passage = expanded.container.querySelector(".captured-passage")!;
    expect(passage).toBeTruthy();
    expect(passage.querySelector("em")?.textContent).toBe("beta");
    expect(passage.textContent).toContain("Smith 2020");
    expect(passage.textContent).toContain("gamma");
    act(() => {
      const { from } = findWords(editor, "gamma");
      editor.view.dispatch(editor.state.tr.insertText("delt", from, from + 4));
    });
    expect(passage.isConnected ? passage.textContent : expanded.container.textContent).toContain("delta");
    expect(expanded.container.textContent).not.toContain("gamma");
    editor.destroy();
  });

  it("one compressed clamp: makeCompressedSummary and the highlight cue share the budget and ellipsis rule", () => {
    const long = "word ".repeat(40).trim();
    const viaSummary = makeCompressedSummary(
      { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: long }] }] },
      1,
    );
    expect(viaSummary).toBe(clampCompressedText(long, 1));
    expect(viaSummary.endsWith("…")).toBe(true);
    expect(viaSummary.length).toBeLessThanOrEqual(81);
    expect(clampCompressedText("short", 1)).toBe("short");
  });
});
