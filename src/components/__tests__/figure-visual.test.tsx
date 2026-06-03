// @vitest-environment jsdom
/**
 * L3m — `FigureVisual` is the shared presentational shell that BOTH the editable
 * page view (`FigureFullView`) and the read-only card preview
 * (`FigureCardPreview`) render through, so a figure affordance is built ONCE and
 * can't silently drift out of one surface again (the Issue-4/9/10 accretion).
 *
 * These tests lock the structure + the byte-identical-critical caption gating
 * the live before/after diff verified on the real app: the caption block shows
 * iff `isFigure && (a caption slot was supplied OR the "Figure N:" prefix will
 * render)`, the slot order is row → caption → chrome → lozenge, and the row's
 * `contentEditable` is a per-surface passthrough (page false; preview omitted).
 *
 * `@/lib/storage` is mocked: importing `FigureBlockNodeView` pulls it in (and
 * its `require("@/…")` calls don't resolve under vitest's aliaser) even though
 * these tests pass `sources={[]}` so no `FigurePanel` ever mounts to call it.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  getDocWriteHandle: () => null,
  importFigureFile: async () => "",
  readFigureSource: async () => null,
  readFigureRaster: async () => null,
  writeFigureRaster: async () => {},
  deleteFigureRaster: async () => {},
  writeFigureIndex: async () => {},
  readFigureIndex: async () => ({}),
}));

import { FigureVisual } from "@/components/FigureBlockNodeView";

const noopRegister = () => () => {};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("FigureVisual — shared figure shell (L3m)", () => {
  it("figure with caption text + lozenge: row, 'Figure N:' label + caption slot, lozenge", () => {
    const { container } = render(
      <FigureVisual
        isFigure
        sources={[]}
        docId={null}
        registerRefresh={noopRegister}
        numbered
        figureNumber={3}
        captionSlot={<span className="figure-caption-text">Hello caption</span>}
        lozenge={<div className="figure-annotation" data-test-lozenge="" />}
      />,
    );
    expect(container.querySelector(".figure-row")).not.toBeNull();
    const caption = container.querySelector(".figure-caption");
    expect(caption).not.toBeNull();
    // "Figure N: " prefix — exact text incl. trailing space (the JSX `{" "}`).
    expect(container.querySelector(".figure-caption-label")?.textContent).toBe(
      "Figure 3: ",
    );
    expect(container.querySelector(".figure-caption-text")?.textContent).toBe(
      "Hello caption",
    );
    expect(container.querySelector("[data-test-lozenge]")).not.toBeNull();
    // No chrome slot was passed → no chrome rendered.
    expect(container.querySelector(".figure-chrome")).toBeNull();
  });

  it("page-style order is row → caption → chrome → lozenge, and the row honors rowContentEditable", () => {
    const { container } = render(
      <FigureVisual
        isFigure
        sources={[]}
        docId={null}
        registerRefresh={noopRegister}
        rowContentEditable={false}
        numbered
        figureNumber={1}
        captionSlot={<span className="figure-caption-text">Cap</span>}
        chrome={<div className="figure-chrome" data-test-chrome="" />}
        lozenge={<div className="figure-annotation" data-test-lozenge="" />}
      />,
    );
    const classes = Array.from(container.children).map((c) =>
      (c as HTMLElement).className,
    );
    expect(classes).toEqual([
      "figure-row",
      "figure-caption",
      "figure-chrome",
      "figure-annotation",
    ]);
    // Page passes rowContentEditable={false} → contenteditable="false" emitted.
    expect(
      container.querySelector(".figure-row")?.getAttribute("contenteditable"),
    ).toBe("false");
  });

  it("preview-style row omits the contentEditable attribute (inherits from wrapper)", () => {
    const { container } = render(
      <FigureVisual
        isFigure
        sources={[]}
        docId={null}
        registerRefresh={noopRegister}
        numbered
        figureNumber={1}
        captionSlot={<span className="figure-caption-text">Cap</span>}
        lozenge={null}
      />,
    );
    expect(
      container.querySelector(".figure-row")?.getAttribute("contenteditable"),
    ).toBeNull();
  });

  it("graphicsBlock (isFigure=false) renders no caption and no lozenge", () => {
    const { container } = render(
      <FigureVisual
        isFigure={false}
        sources={[]}
        docId={null}
        registerRefresh={noopRegister}
        numbered
        figureNumber={5}
        captionSlot={null}
        chrome={<div className="figure-chrome" data-test-chrome="" />}
        lozenge={null}
      />,
    );
    expect(container.querySelector(".figure-row")).not.toBeNull();
    expect(container.querySelector(".figure-caption")).toBeNull();
    expect(container.querySelector(".figure-annotation")).toBeNull();
    // graphicsBlock still gets chrome on the page.
    expect(container.querySelector(".figure-chrome")).not.toBeNull();
  });

  it("empty caption + not numbered → no caption block (preview byte-identical gate)", () => {
    const { container } = render(
      <FigureVisual
        isFigure
        sources={[]}
        docId={null}
        registerRefresh={noopRegister}
        numbered={false}
        figureNumber={null}
        captionSlot={"" /* preview's `captionText && <span/>` with empty text */}
        lozenge={null}
      />,
    );
    expect(container.querySelector(".figure-caption")).toBeNull();
  });

  it("empty caption but numbered → caption block with the 'Figure N:' label, no text span", () => {
    const { container } = render(
      <FigureVisual
        isFigure
        sources={[]}
        docId={null}
        registerRefresh={noopRegister}
        numbered
        figureNumber={2}
        captionSlot={""}
        lozenge={null}
      />,
    );
    const caption = container.querySelector(".figure-caption");
    expect(caption).not.toBeNull();
    expect(container.querySelector(".figure-caption-label")?.textContent).toBe(
      "Figure 2: ",
    );
    expect(container.querySelector(".figure-caption-text")).toBeNull();
  });
});
