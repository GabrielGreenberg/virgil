import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { commentsStripped, cssCommentsStripped, walkFiles } from "@/lib/__tests__/_source-scan";

/**
 * Panel-chrome RAW COLOUR census (task 2026-08-02-286; second needle 284).
 *
 * `STYLE_GUIDE.md` has banned `bg-blue-*` / `bg-emerald-*` / `bg-red-*` in
 * panel chrome for as long as the token scales have existed, and until this
 * suite that ban was **unenforced prose** — `npm run check:radius` covers the
 * radius half and nothing covered the colour half. So the family convention
 * grew: ONE banned `bg-emerald-500` became three sites inside the
 * comment/suggestion card family (the two goal-strip twins + the `accepted`
 * status dot), each copied from the last, with CI green the whole way.
 *
 * The census is the leg with teeth here, and it is deliberately WIDER than the
 * three families the prose names: the drift is a habit ("reach for the Tailwind
 * palette") rather than a hue, so it flags every `<utility>-<palette>-<step>`
 * spelling in the panel tree. Every hit must sit on
 * `PERMITTED_RAW_PALETTE_LITERALS` with the reason it survives and, where one
 * exists, the task that owns draining it.
 *
 * **The list may only SHRINK.** A new raw literal is TOKENIZE-it — mint or
 * reuse a semantic token (`--positive` is what this task minted for the
 * goal-reached / accepted role) — never a new allowlist entry. An entry earns
 * its place only by naming a decision nobody has made yet.
 *
 * Two limits, stated rather than implied:
 *
 *  - The key is `file :: literal`, deduped, NOT per line. Line numbers churn
 *    on every unrelated edit above them, and the allowlist would then fail for
 *    reasons that have nothing to do with colour. The cost is that a file may
 *    grow a SECOND occurrence of a literal it already carries without failing.
 *    Accepted: the realistic drift is a new hue in a new place, and that fails.
 *  - The PALETTE-utility leg's scope is the panel tree plus the two shared
 *    panel/field primitives. Panel chrome authored elsewhere in
 *    `src/components/**` (the Library surfaces above all, which run a
 *    deliberate multi-hue chip vocabulary) is NOT censused by that leg.
 *    Widening it is a separate decision with its own draining cost, not an
 *    oversight of this one. The VALUE leg below is not so limited — see "The
 *    third needle".
 *
 * ── The second needle: a VALUE is a palette choice too (task 2026-08-02-284)
 *
 * The header above says the drift is a habit rather than a hue, and that was
 * one word short: the habit is "reach for a colour", and the Tailwind utility
 * is only ONE of its spellings. The others are the arbitrary-value class
 * (`text-[#857070]`), the inline style (`background: "#fef9c3"`), the
 * functional form (`rgba(180, 87, 87, .13)`) and the bare CSS keyword
 * (`"2px solid white"`). The Outline panel shipped EIGHT such literals across
 * all four, and the hue-scoped guards could only ever see some of them:
 * `destructive-red-tokens` scans the same `.tsx` files and DID see both the
 * arbitrary-value `text-[#b45757]` and the decimal wash — it just could not
 * judge the other hues, since its needle is a red hue window with a saturation
 * floor of 0.15. Four of the eight were therefore catchable and sat on
 * allowlists pointing at this task; `#857070`, `#fef9c3`, `#d4aa17` and the two
 * `white` rings were invisible to every guard in the repo. `#857070` measures
 * sat ≈0.0857, just under that floor — so even the needle nearest to it was
 * structurally entitled to miss it, which is the reason this one is exact
 * rather than thresholded.
 *
 * So `RAW_VALUE` censuses the value spellings beside the name spelling, and two
 * exclusions keep it honest — each of them a decision, not an omission:
 *
 *  - **A `var(--token, #fallback)` fallback is not a literal.** It is the
 *    repo's compliant idiom (globals.css carries 184 hex-fallback reads across
 *    59 tokens, and STYLE_GUIDE discusses the form), so indicting it would make
 *    the compliant answer the failing one — the trap task 204 names, where a
 *    guard whose compliant form reads worse than the violation loses quietly.
 *  - **An ACHROMATIC value (r == g == b) is not a palette choice.** The panel
 *    tree's remaining ones are all `rgba(0, 0, 0, α)` drop shadows, which are a
 *    SHADOW decision with its own filed scale task; flagging them would eat
 *    that diff and say nothing about colour. The chromatic test is deliberately
 *    exact rather than a saturation floor, for the `#857070` reason above.
 *
 * **Limits, stated rather than implied** — every sibling colour guard carries
 * such a list, and the first draft of this one carried none:
 *
 *  - `white` / `black` / `gray` are CSS keywords for ACHROMATIC values, so the
 *    exclusion above covers them by the same rule that covers `#ffffff`. Task
 *    284 retired two `"2px solid white"` rings by hand and this census would
 *    NOT have flagged them — deliberate, and the reason the defect leg below is
 *    scoped to the chromatic spellings rather than claiming all of them.
 *  - `oklch()` / `lab()` / `color()` are not matched at all. None occurs in
 *    either silo today; a new one is a hole, not a pass.
 *  - `hsl()` is matched only in the CSS-Color-4 number form, since the legacy
 *    `%`-suffixed form defeats the channel capture. It is decomposed through
 *    `hslIsChromatic` (saturation zero) rather than through the r==g==b test,
 *    which would read H/S/L as if they were R/G/B and answer backwards in both
 *    directions. No `hsl(` exists in the censused tree today either.
 *  - A hex is matched textually, so a 3- or 6-character DOM id in a
 *    `querySelector("#abc")` would read as a colour. None occurs today.
 *  - A value assembled at runtime (`"#" + hex`) is invisible, as it is to every
 *    other colour guard in the repo.
 *
 * ── The third needle: the VALUE leg reads every production file (task 1412)
 *
 * A raw value is the same habit wherever it is written, and the panel-tree
 * scope left `src/components/**` and `src/lib/**` re-spelling token values as
 * JS literals with no guard: the transient-highlight amber (`--mark-bg` plus an
 * alpha, as a hex), a `--border` copy inside a fallback slot nobody reads, the
 * AI window's amber/violet status pair. So the VALUE leg's population is every
 * production `.ts`/`.tsx` under `src/` (`valueCensusFiles`), and the declared
 * colour SSOT tables it meets there — panel-theme, collab presence, the
 * selection-colour and actions-menu palettes — are LISTED, each with the reason
 * it must stay a concrete value. That is the same shrink-only list, not a new
 * one: an entry names a table or a decision, never a convenience.
 *
 * Widening the population made two of the needle's arms noisy against prose
 * the panel tree never carried, and both are tightened rather than listed:
 *
 *  - `&#182;` is an HTML ENTITY, not a hex colour — the hex arm skips a match
 *    preceded by `&`.
 *  - A colour WORD in a string is not a colour VALUE unless it sits where CSS
 *    reads one: "The quick brown fox", a `Tone = "green"` union member, a
 *    font-family regex naming Crimson. The keyword arm therefore fires only in
 *    a CSS-value context — after a colour-taking property (`color:`,
 *    `background:`, `fill=`, `borderColor:` …) or a border-style word
 *    (`solid gold`). A keyword reached any other way — `const c = "gold";
 *    style={{ color: c }}` — is a hole, stated here rather than implied.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");

/** The `<utility>-<tailwind palette>-<step>` shape, any utility prefix that
 *  takes a colour. Deliberately not anchored to the three banned families. */
