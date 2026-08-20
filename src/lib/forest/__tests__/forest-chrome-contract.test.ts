/**
 * Task 384 — the forest renderer's CHROME contract, read off `globals.css`.
 *
 * The renderer's look is not decoration here, it is part of the claim. Three
 * things have to hold and none of them is visible to a behavioural test of the
 * layout engine or the grammar:
 *
 *  - **The tree is ONE colour, inherited.** Edges, roofs and labels all resolve
 *    `currentColor` on the container, so the drawing takes the document's ink in
 *    both themes and cannot drift into a third palette. A stroke spelled as a
 *    hex is a tree that reads correctly in light and wrongly in dark, silently.
 *  - **The badge is a WARNING, not an alarm.** STYLE_GUIDE's rule is that RED
 *    means an action would destroy content WITHOUT a net; nothing here can
 *    destroy anything, so amber. This is a leg rather than a habit because the
 *    tempting change is one token wide.
 *  - **Print shows the picture and drops the chrome.** Pinned in BOTH
 *    directions — the tree must not be hidden, and the pod frame, the corner and
 *    the badge must be.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssCommentsStripped } from "@/lib/__tests__/_source-scan";

const CSS = cssCommentsStripped(
  readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8"),
);

/**
 * Blank out `var(--token, fallback)` fallbacks before a hex sweep. A fallback IS
 * decoration in this codebase (STYLE_GUIDE: "with a fallback it is decoration —
 * the fallback is the real value only when the token is undefined"), and every
 * pod rule in this family carries one; indicting them would make the leg fail on
 * the house idiom instead of on a drifted colour.
 */
function withoutVarFallbacks(body: string): string {
  return body.replace(/var\([^)]*\)/g, "var()");
}

/** The declaration block of a rule whose selector list contains `selector`. */
function ruleBody(selector: string): string {
  // The selector must END here — `.forest-tree-edge` is a PREFIX of
  // `.forest-tree-edges` (the SVG container), and a bare `indexOf` reads the
  // wrong rule and then asserts about it, which is a leg that passes or fails
  // for reasons unrelated to what it claims.
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
  const m = re.exec(CSS);
  if (!m) throw new Error(`no rule for ${selector} in globals.css`);
  const open = CSS.indexOf("{", m.index);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

describe("the tree takes the document's ink", () => {
  for (const sel of [".forest-tree-edge", ".forest-tree-roof"]) {
    it(`${sel} strokes currentColor, never a hex`, () => {
      const body = ruleBody(sel);
      expect(body).toContain("stroke: currentColor");
      expect(withoutVarFallbacks(body)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });
  }

  it(".forest-tree resolves a token for its ink", () => {
    expect(ruleBody(".forest-tree")).toMatch(/color:\s*var\(--ink-strong/);
  });

  it("math in a label takes the document's math ink", () => {
    expect(ruleBody(".forest-node-math")).toMatch(/var\(--math-color/);
  });

  it("no `:has()` anywhere in the forest family — the Wave-0 invalidation rule", () => {
    const forestRules = CSS.split("}")
      .filter((chunk) => /\.forest-/.test(chunk.split("{")[0] ?? ""))
      .join("\n");
    expect(forestRules).not.toContain(":has(");
  });
});

describe("the refusal badge is a warning, not an alarm", () => {
  it("wears the amber warning tier and no red", () => {
    const body = ruleBody(".forest-refusal-badge");
    expect(body).toContain("var(--amber-500)");
    expect(body).toContain("var(--amber-100)");
    expect(body).not.toMatch(/--danger|--footnote-500/);
    expect(withoutVarFallbacks(body)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("its icon takes the same amber, not an independent hex", () => {
    expect(ruleBody(".forest-refusal-badge-icon")).toContain("var(--amber-500)");
  });
});

describe("print", () => {
  const PRINT = (() => {
    const i = CSS.indexOf("@media print");
    return CSS.slice(i);
  })();

  it("shows the tree — no rule hides it", () => {
    expect(PRINT).not.toMatch(/\.forest-tree[^-][^{]*\{[^}]*display:\s*none/);
    expect(PRINT).not.toMatch(/\.forest-node[^{]*\{[^}]*display:\s*none/);
  });

  it("drops the pod frame around a derived body", () => {
    const body = PRINT.slice(PRINT.indexOf(".source-pod-derived"));
    expect(body).toMatch(/border:\s*0\s*!important/);
  });

  it("drops the corner chrome and the badge", () => {
    expect(PRINT).toMatch(
      /\.source-pod-corner,\s*\.forest-refusal-badge\s*\{[^}]*display:\s*none\s*!important/,
    );
  });
});
