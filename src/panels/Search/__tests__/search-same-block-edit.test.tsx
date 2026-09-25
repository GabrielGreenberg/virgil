// @vitest-environment jsdom
//
// Task 759 — main-text search results must track the document.
//
// 1. Click-time validation: `{blockUuid, offset}` survives edits in EARLIER
//    blocks (search-live-position.test.ts) but not an edit inside the SAME
//    block before the match. The click must highlight the matched characters
//    (re-found in the block) or nothing — never other text.
// 2. Settled refresh: the results memo keys on a settle revision, so a new
//    occurrence typed with the panel open is listed after the typing pause —
//    and NOT before it (the search is O(doc); keystroke sanctity).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Editor, type Content } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { compileQuery, SCOPE_ORDER, type SearchHit } from "@/lib/search-sources";
import SearchPanel, {
  INITIAL_SEARCH_STATE,
  searchMainText,
  resolveAnchoredHighlight,
  followSelectedHit,
} from "@/panels/Search/SearchPanel";
import { useDocSettledRevision, DOC_SETTLE_MS } from "@/hooks/useDocSettledRevision";
import { render as rtlRender, cleanup as rtlCleanup } from "@testing-library/react";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function content(text: string): Content {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Intro." }] },
      { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text }] },
    ],
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.useRealTimers();
});

function mount(text: string): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: content(text),
  });
  cleanups.push(() => {
    editor.destroy();
    element.remove();
  });
  // Warm the bus snapshot (it seeds empty until the first emit).
  editor.view.dispatch(editor.state.tr.insertText(" ", editor.state.doc.content.size - 1));
  return editor;
}

/** Position of the first occurrence of `needle` inside block p2. */
function posInP2(editor: Editor, needle: string): number {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.attrs?.uuid === "p2") {
      at = pos + 1 + node.textContent.indexOf(needle);
      return false;
    }
    return true;
  });
  return at;
}

function click(editor: Editor, hit: SearchHit, re: RegExp) {
  return resolveAnchoredHighlight(
    editor as unknown as ReactEditor,
    hit.blockId!,
    { from: hit.from, to: hit.to },
    { re, match: hit.match },
  );
}

describe("resolveAnchoredHighlight — same-block edits (task 759)", () => {
  it("an insertion before the match in its own block still highlights the match", () => {
    const editor = mount("the cat sat");
    const re = compileQuery("cat", { caseSensitive: false, wholeWord: false })!;
    const [hit] = searchMainText(editor as unknown as ReactEditor, re);

    editor.view.dispatch(editor.state.tr.insertText("big ", posInP2(editor, "cat")));
    expect(editor.state.doc.textBetween(hit.from, hit.to)).not.toBe("cat");

    const range = click(editor, hit, re)!;
    expect(range).not.toBeNull();
    expect(editor.state.doc.textBetween(range.from, range.to)).toBe("cat");
  });

  it("a shortening edit before the match still lands on the match", () => {
    const editor = mount("a very long lead then cat");
    const re = compileQuery("cat", { caseSensitive: true, wholeWord: false })!;
    const [hit] = searchMainText(editor as unknown as ReactEditor, re);

    const from = posInP2(editor, "very long ");
    editor.view.dispatch(editor.state.tr.delete(from, from + "very long ".length));

    const range = click(editor, hit, re)!;
    expect(editor.state.doc.textBetween(range.from, range.to)).toBe("cat");
  });

  it("returns null when the match itself was deleted — never other characters", () => {
    const editor = mount("the cat sat");
    const re = compileQuery("cat", { caseSensitive: false, wholeWord: false })!;
    const [hit] = searchMainText(editor as unknown as ReactEditor, re);

    const from = posInP2(editor, "cat");
    editor.view.dispatch(editor.state.tr.delete(from, from + 3));

    expect(click(editor, hit, re)).toBeNull();
  });

  it("picks the occurrence nearest the old offset when several survive", () => {
    const editor = mount("cat one, cat two");
    const re = compileQuery("cat", { caseSensitive: false, wholeWord: false })!;
    const hits = searchMainText(editor as unknown as ReactEditor, re);
    const second = hits[1];

    editor.view.dispatch(editor.state.tr.insertText("XX", posInP2(editor, "cat")));

    const range = click(editor, second, re)!;
    expect(editor.state.doc.textBetween(range.from, range.to + 4)).toBe("cat two");
  });

  it("an untouched block resolves to the unchanged live range (fast path)", () => {
    const editor = mount("the cat sat");
    const re = compileQuery("cat", { caseSensitive: false, wholeWord: false })!;
    const [hit] = searchMainText(editor as unknown as ReactEditor, re);
    expect(click(editor, hit, re)).toEqual({ from: hit.from, to: hit.to });
  });
});

describe("followSelectedHit (task 759)", () => {
  const hit = (offset: number, match = "cat"): SearchHit => ({
    scope: "mainText",
    from: 10 + offset,
    to: 13 + offset,
    before: "",
    match,
    after: "",
    field: "body",
    blockId: { blockUuid: "p2", offset, length: 3 },
  });

  it("follows the same-identity hit nearest its old offset", () => {
    expect(followSelectedHit([hit(0), hit(9), hit(30)], hit(5))).toBe(1);
  });

  it("returns null when no same-identity hit survives", () => {
    expect(followSelectedHit([hit(0, "dog")], hit(0))).toBeNull();
  });
});