const RAW_PALETTE =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|decoration|outline|shadow|accent|caret|divide|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/**
 * PRE-EXISTING sites, each with the reason it is still a literal. Every one of
 * these was here before task 286; the task drained the three `--positive` ones
 * and pinned the rest so the convention cannot grow a fourth.
 */
const PERMITTED_RAW_PALETTE_LITERALS: Record<string, string> = {
  // The five-way suggestion STATUS DOT vocabulary. `accepted` was drained onto
  // `--positive` (task 286) and `stale` onto `--amber-500` (task 951, the
  // raw-amber sweep); the other three are a traffic-light set whose home is
  // arguably the `--status-*` family, and converging them would MOVE three
  // colours (blue-400 vs --status-* has no member at all; red-400 ≠
  // --status-danger). That is a visual decision, not a swap.
  "src/panels/_shared/suggestion-fields.tsx :: bg-blue-400": "status-dot vocabulary; --status-* convergence is a visual call",
  "src/panels/_shared/suggestion-fields.tsx :: bg-sky-300": "status-dot vocabulary (`applied` = the pending-AI signal); candidate home is the --pending-ai-* family, a visual call",
  "src/panels/_shared/suggestion-fields.tsx :: bg-red-400": "status-dot vocabulary; --status-* convergence is a visual call",

  // The suggestion DIFF vocabulary: green = the proposed text, red = the text
  // it replaces. A different role from `--positive` (which means "attained"),
  // and it wants its own added/removed pair whenever someone designs one.
  "src/panels/_shared/suggestion-fields.tsx :: border-red-200": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: text-red-700": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: placeholder:text-red-300": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: focus:border-red-400": "diff/destructive field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: bg-emerald-50": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: border-emerald-200": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: text-emerald-800": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: placeholder:text-emerald-400": "diff/added field chrome — wants an added/removed token pair",
  "src/panels/_shared/suggestion-fields.tsx :: focus:border-emerald-400": "diff/added field chrome — wants an added/removed token pair",
  // The three accept-ACTION emerald entries that used to sit here
  // (`suggestion-fields :: text-emerald-600` / `:: hover:bg-emerald-50`, and
  // `CitationCard :: text-emerald-600`) are DRAINED by task 501: the
  // affirmative role family (`--positive-soft` / `--positive-ink` /
  // `--positive-strong`) is the token set their own reasons asked for, and
  // the accept/reject pair is now ONE component (`CommitActions`). The
  // diff/added FIELD entries above stay: a legend is not an affirmative
  // control, and repainting it needs rungs this family does not have.
  "src/panels/_shared/suggestion-fields.tsx :: text-red-700/80": "diff/destructive field chrome — wants an added/removed token pair",
  // Was four entries — the Cutter card's pair and the Revisions card's pair,
  // one transcription of the other. Task 714 made the twins ONE component, so
  // the legend has one site and this census two rows instead of four.
  "src/panels/_shared/SuggestionCard.tsx :: text-emerald-700/90": "diff/added preview ink (the shared suggestion card) — wants the added/removed pair",
  "src/panels/_shared/SuggestionCard.tsx :: text-red-700/70": "diff/removed preview ink (the shared suggestion card) — wants the added/removed pair",

  // Owned by other filed tasks — deliberately NOT drained here, so this task
  // does not eat their diffs. (The three Outline blues that sat here retired
  // with task 2026-08-02-284: the Outline's InlineLabel now reads
  // `--heading-annotation-color`, the token its in-prose twin already used.
  // The two Search ambers retired with task 2026-08-06-309: the `Aa`/`W` mode
  // toggles now read the toggle-state SSOT's tint path and the result
  // `<mark>` the `--amber-highlight-*` family — pinned by
  // `src/panels/Search/__tests__/search-token-convergence.test.ts`.)

  // (The Omni `border-sky-200` singleton retired with task 1066: it was never
  // an "omni notice strip" but the bulk PENDING-CHANGE navigator, and it now
  // reads `--pending-ai-edge` with its per-change twin — pinned by
  // `src/cards/__tests__/pending-ai-tint-family.test.ts`.)
};

