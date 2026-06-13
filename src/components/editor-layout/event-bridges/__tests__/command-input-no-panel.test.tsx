// @vitest-environment jsdom
//
// Pins backlog #2: slash commands no longer hard-open their dedicated panel.
//   - `\ex` (virgil-ex-create): inserts the example + selects it, but does
//     NOT open the Examples panel.
//   - `\footnote` (virgil-footnote-input): inserts the footnote + selects it,
//     but does NOT open the Footnotes panel.
//   - `\cite` (virgil-citation-create): soft-routes the new card into
//     OMNI-VIEW (not the dedicated Citations panel) when the citations side
//     is collapsed/blank, and leaves the side alone when another panel
//     already covers omni.

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { act } from "react";
import { useCommandInputBridges } from "@/components/editor-layout/event-bridges/command-input";
import type { ViewPrefs } from "@/hooks/useViewPrefs";
import type { EditorHandle } from "@/components/Editor";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A minimal fake TipTap editor covering only what the footnote handler uses:
// doc.descendants (to collect existing footnote ids) and the insert chain.
function makeFakeEditor() {
  const chain = {
    focus: () => chain,
    insertContent: () => chain,
    run: () => true,
  };
  return {
    state: {
      selection: { from: 1 },
      doc: { descendants: (_fn: (n: unknown) => boolean) => undefined },
    },
    view: {
      coordsAtPos: () => ({ left: 0, top: 0, bottom: 10, right: 0 }),
    },
    chain: () => chain,
  };
}

function makeDeps(prefsOverrides: Partial<ViewPrefs> = {}) {
  const fakeEditor = makeFakeEditor();
  const insertExample = vi.fn(() => ({ exampleId: "ex1" }));
  const renumberFootnotes = vi.fn();
  const editorHandle = {
    getEditor: () => fakeEditor,
    insertExample,
    renumberFootnotes,
  } as unknown as EditorHandle;

  const prefs = {
    placements: [
      { id: "citations", side: "right" },
      { id: "examples", side: "right" },
      { id: "footnotes", side: "right" },
    ],
    activeLeft: "notes",
    activeRight: null,
    ...prefsOverrides,
  } as unknown as ViewPrefs;

  return {
    deps: {
      editorRef: { current: editorHandle },
      prefsRef: { current: prefs },
      setActiveLeft: vi.fn(),
      setActiveRight: vi.fn(),
      setPendingCitationMode: vi.fn(),
      setPendingCitationCreate: vi.fn(),
      setActiveRefLabel: vi.fn(),
      setActiveRefRect: vi.fn(),
      setSelectedFootnoteId: vi.fn(),
      setSelectedExampleId: vi.fn(),
    },
    insertExample,
    renumberFootnotes,
  };
}

type Deps = ReturnType<typeof makeDeps>["deps"];

function mount(deps: Deps) {
  return renderHook(() =>
    useCommandInputBridges(deps as Parameters<typeof useCommandInputBridges>[0]),
  );
}

function dispatch(name: string, detail?: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  });
}

describe("\\ex (virgil-ex-create): inserts + selects, no panel open", () => {
  it("inserts the example and selects it but never opens a panel", () => {
    const { deps, insertExample } = makeDeps();
    mount(deps);
    dispatch("virgil-ex-create");

    expect(insertExample).toHaveBeenCalledWith("single");
    expect(deps.setSelectedExampleId).toHaveBeenCalledWith("ex1");
    expect(deps.setActiveLeft).not.toHaveBeenCalled();
    expect(deps.setActiveRight).not.toHaveBeenCalled();
  });
});

describe("\\footnote (virgil-footnote-input): inserts + selects, no panel open", () => {
  it("inserts the footnote and selects it but never opens a panel", () => {
    const { deps, renumberFootnotes } = makeDeps();
    mount(deps);
    dispatch("virgil-footnote-input");

    expect(renumberFootnotes).toHaveBeenCalledTimes(1);
    expect(deps.setSelectedFootnoteId).toHaveBeenCalledTimes(1);
    expect(deps.setActiveLeft).not.toHaveBeenCalled();
    expect(deps.setActiveRight).not.toHaveBeenCalled();
  });
});

describe("\\cite (virgil-citation-create): soft-routes to omni, not the Citations panel", () => {
  it("opens OMNI on the citations side when that side is collapsed (null)", () => {
    const { deps } = makeDeps({ activeRight: null } as unknown as Partial<ViewPrefs>);
    mount(deps);
    dispatch("virgil-citation-create", { partial: "\\cite", citationId: "c1" });

    expect(deps.setActiveRight).toHaveBeenCalledWith("omni");
    expect(deps.setActiveRight).not.toHaveBeenCalledWith("citations");
    expect(deps.setActiveLeft).not.toHaveBeenCalled();
  });

  it("opens OMNI when the citations side is blank", () => {
    const { deps } = makeDeps({ activeRight: "blank" } as unknown as Partial<ViewPrefs>);
    mount(deps);
    dispatch("virgil-citation-create", { partial: "\\cite", citationId: "c1" });

    expect(deps.setActiveRight).toHaveBeenCalledWith("omni");
  });

  it("leaves the side ALONE when another panel already covers omni", () => {
    const { deps } = makeDeps({ activeRight: "todo" } as unknown as Partial<ViewPrefs>);
    mount(deps);
    dispatch("virgil-citation-create", { partial: "\\cite", citationId: "c1" });

    expect(deps.setActiveRight).not.toHaveBeenCalled();
    expect(deps.setActiveLeft).not.toHaveBeenCalled();
  });

  it("respects a LEFT dock placement for the citations panel", () => {
    const { deps } = makeDeps({
      placements: [{ id: "citations", side: "left" }],
      activeLeft: null,
    } as unknown as Partial<ViewPrefs>);
    mount(deps);
    dispatch("virgil-citation-create", { partial: "\\cite", citationId: "c1" });

    expect(deps.setActiveLeft).toHaveBeenCalledWith("omni");
    expect(deps.setActiveRight).not.toHaveBeenCalled();
  });
});
