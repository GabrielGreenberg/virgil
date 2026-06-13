import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  BODY_CLASS_TYPOGRAPHY,
  FONT_STACKS,
  PANEL_BODY_FONT_OPTIONS,
  PANEL_BODY_TIER,
  resolveFontStack,
  resolvePreviewFontStack,
  getPanelTypography,
  getPanelDefault,
  setTierBaseFontSizes,
  setPanelTypographyField,
  clearPanelTypographyField,
  type PanelBodyKey,
} from "@/lib/panel-typography";
import { CARD_REGISTRY } from "@/cards/card-registry";

/**
 * A9 §C2: `DEFAULT_PANEL_TYPOGRAPHY` is DERIVED from `CardMeta.bodyClass`,
 * not hand-kept. This pins the two ratified fixes and the panel-consistency
 * invariant so the declared appearance class and the rendered default can
 * never silently drift.
 */
describe("DEFAULT_PANEL_TYPOGRAPHY is derived from CardMeta.bodyClass", () => {
  it("the two visual tiers are 15px Source Serif 4 (borrowed) and 12px Inter (sans)", () => {
    expect(BODY_CLASS_TYPOGRAPHY.borrowed).toEqual({
      fontFamily: "Source Serif 4",
      fontSize: 15,
      color: "#44403c",
    });
    expect(BODY_CLASS_TYPOGRAPHY.sans).toEqual({
      fontFamily: "Inter",
      fontSize: 12,
      color: "#44403c",
    });
  });

  it("example renders 15px Source Serif 4 (was 12 — the C2 fix)", () => {
    expect(CARD_REGISTRY.example.bodyClass).toBe("borrowed");
    expect(DEFAULT_PANEL_TYPOGRAPHY.example).toEqual(BODY_CLASS_TYPOGRAPHY.borrowed);
    expect(DEFAULT_PANEL_TYPOGRAPHY.example.fontSize).toBe(15);
  });

  it("report renders 12px Inter (R11 — Report is apparatus/sans)", () => {
    expect(CARD_REGISTRY.report.bodyClass).toBe("sans");
    expect(DEFAULT_PANEL_TYPOGRAPHY.report).toEqual(BODY_CLASS_TYPOGRAPHY.sans);
    expect(DEFAULT_PANEL_TYPOGRAPHY.report.fontFamily).toBe("Inter");
  });

  it("footnotes + archive stay 15px serif (borrowed)", () => {
    expect(CARD_REGISTRY.footnote.bodyClass).toBe("borrowed");
    expect(CARD_REGISTRY.archive.bodyClass).toBe("borrowed");
    expect(DEFAULT_PANEL_TYPOGRAPHY.footnote.fontSize).toBe(15);
    expect(DEFAULT_PANEL_TYPOGRAPHY.archive.fontSize).toBe(15);
  });

  it("every panel-body row matches its primary kind's declared class", () => {
    const cases: Array<[PanelBodyKey, "borrowed" | "sans"]> = [
      ["footnote", "borrowed"],
      ["note", "sans"],
      ["archive", "borrowed"],
      ["cut", "sans"],
      ["revision", "sans"],
      ["citation", "sans"],
      ["bib", "sans"],
      ["todo", "sans"],
      ["report", "sans"],
      ["example", "borrowed"],
    ];
    for (const [key, cls] of cases) {
      expect(DEFAULT_PANEL_TYPOGRAPHY[key]).toEqual(BODY_CLASS_TYPOGRAPHY[cls]);
    }
  });

  it("morph siblings share a bodyClass (the per-panel derivation is faithful)", () => {
    // A morph that flipped the rendered typography would be a bug; pin the
    // 4 pairs agree on their class.
    const pairs = [
      ["note", "highlight"],
      ["revision-comment", "revision-suggestion"],
      ["cutter-comment", "cutter-suggestion"],
      ["report", "report-request"],
    ] as const;
    for (const [a, b] of pairs) {
      expect(CARD_REGISTRY[a].bodyClass).toBe(CARD_REGISTRY[b].bodyClass);
    }
  });
});

