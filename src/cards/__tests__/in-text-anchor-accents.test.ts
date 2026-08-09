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
import {
  LEGACY_TOKEN_CROSSWALK,
  accentTokenFromTint,
  defaultTintForLinkedAnchorKind,
} from "@/cards/legacy-token-crosswalk";
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
  // revision anchors emit the SPINE data-link-card token (`revision-comment:` /
  // `revision-suggestion:`); `comment` survives as the Mode-A cssToken
  // (`data-paragraph-kind="comment"`) + a legacy data-link-card alias. All paint
  // the revision accent.
  "revision-comment": "revision",
  "revision-suggestion": "revision",
  comment: "revision",
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

/**
 * Task 174 — the #27 invariant, extended to the TINT channel.
 *
 * The block above guards `--link-anchor-color` (the in-text active ring + the
 * Mode-A paragraph rail). The persistent tint BAND is a second paint channel on
 * the same kind, fed by the `linkedAnchor` mark's `tintColor` attr, and it was
 * the one that escaped: it persisted the RESOLVED `#fbbf24` — byte-identical to
 * `DEFAULT_PANEL_COLORS.highlight`, i.e. copied out of the theme and then
 * frozen — so a Highlight panel-color override repainted the card, the float
 * and the ring while the band, a highlight's entire in-text identity
 * (`markerType: null`), stayed amber. Nothing caught it because the pre-174
 * guards only ever looked at `--link-anchor-color`.
 *
 * The contract now: a DEFAULT band is an accent sentinel resolved by CSS from
 * the live var; a PER-INSTANCE hue stays a literal hex.
 */
describe("#27 tint channel — the default band derives from the live accent", () => {
  const css = readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8");

  /** Every `linkedAnchor.kind` the tint SSOT can be asked about: the spine
   *  kinds (whose mark-attr token equals the spine kind for all but revision)
   *  plus the legacy `revision`/`cut` aliases and the two render sentinels. */
  const MARK_KINDS = [
    ...Object.keys(LEGACY_TOKEN_CROSSWALK),
    "revision",
    "cut",
    "pending-ai-change",
    "pending-ai-request",
  ];

  it("the highlight band is a sentinel naming a real accent token — never a frozen hex", () => {
    const tint = defaultTintForLinkedAnchorKind("highlight");
    const token = accentTokenFromTint(tint);
    expect(token, `highlight tint "${tint}" is not an accent sentinel`).toBeTruthy();
    // The sentinel names a token the accent map actually stamps a :root var for,
    // and that token's theme is the highlight theme — same source as the ring.
    const row = IN_TEXT_ANCHOR_ACCENTS.find((r) => r.token === token);
    expect(row, `no IN_TEXT_ANCHOR_ACCENTS row for sentinel token "${token}"`).toBeTruthy();
    expect(row!.themeKey).toBe("highlight");
  });

  it("every accent-sentinel tint resolves to its live var in globals.css", () => {
    let sentinels = 0;
    for (const kind of MARK_KINDS) {
      const tint = defaultTintForLinkedAnchorKind(kind);
      const token = accentTokenFromTint(tint);
      if (!token) continue;
      sentinels++;
      // The rule that turns the sentinel attr into the live accent. Without it
      // the band silently falls through to the hardcoded `var()` fallback —
      // i.e. back to the frozen amber this task removed.
      const rule = new RegExp(
        `\\.linked-anchor\\[data-tint-color="${tint}"\\][^}]*--tint-color:\\s*var\\(${inTextAnchorAccentVar(token)}`,
      );
      expect(
        rule.test(css),
        `globals.css has no rule resolving data-tint-color="${tint}" to var(${inTextAnchorAccentVar(token)})`,
      ).toBe(true);
    }
    // Guard the guard: if the SSOT stops emitting sentinels entirely, the loop
    // above passes vacuously — exactly the frozen-literal state this pins.
    expect(sentinels).toBeGreaterThan(0);
  });

  it("the pending-AI bands stay per-instance literal hues", () => {
    // These are genuinely per-instance (one shared light blue for BOTH the
    // applied-change and open-request marks, deliberately — Gabriel 2026-07-03),
    // not a panel theme, so they must keep riding the inline `--tint-color`.
    for (const kind of ["pending-ai-change", "pending-ai-request"]) {
      const tint = defaultTintForLinkedAnchorKind(kind);
      expect(tint).toBe("#bfdbfe");
      expect(accentTokenFromTint(tint)).toBeNull();
    }
  });

  it("no kind but highlight paints a default band", () => {
    for (const kind of MARK_KINDS) {
      if (kind === "highlight" || kind.startsWith("pending-ai-")) continue;
      expect(
        defaultTintForLinkedAnchorKind(kind),
        `kind "${kind}" unexpectedly paints a default tint band`,
      ).toBeNull();
    }
  });

  it("no accent-sentinel rule re-freezes a bare hex", () => {
    // The block-scoped twin of the `--link-anchor-color` offender census above.
    // That one is LINE-scoped (its rules are one-liners) and therefore cannot
    // see this rule family at all, which is how the frozen literal would come
    // back: a sentinel rule written as `--tint-color: #fbbf24` paints exactly
    // like the pre-174 code and satisfies every other guard here. A default-hex
    // `var(…, #xxxxxx)` fallback is fine — that is the pre-mount/SSR default,
    // not the live source.
    const blocks = [
      ...css.matchAll(/\.linked-anchor\[data-tint-color=[^\]]*\]\s*\{([^}]*)\}/g),
    ];
    expect(blocks.length).toBeGreaterThan(0);
    const offenders = blocks
      .map((m) => m[1])
      .filter((body) => /--tint-color:\s*#[0-9a-fA-F]{3,8}\s*;/.test(body))
      .map((body) => body.trim());
    expect(offenders).toEqual([]);
  });

  it("the mark never interpolates a sentinel into an inline style", () => {
    // `linked-anchor.ts` only writes `style: --tint-color: <v>` for a strict
    // hex. A sentinel reaching the style sink would both break the CSS and
    // widen an untrusted-value path (the attr rides sidecar JSON).
    const markSrc = readFileSync(
      resolve(__dirname, "../../lib/tiptap/linked-anchor.ts"),
      "utf8",
    );
    expect(markSrc).toContain("/^#[0-9a-fA-F]{3,8}$/.test(tint)");
  });
});
