// @vitest-environment jsdom
/**
 * TASK 454 — WHICH WORDS REACH THE PDF PANE.
 *
 * The catcher's report on the live app: *"the PDF pane is an empty dark
 * surface … nothing anywhere says a compile is running or has failed."* That is
 * a RENDER fact, so only a render leg can see it — no test of the compile
 * service or of the progress store can tell whether the pixel exists.
 *
 * The contract is that "there is no PDF" resolves to THREE different messages,
 * because it is three different situations, and telling them apart is the whole
 * of the honesty half (task 392's law, one subsystem over).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { CompilePaneStatus, PdfPaneOverlay } from "@/components/CompilePaneStatus";
import {
  __resetAllCompileProgress,
  beginCompile,
  finishCompile,
  noteAssetFetch,
  notePass,
} from "@/lib/compile/compile-progress";

const DOC = "doc-pane";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  __resetAllCompileProgress();
});

describe("the PDF pane always says which of the three states it is in", () => {
  it("nothing yet → the honest prompt", () => {
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByText("No compiled PDF")).toBeTruthy();
  });

  it("downloading packages → says so, and says how many", () => {
    // The phase that takes MINUTES on a first tikz compile and that showed
    // nothing at all before this task.
    beginCompile(DOC);
    noteAssetFetch(DOC, "pgfcore.sty");
    noteAssetFetch(DOC, "pgfsys-pdftex.def");
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText(/Downloading LaTeX packages — 2 so far/)).toBeTruthy();
    // …and WHY it is slow, or it reads as a hang.
    expect(screen.getByText(/cached afterwards/)).toBeTruthy();
  });

  it("typesetting → names the pass", () => {
    beginCompile(DOC);
    notePass(DOC, 2, 3);
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByText(/pass 2 of 3/)).toBeTruthy();
  });

  it("a continuation says which attempt the user is watching", () => {
    beginCompile(DOC, { attempt: 2 });
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByText(/Attempt 2/)).toBeTruthy();
  });

  it("a FAILED compile shows what happened, not the generic prompt", () => {
    beginCompile(DOC);
    finishCompile(DOC, "timeout", "Still downloading LaTeX packages (48 so far).");
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Still downloading LaTeX packages \(48 so far\)/)).toBeTruthy();
    // The pre-454 words must NOT be what a failure shows — that is the defect.
    expect(screen.queryByText("No compiled PDF")).toBeNull();
  });

  it("a SUCCESSFUL compile with no blob falls back to the prompt, not an alert", () => {
    // The one state where the generic prompt is still the right answer: the
    // compile is over and fine, and the pane simply has nothing to show yet.
    beginCompile(DOC);
    finishCompile(DOC, "ok");
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByText("No compiled PDF")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders another document's pane as idle", () => {
    // A module-singleton service under multi-pane keep-alive: pane B must not
    // render pane A's compile.
    beginCompile("doc-A");
    noteAssetFetch("doc-A", "pgf.sty");
    render(<CompilePaneStatus docId="doc-B" />);
    expect(screen.getByText("No compiled PDF")).toBeTruthy();
  });
});

describe("task 855 — the record says what the user is waiting on NOW", () => {
  it("a continuation's attempt line rides ALONGSIDE the fetching line", () => {
    // A continuation exists only because of fetching, so an attempt line shown
    // "instead of" the fetching line was never visible.
    beginCompile(DOC, { attempt: 2 });
    noteAssetFetch(DOC, "tikz.sty");
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByText(/Downloading LaTeX packages/)).toBeTruthy();
    expect(screen.getByText(/Attempt 2 — resuming/)).toBeTruthy();
  });

  it("once no download has arrived for the quiet interval, it reads as typesetting", () => {
    vi.useFakeTimers();
    beginCompile(DOC);
    notePass(DOC, 1, 1);
    noteAssetFetch(DOC, "pgfcore.sty");
    noteAssetFetch(DOC, "pgfsys.def");
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.getByText(/Downloading LaTeX packages — 2 so far/)).toBeTruthy();
    // A new download inside the window keeps it downloading.
    act(() => {
      vi.advanceTimersByTime(600);
      noteAssetFetch(DOC, "tikz.sty");
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText(/Downloading LaTeX packages — 3 so far/)).toBeTruthy();
    // Silence: pdfTeX is past the downloads and working through the pass.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByText(/Downloading LaTeX packages/)).toBeNull();
    expect(screen.getByText(/Typesetting — downloaded 3 packages/)).toBeTruthy();
    // And the cold-compile sentence is gone with it.
    expect(screen.queryByText(/first compile of a paper/)).toBeNull();
  });

  it("a paper with a PDF showing is not told it is on its first compile", () => {
    beginCompile(DOC);
    noteAssetFetch(DOC, "tikz.sty");
    render(<PdfPaneOverlay docId={DOC} stale={false} />);
    expect(screen.getByText(/hasn't used before/)).toBeTruthy();
    expect(screen.queryByText(/first compile of a paper/)).toBeNull();
  });

  it("the user's own Cancel is the neutral prompt, never an alert", () => {
    beginCompile(DOC);
    finishCompile(DOC, "cancelled");
    render(<CompilePaneStatus docId={DOC} />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/didn.t produce a PDF/)).toBeNull();
    expect(screen.getByText("No compiled PDF")).toBeTruthy();
    expect(screen.getByText("Compile cancelled.")).toBeTruthy();
  });
});
