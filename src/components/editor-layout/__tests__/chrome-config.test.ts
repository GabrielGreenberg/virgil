/**
 * READER_CHROME / FULL_CHROME snapshot guard.
 *
 * The Library Reader's chrome preset decides which panels are visible, which
 * card kinds are editable, and whether the formatting toolbar / MenuBar edit
 * items render. These are load-bearing read-only invariants of the
 * Library-Reader-refactor, so they are pinned here field-by-field: a future
 * change to the Reader surface must be a CONSCIOUS, test-breaking diff rather
 * than a silent widening (e.g. accidentally exposing the suggestion panel or
 * making citation cards editable in the read-only Reader).
 *
 * Pure logic — chrome-config.ts has only type-only imports, so this runs in the
 * default `node` env.
 */

import { describe, it, expect } from "vitest";
import { READER_CHROME, FULL_CHROME } from "../chrome-config";

describe("READER_CHROME — pinned read-only preset", () => {
  it("hides the formatting toolbar and MenuBar edit items", () => {
    expect(READER_CHROME.showFormattingToolbar).toBe(false);
    expect(READER_CHROME.showMenuBarEditItems).toBe(false);
    expect(READER_CHROME.showHeadingFloatLabelEdit).toBe(false);
    expect(READER_CHROME.showParagraphFloatTitleEdit).toBe(false);
  });

  it("exposes exactly the six reading-affordance panels (order pinned)", () => {
    expect(READER_CHROME.visiblePanelKinds).toEqual([
      "outline",
      "footnotes",
      "examples",
      "citations",
      "bibliography",
      "notes",
    ]);
  });

  it("makes ONLY note cards editable (annotate-while-reading)", () => {
    expect(READER_CHROME.editableCardKinds).toEqual(["note"]);
  });
});

describe("FULL_CHROME — pinned main-app default (everything on)", () => {
  it("shows the formatting toolbar and MenuBar edit items", () => {
    expect(FULL_CHROME.showFormattingToolbar).toBe(true);
    expect(FULL_CHROME.showMenuBarEditItems).toBe(true);
    expect(FULL_CHROME.showHeadingFloatLabelEdit).toBe(true);
    expect(FULL_CHROME.showParagraphFloatTitleEdit).toBe(true);
  });

  it("leaves panel + card whitelists undefined (= all visible / all editable)", () => {
    expect(FULL_CHROME.visiblePanelKinds).toBeUndefined();
    expect(FULL_CHROME.editableCardKinds).toBeUndefined();
  });
});
