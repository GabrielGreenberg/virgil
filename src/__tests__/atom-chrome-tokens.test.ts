import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ATOM_REGISTRY, type AtomMeta } from "@/lib/tiptap/atom-registry";
import { DERIVED_CSS, PREF_TO_CSS } from "@/lib/preferences-tree";
import { DEFAULT_PREFS, deriveLight } from "@/hooks/usePreferences";

/**
 * INLINE-ATOM REST CHROME IS USER-CONTROLLABLE (task 2026-07-20-194).
 *
 * `color-token-consumers.test.ts` locks named color families by VALUE; this
 * asks the family question its siblings cannot: for every inline Atom the
 * `ATOM_REGISTRY` declares, does its REST-state rule paint from live tokens —
 * and do those tokens resolve to something a user can actually change?
 *
 * The defect that motivated it: `.label-ref-node` — the `\cite` pill's
 * structural twin, same shape, same amber lit state — hardcoded `#f0f0ee` /
 * `#d5d3ce` / `#555` in its rest rule and had NO preference anywhere, while
 * `.citation-node` beside it was fully tokenized AND themeable
 * (`citationColor` / `citationBorderColor`). So a user who retinted their
 * citations left the `\ref` chip frozen grey, and `#555` was literally
 * citation's own default `--citation-color` value: a copy-paste that dropped
 * the token. It survived every existing guard because no guard was keyed on
 * "the set of inline atoms" — the amber census covers the LIT states (which
 * label-ref already shared), the phantom census asks whether a `var()`
 * resolves (there was no `var()` to ask about), and the value-keyed families
 * only know the literals someone thought to list.
 *
 * Deriving the census from `ATOM_REGISTRY.domClass` — the facet the NodeViews
 * already source their live DOM class from — means a FUTURE atom kind is
 * covered the moment its row lands, with nothing to remember.
 *
 * ── Scope, stated ────────────────────────────────────────────────────────
 *
 * REST rules only: an innermost CSS rule one of whose comma-separated
 * selectors is EXACTLY `.<domClass>`. Hover / `.active` / attribute-qualified
 * variants are deliberately out — they are the lit-state vocabulary the amber
 * role-set already owns, and the bare rest rule is precisely the shape that
 * drifted. Keyword values (`inherit`, `transparent`, `none`, `currentColor`)
 * are legal: the print block strips these chips to plain prose and must.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Every stylesheet the app ships. `globals.css` `@import`s the library one. */
const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"] as const;

/** Blank `/* … *​/` comments so a literal NAMED in prose is not a declaration. */
function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      i += 2;
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i++;
      i += 2;
      out += "  ";
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

interface Rule {
  file: string;
  /** Comma-separated selector parts, trimmed. */
  parts: string[];
  body: string;
}

/**
 * Every INNERMOST rule (a `{…}` block containing no nested block). Reading the
 * innermost block is what reaches the atom rules inside `@media print` — where
 * both chips are stripped to prose — without a real CSS parser.
 */
function innermostRules(file: string, css: string): Rule[] {
  const out: Rule[] = [];
  let depth = 0;
  let blockStart = -1;
  let selStart = 0;
  let sawNested = false;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === "{") {
      if (depth === 0) {
        blockStart = i;
        sawNested = false;
      } else if (depth === 1) {
        sawNested = true;
      }
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        if (!sawNested) {
          const selector = css.slice(selStart, blockStart);
          out.push({
            file,
            parts: selector
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            body: css.slice(blockStart + 1, i),
          });
        } else {
          // A block WITH nested rules (@media, @supports): recurse into it so
          // its children are censused too.
          out.push(...innermostRules(file, css.slice(blockStart + 1, i)));
        }
        selStart = i + 1;
      }
      continue;
    }
  }
  return out;
}

const RULES: Rule[] = STYLESHEETS.flatMap((f) => innermostRules(f, stripCssComments(read(f))));

const ATOMS: AtomMeta[] = Object.values(ATOM_REGISTRY);

/** The rest rules that paint a given atom's chrome. */
function restRulesFor(meta: AtomMeta): Rule[] {
  return RULES.filter((r) => r.parts.includes(`.${meta.domClass}`));
}

/** Properties whose value IS a color (so a literal there is a frozen look). */
const COLOR_PROP =
  /^(color|background|background-color|border|border-color|border-(?:top|right|bottom|left)-color|outline|outline-color|box-shadow|fill|stroke|--[\w-]*color)$/;

interface Decl {
  prop: string;
  value: string;
}

