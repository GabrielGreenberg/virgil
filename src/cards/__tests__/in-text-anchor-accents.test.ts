// @vitest-environment jsdom
/**
 * #27 pin tests — the in-text anchor accent map is DERIVED from CARD_THEMES /
 * DEFAULT_PANEL_COLORS via CARD_REGISTRY + the legacy-token crosswalk, replacing
 * the two hand-mirrored hex tables that used to live in globals.css
 * (`.linked-anchor[data-link-card^=…]` Mode B + `[data-paragraph-kind=…]`
 * Mode A). Each token's accent now resolves through the SAME source as the card
 * outline's `--link-anchor-color: theme.accent` PanelCard stamp (chip E), so a
 * panel-color override can't desync card-outline vs in-text anchor paint.
 *
 * Two guards:
 *   1. Derivation coverage — every CSS token the two globals.css blocks select
 *      on has a row, mapped to the correct theme accent (default hex).
 *   2. Source assertion — the hand-mirrored hex tables are GONE from globals.css
 *      (the selectors now read `var(--link-anchor-accent-<token>)`).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// `@/cards/predicates` only reaches the light `card-registry` +
// `legacy-token-crosswalk` (type-only) leaves — but keep the standard storage
// stub in case a transitive edit ever pulls the barrel in (the known gotcha).
vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy({}, { get: () => noop }) as Record<string, unknown>;
});

import {
  IN_TEXT_ANCHOR_ACCENTS,
  inTextAnchorAccentVar,
} from "@/cards/predicates";
import { DEFAULT_PANEL_COLORS } from "@/lib/panel-theme";

/** The CSS tokens the two globals.css blocks select on (Mode A ∪ Mode B). The
 *  expected theme accent for each, frozen as the shipped DEFAULT_PANEL_COLORS
 *  value so a registry/crosswalk edit that re-tints a token trips here. */
const EXPECTED: Record<string, keyof typeof DEFAULT_PANEL_COLORS> = {
  note: "note",
  highlight: "highlight",
  cut: "cut",
  // cutter anchors carry their own data-link-card token; both paint the `cut`
  // accent (the old hand-table omitted them → they fell back to amber).
  "cutter-comment": "cut",
  "cutter-suggestion": "cut",
  comment: "revision", // revision-* anchors emit `comment:` / paint the revision accent
  archive: "archive",
  report: "report",
  "report-request": "report",
  todo: "todo",
};

describe("#27 in-text anchor accent derivation", () => {
  it("covers every CSS token with the correct theme accent (no hand-mirrored hex)", () => {
    const byToken = new Map(IN_TEXT_ANCHOR_ACCENTS.map((r) => [r.token, r]));
    for (const [token, themeKey] of Object.entries(EXPECTED)) {
      const row = byToken.get(token);
      expect(row, `missing accent row for token "${token}"`).toBeTruthy();
      expect(row!.themeKey).toBe(themeKey);
      // The row resolves to the live theme accent — equal to the shipped
      // default hex when no override is set.
      // (EditorLayout calls getPanelColor(row.themeKey) at inject time.)
      expect(DEFAULT_PANEL_COLORS[row!.themeKey]).toBe(
        DEFAULT_PANEL_COLORS[themeKey],
      );
    }
  });

  it("has no stray tokens beyond the CSS contract", () => {
    const tokens = new Set(IN_TEXT_ANCHOR_ACCENTS.map((r) => r.token));
    for (const token of tokens) {
      expect(
        Object.prototype.hasOwnProperty.call(EXPECTED, token),
        `unexpected accent token "${token}" — add a globals.css rule + an EXPECTED entry`,
      ).toBe(true);
    }
    // Sanity: the cutter tokens ARE present (the omission #27 fixed).
    expect(tokens.has("cutter-comment")).toBe(true);
    expect(tokens.has("cutter-suggestion")).toBe(true);
  });

  it("builds the canonical CSS var name", () => {
    expect(inTextAnchorAccentVar("note")).toBe("--link-anchor-accent-note");
    for (const row of IN_TEXT_ANCHOR_ACCENTS) {
      expect(row.cssVar).toBe(`--link-anchor-accent-${row.token}`);
    }
  });
});

describe("#27 globals.css source — hex tables deleted", () => {
  const css = readFileSync(
    resolve(__dirname, "../../app/globals.css"),
    "utf8",
  );

  it("the two anchor-color blocks read CSS vars, not literal hex declarations", () => {
    // Pull just the two blocks (the linked-anchor data-link-card map + the
    // data-paragraph-kind map) and assert none assign a bare hex to
    // --link-anchor-color. (Default-hex `var(…, #xxxxxx)` fallbacks are fine —
    // those are graceful pre-mount defaults, not the live source.)
    const lines = css.split("\n");
    const offenders: string[] = [];
    for (const line of lines) {
      const isAnchorRule =
        /\.linked-anchor\[data-link-card\^=/.test(line) ||
        /\[data-paragraph-kind=/.test(line);
      if (!isAnchorRule) continue;
      // A bare hex assignment: `--link-anchor-color: #rrggbb` NOT inside var(…).
      if (/--link-anchor-color:\s*#[0-9a-fA-F]{3,6}\s*;/.test(line)) {
        offenders.push(line.trim());
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every accent token has a globals.css selector reading its var", () => {
    for (const row of IN_TEXT_ANCHOR_ACCENTS) {
      expect(
        css.includes(`var(${row.cssVar}`),
        `globals.css missing var(${row.cssVar}) for token "${row.token}"`,
      ).toBe(true);
    }
  });
});
