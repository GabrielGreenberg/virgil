import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

/**
 * HEADING-DIVIDER INSETS FOLLOW THE LIVE EDITOR PADDING (task 829).
 *
 * A heading divider's `::before` CANCELS the prose box's horizontal padding
 * so a "full" rule reaches the pane edge and a "mid" rule stops halfway. That
 * padding is `--editor-pl` / `--editor-pr` — user-draggable (useMarginEdit),
 * not the shipped 88/72. The insets used to restate the default as literals
 * (`-88px/-72px`, "mid" `-44px/-36px`), so any dragged margin left a "full"
 * divider short of — or past — the edge it claims to reach.
 *
 * Contract:
 *  - the divider `::before` insets are DERIVED from the padding tokens, with
 *    no length literal outside a `var()` fallback;
 *  - the width preferences carry only a unitless FRACTION (so the padding
 *    `var()` resolves on the `::before`, where the live value is inherited —
 *    not on whatever ancestor the class happens to sit on);
 *  - no rule anywhere cancels the padding with a hardcoded `-88px`/`-72px`;
 *  - print, which zeroes `.tiptap`'s padding, zeroes the TOKENS too, so every
 *    canceller follows to 0 instead of bleeding past the column.
 */

const CSS_PATH = path.resolve(__dirname, "../app/globals.css");
const css = readFileSync(CSS_PATH, "utf8");
const root = postcss.parse(css, { from: CSS_PATH });

/** Remove every `var(--x, <fallback>)` fallback so only live lengths remain. */
function withoutVarFallbacks(value: string): string {
  let out = value;
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(/var\((--[\w-]+)\s*,[^()]*(\([^()]*\))*[^()]*\)/g, "var($1)");
  }
  return out;
}

const dividerBeforeRules: Rule[] = [];
root.walkRules((rule) => {
  if (/heading-wrapper-l\d::before/.test(rule.selector)) dividerBeforeRules.push(rule);
});

describe("heading divider insets", () => {
  it("finds the divider ::before rules", () => {
    expect(dividerBeforeRules.length).toBeGreaterThan(0);
  });

  it("derives left/right from --editor-pl/--editor-pr, never a length literal", () => {
    let checked = 0;
    for (const rule of dividerBeforeRules) {
      rule.walkDecls(/^(left|right)$/, (decl) => {
        checked++;
        const token = decl.prop === "left" ? "--editor-pl" : "--editor-pr";
        expect(decl.value, `${rule.selector} { ${decl.prop} }`).toContain(`var(${token}`);
        expect(withoutVarFallbacks(decl.value), `${rule.selector} { ${decl.prop} }`)
          .not.toMatch(/\d(px|em|rem)/);
      });
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });

  it("width preferences declare only a unitless fraction", () => {
    const seen: Record<string, string> = {};
    root.walkRules(/^\.dividers-width-(full|mid|text)$/, (rule) => {
      rule.walkDecls((decl) => {
        expect(decl.prop, rule.selector).toBe("--divider-inset-frac");
        expect(decl.value, rule.selector).toMatch(/^-?\d+(\.\d+)?$/);
        seen[rule.selector] = decl.value;
      });
    });
    expect(seen).toEqual({
      ".dividers-width-full": "1",
      ".dividers-width-mid": "0.5",
      ".dividers-width-text": "0",
    });
  });

  it("retires the length-valued --divider-inset-left/right tokens", () => {
    expect(css).not.toMatch(/--divider-inset-(left|right)/);
  });

  it("no declaration cancels the padding with a hardcoded default literal", () => {
    const offenders: string[] = [];
    root.walkDecls((decl) => {
      if (/(^|[^\w-])-(88|72|44|36)px/.test(withoutVarFallbacks(decl.value))
        && /^(left|right|margin-left|margin-right|inset-inline-start|inset-inline-end)$/.test(decl.prop)) {
        offenders.push(`${(decl.parent as Rule).selector} { ${decl.prop}: ${decl.value} }`);
      }
    });
    expect(offenders).toEqual([]);
  });

  it("print zeroes the padding TOKENS alongside the padding", () => {
    let found = false;
    root.walkAtRules("media", (at: AtRule) => {
      if (!/\bprint\b/.test(at.params)) return;
      at.walkRules(".tiptap", (rule) => {
        const decls = Object.fromEntries(
          rule.nodes.filter((n) => n.type === "decl").map((d) => [d.prop, d.value]),
        );
        if (decls.padding !== "0") return;
        found = true;
        expect(decls["--editor-pl"]).toBe("0px");
        expect(decls["--editor-pr"]).toBe("0px");
      });
    });
    expect(found).toBe(true);
  });
});
