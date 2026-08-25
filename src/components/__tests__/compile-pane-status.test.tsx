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
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CompilePaneStatus } from "@/components/CompilePaneStatus";
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
