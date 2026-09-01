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

// ── The REVERSE question: does a declared token have a READER? ─────────────

/**
 * ORPHAN TOKENS (task 2026-08-25-460).
 *
 * Everything above asks the FORWARD question — *does every `var(--x)` name a
 * token something defines?* That leg is silent about a token that is defined
 * and read by nothing, which is the other half of the same drift and fails in
 * a way no render can show: `--shadow-ambient-filter` shipped with a comment
 * naming two use cases (swoop tabs, the MenuBar pod), ZERO readers, and
 * NEITHER mechanism ever built — so the next reader who wanted a
 * composited-alpha shadow found a token that said it was for exactly that and
 * no example of it working, and wrote their own literal instead. Two of them
 * did (`.inline-atom-ghost` and the Library tab ghost, at `0 2px 6px` and
 * `0 8px 16px` for one role). A dead token is not inert: it is an invitation
 * to a fork.
 *
 * `inert-preference-controls.test.ts` asks this same question and is the right
 * shape — but its population is `PREF_TO_CSS` / `DERIVED_CSS`, i.e. PREFERENCE
 * tokens. A hand-declared `:root` design token was in no census in either
 * direction. This leg is that population.
 *
 * ── The population: declarations OUTSIDE `@theme` ─────────────────────────
 *
 * A `@theme` entry is the Tailwind MAPPING channel — its reader is a generated
 * `bg-*` / `rounded-*` utility class, not a `var()`, and asking a `var()`
 * question of it reports ~24 false orphans (task 458's three `--radius-*:
 * initial` clears among them). So `@theme` blocks are blanked before the
 * declarations are read. Their right-hand sides are still SCANNED for reads,
 * because `--color-surface: var(--surface)` genuinely reads `--surface`.
 *
 * ── Reader channels, deliberately generous ────────────────────────────────
 *
 * Same posture the definition channels above state: a census of this shape
 * must never accuse healthy code, so where a missed reader form and a false
 * accusation trade off, this leans toward the hole.
 *
 *  1. `var(--x)` anywhere in either stylesheet or any component.
 *  2. A quoted `"--x"` in TS — `setProperty`, `getPropertyValue`, an inline
 *     style key, a `cssVar:` registry row. (A pref-registry row is a WRITE,
 *     not a read; it counts anyway, because the stylesheet rule that consumes
 *     it may legitimately live behind a `var()` this scan cannot attribute.)
 *  3. A runtime-BUILT read registers a PREFIX: `` `var(--pill-${tone}-bg)` ``
 *     in `StatusPill.tsx` is the live instance, and it alone exonerates SEVEN
 *     tokens. Without this channel the leg's first measurement accused every
 *     one of them — which is exactly the failure mode the generosity is for.
 */

/** Blank `@theme … { … }` blocks, brace-balanced, preserving line count. */
function blankThemeBlocks(css: string): string {
  const spans: Array<[number, number]> = [];
  const re = /@theme[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let k = m.index + m[0].length;
    while (k < css.length && depth > 0) {
      if (css[k] === "{") depth++;
      else if (css[k] === "}") depth--;
      k++;
    }
    spans.push([m.index, k]);
  }
  let out = css;
  for (const [a, b] of spans)
    out = out.slice(0, a) + out.slice(a, b).replace(/[^\n]/g, " ") + out.slice(b);
  return out;
}

/** token → first `file:line` that declares it, `@theme` blocks excluded. */
const DECLARED_TOKENS = new Map<string, string>();
for (const f of STYLESHEETS) {
  blankThemeBlocks(stripCssComments(read(f)))
    .split("\n")
    .forEach((lineText, i) => {
      for (const m of lineText.matchAll(/(--[A-Za-z][\w-]*)\s*:/g))
        if (!DECLARED_TOKENS.has(m[1])) DECLARED_TOKENS.set(m[1], `${f}:${i + 1}`);
    });
}

