// The ONE table from a preference to the CSS custom property it drives — read
// by every layer that paints a preference (task 902).
//
// Three readers cannot import each other's world:
//
//   • the RUNTIME (`preferences-tree.ts` → `PREF_TO_CSS`, applied onto `:root`
//     by `EditorLayout`'s prefs effect, through `resolvePrefCssVars`);
//   • the PROMOTER (`tools/promote-defaults.mjs`), plain node, which regenerates
//     the first-paint seed block (PROMOTE-DEFAULTS) in `globals.css` from the
//     shipped defaults;
//   • the COVERAGE CHECK (`tools/check-prefs-coverage.mjs`), which fails when
//     that seed block is not exactly this table rendered at the defaults.
//
// It used to be two hand maps — `cssVarMap` in `dev-prefs-registry.json` for
// first paint and `PREF_TO_CSS` for the runtime — and they had already drifted
// (~16 runtime rows the seed never painted, so the default body font flipped
// from the fallback face to "Lora" a few frames after load). So this file is an
// IMPORT-FREE LEAF, like `library/lib/skill-bundle-layout.mjs`: no `@/…` alias,
// no framework, nothing a plain `node` run cannot load.

/**
 * @typedef {object} PrefCssRow
 * @property {string} key      The `EditorPreferences` field.
 * @property {string} cssVar   The custom property it drives.
 * @property {boolean} [color] A colour: the runtime passes it through the
 *   user's global colour transforms before painting.
 * @property {string} [unit]   Suffix appended to the value (`rem`, `px`).
 * @property {boolean} [quote] Wrap the value in double quotes (font families).
 */