/**
 * The CSS named colours that are CHROMATIC. The achromatic keywords
 * (`white`/`black`/`gray`/`silver`/`gainsboro`/…) are deliberately absent: they
 * are covered by the achromatic exclusion exactly as their hex twins are, and
 * `bg-white` / `text-white` are live Tailwind utilities in this tree.
 */
const NAMED_COLOURS = [
  "aliceblue","antiquewhite","aqua","aquamarine","azure","beige","bisque","blanchedalmond",
  "blue","blueviolet","brown","burlywood","cadetblue","chartreuse","chocolate","coral",
  "cornflowerblue","cornsilk","crimson","cyan","darkblue","darkcyan","darkgoldenrod",
  "darkgreen","darkkhaki","darkmagenta","darkolivegreen","darkorange","darkorchid","darkred",
  "darksalmon","darkseagreen","darkslateblue","darkturquoise","darkviolet","deeppink",
  "deepskyblue","dodgerblue","firebrick","floralwhite","forestgreen","fuchsia","ghostwhite",
  "gold","goldenrod","green","greenyellow","honeydew","hotpink","indianred","indigo","ivory",
  "khaki","lavender","lavenderblush","lawngreen","lemonchiffon","lightblue","lightcoral",
  "lightcyan","lightgreen","lightpink","lightsalmon","lightseagreen","lightskyblue",
  "lightsteelblue","lightyellow","lime","limegreen","linen","magenta","maroon","mediumblue",
  "mediumorchid","mediumpurple","mediumseagreen","mediumslateblue","mediumturquoise",
  "mediumvioletred","midnightblue","mintcream","mistyrose","moccasin","navajowhite","navy",
  "oldlace","olive","olivedrab","orange","orangered","orchid","palegreen","paleturquoise",
  "palevioletred","papayawhip","peachpuff","peru","pink","plum","powderblue","purple",
  "rebeccapurple","red","rosybrown","royalblue","saddlebrown","salmon","sandybrown",
  "seagreen","seashell","sienna","skyblue","slateblue","springgreen","steelblue","tan",
  "teal","thistle","tomato","turquoise","violet","wheat","yellow","yellowgreen",
] as const;

/**
 * A hex literal, the first three channels of a functional colour, or a
 * chromatic CSS keyword. The hex and `rgb()` forms resolve to an r/g/b triple
 * so the achromatic test can run on either; `hsl()` is judged by its SATURATION
 * instead (see `hslIsChromatic` — reading H/S/L through the r==g==b test would
 * answer backwards in both directions), and a keyword is chromatic by
 * membership in the list above.
 *
 * The keyword arm is fenced by `(?<![-\w])` / `(?![-\w])` so it cannot fire on
 * the palette utilities the FIRST needle already owns: without it, every
 * `text-red-700` in the tree reports a second time as a bare `red`.
 */
const RAW_VALUE = new RegExp(
  "(?<!&)#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b" +
    "|\\b(rgba?|hsla?)\\(\\s*([\\d.]+)[\\s,]+([\\d.]+)[\\s,]+([\\d.]+)" +
    `|(?<![-\\w])(?:${NAMED_COLOURS.join("|")})(?![-\\w])`,
  "g",
);

