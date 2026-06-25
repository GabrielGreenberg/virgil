// ITEM 2 + ITEM 3 — top-of-document whitespace fixes.
//
// Two coupled-but-independent guards on the top-of-pod geometry:
//
//   ITEM 2 — the one-off title lead-in is restored DECOUPLED from the
//   adjustable top margin. The old --doc-top-extra baked a fixed +40px
//   INTO the prose padding-top, which is exactly why deleting it also let
//   the slider reach 0. The replacement is a scroll-away pseudo-element
//   (height-based, ~40px) that is INDEPENDENT of --editor-pt and does NOT
//   reintroduce --doc-top-extra (a separate existing test already guards
//   that var's absence in Editor.tsx; here we guard that the globals.css
//   lead-in mechanism exists and likewise avoids the old var).
//
//   The lead-in is SCOPED per surface via a `.doc-prose-leadin` marker
//   class (set in Editor.tsx's editor class string) — NOT the bare
//   `.tiptap` class, which would leak the 40px gap into every text-object
//   pop-out float and lifted drag clone (they're all bare `.tiptap`).
//
//   ITEM 3 — the expand/collapse-all sections strip is GENUINE zero-flow.
//   The old `height: 24; marginBottom: -24` hack only fakes zero-flow in
//   block layout; a flex parent's `gap` is NOT cancelled by the negative
//   margin, reserving a phantom band. The fix is the proven SectionLozenge
//   pattern: `height: 0` sticky container (zero height in BOTH block and
//   flex), sticky-on-scroll preserved.
//
// The TOOTH: re-bake the lead-in into --editor-pt / drop the ::before → RED.
// Restore the marginBottom:-24 hack on the strip → RED.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(rel: string): string {
  return readFileSync(resolve(__dirname, "..", "..", rel), "utf8");
}

const GLOBALS = read("app/globals.css");
const EDITOR_PANE = read("components/EditorPane.tsx");
const EDITOR = read("components/Editor.tsx");

// Whitespace-insensitive view for robust substring matching.
const GLOBALS_FLAT = GLOBALS.replace(/\s+/g, " ");

describe("ITEM 2 — decoupled, SURFACE-SCOPED title lead-in (.doc-prose-leadin::before)", () => {
  it("globals.css defines a .doc-prose-leadin::before lead-in rule (scoped, not bare .tiptap)", () => {
    expect(GLOBALS).toContain(".doc-prose-leadin::before");
  });

  it("the lead-in is NOT applied via the bare .tiptap::before selector (would leak into floats/lift clones)", () => {
    // The bare-`.tiptap` form would paint the 40px gap into every
    // text-object pop-out float and lifted drag clone (all bare `.tiptap`),
    // defeating their flush-top campaigns. The lead-in must be scoped.
    expect(GLOBALS).not.toContain(".tiptap::before");
  });

  it("Editor.tsx's editor class string carries the doc-prose-leadin marker (the scope hook)", () => {
    expect(EDITOR).toContain("doc-prose-leadin");
  });

  it("the lead-in is a height-based, scroll-away pseudo-element", () => {
    // content:"" + display:block + a height term, in the ::before block.
    const block = GLOBALS_FLAT.slice(
      GLOBALS_FLAT.indexOf(".doc-prose-leadin::before"),
      GLOBALS_FLAT.indexOf(".doc-prose-leadin::before") + 220,
    );
    expect(block).toContain("content");
    expect(block).toContain("display: block");
    expect(block).toContain("height:");
    expect(block).toContain("pointer-events: none");
  });

  it("does NOT reintroduce the dead --doc-top-extra var (in the lead-in or anywhere in globals.css)", () => {
    expect(GLOBALS).not.toContain("--doc-top-extra");
  });

  it("the lead-in is independent of the adjustable top margin (not baked into --editor-pt)", () => {
    const block = GLOBALS_FLAT.slice(
      GLOBALS_FLAT.indexOf(".doc-prose-leadin::before"),
      GLOBALS_FLAT.indexOf(".doc-prose-leadin::before") + 220,
    );
    // The lead-in must not couple itself to the slider-driven top inset.
    expect(block).not.toContain("--editor-pt");
  });
});

describe("ITEM 3 — expand/collapse strip is genuine zero-flow", () => {
  it("EditorPane no longer uses the marginBottom:-24 zero-flow hack", () => {
    expect(EDITOR_PANE).not.toContain("marginBottom: -24");
  });

  it("the strip uses a height:0 sticky container", () => {
    // The strip wrapper carries top:0 + height:0 (same as the SectionLozenge
    // precedent). Match the exact style we ship for the strip.
    expect(EDITOR_PANE).toContain("style={{ top: 0, height: 0 }}");
  });

  it("the strip restores a full-width zero-flow hover band (discoverability)", () => {
    // height:0 collapses the hover target to the tiny button footprint, but
    // the buttons are the SOLE entry point (no menu/keyboard fallback). An
    // absolute full-width × 24px band (top-0/left-0/right-0/h-6,
    // pointer-events-auto) re-arms `group-hover` across the whole pod top
    // while adding ZERO flow height (container stays height:0).
    expect(EDITOR_PANE).toContain(
      'className="absolute top-0 left-0 right-0 h-6 pointer-events-auto"',
    );
  });
});
