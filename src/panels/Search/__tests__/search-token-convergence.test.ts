// Task 309 — the Search panel's three "lit" surfaces must read from the token
// SSOTs the rest of the app paints from.
//
// The panel predates the amber-token consolidation (171 / 280 / 292 / 305) and
// was the one panel-family surface it never reached. Its two search-MODE
// toggles (`Aa` match-case, `W` whole-word) painted their ON state
// `border-[var(--accent)] text-[var(--accent)] bg-amber-50/60`, and the result
// card's matched run painted `bg-amber-200/80`. Two distinct bypasses, one
// root cause:
//
//  1. WRONG-ROLE TOKEN. `--accent`'s own declaration comment reserves it for
//     the user-overridable link / selection / mark / CTA accent and says the
//     toggle "on" aesthetic is "decoupled from --accent on purpose". So a user
//     retinting `--accent` moved these two toggles while every other segmented
//     control in the app (Outline Edit/Focus, PrintDialog font size, every
//     `.topbarbtn`/`.iconbtn-toggle`) stayed on the warm-taupe
//     `--control-selected*` family. Neither the compiler nor any render test
//     can see that: both spellings are valid CSS that paints *something*.
//  2. RAW TAILWIND AMBER. There is no `--color-amber-*` in the `@theme inline`
//     block, so a bare `bg-amber-200` resolves to Tailwind v4's DEFAULT amber,
//     not this repo's warm `--amber-*` scale — the identical class
//     `bibliography-amber-strip-convergence.test.ts` (280/305) and
//     `examples-amber-token.test.ts` (292) already pin on their surfaces.
//
// Resolved by Gabriel (2026-08-08): match the app's other toggles. The toggles
// take the toggle-state SSOT's TINT path (`--control-selected-tint` /
// `--control-selected-ink` — the pair `.topbarbtn[aria-pressed="true"]` and
// `.iconbtn-toggle[aria-pressed="true"]` paint from, and which had no `.tsx`
// consumer at all before this task); the matched run genuinely IS a text
// highlight, so it takes the purpose-built `--amber-highlight-*` family.
//
// The leg with teeth is the DIRECTORY census: the constants were never the
// part that could misbehave — a fourth lit surface authored beside them with a
// raw literal is, and that is exactly what shipped here twice.
//
// The banned raw utilities are assembled from fragments so this guard file
// does not itself trip its own directory-wide grep.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { commentsStripped, cssRuleBodies } from "@/lib/__tests__/_source-scan";

const here = dirname(fileURLToPath(import.meta.url));
const PANEL_DIR = resolve(here, "..");
const ROOT = resolve(here, "..", "..", "..", "..");

/** Every PRODUCTION source file in `src/panels/Search/` (tests excluded — a
 *  suite naming the banned spelling is not a drift). Comments blanked, string
 *  literals KEPT: a className needle lives inside the quotes, so stripping
 *  literals would make every leg below unfalsifiable (task 205's lesson). */
const productionSources: Record<string, string> = Object.fromEntries(
  readdirSync(PANEL_DIR)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => [f, commentsStripped(readFileSync(join(PANEL_DIR, f), "utf8"))]),
);

const panelSource = productionSources["SearchPanel.tsx"];
const globals = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");

describe("Search panel token convergence (task 309)", () => {
  it("scans the production files it means to scan", () => {
    // Swallow self-check: a stripper bug (or a moved file) that emptied the
    // census would make every leg below pass vacuously. Anchored on names this
    // task did NOT introduce — a canary standing on the fix would itself fail
    // on the pre-fix tree, which proves nothing about the census's reach.
    expect(Object.keys(productionSources)).toContain("SearchPanel.tsx");
    expect(panelSource.length).toBeGreaterThan(10_000);
    expect(panelSource).toContain("MAX_RENDERED_RESULTS");
    expect(panelSource).toContain("className=");
  });

  it("carries no raw Tailwind amber utility on any Search surface", () => {
    // bg-/border-/text-amber-N, with or without an opacity suffix — the RAW
    // utility, not the bracketed token form `bg-[var(--amber-50)]`.
    const rawAmber = new RegExp("(?:bg|border|text)-" + "amber" + "-\\d+(?:/\\d+)?");
    for (const [name, src] of Object.entries(productionSources)) {
      expect(src, name).not.toMatch(rawAmber);
    }
  });

  it("never paints a toggle ON state from the link/CTA accent", () => {
    // The wrong-role coupling, pinned at the site rather than as a blanket ban
    // on `--accent` in this directory: a genuine link or CTA here would still
    // be free to read it.
    expect(panelSource).toMatch(/const MODE_TOGGLE_ON\s*=/);
    const onDecl = /const MODE_TOGGLE_ON\s*=\s*([\s\S]*?);/.exec(panelSource)?.[1] ?? "";
    expect(onDecl).not.toContain("--accent");
  });

  it("paints both mode toggles from the toggle-state SSOT's tint path", () => {
    const onDecl = /const MODE_TOGGLE_ON\s*=\s*([\s\S]*?);/.exec(panelSource)?.[1] ?? "";
    expect(onDecl).toContain("bg-[var(--control-selected-tint)]");
    expect(onDecl).toContain("text-[var(--control-selected-ink)]");
    expect(onDecl).toContain("border-[var(--control-selected-ink)]");
  });

  it("spells that treatment ONCE for both toggles", () => {
    // `Aa` and `W` are the same control twice. Spelled per-button they had
    // already drifted together onto amber and could next drift apart; a shared
    // const is what makes the leg above cover both.
    // Occurrences MINUS the declaration — the read count, whatever expression
    // shape the className happens to use.
    const uses = (name: string) =>
      [...panelSource.matchAll(new RegExp(name, "g"))].length -
      [...panelSource.matchAll(new RegExp(`const\\s+${name}\\s*=`, "g"))].length;
    expect(uses("MODE_TOGGLE_BASE")).toBe(2);
    expect(uses("MODE_TOGGLE_ON")).toBe(2);
    expect(uses("MODE_TOGGLE_OFF")).toBe(2);
  });

  it("announces the toggles' pressed state", () => {
    // The semantic half of "match the app's other toggles": the shared
    // utilities key their paint on `aria-pressed`, and a hand-rolled toggle
    // that paints the same state must at least announce it.
    expect([...panelSource.matchAll(/aria-pressed=/g)].length).toBe(2);
  });

  it("washes the result match from the amber-highlight family", () => {
    expect(panelSource).toMatch(
      /<mark className="bg-\[var\(--amber-highlight-wash-active\)\] text-\[var\(--amber-highlight-ink\)\]/,
    );
  });

  it("gives the toggle-state tint pair a consumer outside its own declaration", () => {
    // The pair was defined with detailed AA-contrast comments and consumed
    // only by two globals.css utilities — no `.tsx` read anywhere. A token
    // family nothing reads is the dead-SSOT class (171/202); this asserts the
    // half that keeps it honest, from EITHER silo, so a later conversion of
    // these buttons onto a shared class does not fail the leg.
    for (const token of ["--control-selected-tint", "--control-selected-ink"]) {
      const inRules = cssRuleBodies(globals).includes(`var(${token})`);
      const inPanel = panelSource.includes(`var(${token})`);
      expect(inRules || inPanel, `${token} has a consumer`).toBe(true);
    }
  });
});
