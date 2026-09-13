// @vitest-environment jsdom
//
// Task 544 — ONE owner for the no-anchor affordance: the gutter bin.
//
// Pre-544 the fact "this card has no place in the text" was drawn by TWO
// surfaces at once. Task 410 put an "N unanchored" chip in the pod's sticky
// chrome header (both sides, unfiltered) because the margin lane could not
// host it; task 421 then made the omni bins sticky and reachable at every
// scroll position, which retired the chip's whole justification without
// retiring the chip. Gabriel, on a real paper: "still seeing this on-page
// unanchored bar — should be just the gutter bar."
//
// The shape of the fix, and what each leg pins:
//
//  • The BIN reads the side's WHOLE item list (legs 1-2). It used to read the
//    view-filtered `visibleItems`, so hiding all cards on a side — or
//    filtering a category out — emptied the bin, and the only surface that
//    still showed the card was the chip. With the chip gone, the bin inherits
//    task 410's rule: an affordance that exists so a card cannot vanish is
//    not hideable by a layout preference.
//  • A column PUBLISHES whether it hosts a bin surface (leg 3), on the EDGE
//    where its slot mounts / unmounts. The pane does not re-derive the four
//    render gates the slot sits behind.
//  • The chip is the FALLBACK (census): it lists the cards whose SIDE has no
//    bin surface, resolved through the lane's own side ladder, and nothing
//    else.
//  • The column's content signal counts bin members (leg 4), so the Reader's
//    narrow-pane rule cannot crush a column whose only occupant is the bin.
//
// The leg with teeth is the CENSUS: the bin, the column and the chip were
// never the parts that could misbehave — a pane that keeps handing the chip
// the whole set is, and it type-checks and renders perfectly.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Editor } from "@tiptap/react";

vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "mutateBib", "createDocFromPicker",
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

vi.mock("@/hooks/useInTextPositions", () => {
  const state = {
    panelScrollRef: { current: null as HTMLElement | null },
    lastFloor: undefined as unknown,
  };
  return {
    useInTextPositions: (
      _editor: unknown,
      items: Array<{ id: string; pos: number }>,
      _enabled: unknown,
      _entry: unknown,
      _pinned: unknown,
      _resolvePos: unknown,
      floor: unknown,
    ) => {
      state.lastFloor = floor;
      return {
        positions: new Map(items.map((i) => [i.id, i.pos])),
        naturals: new Map(items.map((i) => [i.id, { naturalTop: i.pos, height: 60 }])),
        editorContentHeight: 600,
        panelScrollRef: state.panelScrollRef,
      };
    },
    __mockState: state,
  };
});

import OmniViewPanel from "@/panels/Omni/OmniViewPanel";
import { PanelColumn } from "@/components/editor-layout/panel-column";
import type { OmniItem } from "@/panels/_shared/types";
import * as hookModule from "@/hooks/useInTextPositions";

const mockState = (hookModule as unknown as {
  __mockState: { panelScrollRef: { current: HTMLElement | null }; lastFloor: unknown };
}).__mockState;

afterEach(() => {
  cleanup();
  mockState.panelScrollRef.current = null;
  document.body.innerHTML = "";
});

const SRC = (rel: string) =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const liveEditor = {} as Editor;
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
const NOTES_ONLY = new Set(["notes"]) as never;
const NOTHING = new Set([]) as never;

// ===========================================================================
// The bin reads the WHOLE side, not the view-filtered set
// ===========================================================================

