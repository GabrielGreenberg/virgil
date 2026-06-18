// @vitest-environment jsdom
//
// W4c (SR-C1-01 / SR-F2-01 / SR-F1-02) — the SearchPanel result cursor now
// rides the shared `useCycle` read-clamp instead of a hand-rolled `selectedIdx`
// with manual modular arithmetic. This pins the panel-level wiring (the
// `useCycle` clamp/wrap is proven independently in use-cycle-clamp-wrap.test):
//
//   • the PrevNextCounter reads the CLAMPED cursor, so after the result list
//     shrinks under a selection the header shows "<total> results", never an
//     impossible "N of M" with N > M (SR-C1-01);
//   • Enter cycles forward through every hit and WRAPS at the end (SR-F2-01).

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
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { useState } from "react";
import { Editor, type Content } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import SearchPanel, {
  INITIAL_SEARCH_STATE,
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

// Four paragraphs, each holding one "WIDGET" — four main-text hits.
function makeContent(): Content {
  return {
    type: "doc",
    content: [1, 2, 3, 4].map((n) => ({
      type: "paragraph",
      attrs: { uuid: `uuid-${n}` },
      content: [{ type: "text", text: `Para ${n} has a WIDGET here.` }],
    })),
  };
}

function mount(): { editor: Editor; cleanup: () => void } {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: makeContent(),
  });
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

let editor: Editor;
let teardown: () => void;

beforeEach(() => {
  const m = mount();
  editor = m.editor;
  teardown = m.cleanup;
  return () => { teardown(); cleanup(); };
});

// Mount the panel with a real editor + controlled state, mainText scope only.
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
  // PrevNextCounter renders a single tabular-nums span in the header extras.
  const span = container.querySelector(".tabular-nums");
  return span?.textContent ?? "";
}

function scrollTarget(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!el) throw new Error("scroll container (tabindex=0) not found");
  return el;
}

describe("SearchPanel — result cursor on the useCycle read-clamp (W4c)", () => {
  it("Enter cycles forward and wraps; the counter tracks the cursor", () => {
    const { container } = render(<Harness />);
    // Four matches, no selection yet → "4 results".
    expect(counterText(container)).toBe("4 results");

    const target = scrollTarget(container);
    fireEvent.keyDown(target, { key: "Enter" }); // → 1 of 4
    expect(counterText(container)).toBe("1 of 4");
    fireEvent.keyDown(target, { key: "Enter" }); // → 2 of 4
    fireEvent.keyDown(target, { key: "Enter" }); // → 3 of 4
    fireEvent.keyDown(target, { key: "Enter" }); // → 4 of 4
    expect(counterText(container)).toBe("4 of 4");
    fireEvent.keyDown(target, { key: "Enter" }); // wrap → 1 of 4
    expect(counterText(container)).toBe("1 of 4");
  });

  it("ArrowUp from no selection wraps to the LAST hit", () => {
    const { container } = render(<Harness />);
    fireEvent.keyDown(scrollTarget(container), { key: "ArrowUp" });
    expect(counterText(container)).toBe("4 of 4");
  });

  it("after the result list shrinks under the selection the counter never exceeds total", () => {
    const { container } = render(<Harness />);
    const target = scrollTarget(container);
    // Select the LAST (4th) hit.
    fireEvent.keyDown(target, { key: "ArrowUp" });
    expect(counterText(container)).toBe("4 of 4");

    // Structurally delete two WIDGET-bearing paragraphs (a real edit shrinks
    // the result memo to 2). The cursor (index 3) is now out of range — the
    // useCycle read-clamp resolves it to null, so the counter shows the total
    // only, never "4 of 2".
    act(() => {
      // Delete the last two paragraphs from the end so earlier offsets/uuids
      // are untouched.
      const doc = editor.state.doc;
      const to = doc.content.size;
      // Find the start position of the 3rd paragraph (index 2).
      let from = 0;
      let i = 0;
      doc.forEach((node, offset) => {
        if (i === 2) from = offset;
        i += 1;
      });
      editor.view.dispatch(editor.state.tr.delete(from, to));
    });

    // Re-render so the results memo recomputes against the shrunk doc.
    fireEvent.keyDown(target, { key: "ArrowDown" }); // any interaction re-reads
    const text = counterText(container);
    // Must be a valid "k of 2" with k <= 2, OR the plain total — never k > 2.
    const m = /^(\d+) of (\d+)$/.exec(text);
    if (m) {
      expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2]));
      expect(Number(m[2])).toBe(2);
    } else {
      expect(text).toBe("2 results");
    }
  });
});