/** @type {readonly PrefCssRow[]} */
export const PREF_CSS_ROWS = Object.freeze([
  // Editor body
  { key: "editorFontSize", cssVar: "--editor-font-size", unit: "rem" },
  { key: "editorLineHeight", cssVar: "--editor-line-height" },
  { key: "editorTextColor", cssVar: "--editor-text-color", color: true },

  // App chrome
  // (the theme-color meta follows --topbar-bg's painted value —
  //  src/lib/theme-color.ts; --main-tab-bg is aliased to --background in
  //  globals.css)
  { key: "topbarBackground", cssVar: "--topbar-bg", color: true },
  { key: "topbarBackgroundBottom", cssVar: "--topbar-bg-bottom", color: true },
  { key: "topbarBorder", cssVar: "--topbar-border", color: true },
  { key: "tabBg", cssVar: "--tab-bg", color: true },
  { key: "libraryBg", cssVar: "--library-bg", color: true },
  { key: "virgilBarText", cssVar: "--virgil-bar-text", color: true },

  // Heading annotations
  { key: "headingAnnotationColor", cssVar: "--heading-annotation-color", color: true },
  { key: "headingAnnotationBorder", cssVar: "--heading-annotation-border", color: true },

  // Paragraph titles
  { key: "parTitleSize", cssVar: "--par-title-size", unit: "rem" },
  { key: "parTitleColor", cssVar: "--par-title-color", color: true },

  // Blockquotes
  { key: "blockquoteBorder", cssVar: "--blockquote-border", color: true },
  { key: "blockquoteText", cssVar: "--blockquote-text", color: true },

  // Code & math
  { key: "codeBackground", cssVar: "--code-bg", color: true },
  { key: "codeBlockBackground", cssVar: "--code-block-bg", color: true },
  { key: "mathColor", cssVar: "--math-color", color: true },

  // Inline elements
  { key: "accentColor", cssVar: "--accent", color: true },
  { key: "backgroundColor", cssVar: "--background", color: true },
  { key: "surfaceColor", cssVar: "--surface", color: true },
  { key: "commentColor", cssVar: "--comment-color", color: true },
  { key: "latexCommentColor", cssVar: "--latex-comment-color", color: true },
  { key: "citationColor", cssVar: "--citation-color", color: true },
  { key: "citationBorderColor", cssVar: "--citation-border-color", color: true },
  { key: "labelRefColor", cssVar: "--label-ref-color", color: true },
  { key: "labelRefBorderColor", cssVar: "--label-ref-border-color", color: true },
  { key: "footnoteColor", cssVar: "--footnote-color", color: true },
  { key: "noteColor", cssVar: "--note-color", color: true },
  { key: "noteMarkerBorder", cssVar: "--note-marker-border", color: true },

  // Suggestions
  { key: "markBackground", cssVar: "--mark-bg", color: true },
  { key: "markBorder", cssVar: "--mark-border", color: true },

  // LaTeX commands
  { key: "latexCmdColor", cssVar: "--latex-cmd-color", color: true },

  // Panels
  { key: "panelFontSize", cssVar: "--panel-font-size", unit: "px" },
  { key: "panelHeaderSize", cssVar: "--panel-header-size", unit: "px" },
  // (--pod-editor is aliased to --surface in globals.css)
  { key: "headerBg", cssVar: "--header-bg", color: true },
  { key: "podPanel", cssVar: "--pod-panel", color: true },
  { key: "podToolbar", cssVar: "--pod-toolbar", color: true },
  { key: "podDark", cssVar: "--pod-dark", color: true },
  { key: "panelAdminTextColor", cssVar: "--panel-admin-text-color", color: true },
  { key: "panelHeaderTextColor", cssVar: "--panel-header-text-color", color: true },
  { key: "panelAdminTextFont", cssVar: "--panel-admin-text-font", quote: true },

  // Canvas & layout
  { key: "foreground", cssVar: "--foreground", color: true },
  { key: "borderColor", cssVar: "--border", color: true },
  { key: "borderLight", cssVar: "--border-light", color: true },
  { key: "mutedColor", cssVar: "--muted", color: true },
  { key: "mutedLight", cssVar: "--muted-light", color: true },
  { key: "dragHighlight", cssVar: "--drag-highlight", color: true },
  // (--scrollbar-hover is aliased to --muted-light in globals.css)
  { key: "scrollbarThumb", cssVar: "--scrollbar-thumb", color: true },

  // Fonts
  { key: "fontSerif", cssVar: "--font-serif-override", quote: true },
  { key: "fontSans", cssVar: "--font-sans-override", quote: true },
  { key: "fontDisplay", cssVar: "--font-display-override", quote: true },
  { key: "fontLogo", cssVar: "--font-logo-override", quote: true },
  { key: "fontMono", cssVar: "--font-mono-override", quote: true },

  // Fonts… dialog — non-nullable size/weight fields go straight through.
  // Nullable family fields are DERIVED_CSS rows (preferences-tree.ts) so they
  // can resolve "pinned to body" → the body family rather than leaving the var
  // empty (which would defeat the var() fallback chain).
  { key: "fontMaketitleTitleSize", cssVar: "--font-maketitle-title-size", unit: "rem" },
  { key: "fontMaketitleTitleWeight", cssVar: "--font-maketitle-title-weight" },
  { key: "fontMaketitleMetaSize", cssVar: "--font-maketitle-meta-size", unit: "rem" },
  { key: "fontMaketitleMetaWeight", cssVar: "--font-maketitle-meta-weight" },
  { key: "fontHeadersH1Size", cssVar: "--font-headers-h1-size", unit: "rem" },
  { key: "fontHeadersH1Weight", cssVar: "--font-headers-h1-weight" },
  { key: "fontHeadersH2Size", cssVar: "--font-headers-h2-size", unit: "rem" },
  { key: "fontHeadersH2Weight", cssVar: "--font-headers-h2-weight" },
  { key: "fontHeadersH3Size", cssVar: "--font-headers-h3-size", unit: "rem" },
  { key: "fontHeadersH3Weight", cssVar: "--font-headers-h3-weight" },
  { key: "fontParTitleWeight", cssVar: "--font-partitle-weight" },
]);

