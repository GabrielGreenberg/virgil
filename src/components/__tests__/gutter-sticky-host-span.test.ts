/**
 * The right gutter's sticky lozenge stays pinned however few cards the side
 * holds (task 1604).
 *
 * A sticky box travels only inside its containing block. The lozenge's host,
 * `[data-gutter-side-host]`, took its height from what it held: the omni pod,
 * whose height is only its measured minimum (`editorContentHeight`, 0 when no
 * card is anchored — unanchored cards live in the bin). On a paper with no
 * anchored right-side cards the host shrank to the lozenge and the lozenge
 * scrolled away with the page. The collapsed side had its own inline patch;
 * the rule is now ONE unconditional CSS declaration on the host.
 *
 * jsdom does no layout and resolves no CSS variables, so this pins the
 * specified rule and the JSX shape, not a measured top.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const PANE = readFileSync(join(process.cwd(), "src/components/EditorPane.tsx"), "utf8");

/** The declaration block of the rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  return m ? m[1] : null;
}

describe("right gutter lozenge — its sticky host spans the scroll range (task 1604)", () => {
  it("the lozenge is sticky (the premise)", () => {
    expect(ruleBody(".gutter-side-head")).toMatch(/position:\s*sticky/);
  });

  it("the host carries the scroll-range min-height unconditionally, in CSS", () => {
    const body = ruleBody("[data-gutter-side-host]");
    expect(body, "no `[data-gutter-side-host]` rule in globals.css").not.toBeNull();
    expect(body).toMatch(/min-height:\s*var\(--row-bound-h,\s*100%\)/);
  });

  it("the lozenge is a direct child of the host, and the host has no inline height switch", () => {
    const host = PANE.match(/<div\b[^>]*?data-gutter-side-host=\{side\}[^>]*>\s*<div className="gutter-lozenge gutter-side-head"/);
    expect(host, "the lozenge is no longer the host's first child").not.toBeNull();
    // The old collapsed-only patch (`contentsHidden ? { minHeight … }`) must
    // not come back as a second, conditional spelling of the rule.
    expect(host![0]).not.toMatch(/style=/);
    expect(PANE).not.toMatch(/contentsHidden\s*\?\s*\{\s*minHeight/);
  });
});
