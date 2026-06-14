// @vitest-environment jsdom
//
// Pins backlog #2: slash commands no longer hard-open their dedicated panel.
//   - `\ex` (virgil-ex-create): inserts the example + selects it, but does
//     NOT open the Examples panel.
//   - `\footnote` (virgil-footnote-input): inserts the footnote + selects it,
//     but does NOT open the Footnotes panel.
//
// CITATION MOVED (CHIP 4a-ii): `\cite` no longer rides the
// `virgil-citation-create` event through this hook — it migrated to the
// action-registry bridge (`runAction("citation", …)` → `citation.run`), which
// now OWNS the same backlog-#2 soft-route. Those soft-route assertions live in
// `src/lib/actions/__tests__/citation-cross-surface.test.ts` (section 7),
// driven against the REAL `commands.ts` / `citation.ts` PM surfaces. Here we
// keep only the remaining event-bridge surfaces (`\ex`, `\footnote`) and add a
// tombstone proving `virgil-citation-create` is inert through this hook.

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

  // Citation deps (prefsRef / setActive* / setPendingCitation*) were removed
  // from this hook in CHIP 4a-ii (citation migrated to the bridge). The `prefs`
  // fixture is unused now but kept to document the panel layout the surfaces
  // would see.
  void prefs;
  return {
    deps: {
      editorRef: { current: editorHandle },
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
  });
});

describe("\\footnote (virgil-footnote-input): inserts + selects, no panel open", () => {
  it("inserts the footnote and selects it but never opens a panel", () => {
    const { deps, renumberFootnotes } = makeDeps();
    mount(deps);
    dispatch("virgil-footnote-input");

    expect(renumberFootnotes).toHaveBeenCalledTimes(1);
    expect(deps.setSelectedFootnoteId).toHaveBeenCalledTimes(1);
  });
});

describe("\\cite (virgil-citation-create): MIGRATED off this hook (CHIP 4a-ii)", () => {
  it("dispatching the legacy event through this hook is now a no-op (no listener)", () => {
    const { deps, insertExample, renumberFootnotes } = makeDeps();
    mount(deps);
    // The hook no longer binds `virgil-citation-create`; firing it must not
    // throw and must not collaterally trigger the other surfaces. (The real
    // citation routing now goes through the action-registry bridge — proven in
    // citation-cross-surface.test.ts.)
    expect(() =>
      dispatch("virgil-citation-create", { partial: "\\cite", citationId: "c1" }),
    ).not.toThrow();
    expect(insertExample).not.toHaveBeenCalled();
    expect(renumberFootnotes).not.toHaveBeenCalled();
    expect(deps.setSelectedFootnoteId).not.toHaveBeenCalled();
    expect(deps.setSelectedExampleId).not.toHaveBeenCalled();
  });
});
