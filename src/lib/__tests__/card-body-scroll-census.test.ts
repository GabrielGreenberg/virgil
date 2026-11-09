/**
 * CARD-BODY SCROLL CENSUS (task 1424) — "a nested editor never scrolls an
 * ancestor it doesn't own", and every expanded card body takes ONE cap.
 *
 * Two seams, two legs:
 *
 *  1. CONTAINMENT. Every `useEditor(` outside the main `Editor.tsx` is a
 *     NESTED editor (card body, float body, example card, borrowed text). Each
 *     must mount `handleScrollToSelection: scrollWithinOwnBox`, or
 *     ProseMirror's paste / Enter / typing `scrollIntoView` walks up into the
 *     document row scroller and jumps the paper ("paste jumps the screen").
 *
 *  2. CAP. Every file that renders an expanded card body (`PANEL.cardBody` /
 *     `PANEL.cardInner` body, or a named bespoke body) takes its scroll
 *     behaviour from `cardBodyScroll(...)` — never a hand-rolled
 *     `--dock-slot-frame-h … - 160px` maxHeight (the old near-full-pane cap
 *     that let a long note run off the page).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, codeOnly, commentsStripped, trackedFiles } from "./_source-scan";

const rel = (p: string) => path.relative(REPO_ROOT, p);
const SRC = trackedFiles("src", /\.tsx?$/).filter(
  (p) => !p.includes(`${path.sep}__tests__${path.sep}`),
);
const read = (p: string) => codeOnly(fs.readFileSync(p, "utf8"));
/** Comments out, string/template bodies KEPT — class names live in templates. */
const readWithStrings = (p: string) => commentsStripped(fs.readFileSync(p, "utf8"));

/** The main document editor — the ONE editor that owns the row scroller. */
const MAIN_EDITOR = "src/components/Editor.tsx";

/** Expanded bodies that don't spell `PANEL.cardBody`/`cardInner` but are
 *  card bodies all the same. */
const BESPOKE_BODIES = ["src/panels/_shared/SuggestionCard.tsx"];

/** Files that spell `PANEL.cardInner` for something that is NOT an expanded
 *  card body (each reasoned). */
const NOT_BODIES: Record<string, string> = {
  "src/panels/Search/SearchPanel.tsx":
    "a search-hit ROW (a <button> of a few lines) borrows the padding token; it never expands",
};

describe("card-body scroll census (task 1424)", () => {
  it("every nested editor mounts scrollWithinOwnBox", () => {
    const offenders: string[] = [];
    let population = 0;
    for (const p of SRC) {
      const code = read(p);
      if (!/\buseEditor\(/.test(code)) continue;
      if (rel(p) === MAIN_EDITOR) continue;
      population++;
      if (!/handleScrollToSelection:\s*scrollWithinOwnBox\b/.test(code)) {
        offenders.push(rel(p));
      }
    }
    expect(population).toBeGreaterThanOrEqual(12);
    expect(offenders, "nested editor without scroll containment").toEqual([]);
  });

  it("no expanded body hand-rolls the old dock-frame cap", () => {
    const offenders = SRC.filter((p) =>
      /--dock-slot-frame-h,\s*80vh\)\s*-\s*160px/.test(readWithStrings(p)),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  it("every expanded card body takes its scroll from cardBodyScroll()", () => {
    const offenders: string[] = [];
    let population = 0;
    for (const p of SRC) {
      const r = rel(p);
      const code = readWithStrings(p);
      const isBody =
        /PANEL\.(cardBody|cardInner)\b/.test(code) || BESPOKE_BODIES.includes(r);
      if (!isBody || r in NOT_BODIES) continue;
      population++;
      if (!/\bcardBodyScroll\(/.test(code)) offenders.push(r);
    }
    expect(population).toBeGreaterThanOrEqual(6);
    expect(offenders, "expanded card body without cardBodyScroll()").toEqual([]);
  });

  it("EditableCard's expanded body wears the shared cap", () => {
    const code = fs.readFileSync(path.join(REPO_ROOT, "src/components/panel-primitives.tsx"), "utf8");
    expect(code).toMatch(/\$\{PANEL\.cardBody\} \$\{cardBodyScroll\(isPoppedOut\)\}/);
  });

  it("every card textarea grows with content (task 1524) — no fixed-rows inner scroller", () => {
    // A fixed-height card `<textarea>` is a scroller NESTED in the capped
    // body: the half-pane cap above never engages and a long note reads
    // through a two-line slot. Every textarea under the card silos wears the
    // shared `.card-textarea` content-sizing rule and states no `rows`.
    const CARD_SILOS = [`src${path.sep}panels${path.sep}`, `src${path.sep}cards${path.sep}`];
    const offenders: string[] = [];
    let population = 0;
    for (const p of SRC) {
      if (!p.endsWith(".tsx") || !CARD_SILOS.some((d) => p.includes(d))) continue;
      const code = readWithStrings(p);
      for (const m of code.matchAll(/<textarea\b[\s\S]*?\/>/g)) {
        population++;
        const tag = m[0];
        if (!/\bcard-textarea\b/.test(tag)) offenders.push(`${rel(p)}: no card-textarea class`);
        if (/\brows=\{/.test(tag)) offenders.push(`${rel(p)}: fixed rows`);
      }
    }
    expect(population).toBeGreaterThanOrEqual(2);
    expect(offenders, "card textarea that cannot grow").toEqual([]);
    const css = fs.readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
    const rule = css.match(/\.card-textarea\s*\{([^}]*)\}/);
    expect(rule, ".card-textarea rule").not.toBeNull();
    expect(rule![1]).toMatch(/field-sizing:\s*content/);
    expect(rule![1]).toMatch(/min-height:\s*2lh/);
  });

  it("the cap is half the measured scrollport, contained", () => {
    const css = fs.readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
    const m = css.match(/\.card-body-scroll\s*\{([^}]*)\}/);
    expect(m, ".card-body-scroll rule").not.toBeNull();
    const body = m![1];
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/overscroll-behavior:\s*contain/);
    expect(body).toMatch(
      /max-height:\s*min\(50vh,\s*calc\(var\(--scroll-viewport-h,\s*100dvh\)\s*\*\s*0\.5\)\)/,
    );
  });
});
