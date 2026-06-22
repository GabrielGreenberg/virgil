// @vitest-environment jsdom
//
// A6 behavior pins for the marker-clicks event bridges (test-hardening chip).
// The routes TABLE is already frozen in anchor-route-derivation-contract; this
// file pins the BODIES, by mounting the REAL `useMarkerClickBridges` hook and
// dispatching the window events it listens to:
//
//   1. `routeAnchorClick` (virgil-linked-anchor-click): select on the
//      cardStore → openForCard with the route's omniKey / entrySelector /
//      panelId / skipScroll → align-at-clickY only when clickY is present;
//      unknown kinds are a total no-op.
//   2. Error bridge (virgil-error-marker-click): `selected:false` must sync
//      the deselect (setSelectedErrorId(null)) and must NOT open the errors
//      panel; `selected:true` opens it on its docked side only when it isn't
//      already active.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { act } from "react";

// marker-clicks → panel-registry → card components → `@/lib/storage`, whose
// `require("@/lib/storage-fsa")` vitest can't alias (the known gotcha).
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

// Observe the routing outcome without the whole panel shell.
vi.mock("@/components/editor-layout/event-bridges/open-for-card", () => ({
  openForCard: vi.fn(),
}));
vi.mock("@/links/_shared/usePlacement", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/links/_shared/usePlacement")>();
  return { ...actual, suppressNextPlacement: vi.fn() };
});

import { useMarkerClickBridges } from "@/components/editor-layout/event-bridges/marker-clicks";
import { openForCard } from "@/components/editor-layout/event-bridges/open-for-card";
import { suppressNextPlacement } from "@/links/_shared/usePlacement";
import { cardStore } from "@/links/_shared/anchored-card-store";
import type { ViewPrefs } from "@/hooks/useViewPrefs";

const openForCardMock = vi.mocked(openForCard);
const suppressMock = vi.mocked(suppressNextPlacement);

function makeDeps(prefsOverrides: Partial<ViewPrefs> = {}) {
  const prefs = {
    placements: [{ id: "errors", side: "right" }],
    activeLeft: "notes",
    activeRight: "todo",
    ...prefsOverrides,
  } as unknown as ViewPrefs;
  return {
    prefsRef: { current: prefs },
    setActiveLeft: vi.fn(),
    setActiveRight: vi.fn(),
    setActiveHalf: vi.fn(),
    tryScrollOmniEntry: vi.fn(() => true),
    getOmniEnabled: vi.fn(() => new Set()),
    setSelectedFootnoteId: vi.fn(),
    setSelectedCitationId: vi.fn(),
    setSelectedErrorId: vi.fn(),
    setActiveRefLabel: vi.fn(),
    setActiveRefRect: vi.fn(),
    setActiveRefCommand: vi.fn(),
    setAtomCreateRequest: vi.fn(),
    setActiveMath: vi.fn(),
    setActiveFigure: vi.fn(),
    alignOmniCardWithClick: vi.fn(),
  };
}

type Deps = ReturnType<typeof makeDeps>;

function mountBridges(deps: Deps) {
  return renderHook(() =>
    useMarkerClickBridges(deps as Parameters<typeof useMarkerClickBridges>[0]),
  );
}

function dispatch(name: string, detail: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  });
}

let selectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  selectSpy = vi.spyOn(cardStore, "select");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  selectSpy.mockRestore();
});

