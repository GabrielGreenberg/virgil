// @vitest-environment jsdom
//
// A5 contract, REAL-module edition (test-hardening: the prior versions of
// these pins lived as hand-copied mirrors of OmniViewPanel's split useMemo —
// a mirror can't fail when the component drifts). This file renders the REAL
// default-exported `memo(OmniViewPanel)` and pins:
//
//   1. Mount-race guard — while `editor` is null, every `pos == null` item is
//      DROPPED (no unanchored bin, no flash); anchored items still render.
//   2. Split routing — with a live editor, free + orphaned route into the
//      unanchored bin and the anchored item renders as a positioned
//      `[data-omni-entry-wrapper]` (transform translateY from the cascade).
//   3. Cascade purity — the `inTextItems` the panel feeds `useInTextPositions`
//      never contain a `pos == null` item (captured via the hook mock).
//   4. `panelScrollRef` parentage — the ref the cascade hook returns is
//      attached to the DIRECT PARENT of both the bin and the anchored
//      wrappers, so the bin scrolls with the panel (A5's structural fix).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { createElement } from "react";
import type { Editor } from "@tiptap/react";

// Importing OmniViewPanel pulls panel-registry → card components, whose barrel
// transitively `require()`s `@/lib/storage` (an unaliasable path under
// vitest). Stub it. (memory: vitest_extension_barrel_storage_mock.md)
vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder", "getTexFilename",
    "writePdf", "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const n of names) mod[n] = stub;
  return mod;
});

// The cascade hook does layout measurement (coordsAtPos / ResizeObserver) —
// meaningless in jsdom. The mock echoes each item's pos as its translateY and
// CAPTURES the inTextItems argument (cascade-purity pin) plus hands back a
// stable panelScrollRef the test can inspect for parentage.
/** How far the mock's CASCADED top sits below its NATURAL top, so the two
 *  are distinguishable in the DOM. Declared before the `vi.mock` factory
 *  body runs (hoisted mock, evaluated lazily on first import). */
const NATURAL_MINUS_CASCADED = 7;

vi.mock("@/hooks/useInTextPositions", () => {
  const state = {
    panelScrollRef: { current: null as HTMLElement | null },
    lastItems: null as Array<{ id: string; pos: number }> | null,
  };
  return {
    useInTextPositions: (
      _editor: unknown,
      items: Array<{ id: string; pos: number }>,
    ) => {
      state.lastItems = items;
      return {
        positions: new Map(items.map((i) => [i.id, i.pos])),
        // Anchor-relative pins (task 362): the panel publishes each card's
        // measured natural top on its wrapper, so the placement door can
        // store an OFFSET from the anchor rather than a pod coordinate.
        //
        // The natural top is deliberately NOT the cascaded top here — the
        // producer leg below is the only thing standing between the fix and
        // `data-omni-natural-top={positions.get(id)}`, which type-checks,
        // renders, and makes every stored pin self-referential (its
        // reference would move with the pin). Two numbers that differ is
        // what gives that leg its teeth.
        naturals: new Map(
          items.map((i) => [
            i.id,
            { naturalTop: i.pos - NATURAL_MINUS_CASCADED, height: 60 },
          ]),
        ),
        editorContentHeight: 600,
        panelScrollRef: state.panelScrollRef,
      };
    },
    __mockState: state,
  };
});

import OmniViewPanel from "@/panels/Omni/OmniViewPanel";
import type { OmniItem } from "@/panels/_shared/types";
import * as useInTextPositionsModule from "@/hooks/useInTextPositions";

const mockState = (
  useInTextPositionsModule as unknown as {
    __mockState: {
      panelScrollRef: { current: HTMLElement | null };
      lastItems: Array<{ id: string; pos: number }> | null;
    };
  }
).__mockState;

afterEach(() => {
  cleanup();
  mockState.panelScrollRef.current = null;
  mockState.lastItems = null;
});

