/**
 * "Smart" preferences — a curated, flat presentation layered ABOVE the
 * hierarchical PREFERENCES_TREE. Organized by the real UI region a user
 * might want to tweak ("top bar", "panel theme", etc.) rather than by the
 * internal preference data model.
 *
 * Items come from two sources:
 *   - `pref`         — an EditorPreferences leaf (color/slider/font)
 *   - `panel-color`  — a per-panel base color from `lib/panel-theme.ts`
 *
 * A single section can mix the two kinds.
 */

import type { PrefLeaf } from "./preferences-tree";
import { SANS_CORE_FONTS, SERIF_CORE_FONTS } from "./font-catalogue";
import {
  PANEL_THEME_FAMILIES,
  SYSTEM_THEME_KEYS,
  type PanelThemeFamily,
  type PanelThemeKey,
} from "./panel-theme";
import type { LinkableKey } from "./pref-links";

export interface SmartPrefItem {
  kind: "pref";
  leaf: PrefLeaf;
}

export interface SmartPanelItem {
  kind: "panel-color";
  panelKey: PanelThemeKey;
  label: string;
  description?: string;
}

/** A single grid item — marker that the section body should render as the
 *  panel-typography grid. The data lives in `panel-typography.ts`; this is
 *  just a selector that the renderer switches on. */
export interface SmartPanelTypographyItem {
  kind: "panel-typography-grid";
}

/** A relative link between two color prefs. Visually sits as a thin row
 *  between the parent's and child's color pickers; offers a lock toggle
 *  and a delta slider. See `lib/pref-links.ts` for the store. */
export interface SmartLinkEdgeItem {
  kind: "link-edge";
  parent: LinkableKey;
  child: LinkableKey;
  label: string;
}

export type SmartItem =
  | SmartPrefItem
  | SmartPanelItem
  | SmartPanelTypographyItem
  | SmartLinkEdgeItem;

export interface SmartSection {
  id: string;           // stable id for open/closed state
  label: string;        // section title, e.g. "Top bar"
  description?: string; // one-line preview under the title
  items: SmartItem[];
}

const p = (leaf: PrefLeaf): SmartPrefItem => ({ kind: "pref", leaf });
const panel = (
  panelKey: PanelThemeKey,
  label: string,
  description?: string,
): SmartPanelItem => ({ kind: "panel-color", panelKey, label, description });

/** User-facing copy for each theme key's row in the "Panel theme" section
 *  (task 977). A TOTAL record, so a new `PanelThemeKey` fails tsc until it has
 *  a label. System keys carry copy too (the record stays total) but never
 *  reach the section — they are not user-overridable. */
export const PANEL_THEME_PREF_COPY: Readonly<
  Record<PanelThemeKey, { label: string; description: string }>
> = Object.freeze({
  footnote:  { label: "Footnotes",    description: "Footnote cards, superscript markers, and anchor highlights." },
  citation:  { label: "Citations",    description: "Citation cards, badges, and in-text highlights." },
  bib:       { label: "Bibliography", description: "Bibliography entries and linked citation anchors." },
  highlight: { label: "Highlights",   description: "Highlight cards and the in-text highlight band." },
  example:   { label: "Examples",     description: "Example cards and their in-text anchors." },
  revision:  { label: "Revisions",    description: "Revision cards and change markers." },
  report:    { label: "Reports",      description: "Report cards and their margin markers." },
  aiRequest: { label: "AI requests",  description: "AI-request accents (system colour, not editable)." },
  note:      { label: "Margin notes", description: "Note cards and margin markers." },
  archive:   { label: "Archive",      description: "Archived-snippet cards and anchors." },
  todo:      { label: "To-dos",       description: "Task cards and checklist markers." },
  cut:       { label: "Cuts",         description: "Deleted-text cards and strikethrough markers." },
  error:     { label: "Errors",       description: "Compile-error cards (system colour, not editable)." },
});

