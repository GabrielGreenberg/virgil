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

/**
 * Walk PREFERENCES_TREE and return the first leaf matching `key`, or
 * undefined. Used by PreferenceModePicker to turn a `data-prefs` attribute
 * key into its leaf metadata (label, description, control type). Keys are
 * unique across the tree, so "first match" is unambiguous.
 *
 * Declared here (rather than in the picker) so the tree remains the single
 * source of truth for what's editable.
 */
export function findLeafByKey(
  key: keyof EditorPreferences,
): PrefLeaf | undefined {
  const walk = (nodes: PrefNode[]): PrefLeaf | undefined => {
    for (const n of nodes) {
      if (isLeaf(n)) {
        if (n.key === key) return n;
      } else {
        const found = walk(n.children);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(PREFERENCES_TREE);
}

// ─── Font Options ─────────────────────────────────────────────────────────────

const SERIF_FONTS = ["Source Serif 4", "Georgia", "Playfair Display", "Libre Baskerville", "Lora", "Merriweather", "EB Garamond", "Crimson Text"];
const SANS_FONTS = ["Inter", "system-ui", "Helvetica Neue", "Open Sans", "Lato", "Roboto", "IBM Plex Sans", "Source Sans 3"];
const MONO_FONTS = ["Geist Mono", "JetBrains Mono", "Fira Code", "Source Code Pro", "IBM Plex Mono", "monospace"];
const DISPLAY_FONTS = ["Playfair Display", "Cinzel", "Cormorant Garamond", "Libre Baskerville", "EB Garamond"];
const LOGO_FONTS = ["Cinzel", "Playfair Display", "Cormorant Garamond", "Libre Baskerville"];

// ─── The Preference Tree ──────────────────────────────────────────────────────

export const PREFERENCES_TREE: PrefNode[] = [
  {
    label: "Top Bar & Browser",
    children: [
      { type: "color", key: "topbarBackground", label: "Top bar background", description: "Fill color of the application title bar (also sets the browser/PWA chrome color)" },
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
          { type: "color", key: "mathPrefixColor", label: "Math prefix color", description: "Color of $ delimiters and prefixes" },
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
        label: "AI Markers",
        children: [
          { type: "color", key: "aiMarkerText", label: "Text color", description: "Text inside AI-generated spans" },
          { type: "color", key: "aiMarkerBg", label: "Background", description: "Fill behind AI-generated content" },
          { type: "color", key: "aiMarkerBorder", label: "Border", description: "Outline around AI-generated regions" },
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
          { type: "slider", key: "panelHeaderSize", label: "Header size", description: "Text size for panel section headers", min: 12, max: 17, step: 1, unit: "px" },
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
  // (--theme-color is aliased to --topbar-bg in globals.css)
  { key: "topbarBackground", cssVar: "--topbar-bg", isColor: true },
  { key: "topbarBorder", cssVar: "--topbar-border", isColor: true },
  { key: "tabBg", cssVar: "--tab-bg", isColor: true },
  { key: "mainTabBg", cssVar: "--main-tab-bg", isColor: true },
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
  // (--pod-editor is aliased to --surface in globals.css)
  { key: "headerBg", cssVar: "--header-bg", isColor: true },
  { key: "podPanel", cssVar: "--pod-panel", isColor: true },
  { key: "podToolbar", cssVar: "--pod-toolbar", isColor: true },
  { key: "podDark", cssVar: "--pod-dark", isColor: true },
  { key: "panelAdminTextColor", cssVar: "--panel-admin-text-color", isColor: true },
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
