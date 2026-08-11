// @vitest-environment node
/**
 * BUG #56 pin — typing a lone `\` must NOT compress the paragraph the user is
 * typing in.
 *
 * Root cause: `latex-command.ts` paints a `.latex-cmd` decoration on a bare
 * backslash (`matchCommandLength` returns 1 for "\"), so the instant a user
 * types `\` into a fresh/empty paragraph that paragraph's SOLE child is the
 * `.latex-cmd` span and it matches
 *   `.tiptap p:has(> .latex-cmd:first-child:last-child)`.
 * That base `:has()` rule USED to set `line-height: 1.5` (dropping the typed
 * paragraph's own baseline from the body 1.6) + `margin-bottom: 0.15em`
 * (fighting the unified inter-block model's `margin-bottom: 0`) — so the very
 * paragraph being typed in shifted its own rhythm on the keystroke.
 *
 * Fix (CSS-only — the grey lone-`\` affordance is intentionally kept): the
 * BASE command-only `:has()` rule must declare NO line-height / margin-bottom
 * override (a single command-only line keeps the same rhythm as any other
 * paragraph). The DELIBERATE tightening of a RUN of consecutive command lines
 * is retained, but lives ENTIRELY on the adjacent-sibling rule and tightens
 * the gap-bearing `margin-top` (the property the unified rhythm model owns),
 * never the typed line's own baseline.
 *
 * Pure CSS, so this is a static source-assertion guard (same pattern as
 * in-text-anchor-accents.test.ts) rather than a layout measurement — and it
 * documents WHY the override was removed so a future edit can't silently
 * reintroduce the self-shift.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

/** Extract the `{ … }` declaration block immediately following `selector`. */
function blockFor(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `selector not found in globals.css: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  expect(open).toBeGreaterThan(-1);
  expect(close).toBeGreaterThan(open);
  return css.slice(open + 1, close);
}

// Perf Wave 0 (plan P5.1): the command-only paragraph is now flagged by the
// latex-command plugin as a `p-cmd-only` NODE DECORATION (same DOM semantics
// the old `p:has(> .latex-cmd:first-child:last-child)` selector had — exactly
// one element child and it's the `.latex-cmd` span), so the rhythm rule is
// class-based and the `:has()` invalidation cost is gone. The #56 teeth are
// unchanged: no base command-only rule may touch the typed line's own
// baseline; the run-tightening lives on the sibling rule's margin-top.
const COMMAND_ONLY_RUN = ".tiptap p.p-cmd-only + p.p-cmd-only";

describe("BUG #56 — lone-`\\` paragraph keeps its own rhythm", () => {
  it("there is NO base command-only rule that overrides line-height / margin-bottom", () => {
    // The ONLY occurrence of the command-only class at the start of a rule
    // must be the adjacent-sibling (run) rule. A standalone base rule
    // (`.tiptap p.p-cmd-only {` with no sibling combinator) is exactly the
    // regression — and so is a resurrected `:has()` form.
    const baseRulePattern = /\.tiptap p\.p-cmd-only\s*\{/;
    expect(
      baseRulePattern.test(css),
      "a standalone base `.tiptap p.p-cmd-only { … }` rule is back — it " +
        "paints on the lone-`\\` typed paragraph and shifts its own baseline (#56)",
    ).toBe(false);
    // Comment-stripped so the historical mentions in the BUG #56 prose don't
    // false-positive; only a LIVE selector may match.
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const hasRulePattern = /\.latex-cmd:first-child:last-child\)[^{]*\{/;
    expect(
      hasRulePattern.test(cssNoComments),
      "the `:has(> .latex-cmd…)` selector form is back — perf Wave 0 replaced " +
        "it with the plugin-painted p-cmd-only class (plan P5.1)",
    ).toBe(false);
  });

  it("the run-tightening rule exists and tightens margin-top (not the typed line's baseline)", () => {
    const runBlock = blockFor(COMMAND_ONLY_RUN);
    // The deliberate run-tightening lives here and uses the gap-bearing
    // margin-top (the unified inter-block model's gap property).
    expect(runBlock).toMatch(/margin-top\s*:/);
    // It must NOT mutate the line's own internal baseline — that was the bug.
    expect(runBlock).not.toMatch(/line-height\s*:/);
  });

  it("no command-only rule anywhere sets line-height (the #56 baseline self-shift)", () => {
    // Belt-and-suspenders: scan every rule whose selector mentions the
    // command-only class and assert none reintroduce a line-height override.
    const selectorRe = /\.tiptap p\.p-cmd-only[^{]*\{([^}]*)\}/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = selectorRe.exec(css)) !== null) {
      count++;
      expect(
        /line-height\s*:/.test(m[1]),
        `a command-only rule sets line-height — that is the #56 baseline self-shift:\n${m[0]}`,
      ).toBe(false);
    }
    // Sanity: we actually found (and inspected) the run rule.
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("the affordance is preserved — `.latex-cmd` is still styled grey monospace", () => {
    // The fix is CSS-rhythm-only; the grey lone-`\` decoration must remain so
    // the user still sees the command affordance while typing.
    const block = blockFor(".tiptap .latex-cmd");
    expect(block).toMatch(/--latex-cmd-color/);
    expect(block).toMatch(/font-family/);
  });
});