const anchoredNote: OmniItem = {
  id: "float:card:note:anchored-1",
  pos: 10,
  anchorState: "anchored",
  content: createElement("div", { "data-test-card": "anchored-1" }, "anchored"),
};
const freeNote: OmniItem = {
  id: "float:card:note:free-1",
  pos: null,
  anchorState: "free",
  content: createElement("div", { "data-test-card": "free-1" }, "free"),
};
const orphanFootnote: OmniItem = {
  id: "float:card:footnote:orphan-1",
  pos: null,
  anchorState: "orphaned",
  content: createElement("div", { "data-test-card": "orphan-1" }, "orphan"),
};

const ITEMS = [anchoredNote, freeNote, orphanFootnote];
const CATS = new Set(["notes", "footnotes"] as const) as Set<
  "notes" | "footnotes"
> as never;

function renderPanel(editor: Editor | null) {
  return render(
    <OmniViewPanel
      side="right"
      items={ITEMS}
      editor={editor}
      enabledCategories={CATS}
    />,
  );
}

describe("OmniViewPanel (REAL component) — mount-race guard", () => {
  it("editor null: drops every pos:null item (no bin), anchored still renders", () => {
    const { container } = renderPanel(null);
    // No unanchored bin at all — pos:null items were dropped, not binned.
    expect(container.querySelector("[data-omni-unanchored-bin]")).toBeNull();
    expect(container.querySelector('[data-test-card="free-1"]')).toBeNull();
    expect(container.querySelector('[data-test-card="orphan-1"]')).toBeNull();
    // The anchored item renders in its cascade wrapper.
    const wrapper = container.querySelector(
      `[data-omni-entry-wrapper="${anchoredNote.id}"]`,
    );
    expect(wrapper).not.toBeNull();
    expect(container.querySelector('[data-test-card="anchored-1"]')).not.toBeNull();
  });
});

describe("OmniViewPanel (REAL component) — split routing with a live editor", () => {
  const liveEditor = {} as Editor;

  it("free + orphaned route into the unanchored bin; anchored stays out of it", () => {
    const { container } = renderPanel(liveEditor);
    const bin = container.querySelector("[data-omni-unanchored-bin]");
    expect(bin).not.toBeNull();
    // RENEGOTIATED (task 422): the two states are two pills — the summed
    // "2 unanchored" this leg used to pin announced a FREE card with the
    // error badge, the defect asserted as the contract.
    expect(bin!.textContent).toContain("1 unanchored");
    expect(bin!.textContent).toContain("1 unplaced");
    // The anchored card renders OUTSIDE the bin, positioned by the cascade.
    const wrapper = container.querySelector(
      `[data-omni-entry-wrapper="${anchoredNote.id}"]`,
    ) as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(bin!.contains(wrapper)).toBe(false);
    expect(wrapper.style.transform).toBe("translateY(10px)");
  });

  it("publishes the card's NATURAL top on the wrapper — the anchor reference a pin is stored against", () => {
    // Task 362: a pin is an OFFSET from this number, so if the wrapper
    // published the CASCADED top instead, the pin's own reference would
    // move with the pin and the card would decouple from its anchor all
    // over again — one field over. Both values are `number | undefined`,
    // so nothing but this leg distinguishes them.
    const { container } = renderPanel(liveEditor);
    const wrapper = container.querySelector(
      `[data-omni-entry-wrapper="${anchoredNote.id}"]`,
    ) as HTMLElement;
    expect(wrapper.getAttribute("data-omni-natural-top")).toBe(
      String(anchoredNote.pos! - NATURAL_MINUS_CASCADED),
    );
    // …and it is NOT the cascaded top the same element is translated by.
    expect(wrapper.style.transform).toBe(`translateY(${anchoredNote.pos}px)`);
  });

  it("cascade purity: useInTextPositions only ever receives number-pos items", () => {
    renderPanel(liveEditor);
    expect(mockState.lastItems).not.toBeNull();
    expect(mockState.lastItems!.map((i) => i.id)).toEqual([anchoredNote.id]);
    expect(mockState.lastItems!.every((i) => typeof i.pos === "number")).toBe(true);
  });

  it("panelScrollRef parentage: the bin stack and the anchored wrappers are DIRECT children of the ref'd pod", () => {
    const { container } = renderPanel(liveEditor);
    const pod = mockState.panelScrollRef.current;
    // The component attached the hook's ref to a real element…
    expect(pod).not.toBeNull();
    expect(container.contains(pod)).toBe(true);
    // …which is the bin STACK's direct parent (the stack — and its bins —
    // scroll with the panel). The individual bins flow inside the stack now
    // (task 127), so the DIRECT pod child is the stack, not each bin.
    const stack = container.querySelector("[data-omni-bin-stack]")!;
    expect(stack.parentElement).toBe(pod);
    const bin = container.querySelector("[data-omni-unanchored-bin]")!;
    expect(stack.contains(bin)).toBe(true);
    // …and the anchored wrapper's direct parent (one shared coordinate space).
    const wrapper = container.querySelector(
      `[data-omni-entry-wrapper="${anchoredNote.id}"]`,
    )!;
    expect(wrapper.parentElement).toBe(pod);
    // The pod extends alongside the document (min-height from the hook).
    expect((pod as HTMLElement).style.minHeight).toBe("600px");
  });
});

