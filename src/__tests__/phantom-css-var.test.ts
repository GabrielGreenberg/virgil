import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, cssCommentsStripped } from "@/lib/__tests__/_source-scan";

/**
 * PHANTOM CSS VARIABLES — a `var(--token)` is a CLAIM that the token exists
 * (task 2026-07-18-170).
 *
 * The sibling `token-contract.test.ts` asks whether a DOC states a value the
 * code contradicts. This asks the other half, about code: whether a
 * `var(--token)` READ can resolve at all. Neither the compiler, the linter,
 * nor any render test can: an unresolvable `var()` is CSS's
 * guaranteed-invalid value, and the browser's response is silence.
 *
 * The two failure modes, both silent, in opposite directions:
 *
 *  - **No fallback ⇒ a silent NO-OP.** The declaration becomes "invalid at
 *    computed-value time", which for an inherited property means `inherit`.
 *    `--mono` and `--serif` were spelled 48 times across `library/` and two
 *    `src/` files and defined NOWHERE, so every monospace page-picker, tab
 *    label, citekey and `.tex` fragment — and every serif dialog heading —
 *    quietly rendered in the surrounding sans. For a year. The one visible
 *    trace was that the surfaces looked slightly wrong to nobody in
 *    particular.
 *  - **With a fallback ⇒ DECORATION.** The fallback is the real value and the
 *    var is scenery, which is worse than a literal, because it reads as
 *    tokenized and a retone will never reach it. `--pod-shadow-light` is the
 *    named instance: proposed in a design-system patch that never landed, then
 *    consumed by `library.css` (fallback) and *instructed by the design docs*
 *    (no fallback) for anyone who copied the snippet.
 *
 * ── The three definition channels ────────────────────────────────────────
 *
 * A token can legitimately be defined somewhere a CSS scan cannot see, so the
 * census reads all three rather than just the stylesheets:
 *
 *  1. **CSS** — a `--token:` declaration in either stylesheet.
 *  2. **`next/font`** — `variable: "--font-mono"` in `src/app/layout.tsx`.
 *     These have no CSS declaration at all (`@theme inline` only re-exports
 *     them to Tailwind as `--font-mono: var(--font-mono)`, a self-reference),
 *     so a CSS-only census would condemn the one vocabulary this task's fix
 *     migrates *onto*.
 *  3. **RUNTIME** — a `.tsx`/`.ts` write: `setProperty("--x", …)`, an inline
 *     style key, a `cssVar:`/`variable:` registry row, or a `--x: ${…}`
 *     template. Dynamic names (`` `--link-anchor-accent-${kind}` ``) register
 *     as a PREFIX, since the suffix is only known at runtime.
 *
 * Channel 3 is deliberately generous. A census of this shape must never
 * accuse healthy code: a missed write form is a hole (a phantom reads as
 * defined), while a false positive is a red CI run against working styling —
 * so where the two trade off, this leans toward the hole and states it.
 *
 * ── The two legs ─────────────────────────────────────────────────────────
 *
 * NO-FALLBACK is the one with teeth and its allowlist is EMPTY, because there
 * is no true statement of the form "this read is meant to resolve to nothing".
 * A hit is DEFINE-it or SPELL-the-value.
 *
 * WITH-FALLBACK is a pinned CENSUS rather than a ban: those reads work, and
 * deciding whether `var(--ink, #3a362f)` should become `--ink-body`, a literal,
 * or a newly-minted token is a VISUAL judgement, not a cleanup. So the set is
 * exact — a NEW decorative phantom fails CI — and it can only SHRINK.
 */

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Every stylesheet the app ships. `globals.css` `@import`s the library one. */
const STYLESHEETS = ["src/app/globals.css", "library/styles/library.css"];

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".next-preview",
  ".next-preview-dev",
  ".next-preview-audit",
  ".git",
  ".claude",
  "virgil-data",
  "library-data",
  "samples",
  "dist",
  "build",
  "out",
  "__tests__",
]);

function walkSource(rel: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(path.join(ROOT, rel));
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = path.join(rel, name);
    if (statSync(path.join(ROOT, childRel)).isDirectory()) walkSource(childRel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(childRel);
  }
  return out;
}

/** Blank `/* … *​/` comments so a token NAMED in prose is not a definition.
 *  One copy for every census — see `_source-scan.ts`. */
const stripCssComments = cssCommentsStripped;

