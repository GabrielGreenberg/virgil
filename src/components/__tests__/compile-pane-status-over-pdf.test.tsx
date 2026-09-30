// @vitest-environment jsdom
/**
 * TASK 854 — THE COMPILE'S VOICE OVER A SHOWING PDF.
 *
 * Task 454 gave the PDF pane a voice, but mounted it only where there was NO
 * PDF. `pdfBlobUrl` is the fresh-compile blob OR the disk seed of a reopened
 * paper, so every recompile of an already-compiled paper — including the
 * minutes-long cold package download after adding `\usepackage{tikz}` — ran
 * behind the old PDF with nothing said. `PdfPaneOverlay` is the chrome laid
 * over a showing PDF: the live progress strip while compiling, else the stale
 * chip, never both.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { PdfPaneOverlay } from "@/components/CompilePaneStatus";
import {
  __resetAllCompileProgress,
  beginCompile,
  finishCompile,
  noteAssetFetch,
} from "@/lib/compile/compile-progress";

const DOC = "doc-over-pdf";

afterEach(() => {
  cleanup();
  __resetAllCompileProgress();
});

describe("the compile's voice is not silenced by a PDF being present", () => {
  it("downloading packages over a PDF → a status line naming the count", () => {
    beginCompile(DOC);
    noteAssetFetch(DOC, "pgfcore.sty");
    noteAssetFetch(DOC, "pgfsys-pdftex.def");
    render(<PdfPaneOverlay docId={DOC} stale={false} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/Downloading LaTeX packages — 2 so far/);
    // Pointer-inert: the PDF underneath stays scrollable/selectable.
    expect(status.closest(".pointer-events-none")).toBeTruthy();
  });

  it("the overlay goes away when the compile finishes", () => {
    beginCompile(DOC);
    noteAssetFetch(DOC, "tikz.sty");
    render(<PdfPaneOverlay docId={DOC} stale={false} />);
    expect(screen.getByRole("status")).toBeTruthy();
    act(() => finishCompile(DOC, "ok"));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("while compiling, the stale chip yields to the progress strip", () => {
    beginCompile(DOC);
    render(<PdfPaneOverlay docId={DOC} stale />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("PDF is out of date")).toBeNull();
  });

  it("not compiling + stale → the stale chip; not stale → nothing", () => {
    const { rerender, container } = render(<PdfPaneOverlay docId={DOC} stale />);
    expect(screen.getByText("PDF is out of date")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    rerender(<PdfPaneOverlay docId={DOC} stale={false} />);
    expect(container.textContent).toBe("");
  });

  it("another document's compile does not paint over this doc's PDF", () => {
    beginCompile("doc-A");
    noteAssetFetch("doc-A", "pgf.sty");
    render(<PdfPaneOverlay docId="doc-B" stale={false} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
