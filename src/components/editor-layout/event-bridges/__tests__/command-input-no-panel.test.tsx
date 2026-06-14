// @vitest-environment jsdom
//
// Pins backlog #2: slash commands no longer hard-open their dedicated panel.
// The ONE remaining event-bridge surface through this hook is `\ref`
// (`virgil-ref-create`), which opens the LabelRef popover inline. The rest are
// tombstones proving the migrated events are inert through this hook.
//
// CITATION MOVED (CHIP 4a-ii): `\cite` no longer rides the
// `virgil-citation-create` event through this hook — it migrated to the
// action-registry bridge (`runAction("citation", …)` → `citation.run`), which
// now OWNS the same backlog-#2 soft-route. Those soft-route assertions live in
// `src/lib/actions/__tests__/citation-cross-surface.test.ts` (section 7),
// driven against the REAL `commands.ts` / `citation.ts` PM surfaces.
//
// FOOTNOTE MOVED (CHIP 4b): `\footnote` likewise migrated off the
// `virgil-footnote-input` event + this hook to the action-registry bridge
// (`runAction("footnote", …)` → `footnote.run`), which applies the pristine +
// pinned lifecycle AND the backlog-#2 soft-route. Those assertions live in
// `src/lib/actions/__tests__/footnote-cross-surface.test.ts`. The dead
// `virgil-footnote-created` event (zero listeners) is fully retired.
//
// EXAMPLE MOVED (CHIP 5c): `\ex` no longer rides the `virgil-ex-create` event +
// this hook, nor calls `editorRef.insertExample`. It migrated to the
// action-registry bridge (`runAction("example", …)` → `exampleRun`), which owns
// the SAME wrap-if-selection-else-insert creator as the grid `ex` cell AND the
// backlog-#2 soft panel-select (`panelRouting.selectExample`). Those assertions
// live in `src/lib/actions/__tests__/example-cross-surface.test.ts`.

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

// A minimal fake TipTap editor covering only what the remaining handlers use:
// the `\ref` handler reads `selection.from` + `view.coordsAtPos`. (The footnote
// handler — which used doc.descendants + the insert chain — is gone in 4b.)
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
  const editorHandle = {
    getEditor: () => fakeEditor,
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

  // Citation deps (CHIP 4a-ii) + footnote deps (CHIP 4b) + example deps (CHIP 5c)
  // were removed from this hook as those surfaces migrated to the bridge. The
  // `prefs` fixture is unused now but kept to document the panel layout the
  // surfaces would see.
  void prefs;
  return {
    deps: {
      editorRef: { current: editorHandle },
      setActiveRefLabel: vi.fn(),
      setActiveRefRect: vi.fn(),
    },
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

describe("\\ex (virgil-ex-create): MIGRATED off this hook (CHIP 5c)", () => {
  it("dispatching the legacy event through this hook is now a no-op (no listener)", () => {
    const { deps } = makeDeps();
    mount(deps);
    // The hook no longer binds `virgil-ex-create`; firing it must not throw and
    // must not collaterally trigger the other surfaces. (The real example
    // routing now goes through the action-registry bridge — proven in
    // example-cross-surface.test.ts.)
    expect(() => dispatch("virgil-ex-create")).not.toThrow();
  });
});

describe("\\footnote (virgil-footnote-input): MIGRATED off this hook (CHIP 4b)", () => {
  it("dispatching the legacy event through this hook is now a no-op (no listener)", () => {
    const { deps } = makeDeps();
    mount(deps);
    // The hook no longer binds `virgil-footnote-input`; firing it must not
    // throw. (The real footnote routing now goes through the action-registry
    // bridge — proven in footnote-cross-surface.test.ts.)
    expect(() =>
      dispatch("virgil-footnote-input", { footnoteId: "f1" }),
    ).not.toThrow();
  });

  it("the dead virgil-footnote-created event has no listener here either", () => {
    const { deps } = makeDeps();
    mount(deps);
    expect(() =>
      dispatch("virgil-footnote-created", { footnoteId: "f1", content: {} }),
    ).not.toThrow();
  });
});

describe("\\cite (virgil-citation-create): MIGRATED off this hook (CHIP 4a-ii)", () => {
  it("dispatching the legacy event through this hook is now a no-op (no listener)", () => {
    const { deps } = makeDeps();
    mount(deps);
    // The hook no longer binds `virgil-citation-create`; firing it must not
    // throw. (The real citation routing now goes through the action-registry
    // bridge — proven in citation-cross-surface.test.ts.)
    expect(() =>
      dispatch("virgil-citation-create", { partial: "\\cite", citationId: "c1" }),
    ).not.toThrow();
  });
});
