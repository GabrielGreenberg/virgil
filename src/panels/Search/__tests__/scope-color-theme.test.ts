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

import { describe, it, expect } from "vitest";
import {
  SCOPE_COLOR,
  SCOPE_TO_CARD_THEME,
  SCOPE_ORDER,
  scopeDotBackground,
  type SearchScope,
} from "@/lib/search-sources";
import { DEFAULT_PANEL_COLORS } from "@/lib/panel-theme";

describe("SCOPE_COLOR is derived from the theme SSOT (audit-058)", () => {
  it("every non-transparent scope wears its card kind's accent", () => {
    for (const scope of SCOPE_ORDER) {
      if (scope === "mainText") continue;
      expect(SCOPE_COLOR[scope]).toBe(
        DEFAULT_PANEL_COLORS[SCOPE_TO_CARD_THEME[scope]],
      );
    }
  });

  it("mainText has no source kind, so it stays transparent", () => {
    expect(SCOPE_COLOR.mainText).toBe("transparent");
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
});