describe("OmniViewPanel — two-bin stacking (task 127)", () => {
  const liveEditor = {} as Editor;
  // A card anchored OUTSIDE the focus band → routes to the outside-focus bin
  // (the split checks `item.outsideFocus` before pos, so pos is irrelevant).
  const outsideFocusNote: OmniItem = {
    id: "float:card:note:outside-1",
    pos: 20,
    anchorState: "anchored",
    outsideFocus: true,
    content: createElement("div", { "data-test-card": "outside-1" }, "outside"),
  };

  it("both bins share the ONE absolute stack; unanchored sits above outside-focus in normal flow", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[freeNote, outsideFocusNote]}
        editor={liveEditor}
        enabledCategories={CATS}
      />,
    );
    const stack = container.querySelector("[data-omni-bin-stack]") as HTMLElement;
    const unanchored = container.querySelector("[data-omni-unanchored-bin]") as HTMLElement;
    const outside = container.querySelector("[data-omni-outside-focus-bin]") as HTMLElement;
    expect(unanchored).not.toBeNull();
    expect(outside).not.toBeNull();
    // Both bins live inside the single absolute wrapper — no independent
    // absolute siblings with hand-measured offsets to fight over z-index.
    expect(stack.style.position).toBe("absolute");
    expect(stack.contains(unanchored)).toBe(true);
    expect(stack.contains(outside)).toBe(true);
    // Neither bin positions itself — they flow in the column, so the
    // outside-focus bin is pushed below the unanchored bin whether the latter
    // is collapsed or expanded (the fix: no static top:30 to paint over).
    expect(unanchored.style.position).not.toBe("absolute");
    expect(outside.style.position).not.toBe("absolute");
    // Document order guarantees the outside-focus bin renders AFTER (below) the
    // unanchored bin in the flex column.
    expect(
      unanchored.compareDocumentPosition(outside) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("OmniViewPanel — 'dim at rest' mode gates via data-omni-dim", () => {
  const liveEditor = {} as Editor;

  it("dimResting → cascade root carries data-omni-dim=\"true\" (the CSS gate)", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={ITEMS}
        editor={liveEditor}
        enabledCategories={CATS}
        dimResting
      />,
    );
    // The omni inversion CSS keys off [data-omni-dim="true"]; without this
    // gate on the cascade root, the toggle is inert.
    expect(container.querySelector('[data-omni-dim="true"]')).not.toBeNull();
  });

  it("dimResting falsy → no data-omni-dim attribute (default bright-rest behavior)", () => {
    const { container } = renderPanel(liveEditor);
    expect(container.querySelector("[data-omni-dim]")).toBeNull();
  });
});