/** The fallback slot of a `var(--token, …)` read, ending exactly at the match. */
const VAR_FALLBACK = /var\(\s*--[a-zA-Z0-9-]+\s*,\s*$/;

/**
 * Where CSS reads a colour, ending exactly at a keyword match: a colour-taking
 * property (CSS, camelCase style-object or JSX-attribute spelling) with its
 * `:`/`=` and opening quote, or a border-style word. See "The third needle".
 */
const CSS_COLOUR_CONTEXT =
  /(?:(?:color|Color|background|fill|stroke|border|outline|caret|accent)[\w-]*\s*[:=]\s*\{?\s*["'`]?\s*|\b(?:solid|dashed|dotted|double)\s+)$/;

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * PRE-EXISTING raw colour VALUES, same `file :: literal` key and same
 * shrink-only rule as the palette list above.
 */
const PERMITTED_RAW_VALUE_LITERALS: Record<string, string> = {
  // The panel tree has no entry. The five that lived here — the done-checkbox
  // glyph pair, where `TodoRow`'s `TodoDoneToggle` and the shared
  // `AiRequestCheckbox` drew the same 14×14 rounded rect from the same literals
  // — were drained by task 2026-08-02-287: one `CheckSquare` primitive owns the
  // geometry, the box edge reads `--muted-light`, the checked fill and tick read
  // the minted `--checkbox-fill` / `--checkbox-mark`, and the AI tick derives
  // from the `aiRequest` panel-theme accent. Contract:
  // `src/components/__tests__/checkbox-glyph-ssot.test.tsx`.
  //
  // Everything below arrived with the VALUE leg's widening to all of `src/`
  // (task 1412). A new entry is TOKENIZE-it, not a listing.

  // DECLARED COLOUR TABLES — user-pickable swatches. A swatch is a stored VALUE
  // (it is persisted to prefs, sidecars, or written into the .tex), so it must
  // be a concrete colour, never a `var()`; the hue censuses already name these
  // tables as SSOTs.
  "src/lib/panel-theme.ts :: #0ea5e9": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #14b8a6": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #15803d": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #3b82f6": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #6366f1": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #65a30d": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #7191b0": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #78716c": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #8b6f47": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #9333ea": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #b45757": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #b8a968": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #d4a843": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/panel-theme.ts :: #ec4899": "PRESET_COLORS — the panel-theme picker palette (stored per-panel accent values)",
  "src/lib/collab.ts :: #0ea5e9": "COLLAB_COLORS — collaborator presence swatches (a subset of PRESET_COLORS, sent to peers)",
  "src/lib/collab.ts :: #14b8a6": "COLLAB_COLORS — collaborator presence swatches (a subset of PRESET_COLORS, sent to peers)",
  "src/lib/collab.ts :: #15803d": "COLLAB_COLORS — collaborator presence swatches (a subset of PRESET_COLORS, sent to peers)",
  "src/lib/collab.ts :: #6366f1": "COLLAB_COLORS — collaborator presence swatches (a subset of PRESET_COLORS, sent to peers)",
  "src/lib/collab.ts :: #d4a843": "COLLAB_COLORS — collaborator presence swatches (a subset of PRESET_COLORS, sent to peers)",
  "src/lib/collab.ts :: #ec4899": "COLLAB_COLORS — collaborator presence swatches (a subset of PRESET_COLORS, sent to peers)",
  "src/components/ActionsMenuPanel.tsx :: #16a34a": "DEFAULT_PALETTE — the selection menu's text-colour swatches (written into the .tex as \\textcolor)",
  "src/components/ActionsMenuPanel.tsx :: #2563eb": "DEFAULT_PALETTE — the selection menu's text-colour swatches (written into the .tex as \\textcolor)",
  "src/components/ActionsMenuPanel.tsx :: #6b7280": "DEFAULT_PALETTE — the selection menu's text-colour swatches (written into the .tex as \\textcolor)",
  "src/components/ActionsMenuPanel.tsx :: #9333ea": "DEFAULT_PALETTE — the selection menu's text-colour swatches (written into the .tex as \\textcolor)",
  "src/components/ActionsMenuPanel.tsx :: #ca8a04": "DEFAULT_PALETTE — the selection menu's text-colour swatches (written into the .tex as \\textcolor)",
  "src/components/ActionsMenuPanel.tsx :: #dc2626": "DEFAULT_PALETTE — the selection menu's text-colour swatches (written into the .tex as \\textcolor)",
  "src/components/ActionsMenuPanel.tsx :: #ea580c": "DEFAULT_PALETTE — the selection menu's text-colour swatches (written into the .tex as \\textcolor)",
  "src/components/SelectionColorPopover.tsx :: #0000ff": "the custom-colour HUE WHEEL's conic-gradient stops — the spectrum itself, not a palette choice",
  "src/components/SelectionColorPopover.tsx :: #00ff00": "the custom-colour HUE WHEEL's conic-gradient stops — the spectrum itself, not a palette choice",
  "src/components/SelectionColorPopover.tsx :: #00ffff": "the custom-colour HUE WHEEL's conic-gradient stops — the spectrum itself, not a palette choice",
  "src/components/SelectionColorPopover.tsx :: #ff0000": "the custom-colour HUE WHEEL's conic-gradient stops — the spectrum itself, not a palette choice",
  "src/components/SelectionColorPopover.tsx :: #ff00ff": "the custom-colour HUE WHEEL's conic-gradient stops — the spectrum itself, not a palette choice",
  "src/components/SelectionColorPopover.tsx :: #ffff00": "the custom-colour HUE WHEEL's conic-gradient stops — the spectrum itself, not a palette choice",

  // RULED KEEPS — a concrete value some non-CSS consumer requires.
  "src/cards/legacy-token-crosswalk.ts :: #bfdbfe": "PENDING_AI_TINT — task 1066 kept the TS source, pinned equal to --pending-ai-tint by pending-ai-tint-family.test.ts",
  "src/lib/panel-typography.ts :: #44403c": "BODY_CLASS_TYPOGRAPHY default ink — a typography PREF default is a stored value, so it needs a concrete hex (= --ink-body)",

  // AWAITING A DECISION — the AI window's status chips. Task 1066 left this
  // vocabulary "awaiting a --status-* decision"; converging it MOVES colours,
  // which is a visual call, not a swap.
  "src/components/AIWindow.tsx :: #d97706": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #fff7ed": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #9a3412": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #7c3aed": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #f5f3ff": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #5b21b6": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #16a34a": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #f0fdf4": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
  "src/components/AIWindow.tsx :: #15803d": "STATUS_META — AI-request status chip vocabulary, awaiting the --status-* family (task 1066)",
};

/**
 * An `hsl()` is achromatic exactly when its SATURATION is zero, whatever its
 * hue and lightness. Feeding H/S/L to the r==g==b test instead answers
 * backwards in BOTH directions — `hsl(50 50 50)`, a saturated olive, would be
 * spared as "achromatic", and `hsl(0 0 60)`, a true grey, would be flagged.
 */
const hslIsChromatic = (s: number) => s !== 0;

/** Every censused source file, repo-relative, POSIX-separated. */
function censusFiles(): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const child of walkFiles(abs, { skipDirs: ["__tests__"] })) {
      if (/\.tsx?$/.test(child)) out.push(path.relative(ROOT, child).split(path.sep).join("/"));
    }
  };
  walk(path.join(ROOT, "src/panels"));
  // The two shared primitives panel chrome is authored THROUGH. Both are clean
  // today (their only palette mentions are in prose), which is exactly why they
  // belong in the census rather than outside it.
  out.push("src/components/panel-primitives.tsx", "src/components/field-primitives.tsx");
  return out.sort();
}

/**
 * The VALUE leg's population: every production `.ts`/`.tsx` under `src/`
 * (task 1412 — "The third needle"). Test directories and `*.test.*` files are
 * out; `.d.ts` declarations carry no values. A superset of `censusFiles()`, so
 * the panel-tree defect legs below still drive the same census.
 */
function valueCensusFiles(): string[] {
  return walkFiles(path.join(ROOT, "src"), { skipDirs: ["__tests__"] })
    .map((abs) => path.relative(ROOT, abs).split(path.sep).join("/"))
    .filter((rel) => /\.tsx?$/.test(rel) && !/\.d\.ts$/.test(rel) && !/\.test\.tsx?$/.test(rel))
    .sort();
}

/**
 * `file :: literal` for every raw palette spelling, comments blanked and string
 * literals KEPT — a Tailwind class only ever lives inside a string, so the
 * code-only stripper would blank the very thing this census greps for (the
 * unfalsifiable-leg mistake task 205 made), while leaving comments in would
 * indict prose that merely names a colour (`panel-primitives.tsx` has exactly
 * such a sentence).
 *
 * The Tailwind VARIANT prefix (`hover:`, `focus:`, `placeholder:`) and the
 * opacity suffix (`/80`) are carried into the key when present, so a literal
 * and its hover twin are two entries rather than one.
 */
function flaggedLiterals(): Set<string> {
  const flagged = new Set<string>();
  for (const rel of censusFiles()) {
    const src = commentsStripped(readFileSync(path.join(ROOT, rel), "utf8"));
    for (const m of src.matchAll(RAW_PALETTE)) {
      const start = m.index ?? 0;
      // Widen left over a `hover:` / `focus:` / `placeholder:` variant chain and
      // right over an `/80` opacity suffix, so the key names what was written.
      const before = /(?:[a-z-]+:)*$/.exec(src.slice(Math.max(0, start - 40), start))?.[0] ?? "";
      const after = /^\/\d{1,3}/.exec(src.slice(start + m[0].length))?.[0] ?? "";
      flagged.add(`${rel} :: ${before}${m[0]}${after}`);
    }
  }
  return flagged;
}

/**
 * `file :: literal` for every raw CHROMATIC colour value, same stripper and the
 * same reasons as `flaggedLiterals` above. Exported shape kept identical so the
 * two censuses read as one family.
 */
function flaggedValues(source?: (rel: string) => string): Set<string> {
  const flagged = new Set<string>();
  for (const rel of valueCensusFiles()) {
    const src = commentsStripped(
      source ? source(rel) : readFileSync(path.join(ROOT, rel), "utf8"),
    );
    for (const m of src.matchAll(RAW_VALUE)) {
      const start = m.index ?? 0;
      if (VAR_FALLBACK.test(src.slice(Math.max(0, start - 80), start))) continue;
      const [fn, c1, c2, c3] = [m[1], Number(m[2]), Number(m[3]), Number(m[4])];
      if (m[0][0] === "#") {
        const rgb = hexToRgb(m[0]);
        if (rgb[0] === rgb[1] && rgb[1] === rgb[2]) continue;
        flagged.add(`${rel} :: ${m[0]}`);
      } else if (fn) {
        // `c2` is GREEN for rgb() and SATURATION for hsl() — two different
        // questions, so the two forms are judged apart rather than through one
        // triple that only means something for the first.
        if (fn.startsWith("hsl")) {
          if (!hslIsChromatic(c2)) continue;
          flagged.add(`${rel} :: hsl(${c1},${c2},${c3})`);
        } else {
          if (c1 === c2 && c2 === c3) continue;
          flagged.add(`${rel} :: rgb(${c1},${c2},${c3})`);
        }
      } else {
        // A chromatic CSS keyword; membership in NAMED_COLOURS IS the test —
        // once the word sits where CSS reads a colour ("The third needle").
        if (!CSS_COLOUR_CONTEXT.test(src.slice(Math.max(0, start - 60), start))) continue;
        flagged.add(`${rel} :: ${m[0]}`);
      }
    }
  }
  return flagged;
}

describe("panel-chrome raw palette census", () => {
  it("flags no raw palette literal outside the allowlist", () => {
    const permitted = new Set(Object.keys(PERMITTED_RAW_PALETTE_LITERALS));
    const unexpected = [...flaggedLiterals()].filter((k) => !permitted.has(k)).sort();
    expect(
      unexpected,
      "TOKENIZE these — mint or reuse a semantic token (see STYLE_GUIDE 'Positive / attained' " +
        "for the shape). Do NOT add them to PERMITTED_RAW_PALETTE_LITERALS; that list may only shrink.",
    ).toEqual([]);
  });

  it("keeps the allowlist honest — every entry still names a live site", () => {
    // A drained site whose entry lingers is how an allowlist stops meaning
    // anything. The set may only shrink, so a stale entry is a deletion owed.
    const flagged = flaggedLiterals();
    const stale = Object.keys(PERMITTED_RAW_PALETTE_LITERALS)
      .filter((k) => !flagged.has(k))
      .sort();
    expect(stale, "these sites are drained — delete their allowlist entries").toEqual([]);
  });

  it("every allowlist entry states a reason", () => {
    for (const [key, why] of Object.entries({
      ...PERMITTED_RAW_PALETTE_LITERALS,
      ...PERMITTED_RAW_VALUE_LITERALS,
    })) {
      expect(why.length, `${key} needs a stated reason`).toBeGreaterThan(20);
    }
  });
});

describe("panel-chrome raw colour-VALUE census", () => {
  it("flags no raw chromatic hex / rgb() outside the allowlist", () => {
    const permitted = new Set(Object.keys(PERMITTED_RAW_VALUE_LITERALS));
    const unexpected = [...flaggedValues()].filter((k) => !permitted.has(k)).sort();
    expect(
      unexpected,
      "TOKENIZE these — read the token the concept already has (the Outline's own " +
        "literals each turned out to have one: --heading-annotation-color, " +
        "--par-title-color, --danger-muted, --amber-highlight-wash/-edge). A " +
        "`var(--token, #fallback)` read is fine; a bare value is not. Do NOT add " +
        "them to PERMITTED_RAW_VALUE_LITERALS; that list may only shrink.",
    ).toEqual([]);
  });

  it("keeps the allowlist honest — every entry still names a live site", () => {
    const flagged = flaggedValues();
    const stale = Object.keys(PERMITTED_RAW_VALUE_LITERALS)
      .filter((k) => !flagged.has(k))
      .sort();
    expect(stale, "these sites are drained — delete their allowlist entries").toEqual([]);
  });
});

describe("census self-checks", () => {
  it("can see a literal that is really there (canary)", () => {
    // Anchored on a site the allowlist KEEPS, not on one this task drained — a
    // canary standing on the defect evaporates the moment the defect is fixed.
    expect(flaggedLiterals()).toContain(
      "src/panels/_shared/suggestion-fields.tsx :: bg-blue-400",
    );
  });

  it("reads strings and ignores prose", () => {
    const fixture = [
      '// a comment naming bg-emerald-500 is prose, not chrome',
      'const live = "bg-emerald-500";',
      '/* block comment with text-blue-500 */',
    ].join("\n");
    const stripped = commentsStripped(fixture);
    expect([...stripped.matchAll(RAW_PALETTE)].map((m) => m[0])).toEqual([
      "bg-emerald-500",
    ]);
  });

  it("does not swallow the files it scans", () => {
    // The stripper DELETES comments (it does not blank them to spaces), so a
    // length comparison says nothing. What a swallow destroys is CODE — the
    // task-202b runaway ate 7 kB and nine declarations — so count code shapes
    // a comment cannot plausibly carry: the import statements must all survive,
    // and the semicolon mass cannot collapse.
    //
    // Both needles are anchored at COLUMN ZERO, which is what makes them
    // comment-proof: a block comment's continuation lines carry a leading
    // ` * `, and a `//` line is deleted wholesale. Semicolon MASS was the
    // obvious third needle and is not usable — `atomless-refs.ts` keeps more
    // than half of its semicolons inside a worked example in its own header.
    const declCount = (s: string) => (s.match(/^(?:export|import)\s/gm) ?? []).length;
    // The VALUE population, which is the superset: both legs strip it.
    for (const rel of valueCensusFiles()) {
      const raw = readFileSync(path.join(ROOT, rel), "utf8");
      const stripped = commentsStripped(raw);
      expect(declCount(stripped), rel).toBe(declCount(raw));
      expect(stripped.length, rel).toBeGreaterThan(0);
    }
  });

  it("would have caught every CHROMATIC spelling the Outline shipped (defect leg)", () => {
    // Driven through the REAL census over a substituted OutlinePanel, not
    // through a re-implementation of the needle: what has to be proven is that
    // the census catches these, and only the census can prove that. Every line
    // is verbatim from the pre-284 file.
    //
    // CHROMATIC is the honest scope, not a hedge. The pre-284 file also carried
    // `border: "2px solid white"` twice, which task 284 retired by hand and
    // which this census does NOT flag — `white` is achromatic, so the stated
    // exclusion covers it exactly as it covers `#ffffff`. Claiming "every
    // spelling" here would be the overstatement this suite exists to prevent.
    const OUTLINE = "src/panels/Outline/OutlinePanel.tsx";
    const preFix = [
      'const a = "text-[11px] text-[#857070] truncate";',
      'const b = { background: "#fef9c3" };',
      'const c = { border: "1.5px solid #d4aa17" };',
      'const d = "text-[#b45757] border-[#b45757]";',
      '<PositionHighlight color="rgba(180, 87, 87, 0.13)" />;',
      // Present so the achromatic exclusion is exercised on the real pre-fix
      // line, not merely asserted in prose above.
      'const e = { border: "2px solid white" };',
    ].join("\n");
    const flagged = flaggedValues((rel) =>
      rel === OUTLINE ? preFix : readFileSync(path.join(ROOT, rel), "utf8"),
    );
    expect([...flagged].filter((k) => k.startsWith(`${OUTLINE} ::`)).sort()).toEqual([
      `${OUTLINE} :: #857070`,
      `${OUTLINE} :: #b45757`,
      `${OUTLINE} :: #d4aa17`,
      `${OUTLINE} :: #fef9c3`,
      `${OUTLINE} :: rgb(180,87,87)`,
    ]);
    // …and the shipped file is clean, which is the other half of the claim.
    expect([...flaggedValues()].filter((k) => k.startsWith(`${OUTLINE} ::`))).toEqual([]);
  });

  it("spares a var() fallback and an achromatic scrim (the two stated exclusions)", () => {
    const OUTLINE = "src/panels/Outline/OutlinePanel.tsx";
    const fixture = [
      'const ok1 = "text-[var(--par-title-color,#c45a5a)]";',
      'const ok2 = { color: "var(--ink-body, #44403c)" };',
      'const ok3 = { boxShadow: "0 1px 3px rgba(0,0,0,0.15)" };',
      'const ok4 = { border: "2px solid var(--surface, #ffffff)" };',
      // The control: without one, every leg above could pass on a dead needle.
      'const bad = { color: "#857070" };',
    ].join("\n");
    const flagged = flaggedValues((rel) =>
      rel === OUTLINE ? fixture : readFileSync(path.join(ROOT, rel), "utf8"),
    );
    expect([...flagged].filter((k) => k.startsWith(`${OUTLINE} ::`))).toEqual([
      `${OUTLINE} :: #857070`,
    ]);
  });

  it("judges hsl by SATURATION and keywords by MEMBERSHIP (the two new arms)", () => {
    // Both arms are unreachable from the live tree — no `hsl(` and no chromatic
    // keyword exists in the censused scope today — so without this leg they
    // would ship untested and could be silently wrong in either direction.
    const OUTLINE = "src/panels/Outline/OutlinePanel.tsx";
    const fixture = [
      'const a = { color: "hsl(50 50 50)" };',      // saturated olive -> FLAGGED
      'const b = { color: "hsl(0 0 60)" };',        // true grey       -> spared
      'const c = { border: "2px solid gold" };',    // chromatic name  -> FLAGGED
      'const d = { border: "2px solid black" };',   // achromatic name -> spared
      'const e = "text-red-700";',                  // the FIRST needle's, not this one
    ].join("\n");
    const flagged = [...flaggedValues((rel) =>
      rel === OUTLINE ? fixture : readFileSync(path.join(ROOT, rel), "utf8"),
    )].filter((k) => k.startsWith(`${OUTLINE} ::`)).sort();
    expect(flagged).toEqual([
      `${OUTLINE} :: gold`,
      `${OUTLINE} :: hsl(50,50,50)`,
    ]);
  });

  it("censuses the files it claims to", () => {
    const files = censusFiles();
    expect(files).toContain("src/panels/Cutter/CutterGoalStrip.tsx");
    expect(files).toContain("src/panels/_shared/PanelGoalStrip.tsx");
    expect(files).toContain("src/components/panel-primitives.tsx");
    expect(files.some((f) => f.includes("__tests__"))).toBe(false);
    expect(files.length).toBeGreaterThan(40);
  });

  it("reads every production file for VALUES, not just the panel tree (task 1412)", () => {
    const files = valueCensusFiles();
    // A superset of the palette leg's population, so the defect legs above
    // still exercise the census the VALUE leg actually runs.
    for (const f of censusFiles()) expect(files).toContain(f);
    for (const f of [
      "src/components/AIWindow.tsx",
      "src/lib/tiptap/transient-highlight.ts",
      "src/hooks/useCollab.ts",
      "src/cards/legacy-token-crosswalk.ts",
      "src/app/manifest.ts",
    ]) expect(files).toContain(f);
    expect(files.some((f) => f.includes("__tests__") || /\.test\.tsx?$/.test(f))).toBe(false);
    expect(files.length).toBeGreaterThan(censusFiles().length * 4);
  });

  it("fails a raw value planted OUTSIDE the panel tree (the widening's defect leg)", () => {
    // `#44403c` is `--ink-body`'s own value: the shape the drift takes is a
    // token re-spelled, and src/components was where nothing could see it.
    const SITE = "src/components/FloatingPanel.tsx";
    const live = readFileSync(path.join(ROOT, SITE), "utf8");
    const planted = `${live}\nconst planted = { color: "#44403c" };\n`;
    const flagged = flaggedValues((rel) =>
      rel === SITE ? planted : readFileSync(path.join(ROOT, rel), "utf8"),
    );
    expect([...flagged].filter((k) => k.startsWith(`${SITE} ::`))).toEqual([`${SITE} :: #44403c`]);
    // …and the shipped file is clean — its dead `--border` fallback is drained.
    expect([...flaggedValues()].filter((k) => k.startsWith(`${SITE} ::`))).toEqual([]);
  });

  it("spares an HTML entity and a colour WORD outside a CSS-value context", () => {
    const SITE = "src/components/MenuBar.tsx";
    const fixture = [
      '<span>&#182;</span>;',                                 // entity, not a hex
      'const t = "The quick brown fox";',                     // prose
      'type Tone = "green" | "red";',                         // a union of NAMES
      'const a = { authenticated: "green" };',                // a tone name keyed by status
      // The controls: each spelling CSS actually reads still fails.
      'const b = { color: "red" };',
      'const c = <rect fill="orange" />;',
      'const d = { borderColor: "teal" };',
      'const e = { border: "1px dashed gold" };',
      'const f = { background: "#d97706" };',
    ].join("\n");
    const flagged = [...flaggedValues((rel) =>
      rel === SITE ? fixture : readFileSync(path.join(ROOT, rel), "utf8"),
    )].filter((k) => k.startsWith(`${SITE} ::`)).sort();
    expect(flagged).toEqual([
      `${SITE} :: #d97706`,
      `${SITE} :: gold`,
      `${SITE} :: orange`,
      `${SITE} :: red`,
      `${SITE} :: teal`,
    ]);
  });
});

/**
 * The Outline panel is a MIRROR of chrome the document already renders, so its
 * tokens are not a fresh choice — they are the ones its original already reads.
 * These legs assert the agreement rather than restating either side's value, so
 * a retone of the in-prose rule is caught at the panel that copies it.
 */
describe("the Outline panel mirrors its in-prose originals' tokens (task 284)", () => {
  const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
  /**
   * Every leg below reads the COMMENT-STRIPPED source, and the negative legs
   * especially: this task's own edits explain each swap by naming the literal
   * they retired, and a guard that indicts its own explanation teaches the next
   * author to delete the explanation — the rule the `--positive` block below
   * already states about `bg-emerald-500`. Measured, not theorised: three of
   * these legs failed on raw text against a file with zero live literals.
   */
  const globalsCode = cssCommentsStripped(globals);
  const outline = commentsStripped(
    readFileSync(path.join(ROOT, "src/panels/Outline/OutlinePanel.tsx"), "utf8"),
  );
  /** The declarations of one CSS rule, by selector, comments stripped. */
  const ruleBody = (selector: string) =>
    new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`)
      .exec(globalsCode)?.[1] ?? "";

  it("takes the label-key ink its in-prose twin takes", () => {
    // `.heading-label-input` is the SAME affordance in the margin. Read the
    // token out of its rule so this cannot drift into a second opinion.
    const twin = ruleBody(".heading-label-input");
    expect(twin).toMatch(/--heading-annotation-color/);
    expect(outline).toContain("text-[var(--heading-annotation-color)]");
    expect(outline).not.toMatch(/text-blue-|border-blue-/);
  });

  it("takes the conflict ink its in-prose twin takes", () => {
    // `.heading-label-input.has-conflict` + `.heading-label-warning`.
    expect(ruleBody(".heading-label-input.has-conflict")).toMatch(/--danger-muted/);
    expect(ruleBody(".heading-label-warning")).toMatch(/--danger-muted/);
    // The Tailwind rung exists, so the panel spells the utility (globals.css
    // declares `--color-danger-muted`; `destructive-red-tokens` leg 3 pins the
    // alias⇔utility biconditional, so this spelling keeps that leg satisfied).
    expect(globalsCode).toMatch(/--color-danger-muted:\s*var\(--danger-muted\)/);
    expect(outline).toContain("text-danger-muted border-danger-muted");
    expect(outline).not.toContain("#b45757");
  });

  it("renders paragraph titles in the preference-backed token its siblings use", () => {
    // Not a new decision: the prose annotation, the card-title primitive and the
    // Search breadcrumb all already read it at full strength. The Outline was
    // the sole surface frozen against a user-recolourable pref.
    //
    // Read from the in-prose RULE, like its four sibling legs — an earlier draft
    // asserted a literal class string inside SearchPanel.tsx, which made a
    // whitespace reformat over there fail a test named for the Outline.
    expect(ruleBody(".par-title-annotation")).toMatch(/--par-title-color/);
    // RENEGOTIATED by task 2026-08-18-361, deliberately and in place: this leg
    // used to require the BARE `--par-title-color` here. The Outline is the one
    // consumer at 11px/400 (every other is 12.5px/500), where the shipped
    // default measures 4.17:1 on --pod-panel — under AA. So it now reads the
    // DERIVED rung `--par-title-color-dense`, which is an oklab mix OF the same
    // preference: what this leg guards (the panel tracks the user's colour
    // rather than a frozen literal) is unchanged, and the sheet's own
    // derivation is what carries it. The contrast half — the property no
    // palette census can see — is pinned in
    // src/panels/Outline/__tests__/outline-partitle-contrast.test.ts.
    expect(globalsCode).toMatch(
      /--par-title-color-dense:\s*color-mix\(in oklab, var\(--par-title-color\)/,
    );
    expect(outline).toContain("text-[var(--par-title-color-dense,");
    expect(outline).not.toContain("#857070");
  });

  it("paints the focus band from the shared amber-highlight family", () => {
    expect(outline).toContain("var(--amber-highlight-wash)");
    expect(outline).toContain("var(--amber-highlight-edge)");
    // The band's retired fill had a SECOND speller in globals.css,
    // `.citation-preview` — which turned out to have no producer anywhere and
    // was DELETED rather than tokenized. So the invariant is the value's
    // absence from the sheet, not a second rule reading the token.
    expect(globalsCode).not.toContain("#fef9c3");
    expect(outline).not.toContain("#fef9c3");
    expect(outline).not.toContain("#d4aa17");
  });

  it("rings the focus-band handles in the surface they actually sit on", () => {
    // `--pod-panel`, not `--surface`: `FloatingPanel` fills a `surface="panel"`
    // host (the Outline's default) with `var(--pod-panel)` in BOTH docked and
    // floating modes. The two are separate preferences whose shipped defaults
    // already differ (#fdfaf5 vs #ffffff), so a ring bound to `--surface` would
    // follow a recolour of a card background this panel does not have — the
    // wrong-by-token shape task 284 exists to retire. (No fallback: the old
    // `#fffdfa` one disagreed with the token and could never render — task
    // 1381's fallback-agreement leg in phantom-css-var.test.ts.)
    expect(outline).toContain('border: "2px solid var(--pod-panel)"');
    expect(outline).not.toMatch(/2px solid (?:white|var\(--surface)/);
  });

  it("marks the caret's section with an accent tint, not a borrowed red", () => {
    // `--accent` is the token whose own preference row reads "Links, selections,
    // and active controls" — which is what a current-position selector is.
    expect(outline).toContain("color-mix(in oklab, var(--accent) 13%, transparent)");
    expect(outline).not.toMatch(/rgba\(\s*180\s*,/);
  });
});

describe("the --positive role-set is defined and read", () => {
  const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

  it("defines both rungs in :root, pinned to the emeralds they replaced", () => {
    expect(globals).toMatch(/--positive:\s*#10b981\s*;/);
    expect(globals).toMatch(/--positive-strong:\s*#047857\s*;/);
  });

  it("has the goal strip reading them", () => {
    const strip = readFileSync(
      path.join(ROOT, "src/panels/_shared/PanelGoalStrip.tsx"),
      "utf8",
    );
    expect(strip).toContain("bg-[var(--positive)]");
    expect(strip).toContain("text-[var(--positive-strong)]");
  });

  it("leaves no emerald CLASS in the goal strip or its two adapters", () => {
    // Asked through the census, not through raw file text: the primitive's own
    // header NAMES `bg-emerald-500` when it explains what it replaced, and a
    // guard that indicts its own explanation teaches the next author to delete
    // the explanation.
    const flagged = [...flaggedLiterals()];
    for (const rel of [
      "src/panels/Cutter/CutterGoalStrip.tsx",
      "src/panels/Revisions/RevisionsTracker.tsx",
      "src/panels/_shared/PanelGoalStrip.tsx",
    ]) {
      expect(flagged.filter((k) => k.startsWith(`${rel} ::`)), rel).toEqual([]);
    }
  });
});
