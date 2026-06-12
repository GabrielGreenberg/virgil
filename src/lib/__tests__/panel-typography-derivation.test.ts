import { describe, it, expect } from "vitest";
import {
  DEFAULT_PANEL_TYPOGRAPHY,
  BODY_CLASS_TYPOGRAPHY,
  FONT_STACKS,
  PANEL_BODY_FONT_OPTIONS,
  resolveFontStack,
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
