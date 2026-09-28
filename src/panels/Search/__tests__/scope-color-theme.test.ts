// SCOPE_COLOR ↔ theme-SSOT drift pin (audit-058).
//
// The bug class (D5 · parallel-switches): `SCOPE_COLOR` was a hand-copied
// `Record<SearchScope, hex>` that DECLARED it mirrored each scope's card-kind
// accent ("matches CARD_THEMES") but had silently drifted for 3 of 10 scopes —
// todos / revisions / bibliography wore stale greys while their result-card
// bodies wore the real (brown/purple/khaki) theme, an on-card contradiction.
//
// The fix DERIVES `SCOPE_COLOR` from the theme SSOT
// (`DEFAULT_PANEL_COLORS[SCOPE_TO_CARD_THEME[scope]]`) so it can't drift again.
// These pins lock that contract: if a future edit re-literalizes either table,
// or a panel-color default changes without the search accent following, CI
// fails here.

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  SCOPE_COLOR,
  SCOPE_TO_CARD_THEME,
  SCOPE_ORDER,
  scopeDotBackground,
  type SearchScope,
} from "@/lib/search-sources";
import { DEFAULT_PANEL_COLORS } from "@/lib/panel-theme";
// panel-primitives reaches the storage barrel, whose FSA backend doesn't
// resolve under vitest; this suite touches no storage.
vi.mock("@/lib/storage", () => ({}));
import {
  themedCardStyle,
  NEUTRAL_SELECTED_BORDER,
} from "@/components/panel-primitives";

describe("SCOPE_COLOR is derived from the theme SSOT (audit-058)", () => {
  it("every non-transparent scope wears its card kind's accent", () => {
    for (const scope of SCOPE_ORDER) {
      const key = SCOPE_TO_CARD_THEME[scope];
      if (key === null) continue;
      expect(SCOPE_COLOR[scope]).toBe(DEFAULT_PANEL_COLORS[key]);
    }
  });

  it("mainText has no source kind, so it stays transparent", () => {
    expect(SCOPE_COLOR.mainText).toBe("transparent");
  });

  it("mainText borrows NO theme — its SELECTED state is neutral, not revision purple (task 824)", () => {
    // STYLE_GUIDE "No theme is neutral": a row that points at no kind must not
    // wear a stand-in theme. Until task 824 mainText mapped to "revision", so a
    // selected main-text hit painted the revision accent's selected border.
    expect(SCOPE_TO_CARD_THEME.mainText).toBeNull();
    expect(themedCardStyle(null, true).borderColor).toBe(NEUTRAL_SELECTED_BORDER);
    expect(NEUTRAL_SELECTED_BORDER).toMatch(/^var\(--/);
    // Only mainText is kind-less; every other scope names a real theme key.
    for (const scope of SCOPE_ORDER) {
      if (scope === "mainText") continue;
      expect(SCOPE_TO_CARD_THEME[scope], scope).not.toBeNull();
      expect(DEFAULT_PANEL_COLORS[SCOPE_TO_CARD_THEME[scope]!], scope).toBeTruthy();
    }
  });

  it("covers exactly the SearchScope set (no scope missing an accent)", () => {
    // SCOPE_TO_CARD_THEME is the SSOT for the correspondence; SCOPE_COLOR and
    // SCOPE_ORDER must agree with it so no scope renders undefined.
    const themeKeys = Object.keys(SCOPE_TO_CARD_THEME).sort();
    const colorKeys = Object.keys(SCOPE_COLOR).sort();
    const orderKeys = [...SCOPE_ORDER].sort();
    expect(colorKeys).toEqual(themeKeys);
    expect(orderKeys).toEqual(themeKeys);
  });

  it("pins the three formerly-drifted scopes to their real theme accents", () => {
    // Regression guard for the exact user-visible fix: these three had drifted
    // greys (#a8a29e / #78716c / #6b6245) before audit-058.
    const expected: Partial<Record<SearchScope, string>> = {
      todos: "#44403c", // todo theme, was #a8a29e
      revisions: "#9333ea", // revision (purple), was #78716c
      bibliography: "#b8a968", // bib (khaki), was #6b6245
    };
    for (const [scope, hex] of Object.entries(expected)) {
      expect(SCOPE_COLOR[scope as SearchScope]).toBe(hex);
    }
  });

  it("resolves the neutral (mainText / transparent) dot fill to the --ink-muted token, not a raw hex (audit-308)", () => {
    // The two scope-dot renderers used to hardcode the raw `--ink-muted` hex
    // (byte-for-byte) as the transparent-scope fallback. Fold it onto the token
    // so the neutral dot tracks the ink vocabulary and the two renderers can't
    // drift apart.
    expect(scopeDotBackground("transparent")).toBe("var(--ink-muted)");
    // A source-kind accent passes through untouched (the colored branch).
    expect(scopeDotBackground("#9333ea")).toBe("#9333ea");
  });

  it("every kinded row renders its scope label — the cue that separates same-accent kinds (task 824)", () => {
    // footnote and cut hits share the rust accent and sit in one list, so the
    // label must be derived from "this row has a kind", not special-cased.
    const src = readFileSync(
      path.join(__dirname, "..", "SearchPanel.tsx"),
      "utf8",
    );
    expect(src).toMatch(
      /const showScopeLabel = SCOPE_TO_CARD_THEME\[result\.scope\] !== null;/,
    );
    expect(DEFAULT_PANEL_COLORS.footnote).toBe(DEFAULT_PANEL_COLORS.cut);
  });
});
