// CSS-invalidation guardrail (perf Wave 4 P6) — the stylesheet half of the
// keystroke-sanctity law.
//
// Wave 0 removed every live `:has()` from globals.css (each was a measured
// style-invalidation cliff: Blink re-evaluates `:has()` ancestors on
// subtree mutations, and the retired command-only-paragraph selector alone
// cost a full-tree recalc class) and killed the universal drop-mode
// descendant selector (36 ms full-tree recalc at 18.5k nodes, per drag
// edge). Those removals were doctrine-only until now; this test gives them
// CI teeth, the same probe+grep pattern as the sibling guardrails.
//
// Also pinned: the Wave-4 Stage A containment block stays SCOPED under
// `body.perf-contain` — an unscoped `contain:` rule would apply the
// experiment to every user before its soak.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GLOBALS = path.resolve(HERE, "../../app/globals.css");

/** Strip CSS comments — globals.css documents its RETIRED `:has()` selectors
 *  in prose (8 mentions today), and doctrine must never read as a selector. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("css-invalidation guardrail — globals.css", () => {
  const raw = readFileSync(GLOBALS, "utf8");
  const css = stripCssComments(raw);

  it("has ZERO live :has() selectors (Wave-0's removal stays removed)", () => {
    // Every historical `:has()` here was a measured invalidation cliff. A new
    // one needs a write-time replacement (class stamp / node decoration /
    // data-attr from the owning NodeView) — the four Wave-0 patterns.
    expect(css.includes(":has(")).toBe(false);
  });

  it("keeps the universal drop-mode descendant selector dead (body-only form present)", () => {
    // The `body[data-drop-mode-active] *` form cost a 36 ms full-tree recalc
    // per drag edge; the body-only form inherits identically. (Also pinned in
    // content-drag-guardrail — this copy keeps the stylesheet law self-
    // contained with its siblings.)
    expect(/body\[data-drop-mode-active[^\]]*\]\s*\*/.test(css)).toBe(false);
    expect(css.includes('body[data-drop-mode-active="true"]')).toBe(true);
  });

  it("every contain: rule is scoped under body.perf-contain (the Stage-A flag)", () => {
    // `contain` changes containing-block semantics; it ships as an opt-in
    // experiment. Find each declaration line and require the flag class in
    // its selector block. (contain-intrinsic-size would belong to the
    // rejected Stage B — it must not appear at all.)
    expect(css.includes("contain-intrinsic-size")).toBe(false);
    const blocks = css.split("}");
    for (const block of blocks) {
      if (!/(?:^|[;{\s])contain\s*:/.test(block)) continue;
      expect(
        block.includes("body.perf-contain"),
        `unscoped contain: rule in block: ${block.slice(0, 120)}`,
      ).toBe(true);
    }
  });

  it("content-visibility stays out entirely (Stage B was decision-gated and REJECTED)", () => {
    // The visible-window trace (docs/perf/style-invalidation-findings.md)
    // found no per-keystroke style mass for cv-auto to win against; adopting
    // it would buy artifact risk for nothing. Re-run the trace before ever
    // deleting this pin.
    expect(css.includes("content-visibility")).toBe(false);
  });
});