/**
 * BUG #30: an un-overridden card body's DEFAULT font size tracks the live
 * document, not a frozen literal. `setTierBaseFontSizes(borrowed, sans)` is the
 * O(1), pref-gated push EditorLayout makes when a font pref changes:
 *   - borrowed tier (footnote/archive/example) ← main-text px − 2
 *   - sans tier (everyone else)                ← the `panelFontSize` px pref
 * An explicit numeric `fontSize` override (the size stepper) still wins.
 */
describe("BUG #30: doc-relative default body size, override still wins", () => {
  afterEach(() => {
    // Drop the pushed tier bases (NaN → undefined per the setter's
    // Number.isFinite guard) and any overrides so tests don't bleed.
    setTierBaseFontSizes(NaN, NaN);
    for (const k of Object.keys(DEFAULT_PANEL_TYPOGRAPHY) as PanelBodyKey[]) {
      clearPanelTypographyField(k, "fontSize");
      clearPanelTypographyField(k, "fontFamily");
      clearPanelTypographyField(k, "color");
    }
  });

  it("PANEL_BODY_TIER agrees with each panel's BODY_CLASS_TYPOGRAPHY tier", () => {
    const cases: Array<[PanelBodyKey, "borrowed" | "sans"]> = [
      ["footnote", "borrowed"],
      ["archive", "borrowed"],
      ["example", "borrowed"],
      ["note", "sans"],
      ["cut", "sans"],
      ["revision", "sans"],
      ["citation", "sans"],
      ["bib", "sans"],
      ["todo", "sans"],
      ["report", "sans"],
    ];
    for (const [key, tier] of cases) expect(PANEL_BODY_TIER[key]).toBe(tier);
  });

  it("before any push the default is the static literal (SSR / no-doc fallback)", () => {
    expect(getPanelDefault("footnote").fontSize).toBe(15); // borrowed literal
    expect(getPanelDefault("note").fontSize).toBe(12);     // sans literal
  });

  it("borrowed default = main-text px − 2; sans default = panelFontSize", () => {
    // editorFontSize 0.95rem → round(0.95*16)=15 → borrowed 13; panelFontSize 13.
    setTierBaseFontSizes(15 - 2, 13);
    expect(getPanelDefault("footnote").fontSize).toBe(13);
    expect(getPanelDefault("archive").fontSize).toBe(13);
    expect(getPanelDefault("example").fontSize).toBe(13);
    expect(getPanelDefault("note").fontSize).toBe(13);
    expect(getPanelDefault("report").fontSize).toBe(13);
    // family + color stay the literal — only the size tracks the doc.
    expect(getPanelDefault("footnote").fontFamily).toBe("Source Serif 4");
    expect(getPanelDefault("note").fontFamily).toBe("Inter");
  });

  it("a larger doc lifts the borrowed default in lock-step", () => {
    // editorFontSize 1.25rem → round(1.25*16)=20 → borrowed 18.
    setTierBaseFontSizes(20 - 2, 16);
    expect(getPanelDefault("footnote").fontSize).toBe(18);
    expect(getPanelDefault("note").fontSize).toBe(16); // sans tracks panelFontSize
  });

  it("the effective (getPanelTypography) value tracks the doc when un-overridden", () => {
    setTierBaseFontSizes(15 - 2, 13);
    expect(getPanelTypography("footnote").fontSize).toBe(13);
    expect(getPanelTypography("note").fontSize).toBe(13);
  });

  it("an explicit fontSize override (size stepper) WINS over the doc-relative base", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "fontSize", 22);
    expect(getPanelTypography("footnote").fontSize).toBe(22); // override beats base
    // the un-overridden sibling still tracks the doc
    expect(getPanelTypography("archive").fontSize).toBe(13);
    // clearing restores doc-relative tracking
    clearPanelTypographyField("footnote", "fontSize");
    expect(getPanelTypography("footnote").fontSize).toBe(13);
  });

  it("a family/color override leaves the un-overridden size doc-relative", () => {
    setTierBaseFontSizes(15 - 2, 13);
    setPanelTypographyField("footnote", "color", "#112233");
    const t = getPanelTypography("footnote");
    expect(t.color).toBe("#112233"); // override applied
    expect(t.fontSize).toBe(13);     // size still doc-relative
  });
});