describe("the no-anchor bin is not hideable by a layout preference", () => {
  it("leg 1: 'hide all cards' empties the cascade and NOT the bin", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[anchoredNote, freeNote, orphanFootnote]}
        editor={liveEditor}
        enabledCategories={NOTES_ONLY}
        hideAllCards
      />,
    );
    // The cascade is empty…
    expect(container.querySelector("[data-omni-entry-wrapper]")).toBeNull();
    // …and the bin still holds both no-anchor cards.
    const bin = container.querySelector("[data-omni-unanchored-bin]");
    expect(bin).not.toBeNull();
    expect(bin!.textContent).toContain("2 unanchored");
  });

  it("leg 2: a category filtered OUT of the cascade is still binned", () => {
    // The footnote category is not enabled on this side: the orphaned
    // footnote may not cascade, but it has nowhere else to be.
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[anchoredNote, orphanFootnote]}
        editor={liveEditor}
        enabledCategories={NOTES_ONLY}
      />,
    );
    expect(
      container.querySelector(`[data-omni-entry-wrapper="${anchoredNote.id}"]`),
    ).not.toBeNull();
    const bin = container.querySelector("[data-omni-unanchored-bin]");
    expect(bin).not.toBeNull();
    expect(bin!.textContent).toContain("1 unanchored");
  });

  it("leg 2b (control): with the editor still mounting nothing is binned — the mount-race guard survives", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[freeNote, orphanFootnote]}
        editor={null}
        enabledCategories={NOTES_ONLY}
      />,
    );
    expect(container.querySelector("[data-omni-unanchored-bin]")).toBeNull();
  });

  it("leg 4: the column's content signal counts bin members, so a bin-only column reads as populated", () => {
    const seen: number[] = [];
    render(
      <OmniViewPanel
        side="right"
        items={[freeNote]}
        editor={liveEditor}
        enabledCategories={NOTHING}
        hideAllCards
        onVisibleCardsChange={(n) => seen.push(n)}
      />,
    );
    expect(seen.at(-1)).toBeGreaterThan(0);
  });

  it("the panel hands the hook a cascade-floor source once a bin host exists", () => {
    render(
      <OmniViewPanel
        side="right"
        items={[anchoredNote, freeNote]}
        editor={liveEditor}
        enabledCategories={NOTES_ONLY}
      />,
    );
    // In-pod host: the sticky inner is the occupant, and it is what the hook
    // observes + reads.
    const floor = mockState.lastFloor as { el: HTMLElement; read: unknown } | null;
    expect(floor).not.toBeNull();
    expect(floor!.el.hasAttribute("data-omni-bin-sticky")).toBe(true);
    expect(typeof floor!.read).toBe("function");
  });
});

// ===========================================================================
// The column publishes its bin surface
// ===========================================================================

function renderColumn(collapsed: boolean, onBinSurfaceChange: (p: boolean) => void) {
  return render(
    <PanelColumn
      side="right"
      panelPref={300}
      onPanelPrefChange={() => {}}
      omni={<div data-testid="omni" />}
      stack={[]}
      onTradeHeight={() => {}}
      onResizeBottomEdge={() => {}}
      onFocusBand={() => {}}
      collapsed={collapsed}
      onBinSurfaceChange={onBinSurfaceChange}
    />,
  );
}

describe("PanelColumn — publishes whether it hosts a bin surface", () => {
  it("leg 3: present on mount, absent when collapsed, absent on unmount — edges only", () => {
    const edges: boolean[] = [];
    const view = renderColumn(false, (p) => edges.push(p));
    expect(edges).toEqual([true]);
    // A re-render with an unchanged column publishes NOTHING (the callback ref
    // is stable, so React does not detach/re-attach it per render).
    view.rerender(
      <PanelColumn
        side="right"
        panelPref={320}
        onPanelPrefChange={() => {}}
        omni={<div data-testid="omni" />}
        stack={[]}
        onTradeHeight={() => {}}
        onResizeBottomEdge={() => {}}
        onFocusBand={() => {}}
        collapsed={false}
        onBinSurfaceChange={(p) => edges.push(p)}
      />,
    );
    expect(edges).toEqual([true]);
    // Collapsing unmounts the slot → absent.
    act(() => {
      view.rerender(
        <PanelColumn
          side="right"
          panelPref={320}
          onPanelPrefChange={() => {}}
          omni={<div data-testid="omni" />}
          stack={[]}
          onTradeHeight={() => {}}
          onResizeBottomEdge={() => {}}
          onFocusBand={() => {}}
          collapsed
          onBinSurfaceChange={(p) => edges.push(p)}
        />,
      );
    });
    expect(edges).toEqual([true, false]);
    // …and back.
    act(() => {
      view.rerender(
        <PanelColumn
          side="right"
          panelPref={320}
          onPanelPrefChange={() => {}}
          omni={<div data-testid="omni" />}
          stack={[]}
          onTradeHeight={() => {}}
          onResizeBottomEdge={() => {}}
          onFocusBand={() => {}}
          collapsed={false}
          onBinSurfaceChange={(p) => edges.push(p)}
        />,
      );
    });
    expect(edges).toEqual([true, false, true]);
    view.unmount();
    expect(edges).toEqual([true, false, true, false]);
  });
});

