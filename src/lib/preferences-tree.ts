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
}

export interface PrefLeafSlider {
  type: "slider";
  key: keyof EditorPreferences;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export interface PrefLeafFont {
  type: "font";
  key: keyof EditorPreferences;
  label: string;
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

// ─── The Preference Tree ──────────────────────────────────────────────────────

export const PREFERENCES_TREE: PrefNode[] = [
  {
    label: "App Chrome",
    children: [
      { type: "color", key: "topbarBackground", label: "Top bar background" },
      { type: "color", key: "topbarBorder", label: "Top bar border" },
      { type: "color", key: "themeColor", label: "Browser theme color" },
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
          { type: "slider", key: "editorFontSize", label: "Font size", min: 0.85, max: 1.4, step: 0.05, unit: " rem" },
          { type: "slider", key: "editorLineHeight", label: "Line height", min: 1.4, max: 2.4, step: 0.1, unit: "" },
          { type: "color", key: "editorTextColor", label: "Text color" },
          { type: "font", key: "fontSerif", label: "Font family", options: SERIF_FONTS },
        ],
      },
      {
        label: "Headings",
        children: [
          { type: "color", key: "h1Color", label: "H1 color" },
          { type: "color", key: "h2h3Color", label: "H2/H3 color" },
        ],
      },
      {
        label: "Paragraph Titles",
        children: [
          { type: "slider", key: "parTitleSize", label: "Size", min: 0.6, max: 1.0, step: 0.02, unit: " rem" },
          { type: "color", key: "parTitleColor", label: "Color" },
        ],
      },
      {
        label: "Heading Annotations",
        children: [
          { type: "color", key: "headingAnnotationColor", label: "Text color" },
          { type: "color", key: "headingAnnotationBorder", label: "Border color" },
        ],
      },
      {
        label: "Blockquotes",
        children: [
          { type: "color", key: "blockquoteBorder", label: "Border color" },
          { type: "color", key: "blockquoteText", label: "Text color" },
        ],
      },
      {
        label: "Code & Math",
        children: [
          { type: "color", key: "codeBackground", label: "Code background" },
          { type: "color", key: "codeBlockBackground", label: "Code block background" },
          { type: "color", key: "mathColor", label: "Math text color" },
          { type: "color", key: "mathPrefixColor", label: "Math prefix color" },
        ],
      },
      {
        label: "Citations",
        children: [
          { type: "color", key: "citationColor", label: "Text color" },
          { type: "color", key: "citationBorderColor", label: "Border color" },
        ],
      },
      {
        label: "Footnotes",
        children: [
          { type: "color", key: "footnoteColor", label: "Marker color" },
        ],
      },
      {
        label: "Notes",
        children: [
          { type: "color", key: "noteColor", label: "Marker color" },
          { type: "color", key: "noteMarkerBorder", label: "Border color" },
        ],
      },
      {
        label: "Comments",
        children: [
          { type: "color", key: "commentColor", label: "Highlight color" },
        ],
      },
      {
        label: "LaTeX Comments",
        children: [
          { type: "color", key: "latexCommentColor", label: "Text color" },
        ],
      },
      {
        label: "AI Markers",
        children: [
          { type: "color", key: "aiMarkerText", label: "Text color" },
          { type: "color", key: "aiMarkerBg", label: "Background" },
          { type: "color", key: "aiMarkerBorder", label: "Border" },
        ],
      },
      {
        label: "Suggestions",
        children: [
          { type: "color", key: "markBackground", label: "Mark background" },
          { type: "color", key: "markBorder", label: "Mark border" },
        ],
      },
      {
        label: "LaTeX Commands",
        children: [
          { type: "color", key: "latexCmdColor", label: "Command color" },
        ],
      },
    ],
  },
  {
    label: "Panels",
    children: [
      {
        label: "General",
        children: [
          { type: "slider", key: "panelFontSize", label: "Font size", min: 11, max: 16, step: 1, unit: "px" },
          { type: "slider", key: "panelHeaderSize", label: "Header size", min: 12, max: 17, step: 1, unit: "px" },
          { type: "color", key: "surfaceColor", label: "Card background" },
          { type: "font", key: "fontSans", label: "Font family", options: SANS_FONTS },
        ],
      },
      {
        label: "Chrome",
        children: [
          { type: "color", key: "headerBg", label: "Header background" },
          { type: "color", key: "podPanel", label: "Panel pod background" },
          { type: "color", key: "podToolbar", label: "Toolbar pod background" },
          { type: "color", key: "podEditor", label: "Editor pod background" },
          { type: "color", key: "podDark", label: "Dark pod background" },
        ],
      },
    ],
  },
  {
    label: "Canvas & Layout",
    children: [
      { type: "color", key: "backgroundColor", label: "Page background" },
      { type: "color", key: "foreground", label: "Foreground text" },
      { type: "color", key: "accentColor", label: "Accent" },
      { type: "color", key: "borderColor", label: "Border" },
      { type: "color", key: "borderLight", label: "Border (light)" },
      { type: "color", key: "mutedColor", label: "Muted text" },
      { type: "color", key: "mutedLight", label: "Muted light" },
      { type: "color", key: "dragHighlight", label: "Drag highlight" },
      { type: "color", key: "scrollbarThumb", label: "Scrollbar" },
      { type: "color", key: "scrollbarHover", label: "Scrollbar hover" },
    ],
  },
  {
    label: "Fonts",
    children: [
      { type: "font", key: "fontSerif", label: "Body (serif)", options: SERIF_FONTS },
      { type: "font", key: "fontSans", label: "UI (sans)", options: SANS_FONTS },
      { type: "font", key: "fontDisplay", label: "Display", options: DISPLAY_FONTS },
      { type: "font", key: "fontLogo", label: "Logo", options: LOGO_FONTS },
      { type: "font", key: "fontMono", label: "Monospace", options: MONO_FONTS },
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
  { key: "topbarBackground", cssVar: "--topbar-bg", isColor: true },
  { key: "topbarBorder", cssVar: "--topbar-border", isColor: true },
  { key: "themeColor", cssVar: "--theme-color", isColor: true },

  // Headings
  { key: "h1Color", cssVar: "--h1-color", isColor: true },
  { key: "h2h3Color", cssVar: "--h2h3-color", isColor: true },

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
  { key: "mathPrefixColor", cssVar: "--math-prefix-color", isColor: true },

  // Inline elements
  { key: "accentColor", cssVar: "--accent", isColor: true },
  { key: "backgroundColor", cssVar: "--background", isColor: true },
  { key: "surfaceColor", cssVar: "--surface", isColor: true },
  { key: "commentColor", cssVar: "--comment-color", isColor: true },
  { key: "latexCommentColor", cssVar: "--latex-comment-color", isColor: true },
  { key: "citationColor", cssVar: "--citation-color", isColor: true },
  { key: "citationBorderColor", cssVar: "--citation-border-color", isColor: true },
  { key: "footnoteColor", cssVar: "--footnote-color", isColor: true },
  { key: "noteColor", cssVar: "--note-color", isColor: true },
  { key: "noteMarkerBorder", cssVar: "--note-marker-border", isColor: true },

  // AI markers
  { key: "aiMarkerText", cssVar: "--ai-marker-text", isColor: true },
  { key: "aiMarkerBg", cssVar: "--ai-marker-bg", isColor: true },
  { key: "aiMarkerBorder", cssVar: "--ai-marker-border", isColor: true },

  // Suggestions
  { key: "markBackground", cssVar: "--mark-bg", isColor: true },
  { key: "markBorder", cssVar: "--mark-border", isColor: true },

  // LaTeX commands
  { key: "latexCmdColor", cssVar: "--latex-cmd-color", isColor: true },

  // Panels
  { key: "panelFontSize", cssVar: "--panel-font-size", isColor: false, transform: (v) => `${v}px` },
  { key: "panelHeaderSize", cssVar: "--panel-header-size", isColor: false, transform: (v) => `${v}px` },
  { key: "headerBg", cssVar: "--header-bg", isColor: true },
  { key: "podPanel", cssVar: "--pod-panel", isColor: true },
  { key: "podToolbar", cssVar: "--pod-toolbar", isColor: true },
  { key: "podEditor", cssVar: "--pod-editor", isColor: true },
  { key: "podDark", cssVar: "--pod-dark", isColor: true },

  // Canvas & layout
  { key: "foreground", cssVar: "--foreground", isColor: true },
  { key: "borderColor", cssVar: "--border", isColor: true },
  { key: "borderLight", cssVar: "--border-light", isColor: true },
  { key: "mutedColor", cssVar: "--muted", isColor: true },
  { key: "mutedLight", cssVar: "--muted-light", isColor: true },
  { key: "dragHighlight", cssVar: "--drag-highlight", isColor: true },
  { key: "scrollbarThumb", cssVar: "--scrollbar-thumb", isColor: true },
  { key: "scrollbarHover", cssVar: "--scrollbar-hover", isColor: true },

  // Fonts
  { key: "fontSerif", cssVar: "--font-serif-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontSans", cssVar: "--font-sans-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontDisplay", cssVar: "--font-display-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontLogo", cssVar: "--font-logo-override", isColor: false, transform: (v) => `"${v}"` },
  { key: "fontMono", cssVar: "--font-mono-override", isColor: false, transform: (v) => `"${v}"` },
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
  { cssVar: "--citation-bg", compute: (p) => deriveLight(p.citationColor, 0.08) },
  { cssVar: "--footnote-bg", compute: (p) => deriveLight(p.footnoteColor, 0.08) },
  { cssVar: "--note-bg", compute: (p) => deriveLight(p.noteColor, 0.06) },
  { cssVar: "--pod-border", compute: (p) => `1px solid ${p.borderLight}` },
];
