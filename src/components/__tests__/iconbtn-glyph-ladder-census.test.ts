/**
 * ICON-BUTTON GLYPH LADDER CENSUS (task 2026-10-23-1249).
 *
 * > The icon-button box→glyph ladder — xs 16/12 · sm 20/14 · md 24/16 ·
 * > lg 32/20 — is STRUCTURE, not caller discipline.
 *
 * Before this task only `xs` enforced its glyph (a child selector); the other
 * three rungs were prose ("pass width/height 14 (sm) …"), so sites shipped
 * 11/12px glyphs in `sm`/`md` boxes and an 18px one in `md`, same-role dismiss
 * X's split between `sm` and `xs`, and the 20px `sm` box was hand-copied into
 * JS (`ICONBTN_SM_PX`) and hand-halved in an inline `calc`. Now:
 *
 *  A. Each rung is a `:root` token pair (`--iconbtn-{size}` box,
 *     `--iconbtn-{size}-glyph`); the box rule reads them and DERIVES the
 *     padding, and `.iconbtn-{size} > svg` sizes the glyph from its token at
 *     every size. Opt-out: `data-iconbtn-glyph="<reason>"` on the button.
 *  B. A literal `width`/`height` on an SVG directly inside an iconbtn agrees
 *     with its rung (the larger dimension, for a non-square glyph) — the CSS
 *     wins regardless, so a disagreeing attribute is a lie about the render.
 *  C. No code restates a box size: no `ICONBTN_*` numeric constant, and every
 *     `var(--iconbtn-…)` names a declared token.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT, tagAround, tagEnd, trackedFiles } from "@/lib/__tests__/_source-scan";

const LADDER = {
  xs: { box: 16, glyph: 12 },
  sm: { box: 20, glyph: 14 },
  md: { box: 24, glyph: 16 },
  lg: { box: 32, glyph: 20 },
} as const;
type Size = keyof typeof LADDER;
const SIZES = Object.keys(LADDER) as Size[];

const css = fs.readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function rootTokens(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of cssNoComments.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      if (!out.has(d[1])) out.set(d[1], d[2].trim());
    }
  }
  return out;
}

function ruleBody(selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The selector must open its OWN rule (only whitespace since the previous
  // `}`), so `.iconbtn-lg` does not match the tail of a selector list.
  const m = cssNoComments.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

const SOURCE_FILES = [
  ...trackedFiles("src", /\.tsx?$/),
  ...trackedFiles("library/components", /\.tsx?$/),
].filter((f) => !/__tests__|\.test\.tsx?$/.test(f));

export interface GlyphHit {
  size: Size;
  width: number | null;
  height: number | null;
  exempt: boolean;
}

/** Every SVG that is a DIRECT child of an iconbtn-sized element in `src` —
 *  its children up to the closing `</button>`, or the element's own
 *  `trigger=` render prop (AnchoredMenu/ItemMenu triggers). An SVG behind a
 *  wrapper element is not the utility's child and is not censused (the CSS
 *  child selector does not reach it either). */
