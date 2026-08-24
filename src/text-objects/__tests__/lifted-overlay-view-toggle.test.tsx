// @vitest-environment jsdom
/**
 * Issue-12 (Part B wiring) — the drag-ghost overlay's ROOT must carry the
 * view-toggle class tokens it's handed, so the ghost honors the same
 * show/hide state as the page and the released float. The tokens come from
 * the single `viewToggleClasses(menuBar)` source (proven in
 * `editor-layout/__tests__/view-toggle-classes.test.ts`); here we prove the
 * REAL `LiftedTextOverlay` component lands its `viewToggleCls` prop on the
 * `.lifted-text-overlay` root (ancestor of the `.tiptap` body, where the
 * ancestor-agnostic divider/hide rules apply).
 *
 * The live ghost during an actual drag can't be driven headlessly (the grab
 * handle needs a trusted hover) — so this is the headless class-presence
 * check the plan specifies; the in-drag visual is a user-verify step.
 *
 * Nothing is stubbed. The header content used to be mocked away for module
 * weight; since task 437 the ghost mounts the SAME `FloatChromeContent` the
 * released float does, and a suite that mocks away the component under test
 * can't be evidence for anything — so it renders for real here too.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

// The shared float chrome pulls panel-primitives → `@/lib/storage`, whose
// backend pick is a raw `require` the vitest resolver can't follow (the known
// barrel gotcha). Nothing here touches a sidecar. This is a RESOLVER
// workaround, not a stub of anything under test.
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


import { LiftedTextOverlay } from "@/text-objects/LiftedTextOverlay";
import type { TextObjectRef } from "@/text-objects/types";

const PARAGRAPH_REF: TextObjectRef = { kind: "paragraph", id: "test-uuid" };

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function mountOverlayRoot(viewToggleCls: string): HTMLElement {
  const anchorDom = document.createElement("div");
  anchorDom.innerHTML = "<p>ghost body</p>";
  document.body.appendChild(anchorDom);
  render(
    <LiftedTextOverlay
      ref={PARAGRAPH_REF}
      anchorDom={anchorDom}
      grabOffsetX={0}
      grabOffsetY={0}
      sourceWidth={400}
      sourceHeight={100}
      cursorX={50}
      cursorY={50}
      mode="ghost"
      label="Paragraph"
      viewToggleCls={viewToggleCls}
      ghostContent={null}
    />,
  );
  const root = document.querySelector<HTMLElement>(".lifted-text-overlay");
  if (!root) throw new Error("overlay root .lifted-text-overlay did not mount");
  return root;
}

describe("LiftedTextOverlay — view-toggle classes on the overlay root (Issue-12)", () => {
  it("applies the viewToggleCls tokens to the .lifted-text-overlay root", () => {
    const root = mountOverlayRoot(
      "hide-par-titles show-dividers-2 dividers-width-full",
    );
    // The base class survives, AND every handed toggle token is present —
    // so the ancestor-agnostic `.show-dividers-N .tiptap …` / `.hide-* …`
    // rules now reach the ghost body.
    expect(root.classList.contains("lifted-text-overlay")).toBe(true);
    expect(root.classList.contains("hide-par-titles")).toBe(true);
    expect(root.classList.contains("show-dividers-2")).toBe(true);
    expect(root.classList.contains("dividers-width-full")).toBe(true);
  });

  it("empty viewToggleCls leaves the root exactly `lifted-text-overlay` (Reader / no toggles)", () => {
    const root = mountOverlayRoot("");
    expect(root.className).toBe("lifted-text-overlay");
  });
});
