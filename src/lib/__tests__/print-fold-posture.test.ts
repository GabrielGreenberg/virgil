/**
 * Task 408 — the PRINT FOLD POSTURE, read off `globals.css` and the two
 * plugins that produce the hide classes.
 *
 * The law, stated once in `src/lib/print.ts` and implemented in media queries:
 *
 *   **WHAT PRINTS IS THE DOCUMENT, NOT THE EDITOR'S CURRENT FOLD STATE.**
 *
 * Three surfaces leaked three different unstated answers onto paper — a folded
 * section printed NOTHING, a LOCKED focus band printed only the band (the rest
 * of the document silently absent), and a collapsed source pod printed a
 * two-line truncated stub. All three are PERSISTED per doc, so all three are
 * ordinary starting conditions, not transients.
 *
 * Why this suite is CSS-shaped rather than behavioural (the `forest-chrome-
 * contract` shape): jsdom implements no media queries, no cascade origins and
 * no `getComputedStyle` cascade, so "does this element paint on paper?" is not
 * a question it can answer at all. What IS assertable is the MECHANISM — and
 * the mechanism is the whole finding, because the two candidate mechanisms
 * differ in exactly one way that no behavioural test would ever see.
 *
 * The one behavioural leg that CAN be driven is the pod's paper body: it must
 * be in the DOM with no dependency on print state.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssCommentsStripped, commentsStripped } from "./_source-scan";

const ROOT = process.cwd();
const CSS = cssCommentsStripped(readFileSync(join(ROOT, "src/app/globals.css"), "utf8"));

/** Everything from `@media print {` to the end of the file. */
const PRINT_BLOCK = CSS.slice(CSS.indexOf("@media print"));

/** The `@media screen { … }` block that carries the fold suppression — `""`
 *  when there is none, so a missing block fails the ONE leg that names it
 *  rather than throwing at module scope and collecting zero tests (a fatal
 *  import error reads as "no tests", which is indistinguishable from a suite
 *  that was never written). */
const SCREEN_BLOCK = (() => {
  const at = CSS.indexOf("@media screen");
  if (at < 0) return "";
  // Brace-match so the block's own nested rules are included and the next
  // top-level rule after it is not.
  let depth = 0;
  let i = CSS.indexOf("{", at);
  const open = i;
  for (; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return CSS.slice(open + 1, i);
})();

/**
 * The hide classes, DISCOVERED from the plugins that stamp them rather than
 * hand-listed here. This is the leg with teeth and the reason it reads the
 * plugins: the CSS was never the part that could misbehave — a THIRD hiding
 * decoration that declares its own `display: none` is, and it would be
 * invisible to every assertion about the two classes someone remembered.
 * A rename is caught in the same pass, and a rename is the silent one: the
 * class stops matching, nothing throws, and folding simply stops working.
 */
const HIDE_CLASSES = (() => {
  const found = new Set<string>();
  for (const rel of ["src/lib/section-folding.ts", "src/lib/focus-view.ts"]) {
    // `commentsStripped`, not `codeOnly` — the stamped class IS a string
    // literal, which `codeOnly` blanks. Comments are still dropped, so a
    // retired class named in prose cannot re-enter the census.
    const src = commentsStripped(readFileSync(join(ROOT, rel), "utf8"));
    // The stamped literal is `class: "<name>"` inside a `Decoration.node` spec.
    for (const m of src.matchAll(/\bclass:\s*"([a-z0-9-]+)"/g)) found.add(m[1]);
  }
  return [...found].sort();
})();

describe("the hide-class census", () => {
  it("globals.css carries an `@media screen` block at all", () => {
    expect(SCREEN_BLOCK).not.toBe("");
  });

  it("discovers exactly the two shipped hiding decorations", () => {
    // Not a hand list restated — a floor that proves the discovery WORKS. A
    // needle that matched nothing would make every leg below vacuous.
    expect(HIDE_CLASSES).toEqual(["focus-hidden", "section-folded"]);
  });

  for (const cls of HIDE_CLASSES) {
    it(`\`.${cls}\` hides ONLY inside the screen block`, () => {
      expect(SCREEN_BLOCK).toContain(`.${cls}`);
      // …and nowhere else may hide it. Every other occurrence in the file must
      // be free of a `display` declaration, or the print posture is decided in
      // two places again.
      const outside = CSS.split(SCREEN_BLOCK).join("\n");
      for (const m of outside.matchAll(new RegExp(`\\.${cls}(?![\\w-])[^{}]*\\{([^}]*)\\}`, "g"))) {
        expect(
          m[1],
          `a second rule outside @media screen sets display on .${cls}`,
        ).not.toMatch(/display\s*:/);
      }
    });
  }

  it("the screen block hides by `display: none !important` and nothing weaker", () => {
    // `!important` is load-bearing: a NodeView may carry its own inline or
    // author display, and a fold that loses a specificity race is a section
    // that refuses to fold.
    expect(SCREEN_BLOCK).toMatch(/display:\s*none\s*!important/);
  });
});

describe("the print block does not restate `display` for a folded block", () => {
  // THE finding, and the one no behavioural test could ever reach. The obvious
  // mechanism is `@media print { .section-folded, .focus-hidden { display:
  // revert !important } }` — later, equal specificity, wins. There is no value
  // it could restate: `revert` discards the whole AUTHOR origin for the
  // property, so an `.expex-block` (`display: grid`) or a `.latex-comment`
  // (`display: flex`) sitting inside a folded section would print as a plain
  // block with its layout destroyed, silently, with no error. Absence is the
  // only exact answer, and a media query is the only mechanism for absence.
  for (const cls of HIDE_CLASSES) {
    it(`\`.${cls}\` is not named in @media print at all`, () => {
      expect(PRINT_BLOCK).not.toContain(`.${cls}`);
    });
  }

  it("no rule anywhere reverts `display` on a document block", () => {
    // A guard against the tempting fix arriving under a different selector.
    expect(PRINT_BLOCK).not.toMatch(/display:\s*revert/);
  });
});

describe("the mechanism is path-independent", () => {
  // `html[data-printing]` is stamped ONLY by `runPrint` (applyPrintAttrs). The
  // browser's own File → Print reaches the `beforeprint` listener and nothing
  // else, so a posture keyed on that attribute silently fails for the door most
  // people use. This is a constraint on every future print change, which is why
  // it is a leg and not a comment.
  it("no fold/collapse posture is keyed on `data-printing`", () => {
    for (const m of CSS.matchAll(/\[data-printing[^\]]*\][^{]*\{[^}]*\}/g)) {
      expect(
        m[0],
        "a fold posture keyed on data-printing is invisible to File → Print",
      ).not.toMatch(/section-folded|focus-hidden|source-pod-preview|source-pod-print-source/);
    }
  });

  it("`print.ts` records the two-door constraint where print state is owned", () => {
    const src = readFileSync(join(ROOT, "src/lib/print.ts"), "utf8");
    expect(src).toMatch(/what prints is the DOCUMENT/i);
    // The native door must SAY that applyPrintAttrs never runs for it — that
    // sentence is the whole reason the mechanism is a media query.
    const at = src.indexOf("Native File→Print fallback");
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 900)).toMatch(/data-printing/);
  });
});

