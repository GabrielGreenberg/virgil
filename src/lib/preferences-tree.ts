/**
 * Hierarchical tree structure for the Preferences UI, plus CSS variable mappings.
 */

import type { EditorPreferences } from "@/hooks/usePreferences";
import { deriveLight, hexToRgba } from "@/hooks/usePreferences";

// ─── Tree Types ───────────────────────────────────────────────────────────────

export interface PrefLeafColor {
  type: "color";
  key: keyof EditorPreferences;
  label: string;
  description?: string;
}

export interface PrefLeafSlider {
  type: "slider";
  key: keyof EditorPreferences;
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export interface PrefLeafFont {
  type: "font";
  key: keyof EditorPreferences;
  label: string;
  description?: string;
  options: string[];
}

export type PrefLeaf = PrefLeafColor | PrefLeafSlider | PrefLeafFont;

export interface PrefGroup {
  label: string;
  children: PrefNode[];
  defaultOpen?: boolean;
}

export type PrefNode = PrefGroup | PrefLeaf;

function isLeaf(node: PrefNode): node is PrefLeaf {
  return "type" in node && (node.type === "color" || node.type === "slider" || node.type === "font");
}
export { isLeaf };

// ─── Font Options ─────────────────────────────────────────────────────────────

const SERIF_FONTS = ["Source Serif 4", "Georgia", "Playfair Display", "Libre Baskerville", "Lora", "Merriweather", "EB Garamond", "Crimson Text"];
const SANS_FONTS = ["Inter", "system-ui", "Helvetica Neue", "Open Sans", "Lato", "Roboto", "IBM Plex Sans", "Source Sans 3"];
const MONO_FONTS = ["Geist Mono", "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "monospace"];
const DISPLAY_FONTS = ["Playfair Display", "Cinzel", "Cormorant Garamond", "Libre Baskerville", "EB Garamond"];
const LOGO_FONTS = ["Cinzel", "Playfair Display", "Cormorant Garamond", "Libre Baskerville"];

/** Curated pool for the Fonts… dialog (main-text categories). Grouped
 *  serif → sans → display so the dropdown can render section dividers. */
export const MAIN_TEXT_FONTS: { group: string; fonts: string[] }[] = [
  { group: "Serif", fonts: ["Source Serif 4", "Georgia", "Libre Baskerville", "Libre Caslon Text", "Lora", "Lusitana", "Merriweather", "EB Garamond", "Crimson Text", "Cardo", "Spectral", "PT Serif", "Old Standard TT", "Vollkorn", "Gentium Plus"] },
  { group: "Sans-serif", fonts: ["Inter", "system-ui", "Helvetica Neue", "Open Sans", "Lato", "Roboto", "IBM Plex Sans", "Source Sans 3", "Work Sans", "DM Sans", "Manrope", "Public Sans", "Atkinson Hyperlegible"] },
  { group: "Display", fonts: ["Playfair Display", "Cinzel", "Cormorant Garamond", "Cormorant SC", "IM Fell English", "Marcellus", "Bodoni Moda"] },
];

export const ALL_MAIN_TEXT_FONTS: string[] = MAIN_TEXT_FONTS.flatMap((g) => g.fonts);

// ─── The Preference Tree ──────────────────────────────────────────────────────

export const PREFERENCES_TREE: PrefNode[] = [
  {
    label: "Top Bar & Browser",
    children: [
      { type: "color", key: "topbarBackground", label: "Top bar background", description: "Fill color of the application title bar (also sets the browser/PWA chrome color). Top edge of the Virgil bar gradient." },
      { type: "color", key: "topbarBackgroundBottom", label: "Top bar background (bottom)", description: "Bottom color of the Virgil bar gradient — fades down from the top-bar background. Set equal to the top for a flat bar." },
      { type: "color", key: "topbarBorder", label: "Top bar border", description: "Bottom edge separating title bar from content" },
    ],
  },
  {
    label: "Editor",
    defaultOpen: true,
    children: [
      {
        label: "Body Text",
        defaultOpen: true,
        children: [
          { type: "slider", key: "editorFontSize", label: "Font size", description: "Base size for body paragraphs", min: 0.85, max: 1.4, step: 0.05, unit: " rem" },
          { type: "slider", key: "editorLineHeight", label: "Line height", description: "Vertical spacing between text lines", min: 1.4, max: 2.4, step: 0.1, unit: "" },
          { type: "color", key: "editorTextColor", label: "Text color", description: "Default color for paragraph body text" },
          { type: "font", key: "fontSerif", label: "Font family", description: "Typeface used for body paragraphs", options: SERIF_FONTS },
        ],
      },
      {
        label: "Paragraph Titles",
        children: [
          { type: "slider", key: "parTitleSize", label: "Size", description: "Size of short titles before paragraphs", min: 0.6, max: 1.0, step: 0.02, unit: " rem" },
          { type: "color", key: "parTitleColor", label: "Color", description: "Color of paragraph title labels" },
        ],
      },
      {
        label: "Heading Annotations",
        children: [
          { type: "color", key: "headingAnnotationColor", label: "Text color", description: "Annotations displayed alongside headings" },
          { type: "color", key: "headingAnnotationBorder", label: "Border color", description: "Border around heading annotation markers" },
        ],
      },
      {
        label: "Blockquotes",
        children: [
          { type: "color", key: "blockquoteBorder", label: "Border color", description: "Left border stripe on quoted blocks" },
          { type: "color", key: "blockquoteText", label: "Text color", description: "Text inside quoted blocks" },
        ],
      },
      {
        label: "Code & Math",
        children: [
          { type: "color", key: "codeBackground", label: "Code background", description: "Fill behind inline code spans" },
          { type: "color", key: "codeBlockBackground", label: "Code block background", description: "Fill behind fenced code blocks" },
          { type: "color", key: "mathColor", label: "Math text color", description: "Color of rendered math expressions" },
        ],
      },
      {
        label: "Citations",
        children: [
          { type: "color", key: "citationColor", label: "Text color", description: "Inline citation key text" },
          { type: "color", key: "citationBorderColor", label: "Border color", description: "Border around citation markers" },
        ],
      },
      {
        label: "Cross-references",
        children: [
          { type: "color", key: "labelRefColor", label: "Text color", description: "Inline \\ref cross-reference chips (the chip's fill follows this color)" },
          { type: "color", key: "labelRefBorderColor", label: "Border color", description: "Border around cross-reference chips" },
        ],
      },
      {
        label: "Footnotes",
        children: [
          { type: "color", key: "footnoteColor", label: "Marker color", description: "Superscript footnote numbers" },
        ],
      },
      {
        label: "Margin Notes",
        children: [
          { type: "color", key: "noteColor", label: "Marker color", description: "Note indicator icons and numbers" },
          { type: "color", key: "noteMarkerBorder", label: "Border color", description: "Border around note markers" },
        ],
      },
      {
        label: "Comments",
        children: [
          { type: "color", key: "commentColor", label: "Highlight color", description: "Background highlight on commented text" },
        ],
      },
      {
        label: "LaTeX Comments",
        children: [
          { type: "color", key: "latexCommentColor", label: "Text color", description: "% comments visible in source view" },
        ],
      },
      {
        label: "Suggestions",
        children: [
          { type: "color", key: "markBackground", label: "Mark background", description: "Highlight fill behind suggestion text" },
          { type: "color", key: "markBorder", label: "Mark border", description: "Outline around suggestion marks" },
        ],
      },
      {
        label: "LaTeX Commands",
        children: [
          { type: "color", key: "latexCmdColor", label: "Command color", description: "Backslash commands in source view" },
        ],
      },
    ],
  },
  {
    label: "Panels & UI",
    children: [
      {
        label: "Panel Typography & Surfaces",
        children: [
          { type: "slider", key: "panelFontSize", label: "Font size", description: "Text size in side panel content", min: 11, max: 16, step: 1, unit: "px" },
          { type: "slider", key: "panelHeaderSize", label: "Header size", description: "Text size for panel section headers", min: 9, max: 17, step: 1, unit: "px" },
          { type: "color", key: "surfaceColor", label: "Card background", description: "Fill color of cards and containers" },
          { type: "font", key: "fontSans", label: "Font family", description: "Typeface used in panels and UI", options: SANS_FONTS },
        ],
      },
      {
        label: "Panel Backgrounds",
        children: [
          { type: "color", key: "headerBg", label: "Header background", description: "Top header bar of each panel" },
          { type: "color", key: "podPanel", label: "Panel pod background", description: "Container area behind panel content" },
          { type: "color", key: "podToolbar", label: "Toolbar pod background", description: "Container area behind the toolbar" },
          { type: "color", key: "podDark", label: "Dark pod background", description: "Dark-themed container regions" },
        ],
      },
    ],
  },
  {
    label: "Canvas & Layout",
    children: [
      { type: "color", key: "backgroundColor", label: "Page background", description: "Main page/canvas fill color" },
      { type: "color", key: "foreground", label: "Foreground text", description: "Default text color for UI elements" },
      { type: "color", key: "accentColor", label: "Accent", description: "Links, selections, and active controls" },
      { type: "color", key: "borderColor", label: "Border", description: "Primary borders between regions" },
      { type: "color", key: "borderLight", label: "Border (light)", description: "Subtle inner dividers and separators" },
      { type: "color", key: "mutedColor", label: "Muted text", description: "Secondary and de-emphasized text" },
      { type: "color", key: "mutedLight", label: "Muted light", description: "Very light placeholder and hint text" },
      { type: "color", key: "dragHighlight", label: "Drag highlight", description: "Indicator shown when dragging items" },
      { type: "color", key: "scrollbarThumb", label: "Scrollbar", description: "Scrollbar handle at rest (hover state is locked to muted text color)" },
    ],
  },
  {
    label: "Global Font Families",
    children: [
      { type: "font", key: "fontSerif", label: "Body (serif)", description: "Main typeface for document text", options: SERIF_FONTS },
      { type: "font", key: "fontSans", label: "UI (sans)", description: "Typeface for panels and interface", options: SANS_FONTS },
      { type: "font", key: "fontDisplay", label: "Display", description: "Decorative face for titles and headers", options: DISPLAY_FONTS },
      { type: "font", key: "fontLogo", label: "Logo", description: "Typeface for the app logo", options: LOGO_FONTS },
      { type: "font", key: "fontMono", label: "Monospace", description: "Code, math, and fixed-width text", options: MONO_FONTS },
    ],
  },
];

// ─── CSS Variable Mappings ────────────────────────────────────────────────────

export interface CssMapping {
  key: keyof EditorPreferences;
  cssVar: string;
  isColor: boolean;
  transform?: (value: string | number) => string;
}

export const PREF_TO_CSS: CssMapping[] = [
  // Editor body
  { key: "editorFontSize", cssVar: "--editor-font-size", isColor: false, transform: (v) => `${v}rem` },
  { key: "editorLineHeight", cssVar: "--editor-line-height", isColor: false },
  { key: "editorTextColor", cssVar: "--editor-text-color", isColor: true },

  // App chrome
  // (--theme-color is aliased to --topbar-bg, --main-tab-bg is aliased to
  //  --background, both in globals.css)
  { key: "topbarBackground", cssVar: "--topbar-bg", isColor: true },
  { key: "topbarBackgroundBottom", cssVar: "--topbar-bg-bottom", isColor: true },
  { key: "topbarBorder", cssVar: "--topbar-border", isColor: true },
  { key: "tabBg", cssVar: "--tab-bg", isColor: true },
  { key: "libraryBg", cssVar: "--library-bg", isColor: true },
  { key: "virgilBarText", cssVar: "--virgil-bar-text", isColor: true },

  // Heading annotations
  { key: "headingAnnotationColor", cssVar: "--heading-annotation-color", isColor: true },
  { key: "headingAnnotationBorder", cssVar: "--heading-annotation-border", isColor: true },

  // Paragraph titles
  { key: "parTitleSize", cssVar: "--par-title-size", isColor: false, transform: (v) => `${v}rem` },
  { key: "parTitleColor", cssVar: "--par-title-color", isColor: true },

  // Blockquotes
  { key: "blockquoteBorder", cssVar: "--blockquote-border", isColor: true },
  { key: "blockquoteText", cssVar: "--blockquote-text", isColor: true },

  // Code & math
  { key: "codeBackground", cssVar: "--code-bg", isColor: true },
  { key: "codeBlockBackground", cssVar: "--code-block-bg", isColor: true },
  { key: "mathColor", cssVar: "--math-color", isColor: true },

  // Inline elements
  { key: "accentColor", cssVar: "--accent", isColor: true },
  { key: "backgroundColor", cssVar: "--background", isColor: true },
  { key: "surfaceColor", cssVar: "--surface", isColor: true },
  { key: "commentColor", cssVar: "--comment-color", isColor: true },
  { key: "latexCommentColor", cssVar: "--latex-comment-color", isColor: true },
  { key: "citationColor", cssVar: "--citation-color", isColor: true },
  { key: "citationBorderColor", cssVar: "--citation-border-color", isColor: true },
  { key: "labelRefColor", cssVar: "--label-ref-color", isColor: true },
  { key: "labelRefBorderColor", cssVar: "--label-ref-border-color", isColor: true },
  { key: "footnoteColor", cssVar: "--footnote-color", isColor: true },
  { key: "noteColor", cssVar: "--note-color", isColor: true },
  { key: "noteMarkerBorder", cssVar: "--note-marker-border", isColor: true },

  // Suggestions
  { key: "markBackground", cssVar: "--mark-bg", isColor: true },
  { key: "markBorder", cssVar: "--mark-border", isColor: true },

  // LaTeX commands
  { key: "latexCmdColor", cssVar: "--latex-cmd-color", isColor: true },

  // Panels
  { key: "panelFontSize", cssVar: "--panel-font-size", isColor: false, transform: (v) => `${v}px` },
  { key: "panelHeaderSize", cssVar: "--panel-header-size", isColor: false, transform: (v) => `${v}px` },
  // (--pod-editor is aliased to --surface in globals.css)
  { key: "headerBg", cssVar: "--header-bg", isColor: true },
  { key: "podPanel", cssVar: "--pod-panel", isColor: true },
  { key: "podToolbar", cssVar: "--pod-toolbar", isColor: true },
  { key: "podDark", cssVar: "--pod-dark", isColor: true },
  { key: "panelAdminTextColor", cssVar: "--panel-admin-text-color", isColor: true },
  { key: "panelHeaderTextColor", cssVar: "--panel-header-text-color", isColor: true },
  { key: "panelAdminTextFont", cssVar: "--panel-admin-text-font", isColor: false, transform: (v) => `"${v}"` },

  // Canvas & layout
  { key: "foreground", cssVar: "--foreground", isColor: true },
  { key: "borderColor", cssVar: "--border", isColor: true },
  { key: "borderLight", cssVar: "--border-light", isColor: true },
  { key: "mutedColor", cssVar: "--muted", isColor: true },
  { key: "mutedLight", cssVar: "--muted-light", isColor: true },
  { key: "dragHighlight", cssVar: "--drag-highlight", isColor: true },
  // (--scrollbar-hover is aliased to --muted-light in globals.css)
  { key: "scrollbarThumb", cssVar: "--scrollbar-thumb", isColor: true },

  // Fonts
  { key: "fontSerif", cssVar: "--font-serif-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontSans", cssVar: "--font-sans-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontDisplay", cssVar: "--font-display-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontLogo", cssVar: "--font-logo-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontMono", cssVar: "--font-mono-override", isColor: false, transform: (v) => `"${v}"` },

  // Fonts… dialog — non-nullable size fields go straight through.
  // Nullable family fields are handled in DERIVED_CSS below so they can
  // resolve "pinned to body" → bodySerif rather than leaving the var empty
  // (which would defeat the var() fallback chain).
  { key: "fontMaketitleTitleSize", cssVar: "--font-maketitle-title-size", isColor: false, transform: (v) => `${v}rem` },
  { key: "fontMaketitleTitleWeight", cssVar: "--font-maketitle-title-weight", isColor: false, transform: (v) => `${v}` },
  { key: "fontMaketitleMetaSize", cssVar: "--font-maketitle-meta-size", isColor: false, transform: (v) => `${v}rem` },
  { key: "fontMaketitleMetaWeight", cssVar: "--font-maketitle-meta-weight", isColor: false, transform: (v) => `${v}` },
  { key: "fontHeadersH1Size", cssVar: "--font-headers-h1-size", isColor: false, transform: (v) => `${v}rem` },
  { key: "fontHeadersH1Weight", cssVar: "--font-headers-h1-weight", isColor: false, transform: (v) => `${v}` },
  { key: "fontHeadersH2Size", cssVar: "--font-headers-h2-size", isColor: false, transform: (v) => `${v}rem` },
  { key: "fontHeadersH2Weight", cssVar: "--font-headers-h2-weight", isColor: false, transform: (v) => `${v}` },
  { key: "fontHeadersH3Size", cssVar: "--font-headers-h3-size", isColor: false, transform: (v) => `${v}rem` },
  { key: "fontHeadersH3Weight", cssVar: "--font-headers-h3-weight", isColor: false, transform: (v) => `${v}` },
  { key: "fontParTitleWeight", cssVar: "--font-partitle-weight", isColor: false, transform: (v) => `${v}` },
];

// Derived CSS variables computed from multiple preferences
export interface DerivedCssMapping {
  cssVar: string;
  compute: (prefs: EditorPreferences) => string;
}

export const DERIVED_CSS: DerivedCssMapping[] = [
  { cssVar: "--accent-light", compute: (p) => deriveLight(p.accentColor, 0.1) },
  { cssVar: "--comment-bg", compute: (p) => hexToRgba(p.commentColor, 0.25) },
  { cssVar: "--comment-border", compute: (p) => hexToRgba(p.commentColor, 0.5) },
  { cssVar: "--latex-comment-bg", compute: (p) => deriveLight(p.latexCommentColor, 0.12) },
  // Hover + node-selection washes for the inline LaTeX-comment node — the same
  // derivation as the rest-state twin above, one/two steps stronger, so they
  // follow the user's `latexCommentColor` instead of a frozen blue (task 193,
  // the task-175 `--footnote-bg-hover` class one inline-kind over).
  //
  // DELIBERATE SAME-RAY NEAR-MATCH, not a byte-preserving swap: the retired
  // literals `#e8f0f8` (hover) / `#e0ecf5` (selectednode) were hand-picked with
  // a bluer-than-ray bias, so no single opacity reproduces all three channels.
  // 0.16 / 0.22 reproduce each literal's RED channel EXACTLY (`#e8…` / `#e0…` —
  // the dominant hue channel), landing g/b a few /255 less blue so the wash now
  // sits on the SAME ray as the rest state (rest #eef2f6 → hover #e8edf2 →
  // active #e0e7ee at the default #7191b0). Consistency with the rest wash is
  // the property that was broken, and is worth a couple /255 of blue — same
  // trade the footnote precedent accepted at `--footnote-bg-hover` below.
  { cssVar: "--latex-comment-bg-hover", compute: (p) => deriveLight(p.latexCommentColor, 0.16) },
  { cssVar: "--latex-comment-bg-active", compute: (p) => deriveLight(p.latexCommentColor, 0.22) },
  { cssVar: "--citation-bg", compute: () => "#ffffff" },
  // Cross-reference chip fill. DERIVED from the user's `\ref` ink rather than
  // frozen like its citation twin's `--citation-bg`, because the two chips have
  // different rest looks: citation rests on hard WHITE (neutral under any
  // border/ink), while the ref chip rests on a TINTED wash. A frozen wash would
  // leave a recolored chip half-changed — the exact half-tokenized shape task
  // 194 exists to close — so the wash rides the same ray as the ink, the
  // footnote / latex-comment / note precedent above and below.
  //
  // DELIBERATE SAME-RAY NEAR-MATCH, not a byte-preserving swap: the retired
  // literal was `#f0f0ee` (a hair warm); at the default `#555555` this derives
  // `#f0f0f0`, reproducing R and G EXACTLY and landing blue 2/255 higher — i.e.
  // a true neutral instead of a warm-biased one. Same trade the two comments
  // around it accepted, and the seed in globals.css is the DERIVED value, so
  // there is no flip at hydration.
  { cssVar: "--label-ref-bg", compute: (p) => deriveLight(p.labelRefColor, 0.088) },
  { cssVar: "--footnote-bg", compute: (p) => deriveLight(p.footnoteColor, 0.08) },
  // Hover wash for the in-text footnote marker — the same derivation as its
  // rest-state twin above, one step stronger, so hover follows the user's
  // marker color instead of a frozen rust (task 175).
  //
  // DELIBERATE NEAR-MATCH, not a byte-preserving swap: the old literal was
  // `#fde8e8` (the `--footnote-100` scale step); at the default `#b45757` this
  // derives `#f5e8e8` — g/b identical, red 8/255 lower. 0.135 is chosen because
  // it reproduces `--footnote-100`'s g/b channels EXACTLY, which is the same
  // relationship 0.08 has to `--footnote-50` for the rest state above (that one
  // likewise renders `#f9f2f2`, not the literal `#fef2f2`). So hover and rest
  // now sit on one ray from the user's accent, consistent with each other —
  // which is the property that was broken, and is worth 8/255 of red.
  { cssVar: "--footnote-bg-hover", compute: (p) => deriveLight(p.footnoteColor, 0.135) },
  { cssVar: "--note-bg", compute: (p) => deriveLight(p.noteColor, 0.06) },
  { cssVar: "--pod-border", compute: (p) => `1px solid ${p.borderLight}` },
  // Panels are borderless warm sheets (separation via gutter + shadow). Keep
  // in sync with the static `--panel-border: none` in globals.css. Don't
  // re-derive a border from borderLight — that's the editor pod's `--pod-border`.
  { cssVar: "--panel-border", compute: () => "none" },
  // Per-category font families. When the user picks "Pin to body family"
  // (stored as null) we resolve to the body family here so the rendered
  // CSS var always carries a usable value.
  { cssVar: "--font-maketitle-family", compute: (p) => `"${p.fontMaketitleFamily ?? p.fontSerif}"` },
  { cssVar: "--font-headers-family", compute: (p) => `"${p.fontHeadersFamily ?? p.fontSerif}"` },
  { cssVar: "--font-partitle-family", compute: (p) => `"${p.fontParTitleFamily ?? p.fontSans}"` },
];