describe("routeAnchorClick body (virgil-linked-anchor-click)", () => {
  it("note click: selects on the cardStore and opens via the derived route (skipScroll)", () => {
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-linked-anchor-click", { entityId: "n1", kind: "note" });

    expect(suppressMock).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledWith({ kind: "note", id: "n1" });
    expect(openForCardMock).toHaveBeenCalledTimes(1);
    const [target, env] = openForCardMock.mock.calls[0];
    expect(target).toEqual({
      omniKey: "float:card:note:n1",
      // note is one of the legacy entrySelectorBase overrides.
      entrySelector: '[data-note-entry="n1"]',
      panelId: "notes",
      cardKind: "note",
      skipScroll: true,
    });
    expect(env.prefs).toBe(deps.prefsRef.current);
    // No clickY in the event → no pin alignment.
    expect(deps.alignOmniCardWithClick).not.toHaveBeenCalled();
  });

  it("cutter-suggestion click: canonical data-card-key selector + cutter panel", () => {
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-linked-anchor-click", {
      entityId: "c1",
      kind: "cutter-suggestion",
    });

    expect(selectSpy).toHaveBeenCalledWith({ kind: "cutter-suggestion", id: "c1" });
    const [target] = openForCardMock.mock.calls[0];
    expect(target).toEqual({
      omniKey: "float:card:cutter-suggestion:c1",
      entrySelector: '[data-card-key="float:card:cutter-suggestion:c1"]',
      panelId: "cutter",
      cardKind: "cutter-suggestion",
      skipScroll: true,
    });
  });

  it("clickY present: pins the omni card at the click Y (after routing)", () => {
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-linked-anchor-click", {
      entityId: "t1",
      kind: "todo",
      clickY: 123,
    });

    expect(openForCardMock).toHaveBeenCalledTimes(1);
    expect(deps.alignOmniCardWithClick).toHaveBeenCalledTimes(1);
    expect(deps.alignOmniCardWithClick).toHaveBeenCalledWith(
      "float:card:todo:t1",
      123,
      null, // no .linked-anchor span in this DOM
    );
  });

  it("anchorIndex present: keys the omni open + pin on the `@N` row (REP-F3-01 / OMNI-F3-01 / OMNI-F8-02)", () => {
    // A 2-anchor report draws one margin marker per anchored paragraph; the
    // omni surface draws one row per anchor keyed `…@<anchorIndex>`. The marker
    // for the SECOND anchor stamps `anchorIndex: 1`, so the bridge must open +
    // pin `float:card:report:r1@1`, NOT the bare (first-row) key.
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-linked-anchor-click", {
      entityId: "r1",
      kind: "report",
      clickY: 200,
      anchorIndex: 1,
    });

    expect(selectSpy).toHaveBeenCalledWith({ kind: "report", id: "r1" });
    const [target] = openForCardMock.mock.calls[0];
    expect(target).toMatchObject({
      omniKey: "float:card:report:r1@1",
      panelId: "reports",
      cardKind: "report",
      skipScroll: true,
    });
    // The pin targets the SAME `@1` row.
    expect(deps.alignOmniCardWithClick).toHaveBeenCalledWith(
      "float:card:report:r1@1",
      200,
      null,
    );
  });

  it("anchorIndex absent (single-anchor card): keys the BARE card popKey (no `@N`)", () => {
    // A single-anchor card's omni row carries no `@N` suffix (the omni builders
    // only suffix when `pids.length > 1`), so the marker stamps no anchorIndex
    // and the bridge keys the bare key — back-compat with the existing route.
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-linked-anchor-click", {
      entityId: "r2",
      kind: "report",
      clickY: 50,
    });

    const [target] = openForCardMock.mock.calls[0];
    expect(target).toMatchObject({ omniKey: "float:card:report:r2" });
    expect(deps.alignOmniCardWithClick).toHaveBeenCalledWith(
      "float:card:report:r2",
      50,
      null,
    );
  });

  it("unrouted kind (footnote rides its own event): TOTAL no-op — no select, no open", () => {
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-linked-anchor-click", { entityId: "f1", kind: "footnote" });

    expect(selectSpy).not.toHaveBeenCalled();
    expect(openForCardMock).not.toHaveBeenCalled();
    expect(suppressMock).not.toHaveBeenCalled();
    expect(deps.alignOmniCardWithClick).not.toHaveBeenCalled();
  });

  it("malformed detail (missing entityId / kind) is ignored", () => {
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-linked-anchor-click", { kind: "note" });
    dispatch("virgil-linked-anchor-click", { entityId: "n1" });
    dispatch("virgil-linked-anchor-click", undefined);

    expect(selectSpy).not.toHaveBeenCalled();
    expect(openForCardMock).not.toHaveBeenCalled();
  });
});

describe("error bridge (virgil-error-marker-click)", () => {
  it("selected:false syncs the DESELECT and does NOT open the errors panel", () => {
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-error-marker-click", { errorId: "e1", selected: false });

    expect(deps.setSelectedErrorId).toHaveBeenCalledWith(null);
    expect(deps.setActiveLeft).not.toHaveBeenCalled();
    expect(deps.setActiveRight).not.toHaveBeenCalled();
    expect(deps.setActiveHalf).not.toHaveBeenCalled();
  });

  it("selected:true opens the errors panel on its docked side (right)", () => {
    const deps = makeDeps(); // errors placed right; activeRight is "todo"
    mountBridges(deps);
    dispatch("virgil-error-marker-click", { errorId: "e1", selected: true });

    expect(deps.setSelectedErrorId).toHaveBeenCalledWith("e1");
    expect(deps.setActiveRight).toHaveBeenCalledWith("errors");
    expect(deps.setActiveLeft).not.toHaveBeenCalled();
  });

  it("selected:true respects a LEFT dock placement", () => {
    const deps = makeDeps({
      placements: [{ id: "errors", side: "left" }],
    } as unknown as Partial<ViewPrefs>);
    mountBridges(deps);
    dispatch("virgil-error-marker-click", { errorId: "e1", selected: true });

    expect(deps.setActiveLeft).toHaveBeenCalledWith("errors");
    expect(deps.setActiveRight).not.toHaveBeenCalled();
  });

  it("selected:true is idempotent when the errors panel is already active on its side", () => {
    // New band-stack model: "already active on its side" = errors is docked in
    // that side's stack (the retired `activeRight` field is gone), so the
    // `isPanelDocked` guard short-circuits before calling the opener.
    const deps = makeDeps({
      dockStack: { left: [], right: ["errors"] },
    } as unknown as Partial<ViewPrefs>);
    mountBridges(deps);
    dispatch("virgil-error-marker-click", { errorId: "e1", selected: true });

    expect(deps.setSelectedErrorId).toHaveBeenCalledWith("e1");
    expect(deps.setActiveRight).not.toHaveBeenCalled();
  });

  it("missing errorId is ignored entirely", () => {
    const deps = makeDeps();
    mountBridges(deps);
    dispatch("virgil-error-marker-click", { selected: true });

    expect(deps.setSelectedErrorId).not.toHaveBeenCalled();
    expect(deps.setActiveLeft).not.toHaveBeenCalled();
    expect(deps.setActiveRight).not.toHaveBeenCalled();
  });
});