describe("a collapsed source pod prints its SOURCE", () => {
  it("the screen preview is dropped in print media", () => {
    expect(PRINT_BLOCK).toMatch(/\.source-pod-preview\s*\{[^}]*display:\s*none\s*!important/);
  });

  it("the paper body rides `.print-only`, which the print block already reveals", () => {
    // The already-tested idiom: base `display: none`, print `display: block`.
    // Reusing it is what removes the React dependency on print state.
    expect(CSS).toMatch(/\.print-only\s*\{\s*display:\s*none;?\s*\}/);
    expect(PRINT_BLOCK).toMatch(/\.print-only\s*\{\s*display:\s*block;?\s*\}/);
  });

  it("the paper body wraps instead of clipping", () => {
    // A `<pre>` defaults to `white-space: pre`, which in paged media does not
    // paginate horizontally — it runs off the page edge, silently, exactly the
    // clipping failure the derived-body scroll release exists to prevent.
    const at = PRINT_BLOCK.indexOf(".source-pod-print-source");
    expect(at).toBeGreaterThan(-1);
    const body = PRINT_BLOCK.slice(at, PRINT_BLOCK.indexOf("}", at));
    expect(body).toMatch(/white-space:\s*pre-wrap/);
    expect(body).toMatch(/break-inside:\s*avoid/);
  });

  it("editor-only pod affordances stay off the paper", () => {
    // The fold chevron paints RED while folded; a collapsed pod that now prints
    // its body would otherwise carry a red arrow into the paper's margin.
    expect(PRINT_BLOCK).toMatch(
      /\.source-pod-fold-chevron,\s*\.source-pod-row-sensor\s*\{[^}]*display:\s*none\s*!important/,
    );
  });

  it("the NodeView renders the paper body with no print-state condition", () => {
    // `commentsStripped`, NOT `codeOnly`: the class name lives inside a JSX
    // string attribute, and `codeOnly` blanks string literals — the exact trap
    // `_source-scan`'s own header documents.
    const src = commentsStripped(
      readFileSync(join(ROOT, "src/components/SourcePodNodeView.tsx"), "utf8"),
    );
    expect(src).toContain("print-only source-pod-print-source");
    // The pod may not learn about printing: no matchMedia, no beforeprint, no
    // data-printing read. That is what makes both doors behave identically.
    expect(src).not.toMatch(/matchMedia|beforeprint|dataset\.printing|data-printing/);
  });
});