function colorDecls(body: string): Decl[] {
  const out: Decl[] = [];
  for (const raw of body.split(";")) {
    const idx = raw.indexOf(":");
    if (idx === -1) continue;
    const prop = raw.slice(0, idx).trim();
    if (!COLOR_PROP.test(prop)) continue;
    out.push({ prop, value: raw.slice(idx + 1).trim() });
  }
  return out;
}

/** Drop `var(--x, <fallback>)` fallbacks — a fallback literal is the idiom. */
function withoutFallbacks(value: string): string {
  let prev = value;
  for (let i = 0; i < 5; i++) {
    const next = prev.replace(/var\(\s*(--[\w-]+)\s*,[^()]*\)/g, "var($1)");
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

const RAW_COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;

// ── Leg 1: no rest rule spells a color ──────────────────────────────────────

describe("every inline Atom's rest chrome reads tokens, not literals", () => {
  it.each(ATOMS.map((m) => [m.kind, m] as const))(
    "%s has a rest rule the census can see",
    (_kind, meta) => {
      // Without this the leg below passes vacuously for a renamed class.
      expect(restRulesFor(meta).length).toBeGreaterThan(0);
    },
  );

  it("spells no raw color in any atom's rest-state declarations", () => {
    const hits: string[] = [];
    for (const meta of ATOMS) {
      for (const rule of restRulesFor(meta)) {
        for (const d of colorDecls(rule.body)) {
          if (RAW_COLOR.test(withoutFallbacks(d.value))) {
            hits.push(`${rule.file} .${meta.domClass} { ${d.prop}: ${d.value} }`);
          }
        }
      }
    }
    expect(
      hits,
      "An inline atom's rest look is a frozen literal. Mint a token (and a " +
        "preference, if the sibling atoms have one) and read it here — a `var()` " +
        "FALLBACK literal is fine, the declaration itself must not be one.",
    ).toEqual([]);
  });
});

// ── Leg 2: the tokens it reads are ones a user can change ───────────────────

/**
 * Tokens a preference writes onto `:root` at runtime — directly
 * (`PREF_TO_CSS`) or derived from one or more prefs (`DERIVED_CSS`).
 */
const LIVE_PREF_VARS = new Set<string>([
  ...PREF_TO_CSS.map((e) => e.cssVar),
  ...DERIVED_CSS.map((e) => e.cssVar),
]);

/** `--x: var(--y)` aliases in the stylesheets, so an alias resolves through. */
const ALIASES = new Map<string, string>();
for (const f of STYLESHEETS)
  for (const m of stripCssComments(read(f)).matchAll(
    /(--[\w-]+)\s*:\s*var\(\s*(--[\w-]+)/g,
  ))
    if (!ALIASES.has(m[1])) ALIASES.set(m[1], m[2]);

function resolvesToPreference(token: string): boolean {
  let cur: string | undefined = token;
  for (let i = 0; i < 8 && cur; i++) {
    if (LIVE_PREF_VARS.has(cur)) return true;
    cur = ALIASES.get(cur);
  }
  return false;
}

describe("those tokens are user-controllable, not decoration", () => {
  it("every token an atom's rest chrome reads resolves to a preference", () => {
    const hits: string[] = [];
    for (const meta of ATOMS) {
      for (const rule of restRulesFor(meta)) {
        for (const d of colorDecls(rule.body)) {
          for (const m of d.value.matchAll(/var\(\s*(--[\w-]+)/g)) {
            if (!resolvesToPreference(m[1]))
              hits.push(`${rule.file} .${meta.domClass} { ${d.prop} } reads ${m[1]}`);
          }
        }
      }
    }
    expect(
      hits,
      "A token nothing writes from a preference is a frozen look wearing a " +
        "var(): the retone will never reach it. Wire it through PREF_TO_CSS / " +
        "DERIVED_CSS, or alias it onto a token that is.",
    ).toEqual([]);
  });
});

// ── The `\ref` chip specifically: parity with its citation twin ─────────────

describe("the cross-reference chip is themeable like its citation twin", () => {
  const prefVar = (key: string) => PREF_TO_CSS.find((e) => e.key === key)?.cssVar;

  it("exposes ink + border preferences mirroring citation's pair", () => {
    expect(prefVar("labelRefColor")).toBe("--label-ref-color");
    expect(prefVar("labelRefBorderColor")).toBe("--label-ref-border-color");
    expect(DEFAULT_PREFS.labelRefColor).toBe("#555555");
    expect(DEFAULT_PREFS.labelRefBorderColor).toBe("#d5d3ce");
  });

  const bg = () => DERIVED_CSS.find((e) => e.cssVar === "--label-ref-bg")!;

  it("derives the chip fill from the ink, so a recolor moves the whole chip", () => {
    expect(bg()).toBeDefined();
    const recolored = { ...DEFAULT_PREFS, labelRefColor: "#2f5fa0" };
    expect(bg().compute(recolored)).toBe(deriveLight("#2f5fa0", 0.088));
    expect(bg().compute(recolored)).not.toBe(bg().compute(DEFAULT_PREFS));
  });

  it("does not move when an unrelated preference changes", () => {
    const other = { ...DEFAULT_PREFS, citationColor: "#123456" };
    expect(bg().compute(other)).toBe(bg().compute(DEFAULT_PREFS));
  });

  it("keeps grey — the derivation reproduces R and G of the retired #f0f0ee exactly", () => {
    // Pinned at the COLOR, not at DEFAULT_PREFS: the shipped default is
    // Gabriel's to move through promote-defaults (citationColor already went
    // #555 → #6b6245 that way), and this documented same-ray trade is a fact
    // about the derivation at the original literal's ink. Blue lands 2/255
    // higher — a true neutral rather than the old warm-biased grey.
    expect(deriveLight("#555555", 0.088)).toBe("#f0f0f0");
  });

  it("seeds globals.css with the value the derivation yields at the shipped default", () => {
    // The pre-hydration / SSR / print value of a DERIVED token has no
    // generator: `promote-defaults` rewrites the managed block from
    // `cssVarMap`, and a derived token has no `bucket.key` source to sit
    // there. So this seed is hand-written, and this is the only thing keeping
    // it honest — without it a promoted `labelRefColor` would leave the chip's
    // first paint carrying the OLD grey wash under the NEW ink.
    const at = bg().compute(DEFAULT_PREFS);
    expect(
      read("src/app/globals.css"),
      `--label-ref-bg's :root seed is stale. Set it to ${at} — the value ` +
        "DERIVED_CSS computes from the shipped labelRefColor " +
        `(${DEFAULT_PREFS.labelRefColor}). It is the pre-hydration twin of a ` +
        "derived token, so promote-defaults cannot regenerate it.",
    ).toMatch(new RegExp(`--label-ref-bg:\\s*${at}\\s*;`));
  });

  it("leaves no #f0f0ee anywhere — the duplicate in the ref popover included", () => {
    for (const f of STYLESHEETS) expect(read(f)).not.toContain("#f0f0ee");
  });
});

// ── Self-checks: a blind census passes every assertion above ────────────────

describe("the census can see", () => {
  it("parses real rules out of both stylesheets", () => {
    expect(RULES.length).toBeGreaterThan(500);
    expect(new Set(RULES.map((r) => r.file)).size).toBe(STYLESHEETS.length);
    // Reaches INTO @media — the print block strips both chips to plain prose.
    expect(
      RULES.some((r) => r.parts.includes(".label-ref-node") && /inherit/.test(r.body)),
    ).toBe(true);
  });

  it("would catch a planted literal, and does not flag a var()", () => {
    const planted: Rule = {
      file: "test",
      parts: [".citation-node"],
      body: "color: #ff0000; background: var(--citation-bg, #ffffff);",
    };
    const flagged = colorDecls(planted.body).filter((d) =>
      RAW_COLOR.test(withoutFallbacks(d.value)),
    );
    expect(flagged.map((d) => d.prop)).toEqual(["color"]);
  });

  it("would catch a token no preference writes", () => {
    expect(resolvesToPreference("--definitely-not-a-pref-xyz")).toBe(false);
    expect(resolvesToPreference("--citation-color")).toBe(true); // PREF_TO_CSS
    expect(resolvesToPreference("--citation-bg")).toBe(true); // DERIVED_CSS
    expect(resolvesToPreference("--footnote-color")).toBe(true); // pref + :root alias
  });

  it("the comment stripper did not swallow the stylesheets", () => {
    // The 202b runaway: a bad stripper empties its input and every census
    // above reports green. Count DECLARATIONS, the thing this consumes.
    const count = (css: string) => [...css.matchAll(/[\w-]+\s*:\s*[^;{}]+;/g)].length;
    for (const f of STYLESHEETS) {
      const raw = read(f);
      expect(count(stripCssComments(raw)), `${f} lost declarations`).toBeGreaterThan(
        count(raw) * 0.8,
      );
    }
  });
});