/**
 * Render one preference value the way its custom property carries it. A
 * missing value renders as the empty string (the property is cleared, so the
 * stylesheet's own fallback chain answers).
 *
 * @param {PrefCssRow} row
 * @param {unknown} raw
 * @returns {string}
 */
export function renderPrefCssValue(row, raw) {
  if (raw === undefined || raw === null) return "";
  if (row.quote) return `"${String(raw)}"`;
  if (row.unit) return `${raw}${row.unit}`;
  return String(raw);
}

/**
 * The first-paint seed: every row rendered from the shipped editor defaults
 * (`usePreferences.defaults.json`), in table order, as `[cssVar, value]`
 * pairs. A row whose default is missing is skipped — `check-prefs-coverage`
 * fails on that separately.
 *
 * @param {Record<string, unknown>} defaults
 * @returns {[string, string][]}
 */
export function renderPrefCssSeed(defaults) {
  /** @type {[string, string][]} */
  const out = [];
  for (const row of PREF_CSS_ROWS) {
    const raw = defaults[row.key];
    if (raw === undefined || raw === null) continue;
    out.push([row.cssVar, renderPrefCssValue(row, raw)]);
  }
  return out;
}

// ── The managed block in globals.css ────────────────────────────────────────
//
// The seed above is written into `globals.css` between a PROMOTE-DEFAULTS-START
// comment and the END marker, and that region is GENERATED: the promoter
// rebuilds it from the seed, byte for byte, on every run. Splitting the file
// and rendering the body are stated ONCE, here, so the promoter that writes the
// block and the guards that check it (`check-prefs-coverage`, the
// pref-css-one-table suite) cannot disagree about what "the block" is. They
// used to each carry their own regex, and the vitest guard's line regex skipped
// any line with a trailing comment — so a hand-added token inside the block
// (task 1344's `--code-block-bg-hover`, task 1351) went unseen until an
// unrelated isolation test reported a nameless "Would update globals.css".

export const PREF_CSS_BLOCK_END = "/* PROMOTE-DEFAULTS-END */";

/**
 * Split a stylesheet around its managed block. `before` ends with the START
 * comment, `body` is everything up to (not including) the END marker, `after`
 * follows the marker; `indent` is the START comment's indentation.
 *
 * @param {string} css
 * @returns {{ before: string, indent: string, body: string, after: string } | null}
 */
export function splitPrefCssBlock(css) {
  const start = /^([ \t]*)\/\* PROMOTE-DEFAULTS-START[\s\S]*?\*\//m.exec(css);
  if (!start) return null;
  const bodyStart = start.index + start[0].length;
  const endIdx = css.indexOf(PREF_CSS_BLOCK_END, bodyStart);
  if (endIdx === -1) return null;
  return {
    before: css.slice(0, bodyStart),
    indent: start[1],
    body: css.slice(bodyStart, endIdx),
    after: css.slice(endIdx + PREF_CSS_BLOCK_END.length),
  };
}

/**
 * The managed block's body, exactly as the promoter writes it: one
 * `cssVar: value;` line per seed pair, then the END marker's indentation.
 *
 * @param {[string, string][]} seed
 * @param {string} indent
 * @returns {string}
 */
export function renderPrefCssBlockBody(seed, indent) {
  const lines = seed.map(([cssVar, value]) => `${indent}${cssVar}: ${value};`);
  return "\n" + lines.join("\n") + "\n" + indent;
}

/**
 * The guards' one failure sentence when the block is not the promoter's render.
 * It names the generator, because the usual cause is a hand edit inside the
 * block, and the fix is to move it — not to re-run anything.
 */
export const PREF_CSS_BLOCK_HAND_EDIT_HINT =
  "globals.css's PROMOTE-DEFAULTS block is GENERATED by tools/promote-defaults.mjs " +
  "(the pref-css-table rendered at usePreferences.defaults.json). Put a hand-written " +
  "token in the :root above the block, and change a shipped default in the JSON " +
  "sidecar (then `npm run promote-defaults`), never inside the block.";
