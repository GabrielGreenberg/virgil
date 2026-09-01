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
import { cssCommentsStripped } from "@/lib/__tests__/_source-scan";

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
    // --link-anchor-color.
    //
    // A `var(…, #xxxxxx)` FALLBACK is still legal here — it is the graceful
    // pre-mount default, not the live source, and it has to be a literal
    // because CSS cannot import TS. What is NOT legal, and what this comment
    // used to license in as many words ("those are fine"), is that literal
    // drifting from the value it restates: see the task-494 block below, which
    // pins every one of them to `DEFAULT_PANEL_COLORS`. This leg governs the
    // ASSIGNMENT; that one governs the FALLBACK.
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

/**
 * Task 494 — the pre-mount FALLBACK is PINNED to the value it restates.
 *
 * Every accent selector in globals.css reads `var(--link-anchor-accent-<token>,
 * #rrggbb)`. The var is stamped at mount by `EditorLayout` from the live theme;
 * the literal is what paints BEFORE that effect runs (SSR, first paint, and any
 * path where the injector has not run yet). CSS cannot import TS, so the literal
 * has to be hand-written — which makes it a hand-written restatement of
 * `DEFAULT_PANEL_COLORS`, one per token, with nothing holding it in step.
 *
 * Measured at HEAD there was zero drift across all 20, so this is a live
 * invariant with no guard rather than a live defect — and the sentence that
 * licensed the gap was in the suite above ("Default-hex `var(…, #xxxxxx)`
 * fallbacks are fine"), renegotiated in place. A drift here paints the wrong
 * colour for the pre-mount window, which is exactly the window nobody looks at.
 *
 * The token → theme-key map is read off the LIVE `IN_TEXT_ANCHOR_ACCENTS`,
 * never a restated list, so a new accent token is covered by declaring itself.
 *
 * Two directions, and the second is the one with teeth:
 *   1. every fallback matches `DEFAULT_PANEL_COLORS[themeKeyForToken(token)]`;
 *   2. every accent-var READ carries a fallback at all — a read with none
 *      paints NOTHING pre-mount, which no assertion about hexes can see.
 */
describe("task 494 — accent var fallbacks are pinned to DEFAULT_PANEL_COLORS", () => {
  const css = cssCommentsStripped(
    readFileSync(resolve(__dirname, "../../app/globals.css"), "utf8"),
  );

  const THEME_KEY_BY_TOKEN = new Map(
    IN_TEXT_ANCHOR_ACCENTS.map((r) => [r.token, r.themeKey] as const),
  );

  /** Every `var(--link-anchor-accent-<token> …)` occurrence, with whatever
   *  fallback it carries. Token-EXACT: a loose `[a-z-]+` prefix-matches
   *  `--link-anchor-accent-cut` out of `…-cutter-comment`, so the capture stops
   *  at the comma or the closing paren and the token is then looked up. */
  const READS = [
    ...css.matchAll(
      /var\(\s*--link-anchor-accent-([a-z0-9-]+)\s*(?:,\s*([^)]*?)\s*)?\)/g,
    ),
  ].map((m) => ({ token: m[1], fallback: (m[2] ?? "").trim() }));

  it("the sweep is not vacuous — it sees every read and every token", () => {
    // Floor renegotiated 20 -> 19 in task 525, which deleted ONE read: the
    // Mode-A `[data-paragraph-kind="report-request"]` rule, dead by derivation
    // (that kind's `cssToken` is `report`, so the attribute could never hold
    // the value). The TOKEN is untouched — its Mode-B
    // `.linked-anchor[data-link-card^="report-request:"]` read is live — so
    // this is a floor about the sweep's reach, not a contract about which
    // reads exist. The two legs below are where the content is.
    expect(READS.length).toBeGreaterThanOrEqual(19);
    const seen = new Set(READS.map((r) => r.token));
    // Every token the CSS reads is a token the SSOT declares…
    for (const r of READS) {
      expect(
        THEME_KEY_BY_TOKEN.has(r.token),
        `globals.css reads an accent var for unknown token "${r.token}"`,
      ).toBe(true);
    }
    // …and the CSS really does read more than a couple of them.
    expect(seen.size).toBeGreaterThanOrEqual(10);
  });

  it("every fallback hex equals the token's DEFAULT_PANEL_COLORS value", () => {
    const drift: string[] = [];
    for (const { token, fallback } of READS) {
      const key = THEME_KEY_BY_TOKEN.get(token);
      if (!key) continue;
      const want = DEFAULT_PANEL_COLORS[key].toLowerCase();
      if (fallback.toLowerCase() !== want) {
        drift.push(
          `--link-anchor-accent-${token} falls back to "${fallback}" but ` +
            `DEFAULT_PANEL_COLORS.${key} is ${want}`,
        );
      }
    }
    expect(drift).toEqual([]);
  });

  it("every accent-var read CARRIES a fallback — a bare read paints nothing pre-mount", () => {
    const bare = READS.filter((r) => r.fallback === "").map((r) => r.token);
    expect(bare).toEqual([]);
  });

  /**
   * M3 — the two bare amber literals on `.linked-anchor`. One is the
   * "unrecognised kind" base (`--link-anchor-color: #fbbf24`), one the
   * `color-mix` tint fallback (`var(--tint-color, #fbbf24)`). Both restate
   * `DEFAULT_PANEL_COLORS.highlight` from the same table as the 20 above and
   * had the same absence of a pin. They stay literals for the same reason
   * (CSS cannot import TS); what changes is that a drift is now a red test.
   */
  it("the .linked-anchor amber fallbacks equal DEFAULT_PANEL_COLORS.highlight", () => {
    const amber = DEFAULT_PANEL_COLORS.highlight.toLowerCase();
    const base = css.match(
      /\.linked-anchor\s*\{[^}]*--link-anchor-color:\s*(#[0-9a-fA-F]{3,8})\s*;/,
    );
    expect(base, "the .linked-anchor base rule no longer declares a fallback color").toBeTruthy();
    expect(base![1].toLowerCase()).toBe(amber);

    const mix = css.match(/var\(\s*--tint-color\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/);
    expect(mix, "the tint color-mix no longer carries a fallback").toBeTruthy();
    expect(mix![1].toLowerCase()).toBe(amber);
  });
});