/**
 * Bare family names must never ship as inline font-family: next/font loads
 * the real faces only behind CSS vars (--font-sans / --font-serif /
 * --font-mono + the --font-*-override prefs), so a bare `Inter` silently
 * falls back to the UA default (Times New Roman). `resolveFontStack` is the
 * TOTAL name → real-stack resolver `usePanelBodyStyle` routes through.
 */
describe("resolveFontStack: bare family names never ship", () => {
  const GENERIC_TAIL = /,\s*(serif|sans-serif|monospace)$/;

  it("every BODY_CLASS_TYPOGRAPHY family resolves to a stack ending in a generic family", () => {
    for (const tier of Object.values(BODY_CLASS_TYPOGRAPHY)) {
      const stack = resolveFontStack(tier.fontFamily);
      expect(stack).not.toBe(tier.fontFamily); // not a bare name
      expect(stack).toMatch(GENERIC_TAIL);
    }
  });

  it("the two registry defaults get the override-first var stacks", () => {
    expect(resolveFontStack("Inter")).toBe(
      "var(--font-sans-override, var(--font-sans)), Inter, system-ui, sans-serif",
    );
    expect(resolveFontStack("Source Serif 4")).toBe(
      'var(--font-serif-override, var(--font-serif)), "Source Serif 4", Georgia, serif',
    );
  });

  it("every picker-pool name resolves without a bare dead-end", () => {
    for (const name of PANEL_BODY_FONT_OPTIONS) {
      const stack = resolveFontStack(name);
      // Never a single bare token — always a real stack with a generic tail.
      expect(stack).not.toBe(name);
      expect(stack).not.toBe(`"${name}"`);
      expect(stack).toMatch(GENERIC_TAIL);
      // Every pool name is curated, not heuristic-fallback territory.
      expect(FONT_STACKS[name]).toBeDefined();
    }
  });

  it("explicit picks of Google-pool-loaded fonts keep the literal FIRST (not hijacked by override vars)", () => {
    const poolLoaded = [
      "Libre Baskerville",
      "Lora",
      "Merriweather",
      "EB Garamond",
      "Crimson Text",
      "Open Sans",
      "Lato",
      "Roboto",
      "IBM Plex Sans",
      "Source Sans 3",
    ];
    for (const name of poolLoaded) {
      const stack = resolveFontStack(name);
      const first = stack.split(",")[0].trim().replace(/^"|"$/g, "");
      expect(first).toBe(name);
      expect(stack).not.toContain("var(");
    }
  });

  it("Playfair Display (next/font, not in the pool link) routes through --font-display to something real", () => {
    const stack = resolveFontStack("Playfair Display");
    expect(stack.split(",")[0].trim()).toBe('"Playfair Display"');
    expect(stack).toContain("var(--font-display)");
    expect(stack).toMatch(GENERIC_TAIL);
  });

  it("unknown names hit the total fallback with a heuristic generic", () => {
    expect(resolveFontStack("Comic Neue")).toBe('"Comic Neue", sans-serif');
    expect(resolveFontStack("Helvetica")).toBe("Helvetica, sans-serif");
    expect(resolveFontStack("Adobe Garamond Pro")).toBe('"Adobe Garamond Pro", serif');
    expect(resolveFontStack("PT Serif")).toBe('"PT Serif", serif');
    expect(resolveFontStack("Fira Code")).toBe('"Fira Code", monospace');
    expect(resolveFontStack("JetBrains Mono")).toBe('"JetBrains Mono", monospace');
  });

  it("every Fonts-dialog-pool serif/display name resolves with a serif tail (T5 heuristic widening)", () => {
    // The non-curated serif names reachable from MAIN_TEXT_FONTS
    // (src/lib/preferences-tree.ts) — each must heuristic-fallback to
    // `serif`, not the default `sans-serif`.
    const poolSerifs = [
      "Lusitana",
      "Cardo",
      "Spectral",
      "Vollkorn",
      "Gentium Plus",
      "Old Standard TT",
      "Libre Caslon Text",
      "Marcellus",
      "Bodoni Moda",
      "Cormorant Garamond",
      "Cormorant SC",
      "IM Fell English",
    ];
    for (const name of poolSerifs) {
      const stack = resolveFontStack(name);
      expect(stack, name).toMatch(/,\s*serif$/);
      expect(stack).not.toBe(name);
    }
  });

  it("the full MAIN_TEXT_FONTS pool never dead-ends bare and each group gets the right generic", async () => {
    const { MAIN_TEXT_FONTS } = await import("@/lib/preferences-tree");
    for (const group of MAIN_TEXT_FONTS) {
      const expected = group.group === "Sans-serif" ? "sans-serif" : "serif";
      for (const name of group.fonts) {
        const stack = resolveFontStack(name);
        expect(stack, name).not.toBe(name);
        expect(stack, name).toMatch(GENERIC_TAIL);
        expect(stack, name).toMatch(new RegExp(`,\\s*${expected}$`));
      }
    }
  });

  it("Cinzel (next/font-only, Fonts-dialog pool) routes through --font-logo, not a bare dead-end", () => {
    const stack = resolveFontStack("Cinzel");
    expect(stack).toContain("var(--font-logo)");
    expect(stack).toMatch(GENERIC_TAIL);
  });

  it("degenerate inputs stay total: empty/whitespace → plain generic; prototype keys don't leak", () => {
    expect(resolveFontStack("")).toBe("sans-serif");
    expect(resolveFontStack("   ")).toBe("sans-serif");
    // A corrupted pref like "toString" must resolve via the fallback rule
    // (string result), never pull a function off the prototype chain.
    expect(resolveFontStack("toString")).toBe("toString, sans-serif");
    expect(resolveFontStack("constructor")).toBe("constructor, sans-serif");
  });

  it("FONT_STACKS is frozen", () => {
    expect(Object.isFrozen(FONT_STACKS)).toBe(true);
  });
});