/** The "Panel theme" rows, DERIVED from `PANEL_THEME_FAMILIES` (task 977) in
 *  family order — the same membership the per-panel picker covers — minus the
 *  non-overridable `SYSTEM_THEME_KEYS`. It used to be a hand list of eight that
 *  silently omitted highlight, example and report. */
export const PANEL_THEME_ITEMS: readonly SmartPanelItem[] = (
  Object.keys(PANEL_THEME_FAMILIES) as PanelThemeFamily[]
).flatMap((family) =>
  PANEL_THEME_FAMILIES[family].keys
    .filter((key) => !SYSTEM_THEME_KEYS.has(key))
    .map((key) =>
      panel(key, PANEL_THEME_PREF_COPY[key].label, PANEL_THEME_PREF_COPY[key].description),
    ),
);

export const SMART_PREFERENCES: SmartSection[] = [
  {
    id: "top-bar",
    label: "Top bar",
    description: "The Virgil bar at the top: tabs, logo, and chrome.",
    items: [
      p({
        type: "color",
        key: "topbarBackground",
        label: "Virgil bar background",
        description: "Fill behind the logo and tabs (also sets browser chrome color). Top edge of the Virgil bar gradient.",
      }),
      p({
        type: "color",
        key: "topbarBackgroundBottom",
        label: "Virgil bar background (bottom)",
        description: "Bottom edge of the Virgil bar gradient. Set equal to the top for a flat bar.",
      }),
      p({
        type: "color",
        key: "backgroundColor",
        label: "Document background",
        description: "Fill of the page canvas — the active tab joins this color.",
      }),
      {
        kind: "link-edge",
        parent: "topbarBackground",
        child: "libraryBg",
        label: "Library tab steps up from Virgil bar",
      },
      p({
        type: "color",
        key: "libraryBg",
        label: "Library tab background",
        description: "Fill of the darker library peek-tab next to each doc tab.",
      }),
      p({
        type: "color",
        key: "topbarBorder",
        label: "Tab outline",
        description: "Border around tabs and under the top bar.",
      }),
      p({
        type: "color",
        key: "virgilBarText",
        label: "Top bar text",
        description: "Color of the VIRGIL logo and icons in the bar (tab labels keep their own color).",
      }),
    ],
  },
  {
    id: "panel-theme",
    label: "Panel theme",
    description: "Base color for each kind of panel — tints its cards, badges, highlights, and marginalia markers.",
    items: [
      ...PANEL_THEME_ITEMS,
    ],
  },
  {
    id: "panel-text",
    label: "Panel text",
    description: "Body text (font, size, color) inside each panel's note cards.",
    items: [{ kind: "panel-typography-grid" }],
  },
  {
    id: "panel-contents",
    label: "Panel contents",
    description: "Shared chrome inside every panel: backgrounds, outline, and header text.",
    items: [
      p({
        type: "color",
        key: "headerBg",
        label: "Header background",
        description: "Fill of each panel's top header bar.",
      }),
      p({
        type: "color",
        key: "podPanel",
        label: "Body background",
        description: "Fill of the panel's main content area (behind the cards).",
      }),
      p({
        type: "color",
        key: "surfaceColor",
        label: "Note background",
        description: "Fill of individual note/card surfaces inside the panel.",
      }),
      p({
        type: "color",
        key: "borderLight",
        label: "Panel outline",
        description: "Subtle dividers around panels and between cards.",
      }),
      p({
        type: "color",
        key: "panelAdminTextColor",
        label: "Header title color",
        description: "Panel header titles like \"Footnotes\" and \"Citations\".",
      }),
      p({
        type: "color",
        key: "panelHeaderTextColor",
        label: "Header text color",
        description: "Other text in panel headers (e.g. count number).",
      }),
      p({
        type: "font",
        key: "panelAdminTextFont",
        label: "Admin text font",
        description: "Typeface for panel header titles.",
        // Sans cores first (the default face), then serif — one vocabulary (task 901).
        options: [...SANS_CORE_FONTS, ...SERIF_CORE_FONTS],
      }),
    ],
  },
];
