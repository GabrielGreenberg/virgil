// @vitest-environment jsdom
//
// Task 423 — pin-on-touch fires for a card whose ROOT is draggable.
//
// Task 328's "pin on touch" publishes a pin at the card's current Y on any
// mousedown on an omni wrapper, BEFORE the click toggles selection and the
// cascade recomputes — it is what keeps the card's top still through its own
// collapse/expand. Its interactive-control blocker ran an UNSCOPED `closest()`
// over a selector that includes `[draggable='true']`, and a card root is
// draggable for cross-editor anchor drags (CitationCard ships it). So a press
// ANYWHERE on such a card walked up to the root, matched, and bailed:
// `holdOmniCard` never ran, the card and every card below it jumped.
//
// This renders the REAL `OmniViewPanel` wrapper around a card root with the
// CitationCard shape (`draggable="true"` on the root, a header button inside)
// and spies on the REAL door. The defect leg fails on the pre-423 unscoped
// `closest` (measured by neutering the scoping in `pressFromInteractiveControl`).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createElement } from "react";
import type { Editor } from "@tiptap/react";

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

vi.mock("@/hooks/useInTextPositions", () => ({
  useInTextPositions: (_editor: unknown, items: Array<{ id: string; pos: number }>) => ({
    positions: new Map(items.map((i) => [i.id, i.pos])),
    naturals: new Map(items.map((i) => [i.id, { naturalTop: i.pos, height: 60 }])),
    editorContentHeight: 600,
    panelScrollRef: { current: null },
  }),
}));

// The REAL door, spied — the assertion is "was the door entered", which is
// the only thing the wrapper decides.
const holdSpy = vi.fn();
vi.mock("@/components/editor-layout/omni-card-placement", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/editor-layout/omni-card-placement")>();
  return { ...real, holdOmniCard: (...a: unknown[]) => holdSpy(...a) };
});

import OmniViewPanel from "@/panels/Omni/OmniViewPanel";
import type { OmniItem } from "@/panels/_shared/types";

afterEach(() => {
  cleanup();
  holdSpy.mockReset();
});

/** A card root with the CitationCard shape: the `data-card` shell PanelCard
 *  renders, `draggable` on that same root, a header holding a button, a
 *  compressed prose body, and a contenteditable editor body. */
const draggableCard: OmniItem = {
  id: "float:card:citation:c1",
  pos: 10,
  anchorState: "anchored",
  content: createElement(
    "div",
    { "data-test-card": "c1", "data-card": "1", draggable: true },
    createElement("div", { "data-test": "header" }, createElement("span", { "data-test": "title" }, "Smith 2020"), createElement("button", { "data-test": "trash" }, "x")),
    createElement("div", { "data-test": "body" }, createElement("span", { "data-test": "prose" }, "compressed body")),
    createElement("div", { contentEditable: true, suppressContentEditableWarning: true, "data-test": "editor" }, createElement("span", { "data-test": "in-editor" }, "live prose")),
  ),
};

const CATS = new Set(["citations"] as const) as Set<"citations"> as never;

function mount() {
  const r = render(
    <OmniViewPanel side="right" items={[draggableCard]} editor={{} as Editor} enabledCategories={CATS} />,
  );
  const wrapper = r.container.querySelector(`[data-omni-entry-wrapper="${draggableCard.id}"]`) as HTMLElement;
  expect(wrapper).not.toBeNull();
  const at = (t: string) => r.container.querySelector(`[data-test="${t}"]`) as HTMLElement;
  return { wrapper, at };
}

describe("omni pin-on-touch with a DRAGGABLE card root (task 423)", () => {
  it("a mousedown on the card's prose publishes a pin for the wrapper (defect leg)", () => {
    const { wrapper, at } = mount();
    fireEvent.mouseDown(at("prose"));
    expect(holdSpy).toHaveBeenCalledTimes(1);
    expect(holdSpy).toHaveBeenCalledWith(wrapper);
  });

  it("a mousedown on the header TITLE (not a control) publishes a pin", () => {
    const { wrapper, at } = mount();
    fireEvent.mouseDown(at("title"));
    expect(holdSpy).toHaveBeenCalledWith(wrapper);
  });

  it("a mousedown on the draggable card ROOT itself publishes a pin", () => {
    const { wrapper, at } = mount();
    fireEvent.mouseDown(at("header").parentElement!);
    expect(holdSpy).toHaveBeenCalledWith(wrapper);
  });

  it("a mousedown on a nested header BUTTON does NOT publish (control pass-through, unchanged)", () => {
    const { at } = mount();
    fireEvent.mouseDown(at("trash"));
    expect(holdSpy).not.toHaveBeenCalled();
  });

  it("a mousedown inside the card's contenteditable body does NOT publish (decided: clicking into prose changes no height)", () => {
    const { at } = mount();
    fireEvent.mouseDown(at("in-editor"));
    expect(holdSpy).not.toHaveBeenCalled();
  });
});
