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

  it(".forest-tree takes the DOCUMENT's ink and face, pref-override included", () => {
    const body = ruleBody(".forest-tree");
    // The same pair `.tiptap` itself resolves — a tree is the paper's writing,
    // so a retuned main-text font or colour must reach it. Spelled the same way
    // in both rules or the two silently drift apart.
    expect(body).toMatch(/color:\s*var\(--editor-text-color/);
    expect(body).toMatch(/var\(--font-serif-override,\s*var\(--font-serif\)\)/);
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

describe("the corner does not swallow clicks the pod used to receive", () => {
  // The pre-384 chip was a bare element carrying `pointer-events-none`, sitting
  // over the 44px right inset the code surface reserves; a click there fell
  // through to `.cm-content` and placed a caret. Wrapping it in a flex box —
  // the whole point of the shared corner — reintroduces a hit target unless the
  // WRAPPER is click-through and the one real control opts back in. A
  // shared-class refactor that makes a corner of every texBlock pod inert is
  // exactly the silent regression this family's rules exist to prevent.
  it("the corner itself is click-through", () => {
    expect(ruleBody(".source-pod-corner")).toMatch(/pointer-events:\s*none/);
  });

  it("the chip is too — it is read, not pressed", () => {
    expect(ruleBody(".source-pod-chip")).toMatch(/pointer-events:\s*none/);
  });

  it("…and the mode toggle opts back IN, or it cannot be clicked at all", () => {
    expect(ruleBody(".source-pod-mode-toggle")).toMatch(/pointer-events:\s*auto/);
  });

  it("the SCROLL box is inside the frame, so the corner does not scroll away", () => {
    // An overflow container positions its absolute descendants against its
    // CONTENT. With the scroll on the frame itself, the mode toggle slid out of
    // reach on exactly the trees whose source you most want to open.
    expect(ruleBody(".source-pod-derived")).not.toMatch(/overflow/);
    expect(ruleBody(".source-pod-derived-scroll")).toMatch(/overflow-x:\s*auto/);
    expect(ruleBody(".source-pod-derived")).toMatch(/position:\s*relative/);
  });

  it("the banner slot is positioned, or the row sensor covers its text", () => {
    // `.source-pod-row-sensor` is an absolutely positioned FIRST child of the
    // pod and hit-tests above any in-flow sibling — which is why the preview
    // and the editor beside it both carry `position: relative`. The banner is a
    // generic slot, so the POD owns its stacking rather than each contributor
    // re-discovering the trap.
    expect(ruleBody(".source-pod-banner")).toMatch(/position:\s*relative/);
  });
});

describe("print", () => {
  // This describe is about the DERIVED body — a rendered tree on paper. The
  // wider posture it sits inside (what a folded section, a locked focus band and
  // a COLLAPSED pod put on paper) is task 408's, and lives in
  // `src/lib/__tests__/print-fold-posture.test.ts`. Kept apart on purpose: that
  // law governs three surfaces and two of them have nothing to do with forest.
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

  it("releases the derived body's scroll constraint, or a wide tree is CLIPPED", () => {
    // An `overflow: auto` box does not paginate or grow in paged media — it
    // clips at its border box. On screen the scrollbar says so; on paper
    // nothing does, and the right-hand subtrees are simply gone.
    const at = PRINT.indexOf(".source-pod-derived-scroll");
    const body = PRINT.slice(at, PRINT.indexOf("}", at));
    expect(body).toMatch(/overflow:\s*visible\s*!important/);
  });

  it("drops the corner chrome and the badge", () => {
    // RENEGOTIATED (task 535): pre-535 this leg pinned a BY-NAME print rule
    // (`.source-pod-corner, .forest-refusal-badge { display: none }`) — the
    // hand-list shape the print block's own comment said the marker rule
    // existed to replace. The posture now lives where the WRITER declares it:
    // both elements are stamped `chromeOnly(...)` and ONE marker rule hides
    // every chrome-only element. `print-chrome-only-posture.test.ts` pins that
    // the by-name rule is gone; this leg pins the two stamps and the rule.
    const corner = readFileSync(join(process.cwd(), "src/components/SourcePodNodeView.tsx"), "utf8");
    const badge = readFileSync(join(process.cwd(), "src/components/ForestRefusalBadge.tsx"), "utf8");
    expect(corner).toMatch(/chromeOnly\(\s*"source-pod-corner"\s*\)/);
    expect(badge).toMatch(/chromeOnly\(\s*"forest-refusal-badge"\s*\)/);
    expect(PRINT).toMatch(/\.virgil-chrome-only\s*\{[^}]*display:\s*none\s*!important/);
  });
});