export function iconbtnGlyphs(src: string): GlyphHit[] {
  const hits: GlyphHit[] = [];
  const seen = new Set<number>();
  for (const m of src.matchAll(/\biconbtn-(xs|sm|md|lg)\b/g)) {
    const tag = tagAround(src, m.index!);
    if (!tag || !/\b(className|triggerClassName)=/.test(tag)) continue;
    const start = src.lastIndexOf(tag, m.index!);
    if (start < 0 || seen.has(start)) continue;
    seen.add(start);
    const sizes = new Set([...tag.matchAll(/\biconbtn-(xs|sm|md|lg)\b/g)].map((x) => x[1]));
    if (sizes.size !== 1) continue; // a computed size choice — not readable here
    const size = m[1] as Size;
    const exempt = /\bdata-iconbtn-glyph=/.test(tag);
    let region: string;
    const trig = tag.search(/\btrigger=\{/);
    if (trig >= 0) region = tag.slice(trig);
    else {
      const after = start + tag.length;
      const close = src.indexOf("</button>", after);
      if (close < 0 || tag.endsWith("/>")) continue;
      region = src.slice(after, close);
    }
    region = region.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // Walk the region's SVGs; one is DIRECT when nothing but non-element
    // text (braces, ternaries, earlier sibling SVGs) precedes it.
    let consumed = "";
    let rest = region;
    for (;;) {
      const i = rest.search(/<svg\b/);
      if (i < 0) break;
      consumed += rest.slice(0, i);
      const end = tagEnd(rest, i);
      if (end < 0) break;
      const open = rest.slice(i, end + 1);
      if (!/<[A-Za-z]/.test(consumed)) {
        const num = (attr: string): number | null => {
          const a = open.match(new RegExp(`\\b${attr}=(?:"(\\d+)"|\\{(\\d+)\\})`));
          return a ? Number(a[1] ?? a[2]) : null;
        };
        hits.push({ size, width: num("width"), height: num("height"), exempt });
      }
      const closeSvg = rest.indexOf("</svg>", end);
      rest = closeSvg < 0 ? rest.slice(end + 1) : rest.slice(closeSvg + "</svg>".length);
    }
  }
  return hits;
}

describe("A · the ladder is declared once and read by the utility", () => {
  const tokens = rootTokens();

  it.each(SIZES)("--iconbtn-%s box and glyph tokens hold the ladder", (s) => {
    expect(tokens.get(`--iconbtn-${s}`)).toBe(`${LADDER[s].box}px`);
    expect(tokens.get(`--iconbtn-${s}-glyph`)).toBe(`${LADDER[s].glyph}px`);
  });

  it.each(SIZES)(".iconbtn-%s reads its box token and derives its padding", (s) => {
    const body = ruleBody(`.iconbtn-${s}`);
    expect(body, `.iconbtn-${s} { … } rule`).not.toBeNull();
    expect(body).toContain(`width: var(--iconbtn-${s})`);
    expect(body).toContain(`height: var(--iconbtn-${s})`);
    expect(body).toContain(`padding: calc((var(--iconbtn-${s}) - var(--iconbtn-${s}-glyph)) / 2)`);
  });

  it.each(SIZES)(".iconbtn-%s > svg reads its glyph token (opt-out: data-iconbtn-glyph)", (s) => {
    const body = ruleBody(`.iconbtn-${s}:not([data-iconbtn-glyph]) > svg`);
    expect(body, `.iconbtn-${s}:not([data-iconbtn-glyph]) > svg rule`).not.toBeNull();
    expect(body).toContain(`width: var(--iconbtn-${s}-glyph)`);
    expect(body).toContain(`height: var(--iconbtn-${s}-glyph)`);
  });

  it("no other globals.css rule restates an iconbtn box or glyph in px", () => {
    const offenders: string[] = [];
    for (const m of cssNoComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const sel = m[1].trim();
      if (!/\.iconbtn-(xs|sm|md|lg)\b/.test(sel)) continue;
      if (/(^|[\s,])(width|height|padding)\s*:\s*\d+px/.test(m[2])) offenders.push(sel);
    }
    expect(offenders).toEqual([]);
  });
});

describe("B · an iconbtn's own SVG attributes agree with its rung", () => {
  it("the checker reads direct children, ternaries and triggers — and skips wrappers", () => {
    const fixture = [
      `<button className="iconbtn-sm"><svg width="11" height="11" /></button>`,
      `<button className="iconbtn-xs">{ok ? (<svg width="12" height="9"></svg>) : (<svg width="10" height="10"></svg>)}</button>`,
      `<AnchoredMenu triggerClassName="iconbtn-md" trigger={() => (<svg width={16} height={16}></svg>)} />`,
      `<button className="iconbtn-md"><span className="contents"><svg width="18" height="18"></svg></span></button>`,
      `<button className="iconbtn-md" data-iconbtn-glyph="aligns: x"><svg width="18" height="18"></svg></button>`,
    ].join("\n");
    const hits = iconbtnGlyphs(fixture);
    expect(hits.map((h) => [h.size, h.width, h.height, h.exempt])).toEqual([
      ["sm", 11, 11, false],
      ["xs", 12, 9, false],
      ["xs", 10, 10, false],
      ["md", 16, 16, false],
      ["md", 18, 18, true],
    ]);
  });

  const all = SOURCE_FILES.flatMap((f) =>
    iconbtnGlyphs(fs.readFileSync(f, "utf8")).map((h) => ({ ...h, file: path.relative(REPO_ROOT, f) })),
  );

  it("sees the population (not vacuous)", () => {
    expect(all.length).toBeGreaterThanOrEqual(30);
  });

  it("every literal glyph size equals its rung (larger dimension), unless the button states why", () => {
    const offenders = all
      .filter((h) => !h.exempt)
      .filter((h) => {
        const dims = [h.width, h.height].filter((d): d is number => d !== null);
        return dims.length > 0 && Math.max(...dims) !== LADDER[h.size].glyph;
      })
      .map((h) => `${h.file}: iconbtn-${h.size} glyph ${h.width}×${h.height} ≠ ${LADDER[h.size].glyph}`);
    expect(offenders).toEqual([]);
  });

  it("every data-iconbtn-glyph opt-out carries a reason", () => {
    const offenders: string[] = [];
    for (const f of SOURCE_FILES) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/data-iconbtn-glyph(=(?:"([^"]*)"|\{[^}]*\}))?/g)) {
        if (m[1] === undefined || (m[2] !== undefined && m[2].trim().length < 8)) {
          offenders.push(path.relative(REPO_ROOT, f));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("C · no code restates a box size", () => {
  const tokens = rootTokens();

  it("no ICONBTN_* numeric constant", () => {
    const offenders = SOURCE_FILES.filter((f) =>
      /\bconst\s+\w*ICONBTN\w*\s*=\s*\d/.test(fs.readFileSync(f, "utf8")),
    ).map((f) => path.relative(REPO_ROOT, f));
    expect(offenders).toEqual([]);
  });

  it("the card corner cluster and the popped card's X read --iconbtn-sm", () => {
    const pp = fs.readFileSync(path.join(REPO_ROOT, "src/components/panel-primitives.tsx"), "utf8");
    expect(pp).toMatch(/function cornerSlotStyle[\s\S]{0,300}var\(--iconbtn-sm\)/);
    expect(pp).toContain("calc(var(--pc-header-h, 24px) / 2 - var(--iconbtn-sm) / 2)");
  });

  it("every var(--iconbtn-…) in source names a declared token", () => {
    const offenders: string[] = [];
    for (const f of SOURCE_FILES) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/var\((--iconbtn-[\w-]+)/g)) {
        if (!tokens.has(m[1])) offenders.push(`${path.relative(REPO_ROOT, f)}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