const readTokens = new Set<string>();
const readPrefixes = new Set<string>();
for (const [, text] of SOURCES) {
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) readTokens.add(m[1]);
  for (const m of text.matchAll(/["'`](--[\w-]+)["'`]/g)) readTokens.add(m[1]);
  for (const m of text.matchAll(/var\(\s*(--[\w-]+)\$\{/g)) readPrefixes.add(m[1]);
  for (const m of text.matchAll(/[`"'](--[\w-]+)\$\{/g)) readPrefixes.add(m[1]);
}
const isReadSomewhere = (token: string): boolean =>
  readTokens.has(token) || [...readPrefixes].some((p) => token.startsWith(p));

/**
 * Declared tokens with no reader, each with the reason it is still open.
 * SHRINK-ONLY: a NEW orphan fails the exact-set check. WIRE it, DELETE it, or
 * — if neither is this task's call — record it here with a reason a reader can
 * check against the code. "Unclear" is not a reason; that is the filing
 * cabinet this list exists not to become.
 */
const PERMITTED_ORPHAN_TOKENS: Readonly<Record<string, string>> = {
  // DOCUMENTATION-SHAPED ALIAS. Locked to --topbar-bg and pinned as such by
  // token-contract.test.ts's LOCKED_ALIASES — but the PWA/browser chrome color
  // is written in EditorLayout.tsx (`meta[name="theme-color"]`) from the PREF
  // value through applyTransforms, never from this var. So the alias states a
  // tracking relationship the code implements somewhere else, and the guard
  // pins the statement rather than the mechanism. Resolving it is a choice
  // between deleting the token (and its LOCKED_ALIASES row) and making the
  // meta write read the computed var — a behaviour change on the installed-PWA
  // chrome path, which reproduces in no preview. A suite is not a consumer.
  "--theme-color":
    "aliased + pinned by token-contract, but the meta tag is written from the PREF in EditorLayout, not from this var",

  // The one unread member of the four-token window-inset SSOT, whose stated
  // model is that EVERY OS-reserved edge flows through these vars (-top,
  // -left, -right are all live). env(safe-area-inset-bottom) only becomes
  // non-zero once layout.tsx sets viewport-fit=cover AND something anchors to
  // the bottom edge; nothing does. Deleting it falsifies the SSOT's own
  // completeness claim; wiring it needs a bottom-anchored surface to exist.
  "--window-inset-bottom":
    "the unread rung of the window-inset SSOT; no bottom-anchored chrome exists yet, and the model's claim is that every edge has a var",

  // A PAGE-WIDTH mechanism whose live implementation is JS. EditorLayout's
  // `useState(880)` re-spells --page-preferred's value as a literal at another
  // depth, and 640 / 1400 appear nowhere in TS at all — the same "one role,
  // spelled twice, chosen by eye" disease task 460 fixed on the drag-ghost
  // axis, on the width axis. --page-preferred additionally sits INSIDE the
  // machine-managed PROMOTE-DEFAULTS block while being no preference at all
  // (no usePreferences field, no PREF_TO_CSS row), so the promoter carries a
  // line nothing reads. Whether the editor basis should read the token is a
  // layout decision, not a cleanup.
  "--page-preferred": "page-width mechanism moved to JS (EditorLayout `useState(880)`); token left behind",
  "--page-min": "page-width mechanism moved to JS; 640 appears in no component",
  "--page-max": "page-width mechanism moved to JS; 1400 appears in no component",

  // Sibling of the LIVE --panel-min (read by panel-column.tsx). The band-height
  // floor that would consume this is MIN_BAND_PX = 140 in view-prefs-dock.ts —
  // a different value at a different depth. Same disease as the --page-* trio.
  "--panel-min-h":
    "the height twin of the live --panel-min; the real floor is MIN_BAND_PX=140 in view-prefs-dock.ts",

  // TWO RUNGS OF A SCALE, which is a different thing from a dead alias. The
  // --footnote-50/100/200/300/500 tint scale (task 175) exists so a reader
  // reaching for a red tint finds a tier rather than inventing a literal;
  // 50/100/500 are consumed and 200/300 are the ones nobody has needed yet.
  // Deleting a middle rung to satisfy a census would put a gap exactly where
  // the next person reaches — the scale's completeness IS its value.
  //
  // --footnote-200 joined the list in task 525, and how it got here is the
  // point: its ONLY reader was `.footnote-highlight-marker`, a rule with ZERO
  // producers that §8's rust consumer sweep had migrated onto this token while
  // reasoning about it. So a dead SELECTOR was propping up a token and making
  // it look consumed — this census could not see that, because it asks whether
  // a token has a READER and never whether the reader's hook has a PRODUCER.
  // That second question is `dead-css-hook-census.test.ts`, and deleting the
  // rule is what surfaced this rung. A scale's unused rung is honest; a live
  // reader that can never paint is not.
  "--footnote-200": "an unused rung of the deliberate --footnote-* tint scale (its one reader, the dead .footnote-highlight-marker, was deleted in 525)",
  "--footnote-300": "an unused rung of the deliberate --footnote-* tint scale; a scale is a vocabulary, not an alias",
};

describe("every declared token has a reader", () => {
  it("the set of orphan tokens is exactly the recorded one", () => {
    const orphans = [...DECLARED_TOKENS.keys()].filter((t) => !isReadSomewhere(t)).sort();
    expect(
      orphans,
      "A token declared in a stylesheet and read by nothing is an invitation " +
        "to a fork: the next person who wants that role finds a name that " +
        "claims it, no example of it working, and writes a literal instead " +
        "(that is exactly how the drag-ghost lift came to be spelled twice). " +
        "WIRE it, DELETE it, or record it above with a checkable reason. " +
        "This list may only shrink.",
    ).toEqual(Object.keys(PERMITTED_ORPHAN_TOKENS).sort());
  });

  it("every recorded orphan states a reason", () => {
    // Same caveat the decorative-phantom twin states: a length floor pins the
    // SHAPE of the obligation, never its honesty. Read each reason against the
    // code before trusting it.
    for (const [token, why] of Object.entries(PERMITTED_ORPHAN_TOKENS))
      expect(why.length, `${token} needs a stated reason, not an empty string`).toBeGreaterThan(30);
  });

  it("the drag-ghost lift is one token read by both ghosts", () => {
    // The token this leg was written for. Two consumers, one value, and no
    // `drop-shadow(` literal left anywhere: the ONLY spelling of the function
    // in either silo is the declaration itself.
    const GHOST = "--shadow-drag-ghost-filter";
    expect(DECLARED_TOKENS.has(GHOST), `${GHOST} must be declared`).toBe(true);
    const readers = SOURCES.filter(([, text]) => text.includes(`var(${GHOST})`)).map(([f]) => f);
    expect(readers.sort()).toEqual([
      "library/components/panel-tabs/PanelTabStrip.tsx",
      "src/app/globals.css",
    ]);
    const literals: string[] = [];
    for (const [file, text] of SOURCES)
      text.split("\n").forEach((lineText, i) => {
        if (/drop-shadow\(/.test(lineText) && !lineText.includes(GHOST))
          literals.push(`${file}:${i + 1} — ${lineText.trim().slice(0, 80)}`);
      });
    expect(
      literals,
      "A `filter:` elevation is the drag-ghost tier or it is a new role that " +
        "mints its own token with its first consumer — never a hand-written " +
        "drop-shadow() (task 2026-08-25-460).",
    ).toEqual([]);
  });

  it("--shadow-ambient-filter stays retired", () => {
    // Deleted by task 460 after five weeks and 93 commits at zero readers,
    // with both use cases named in its own comment unbuilt. It would come back
    // the same way it arrived: minted ahead of a consumer.
    const hits: string[] = [];
    for (const [file, text] of SOURCES)
      text.split("\n").forEach((lineText, i) => {
        if (lineText.includes("--shadow-ambient-filter")) hits.push(`${file}:${i + 1}`);
      });
    expect(hits, "mint a filter-form token with its first consumer, not ahead of one").toEqual([]);
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

  it("the reverse census can see, and does not accuse healthy code", () => {
    // Population sanity: real, and NOT polluted by the Tailwind mapping
    // channel — `--color-surface` is declared ONLY inside `@theme inline`, so
    // a census that failed to blank those blocks would carry it (and ~23
    // siblings) as false orphans.
    expect(DECLARED_TOKENS.size).toBeGreaterThan(150);
    expect(DECLARED_TOKENS.has("--surface")).toBe(true);
    expect(DECLARED_TOKENS.has("--color-surface")).toBe(false);
    expect(DECLARED_TOKENS.has("--radius-2xl")).toBe(false);

    // A planted token nothing reads is caught; a real read exonerates.
    expect(isReadSomewhere("--definitely-not-a-token-xyz")).toBe(false);
    expect(isReadSomewhere("--surface")).toBe(true);

    // Channel 3 is the one that matters, and it is load-bearing rather than
    // theoretical: StatusPill.tsx builds `var(--pill-${tone}-bg)` at runtime,
    // and these SEVEN tokens are read through nothing else. The leg's own
    // first measurement accused every one of them.
    for (const t of [
      "--pill-green-bg",
      "--pill-green-fg",
      "--pill-amber-bg",
      "--pill-amber-fg",
      "--pill-gray-bg",
      "--pill-gray-fg",
      "--pill-blue-bg",
    ]) {
      expect(DECLARED_TOKENS.has(t), `${t} should be in the population`).toBe(true);
      expect(isReadSomewhere(t), `${t} is read through the runtime-built prefix`).toBe(true);
    }
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