// ===========================================================================
// CENSUS — the leg with teeth
// ===========================================================================

describe("census — one owner, one fallback, one floor", () => {
  it("the chip is the FALLBACK: it lists only the cards whose side has no bin surface, through the lane's side ladder", () => {
    const pane = codeOnly(SRC("components/EditorPane.tsx"));
    const decl = pane.match(/const chipMarkers = useMemo\(([\s\S]{0,600}?)\);\n/);
    expect(decl, "chipMarkers derivation not found").toBeTruthy();
    const body = decl![1];
    expect(body).toContain("unanchoredMarkers.filter");
    expect(body).toContain("binSurfaceSides[");
    // The side is RESOLVED, never read off the record — the same ladder the
    // lane packs by (task 205).
    expect(body).toContain("marginSideForMarkerType(");
    expect(body).toContain("marginaliaPanelSides");
    // The chip is handed exactly that set, and its gate reads it too.
    expect(pane).toContain("markers={chipMarkers}");
    expect(pane).not.toContain("markers={unanchoredMarkers}");
    expect(pane).toContain("chipMarkers.length > 0");
    expect(pane.split("<UnanchoredCardsChip").length - 1).toBe(1);
  });

  it("the surface fact is PUBLISHED by the column and threaded from both rails — never re-derived in the pane", () => {
    const pane = codeOnly(SRC("components/EditorPane.tsx"));
    const col = codeOnly(SRC("components/editor-layout/panel-column.tsx"));
    // Both rail mounts hand the pane's setter down…
    expect((pane.match(/onBinSurfaceChange=\{noteBinSurface\}/g) ?? []).length).toBe(2);
    // …the rail threads it to the column…
    expect(pane).toMatch(/onBinSurfaceChange=\{\(present\) => onBinSurfaceChange\?\.\(side, present\)\}/);
    // …and the column fires it from the slot's own ref edge.
    expect(col).toContain("onBinSurfaceChangeRef.current?.(el !== null)");
    expect(col).toContain("ref={publishBinSlot}");
    // No copy of the slot's render gates decides the chip: the pane never
    // reads the collapse prefs or zen to gate it.
    const gate = pane.slice(
      pane.indexOf("const [binSurfaceSides"),
      pane.indexOf("const chipMarkers"),
    );
    expect(gate).not.toMatch(/collapsedLeft|collapsedRight|zenMode|codeSplit/);
  });

  it("the omni view hands the cascade its floor source, and the hook observes it", () => {
    const omni = codeOnly(SRC("panels/Omni/OmniViewPanel.tsx"));
    expect(omni).toContain("cascadeFloorForBinSlot(binSlot)");
    expect(omni).toContain("cascadeFloorForStickyOccupant(podOccupant)");
    // The floor is the hook's SEVENTH argument at the ONE call site.
    expect(omni).toMatch(/useInTextPositions\(\s*editor,\s*inTextItems,\s*true,\s*"data-omni-entry-wrapper",\s*pinned,\s*resolvePos,\s*cascadeFloor,\s*\)/);
    const hook = codeOnly(SRC("hooks/useInTextPositions.ts"));
    expect(hook).toContain("if (floor) obs.observe(floor.el);");
    expect(hook).toContain("resolveCascade(naturalRef.current, items, pinned, floorRef.current)");
  });

  it("'unplaced' is gone from the two affordance surfaces; the merged pill keeps the chip's word", () => {
    expect(codeOnly(SRC("panels/Omni/OmniViewPanel.tsx"))).not.toMatch(/unplaced/i);
    expect(codeOnly(SRC("components/UnanchoredCardsChip.tsx"))).not.toMatch(/unplaced/i);
  });
});
