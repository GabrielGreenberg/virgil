// @vitest-environment jsdom
//
// Task 2026-07-12-100: the docked / popped-out Examples panel selection must be
// STORE-backed, not islanded on a private `useState`. `ExamplesHost` reads
// `selectedExampleId` / `setSelectedExampleId` from `useSelectionsContext()`
// (the same store slot the Omni host and `openItemInPanel("examples", …)`
// write), so selection stays in sync across the docked panel, the Omni halo,
// in-text selection, and the collab-claim — parity with every sibling host.
//
// These two assertions pin BOTH directions of the wiring:
//   panel → store  (clicking a card writes the store selection)
//   store → panel  (a store change highlights the docked card)

import { describe, it, expect, vi, afterEach } from "vitest";

// panel-primitives transitively pulls the `@/lib/storage` barrel (the known
// vitest barrel/storage gotcha) — stub it; nothing here touches a sidecar.
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
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
  return Object.fromEntries(names.map((n) => [n, noop]));
});

// ExampleCard mounts embedded TipTap editors — irrelevant to the selection
// wiring. Stub it to a lightweight button that surfaces `isSelected` and fires
// `onSelect`, exactly as the real card does through the panel's renderCard.
vi.mock("@/panels/Examples/ExampleCard", () => ({
  ExampleCard: ({
    example,
    isSelected,
    onSelect,
  }: {
    example: { exampleId: string };
    isSelected: boolean;
    onSelect: () => void;
  }) => (
    <button
      data-testid={`ex-${example.exampleId}`}
      data-selected={isSelected ? "true" : "false"}
      // The real ExampleCard routes its select-click through `onBodyActivate`
      // and does not let it bubble to the list container's `onClickEmpty`
      // (which would immediately clear the selection). Mirror that here.
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      {example.exampleId}
    </button>
  ),
}));

// PanelThemePicker reaches for theme wiring we don't provide here.
vi.mock("@/components/PanelThemePicker", () => ({
  default: () => <div data-testid="theme-picker" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { act, render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ExamplesHost } from "../examples-host";
import { EditorRefProvider } from "../../contexts/editor-ref";
import { SelectionsProvider } from "../../contexts/selections";
import { CardStoreProvider, createCardStore } from "@/links/_shared/anchored-card-store";
import type { EditorHandle } from "@/components/Editor";
import type { ExampleInfo } from "@/components/Editor";

afterEach(cleanup);

function makeExample(id: string, number: number): ExampleInfo {
  return {
    exampleId: id,
    pos: number,
    number,
    kind: "single",
    tag: "",
    label: "",
    preview: `example ${number}`,
    subLabelRange: "",
    bodyText: `example ${number}`,
    bodyContent: null,
    items: [],
    latex: "",
  };
}

function renderHost(examples: ExampleInfo[]) {
  const store = createCardStore();
  const scrollToExample = vi.fn();
  const editorRef = {
    current: { scrollToExample } as unknown as EditorHandle,
  };
  const utils = render(
    <CardStoreProvider store={store}>
      <EditorRefProvider
        value={{
          editorInstance: null,
          editorRef,
          setOverrideEditor: () => {},
        }}
      >
        <SelectionsProvider
          store={store}
          value={{ selectedBibKey: null, setSelectedBibKey: () => {} }}
        >
          <ExamplesHost examples={examples} />
        </SelectionsProvider>
      </EditorRefProvider>
    </CardStoreProvider>,
  );
  return { store, ...utils };
}

describe("ExamplesHost — store-backed selection", () => {
  it("panel → store: clicking a docked example card writes the store selection", () => {
    const { store } = renderHost([makeExample("ex1", 1), makeExample("ex2", 2)]);

    expect(store.getState().selected).toBeNull();

    fireEvent.click(screen.getByTestId("ex-ex2"));

    expect(store.getState().selected).toEqual({ kind: "example", id: "ex2" });
  });

  it("store → panel: a store selection change highlights the docked example card", () => {
    const { store } = renderHost([makeExample("ex1", 1), makeExample("ex2", 2)]);

    expect(screen.getByTestId("ex-ex1").getAttribute("data-selected")).toBe("false");

    // Simulate an out-of-panel selection (omni click / jump-to-example) that
    // routes through the shared store.
    act(() => {
      store.select({ kind: "example", id: "ex1" });
    });

    expect(screen.getByTestId("ex-ex1").getAttribute("data-selected")).toBe("true");
    // And the previously-null sibling stays unselected.
    expect(screen.getByTestId("ex-ex2").getAttribute("data-selected")).toBe("false");
  });
});
