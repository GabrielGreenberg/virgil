// Task 1320: the document row's right-hand pane is ONE slot (code | pdf | null)
// rendered by ONE split. These pin the slot's policy (pure transitions) and the
// shell's wiring to it (source census — EditorLayout is too heavy to mount).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  afterDocSwitch,
  afterFreshCompile,
  closeRightPane,
  openRightPane,
} from "../right-pane";

describe("right-pane slot transitions (task 1320)", () => {
  it("opening one occupant replaces the other — code ↔ pdf swap", () => {
    expect(openRightPane("code", "pdf")).toBe("pdf");
    expect(openRightPane("pdf", "code")).toBe("code");
    expect(openRightPane(null, "pdf")).toBe("pdf");
  });

  it("closing a kind leaves any other occupant alone", () => {
    expect(closeRightPane("pdf", "pdf")).toBeNull();
    expect(closeRightPane("code", "pdf")).toBe("code");
    expect(closeRightPane(null, "code")).toBeNull();
  });

  it("a fresh compile opens the PDF only into an EMPTY slot (never yanks code)", () => {
    expect(afterFreshCompile(null)).toBe("pdf");
    expect(afterFreshCompile("code")).toBe("code");
    expect(afterFreshCompile("pdf")).toBe("pdf");
  });

  it("a paper switch closes the PDF; code stays", () => {
    expect(afterDocSwitch("pdf")).toBeNull();
    expect(afterDocSwitch("code")).toBe("code");
    expect(afterDocSwitch(null)).toBeNull();
  });
});

describe("EditorLayout renders the slot through the ONE split (task 1320 census)", () => {
  const src = readFileSync(
    join(__dirname, "..", "..", "EditorLayout.tsx"),
    "utf8",
  );

  it("holds one rightPane state — no separate codeView/pdfView booleans", () => {
    expect(src).toMatch(/useState<RightPane>\(null\)/);
    expect(src).not.toMatch(/\bsetPdfView\b/);
    expect(src).not.toMatch(/\bsetCodeView\b/);
  });

  it("the editor stays visible with the PDF open (keep-alive slot ignores pdfView)", () => {
    const m = src.match(/isVisible=\{([^}]*)\}\s*\n\s*onUnmount=\{pruneDocMaps\}/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/pdfView/);
  });

  it("the split opens for either occupant, and the PDF viewer mounts only inside it", () => {
    expect(src).toMatch(/open=\{isActive && rightPane !== null\}/);
    // One PDF viewer mount path: the single FramedViewerSurface sits in the
    // split's `right` child, after the code pane's branch.
    const uses = src.match(/<FramedViewerSurface\b/g) ?? [];
    expect(uses).toHaveLength(1);
    const split = src.indexOf("<SplitWithCode");
    const splitEnd = src.indexOf("</DocPipeline>", split);
    const viewer = src.indexOf("<FramedViewerSurface");
    expect(viewer).toBeGreaterThan(split);
    expect(viewer).toBeLessThan(splitEnd);
  });

  it("the sync-position pill is offered only beside code", () => {
    expect(src).toMatch(/onMoveCodeToText=\{\s*isActive && codeView \?/);
    expect(src).toMatch(/onMoveTextToCode=\{\s*isActive && codeView \?/);
  });

  it("auto-open rides the press's FRESH result, through afterFreshCompile", () => {
    const at = src.indexOf("const stableCompilePdf");
    expect(at).toBeGreaterThan(-1);
    const body = src.slice(at, src.indexOf("}, []);", at));
    expect(body).toMatch(/await paneStateRef\.current\?\.compilePdf\?\.\(\)/);
    expect(body).toMatch(/if \(!fresh/);
    expect(body).toMatch(/setRightPane\(afterFreshCompile\)/);
  });
});
