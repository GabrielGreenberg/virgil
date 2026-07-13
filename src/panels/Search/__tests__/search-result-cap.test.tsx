// @vitest-environment jsdom
//
// Task 119 — the rendered result list is BOUNDED while the counter keeps the
// TRUE total. A short query on a long doc can match tens of thousands of
// times; mounting every hit as a ResultCard froze the panel for seconds. Now
// at most MAX_RENDERED_RESULTS cards mount, an overflow note names what's
// hidden, and PrevNextCounter still reports the full hit count.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Storage stub (the editor extension stack pulls @/lib/storage transitively).
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
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

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??=
  ResizeObserverStub;

import { render, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import SearchPanel, {
  INITIAL_SEARCH_STATE,
  MAX_RENDERED_RESULTS,
  type SearchPanelState,
} from "@/panels/Search/SearchPanel";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

// More WIDGET-bearing paragraphs than the render cap.
const OVERFLOW = 50;
const TOTAL = MAX_RENDERED_RESULTS + OVERFLOW;

function makeContent(): Content {
  return {
    type: "doc",
    content: Array.from({ length: TOTAL }, (_, n) => ({
      type: "paragraph",
      attrs: { uuid: `uuid-${n}` },
      content: [{ type: "text", text: `Para ${n} has a WIDGET here.` }],
    })),
  };
}

let editor: Editor;
let teardown: () => void;

beforeEach(() => {
  const element = document.createElement("div");
  document.body.appendChild(element);
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  teardown = () => {
    editor.destroy();
    element.remove();
  };
  return () => {
    teardown();
    cleanup();
  };
});

function Harness() {
  const [state, setState] = useState<SearchPanelState>({
    ...INITIAL_SEARCH_STATE,
    query: "WIDGET",
    enabledScopes: ["mainText"],
  });
  return (
    <SearchPanel
      editor={editor}
      onHighlightRange={vi.fn()}
      footnotes={[]}
      orphanedFootnotes={[]}
      notes={[]}
      citations={[]}
      editorCitations={[]}
      getCitationDisplayText={(c) => c}
      todos={[]}
      archiveSnippets={[]}
      cutterCards={[]}
      reportCards={[]}
      comments={[]}
      bibEntries={[]}
      onOpenItem={vi.fn()}
      state={state}
      onStateChange={setState}
    />
  );
}

function counterText(container: HTMLElement): string {
  const span = container.querySelector(".tabular-nums");
  return span?.textContent ?? "";
}

describe("task 119 — bounded render, true total", () => {
  it(`mounts at most ${MAX_RENDERED_RESULTS} cards for ${TOTAL} hits`, () => {
    const { container } = render(<Harness />);
    const cards = container.querySelectorAll("[data-result-idx]");
    expect(cards.length).toBe(MAX_RENDERED_RESULTS);
  });

  it("the counter reports the TRUE total, not the rendered count", () => {
    const { container } = render(<Harness />);
    expect(counterText(container)).toBe(`${TOTAL} results`);
  });

  it("an overflow note names the shown and total counts", () => {
    const { container } = render(<Harness />);
    expect(container.textContent).toContain(
      `Showing the first ${MAX_RENDERED_RESULTS} of ${TOTAL} results`,
    );
  });

  it("Enter selects within the displayed window; the counter keeps the true total", () => {
    const { container } = render(<Harness />);
    const target = container.querySelector<HTMLElement>('[tabindex="0"]');
    if (!target) throw new Error("scroll container not found");
    fireEvent.keyDown(target, { key: "Enter" });
    expect(counterText(container)).toBe(`1 of ${TOTAL}`);
  });

  it("under the cap, every hit renders and no overflow note shows", () => {
    // Shrink the doc to 3 paragraphs — the note must disappear.
    const doc = editor.state.doc;
    let from = 0;
    let i = 0;
    doc.forEach((node, offset) => {
      if (i === 3) from = offset;
      i += 1;
    });
    editor.view.dispatch(editor.state.tr.delete(from, doc.content.size));

    const { container } = render(<Harness />);
    expect(container.querySelectorAll("[data-result-idx]").length).toBe(3);
    expect(counterText(container)).toBe("3 results");
    expect(container.textContent).not.toContain("Showing the first");
  });
});