const SOURCE_FILES = [...walkSource("src"), ...walkSource("library")];
/** Comments stripped, STRING LITERALS KEPT — every `var()` in `.tsx` lives
 *  inside a quoted style value, so blanking literals would empty the census. */
const SOURCES: ReadonlyArray<readonly [string, string]> = [
  ...STYLESHEETS.map((f) => [f, stripCssComments(read(f))] as const),
  ...SOURCE_FILES.map((f) => [f, commentsStripped(read(f))] as const),
];

// ── Channel 1 + 2 + 3: what is DEFINED ──────────────────────────────────────

const definedInCss = new Set<string>();
for (const f of STYLESHEETS)
  for (const m of stripCssComments(read(f)).matchAll(/(--[A-Za-z][\w-]*)\s*:/g))
    definedInCss.add(m[1]);

/** Write forms that DEFINE a custom property from TS/TSX. */
const WRITE_FORMS: RegExp[] = [
  /setProperty\(\s*["'`](--[\w-]+)["'`]/g, // el.style.setProperty("--x", v)
  /\[\s*["'`](--[\w-]+)["'`](?:\s+as\s+[\w.]+)?\s*\]\s*[=:]/g, // vars["--x"] = v / ["--x" as string]: v
  /["'`](--[\w-]+)["'`]\s*:/g, // { "--x": v }
  /(?:variable|cssVar)\s*:\s*["'`](--[\w-]+)["'`]/g, // next/font + preferences-tree
  /(--[\w-]+)\s*:\s*\$\{/g, // `--x: ${v}` in a cssText template
];
/** A name built at runtime registers as a PREFIX — the suffix is a variable. */
const DYNAMIC_FORMS: RegExp[] = [/[`"'](--[\w-]+)\$\{/g];

const definedAtRuntime = new Set<string>();
const definedPrefixes = new Set<string>();
for (const [, text] of SOURCES) {
  for (const re of WRITE_FORMS) for (const m of text.matchAll(re)) definedAtRuntime.add(m[1]);
  for (const re of DYNAMIC_FORMS) for (const m of text.matchAll(re)) definedPrefixes.add(m[1]);
}

const isDefined = (token: string): boolean =>
  definedInCss.has(token) ||
  definedAtRuntime.has(token) ||
  [...definedPrefixes].some((p) => token.startsWith(p));

// ── The census: what is READ ────────────────────────────────────────────────

interface VarRead {
  file: string;
  line: number;
  token: string;
  hasFallback: boolean;
}

const READS: VarRead[] = [];
for (const [file, text] of SOURCES) {
  text.split("\n").forEach((lineText, i) => {
    // The trailing char disambiguates the three shapes: `,` = fallback,
    // `)` = bare, `$` = a runtime-built name (skipped — see DYNAMIC_FORMS).
    for (const m of lineText.matchAll(/var\(\s*(--[\w-]+)\s*([,)$])/g)) {
      if (m[2] === "$") continue;
      if (isDefined(m[1])) continue;
      READS.push({ file, line: i + 1, token: m[1], hasFallback: m[2] === "," });
    }
  });
}

const site = (r: VarRead) => `${r.file}:${r.line} — var(${r.token})`;

// ── Leg 1: a read with no fallback must resolve. Allowlist EMPTY. ───────────

describe("no var() read resolves to nothing", () => {
  it("every fallback-less var() names a token something defines", () => {
    const silent = READS.filter((r) => !r.hasFallback).map(site);
    expect(
      silent,
      "A `var(--x)` with no fallback and no definition is the guaranteed-invalid " +
        "value: the whole declaration is dropped, silently. DEFINE the token, or " +
        "spell the value. There is no allowlist — no read is meant to resolve to " +
        "nothing.",
    ).toEqual([]);
  });
});

// ── Leg 2: decorative phantoms are a pinned, shrink-only census ─────────────

/**
 * Reads whose fallback IS the shipped value. Each entry states why it has not
 * been resolved — in every case because choosing the real token is a VISUAL
 * decision. The set may only shrink; a new phantom fails the exact-set check.
 */
const PERMITTED_DECORATIVE_PHANTOMS: Readonly<Record<string, string>> = {
  // A vocabulary the math / figure / expex chrome invented alongside the real
  // `--surface` / `--foreground` / `--muted` / `--ink-*` scales it sits beside.
  // `--text` (#1a1a1a) and `--panel-bg`/`--input-bg` (#ffffff) match a live
  // token EXACTLY today; `--ink` and `--text-muted` match none, and `--ink`
  // carries two different fallbacks. Re-pointing any of them makes those
  // surfaces newly follow a user retone — right, and a change to look at.
  "--ink": "math/figure chrome; fallback is the shipped value; two variants (#3a362f / #2a2520)",
  "--text": "math/figure chrome; fallback #1a1a1a equals --foreground today",
  "--text-muted": "math/figure chrome; fallback #9a8f80 matches no live token",
  "--panel-bg": "math/figure chrome; fallback #ffffff equals --surface today",
  "--input-bg": "math/figure chrome; fallback #ffffff equals --surface today",
  "--doc-title-leadin": "title lead-in height; fallback 40px is the shipped value",

  // The heading-typography preference registry (`preferences-tree.ts`:345-350)
  // has exactly six rows: h1 / h2 / h3 × size + weight. The stylesheet reads
  // h0 / h5 / h6 prefs nothing ever writes, so those levels silently ignore
  // the user's heading font settings. (h4 has no pref row AND no stylesheet
  // read — the level is simply absent from the typography system, which is
  // why it is not a phantom here.) Wiring the missing rows adds preference
  // UI — a product call.
  "--font-headers-h0-size": "heading pref registry covers h1–h3 only; h0 unwired",
  "--font-headers-h0-weight": "heading pref registry covers h1–h3 only; h0 unwired",
  "--font-headers-h5-size": "heading pref registry covers h1–h3 only; h5 unwired",
  "--font-headers-h5-weight": "heading pref registry covers h1–h3 only; h5 unwired",
  "--font-headers-h6-size": "heading pref registry covers h1–h3 only; h6 unwired",
  "--font-headers-h6-weight": "heading pref registry covers h1–h3 only; h6 unwired",

  // Library-silo status vocabulary, same shape as --mono/--serif but honest
  // about it. Which live token each should take is a color decision.
  //
  // `--error` RETIRED (task 2026-07-20-195): the colour decision this entry was
  // waiting on is the one that task made. Both `role="alert"` sites now read
  // `--danger-strong`, the destructive family's error-ink rung — the same token
  // `.figure-error` / `.math-error` / KaTeX's `errorColor` resolve, so the two
  // silos state error ink once. Stated exactly rather than favourably: #b00020
  // → #b8261a moves alert text 7.33:1 → 6.31:1 on white, a real step DOWN
  // (through AAA, still comfortably over AA) accepted to end the fork — where
  // the lighter `--danger` would have taken it to 3.76:1, under AA.
  "--success": "style-editor validity tick; fallback #15803d",
  "--surface-warning": "float-sync stale banner; fallback in the Tailwind arbitrary value",
  "--ink-warning": "float-sync stale banner; fallback in the Tailwind arbitrary value",
  "--edge-warning": "float-sync stale banner; fallback in the Tailwind arbitrary value",
};

describe("decorative phantoms are a pinned census", () => {
  it("the set of fallback-carrying phantom tokens is exactly the recorded one", () => {
    const found = [...new Set(READS.filter((r) => r.hasFallback).map((r) => r.token))].sort();
    expect(
      found,
      "A var() whose token nothing defines is DECORATION — the fallback is the " +
        "real value, and a retone will never reach it. Resolve it (point at a " +
        "live token, or spell the value), or record it here with the reason it " +
        "is still open. This list may only shrink.",
    ).toEqual(Object.keys(PERMITTED_DECORATIVE_PHANTOMS).sort());
  });

  it("every recorded phantom states a reason", () => {
    // A length floor pins the SHAPE of the obligation, never its honesty —
    // an inaccurate reason passes here exactly as a true one does. (This
    // guard's own first draft said the heading registry "covers h1–h4" when
    // it covers h1–h3 and h4 does not exist anywhere in the typography
    // system; an adversarial reader caught it, not this assertion.) Read the
    // reason against the code before trusting it.
    for (const [token, why] of Object.entries(PERMITTED_DECORATIVE_PHANTOMS)) {
      expect(why.length, `${token} needs a stated reason, not an empty string`).toBeGreaterThan(20);
    }
  });
});

// ── The retired vocabulary stays retired ───────────────────────────────────

describe("the phantom font vocabulary is dead", () => {
  it.each(["--mono", "--serif", "--sans"])(
    "%s appears in no stylesheet or component",
    (token) => {
      // These are the 48 silent no-ops leg 1 exists for, and they would come
      // back the same way they arrived: by looking like tokens. `FONT_MONO` /
      // `FONT_SERIF` / `FONT_SANS` in src/lib/font-stacks.ts are the spelling.
      const hits: string[] = [];
      for (const [file, text] of SOURCES) {
        text.split("\n").forEach((lineText, i) => {
          if (new RegExp(`var\\(\\s*${token}\\s*[,)]`).test(lineText))
            hits.push(`${file}:${i + 1}`);
        });
      }
      expect(hits, `${token} is not a Virgil token — use the font-stack SSOT`).toEqual([]);
    },
  );

  /**
   * Files allowed to spell an override chain themselves.
   *
   * `panel-typography.ts` answers a DIFFERENT question: it maps the user's
   * chosen font FAMILY to that family's stack ("Inter" → …, "Playfair
   * Display" → a display face layered over the serif override), so its rows
   * deliberately differ from the three chrome chains and are not copies of
   * them. The stylesheets are exempt by construction — CSS cannot import.
   */
  const PERMITTED_HAND_SPELLED_CHAINS = new Set([
    "src/lib/font-stacks.ts", // the SSOT itself
    "src/lib/panel-typography.ts", // per-FAMILY stacks, not the chrome chains
  ]);

  it("nothing re-spells a font chain by hand", () => {
    // Three copies of the sans chain is how it drifted before. The stylesheets
    // must spell it (CSS cannot import), components must not.
    const hits: string[] = [];
    for (const [file, text] of SOURCES) {
      if (STYLESHEETS.includes(file)) continue;
      if (PERMITTED_HAND_SPELLED_CHAINS.has(file)) continue;
      text.split("\n").forEach((lineText, i) => {
        if (/var\(--font-(?:sans|serif|mono)-override/.test(lineText))
          hits.push(`${file}:${i + 1} — ${lineText.trim().slice(0, 80)}`);
      });
    }
    expect(
      hits,
      "Import FONT_SANS / FONT_SERIF / FONT_MONO from @/lib/font-stacks instead " +
        "of re-spelling the override chain.",
    ).toEqual([]);
  });
});

// ── Self-checks: a silent census passes every assertion above ──────────────

describe("the census can see", () => {
  it("reads real files and finds real definitions", () => {
    expect(SOURCE_FILES.length).toBeGreaterThan(200);
    expect(definedInCss.size).toBeGreaterThan(100);
    expect(definedAtRuntime.size).toBeGreaterThan(50);
    expect(definedPrefixes.size).toBeGreaterThan(0);
  });

  it("finds var() reads at all, and resolves the overwhelming majority", () => {
    const total = SOURCES.reduce(
      (n, [, t]) => n + [...t.matchAll(/var\(\s*--[\w-]+/g)].length,
      0,
    );
    expect(total).toBeGreaterThan(500);
    // READS holds only the UNresolved ones — if the definition channels broke,
    // this ratio explodes and every leg above fails for the wrong reason.
    expect(READS.length).toBeLessThan(total * 0.15);
  });

  it("would catch a planted phantom", () => {
    const planted = "--definitely-not-a-token-xyz";
    expect(isDefined(planted)).toBe(false);
    expect(isDefined("--font-mono")).toBe(true); // channel 2: next/font
    expect(isDefined("--surface")).toBe(true); // channel 1: globals.css
    expect(isDefined("--link-anchor-accent-note")).toBe(true); // channel 3: prefix
  });

  it("the comment stripper did not swallow the stylesheets", () => {
    // The 202b runaway: a bad stripper silently empties its input and every
    // census above reports green. A LENGTH ratio cannot pin this — globals.css
    // is ~40% comment by weight, which is healthy — so the check is a
    // DECLARATION count, the thing the census actually consumes.
    const count = (css: string) => [...css.matchAll(/(--[A-Za-z][\w-]*)\s*:/g)].length;
    for (const f of STYLESHEETS) {
      const raw = read(f);
      const kept = count(stripCssComments(raw));
      expect(kept, `${f} lost its declarations to the stripper`).toBeGreaterThan(
        count(raw) * 0.8,
      );
      // library.css declares only its ~17 pill/paper-render tokens; the floor
      // is a "not empty" sentinel, not a size expectation.
      expect(kept, `${f} stripped to nothing`).toBeGreaterThan(10);
    }
  });
});