describe("resolvePreviewFontStack: option previews show the NAMED face (backlog #28)", () => {
  it("Inter previews literal-first through the un-overridden --font-sans var", () => {
    expect(resolvePreviewFontStack("Inter")).toBe(
      "Inter, var(--font-sans), system-ui, sans-serif",
    );
  });

  it("Source Serif 4 previews literal-first through the un-overridden --font-serif var", () => {
    expect(resolvePreviewFontStack("Source Serif 4")).toBe(
      '"Source Serif 4", var(--font-serif), Georgia, serif',
    );
  });

  it("the preview stacks are NOT override-first (the bug they fix)", () => {
    // The applied-style resolver routes these two override-first; the
    // preview resolver must not — otherwise the option shows the user's
    // override face, not the named one.
    expect(resolvePreviewFontStack("Inter")).not.toContain("--font-sans-override");
    expect(resolvePreviewFontStack("Source Serif 4")).not.toContain("--font-serif-override");
    expect(resolveFontStack("Inter")).toContain("--font-sans-override");
    expect(resolveFontStack("Source Serif 4")).toContain("--font-serif-override");
  });

  it("every other family falls through to resolveFontStack unchanged", () => {
    for (const name of ["Lora", "Playfair Display", "Georgia", "Comic Neue", "Cinzel", ""]) {
      expect(resolvePreviewFontStack(name)).toBe(resolveFontStack(name));
    }
  });
});
