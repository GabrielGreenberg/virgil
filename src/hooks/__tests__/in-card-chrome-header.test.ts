// In-card chrome header — the section breadcrumb + docked MenuBar now render
// as ONE white header band INSIDE the white card, not in the manilla band
// above it, and the card's top outer gap is SYMMETRIC with its bottom.
//
// Source-contract guards (same style as top-leadin-and-strip-zeroflow.test.ts):
// these pin the structural decisions that a careless refactor would silently
// undo (e.g. the strip drifting back to a manilla background, or the card edge
// re-coupling to the chrome height).
//
// THE TOOTH:
//   - paint the header manilla (background var(--background)) → RED
//   - re-couple the card edge to --chrome-top instead of --pod-top → RED
//   - resurrect --tool-strip-h / --pod-edge-inset / --menubar-width vars → RED
//   - revert --chrome-top to the non-parsing calc() form → RED (scroll-margin)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", "..", rel), "utf8");
}

const EDITOR_PANE = read("components/EditorPane.tsx");
const CHROME_SCROLL = read("lib/tiptap/chrome-scroll-margin.ts");

describe("in-card chrome header — symmetric card edge", () => {
  it("--pod-top (card top edge) is locked to --pod-cap-inner (= the 8px bottom gap)", () => {
    expect(EDITOR_PANE).toContain(
      "['--pod-top' as string]: 'var(--pod-cap-inner)'",
    );
  });

  it("the top outer gap is an in-flow spacer of height --pod-top (mirror of the bottom 8px spacer)", () => {
    expect(EDITOR_PANE).toContain("style={{ height: 'var(--pod-top)' }}");
  });

  it("card-EDGE chrome (frame ring + top cap) reads --pod-top, not --chrome-top", () => {
    // The frame ring now sits at the card edge (--pod-top); the in-card header
    // lives inside it. The cap's white inner lands at --pod-top too.
    expect(EDITOR_PANE).toContain("top: 'var(--pod-top)'");
    expect(EDITOR_PANE).toContain(
      "top: 'calc(var(--pod-top) - var(--pod-cap-bleed))'",
    );
  });
});

describe("in-card chrome header — white, in-card, unified", () => {
  it("the chrome strip is a white (var(--pod-editor)) z-30 header band, not a manilla tool-strip", () => {
    expect(EDITOR_PANE).toContain(
      'className="flex items-center justify-between shrink-0 sticky z-30 pointer-events-none"',
    );
    // The strip's own background is the white pod surface (the manilla
    // var(--background) tool-strip is gone).
    expect(EDITOR_PANE).toContain("background: 'var(--pod-editor)',");
  });

  it("the breadcrumb + MenuBar are ONE row (justify-between), so the --menubar-width measurement is gone", () => {
    // The merged flex row makes the old ResizeObserver + max-width calc dead.
    expect(EDITOR_PANE).not.toContain("['--menubar-width'");
    expect(EDITOR_PANE).not.toContain("dockedMenuBarRef");
  });
});

describe("in-card chrome header — retired conflated tokens", () => {
  it("--tool-strip-h and --pod-edge-inset are retired (the chrome height no longer doubles as the card edge)", () => {
    expect(EDITOR_PANE).not.toContain("['--tool-strip-h'");
    expect(EDITOR_PANE).not.toContain("['--pod-edge-inset'");
  });

  it("--chrome-top is emitted as plain px (content-area top), not the old non-parsing calc()", () => {
    expect(EDITOR_PANE).toContain("['--chrome-top' as string]: `${chromeTopPx}px`");
    expect(EDITOR_PANE).not.toContain("calc(var(--tool-strip-h)");
  });
});

describe("chrome-scroll-margin tracks the in-card header", () => {
  it("reads --chrome-top as a parseable plain px (fallback refreshed off the old 24)", () => {
    expect(CHROME_SCROLL).toContain('readPxVar(dom, "--chrome-top"');
    expect(CHROME_SCROLL).not.toContain('"--chrome-top", 24');
  });
});