describe("useDocSettledRevision — the refresh edge (task 759)", () => {
  function Probe({
    editor,
    enabled,
    onRender,
  }: {
    editor: Editor;
    enabled: boolean;
    onRender: (rev: number) => void;
  }) {
    onRender(useDocSettledRevision(editor as unknown as ReactEditor, { enabled }));
    return null;
  }

  function render(editor: Editor, enabled: boolean) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const out = { rev: 0, renders: 0 };
    let root: Root;
    act(() => {
      root = createRoot(host);
      root.render(
        <Probe
          editor={editor}
          enabled={enabled}
          onRender={(rev) => {
            out.rev = rev;
            out.renders++;
          }}
        />,
      );
    });
    cleanups.push(() => {
      act(() => root.unmount());
      host.remove();
    });
    return out;
  }

  function type(editor: Editor, text: string) {
    for (const ch of text) {
      act(() => {
        editor.view.dispatch(editor.state.tr.insertText(ch, posInP2(editor, "sat")));
      });
    }
  }

  it("bumps ONCE after a typing burst settles, and never inside the burst", () => {
    const editor = mount("the cat sat");
    vi.useFakeTimers();
    const out = render(editor, true);
    const renders0 = out.renders;

    type(editor, "cat ");
    // Mid-burst: no revision, no re-render — the O(doc) search cannot run.
    expect(out.rev).toBe(0);
    expect(out.renders).toBe(renders0);
    act(() => void vi.advanceTimersByTime(DOC_SETTLE_MS - 1));
    expect(out.rev).toBe(0);

    act(() => void vi.advanceTimersByTime(1));
    expect(out.rev).toBe(1);

    // And the settled search now sees the newly typed occurrence.
    const re = compileQuery("cat", { caseSensitive: false, wholeWord: false })!;
    expect(searchMainText(editor as unknown as ReactEditor, re)).toHaveLength(2);
  });

  it("subscribes to nothing when disabled (empty query)", () => {
    const editor = mount("the cat sat");
    vi.useFakeTimers();
    const out = render(editor, false);
    type(editor, "x");
    act(() => void vi.advanceTimersByTime(DOC_SETTLE_MS * 2));
    expect(out.rev).toBe(0);
  });

  it("a structural edit (a new block) also settles into a bump", () => {
    const editor = mount("the cat sat");
    vi.useFakeTimers();
    const out = render(editor, true);
    act(() => {
      const end = editor.state.doc.content.size;
      editor.view.dispatch(
        editor.state.tr.insert(
          end,
          editor.schema.nodes.paragraph.create(
            { uuid: "p3" },
            editor.schema.text("another cat"),
          ),
        ),
      );
    });
    act(() => void vi.advanceTimersByTime(DOC_SETTLE_MS));
    expect(out.rev).toBe(1);
  });
});

// ── Panel-level: the list reflects the document within one settle ──────────

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

describe("SearchPanel — settled refresh (task 759)", () => {
  const EMPTY: never[] = [];
  const noop = () => {};
  const ident = (c: string) => c;

  function counter(container: HTMLElement): string {
    return container.querySelector(".tabular-nums")?.textContent ?? "";
  }

  it("lists a newly typed occurrence after the settle edge, not before", () => {
    const editor = mount("the cat sat");
    vi.useFakeTimers();
    const state = { ...INITIAL_SEARCH_STATE, query: "cat", enabledScopes: ["mainText" as const] };
    const { container } = rtlRender(
      <SearchPanel
        editor={editor as unknown as ReactEditor}
        onHighlightRange={noop}
        footnotes={EMPTY}
        orphanedFootnotes={EMPTY}
        notes={EMPTY}
        citations={EMPTY}
        editorCitations={EMPTY}
        getCitationDisplayText={ident}
        todos={EMPTY}
        archiveSnippets={EMPTY}
        cutterCards={EMPTY}
        reportCards={EMPTY}
        comments={EMPTY}
        bibEntries={EMPTY}
        onOpenItem={noop}
        availableScopes={SCOPE_ORDER}
        state={state}
        onStateChange={noop}
      />,
    );
    cleanups.push(() => rtlCleanup());
    expect(counter(container)).toBe("1 results");

    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(" cat", posInP2(editor, "sat") + 3));
    });
    expect(counter(container)).toBe("1 results");

    act(() => void vi.advanceTimersByTime(DOC_SETTLE_MS));
    expect(counter(container)).toBe("2 results");

    // And a deleted match drops out on the next settle.
    act(() => {
      const from = posInP2(editor, "cat");
      editor.view.dispatch(editor.state.tr.delete(from, from + 3));
    });
    act(() => void vi.advanceTimersByTime(DOC_SETTLE_MS));
    expect(counter(container)).toBe("1 results");
  });
});
