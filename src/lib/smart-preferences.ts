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
import type { PanelThemeKey } from "./panel-theme";
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
        description: "Fill behind the logo and tabs (also sets browser chrome color).",
      }),
      {
        kind: "link-edge",
        parent: "topbarBackground",
        child: "tabBg",
        label: "Tab background tracks Virgil bar",
      },
      p({
        type: "color",
        key: "tabBg",
        label: "Tab background",
        description: "Fill of inactive document tabs.",
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
      {
        kind: "link-edge",
        parent: "libraryBg",
        child: "mainTabBg",
        label: "Main tab steps up from library",
      },
      p({
        type: "color",
        key: "mainTabBg",
        label: "Main tab background",
        description: "Fill of the active tab — blends into the page canvas below.",
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
      panel("citation", "Citations", "Citation cards, badges, and in-text highlights."),
      panel("bib",      "Bibliography", "Bibliography entries and linked citation anchors."),
      panel("footnote", "Footnotes", "Footnote cards, superscript markers, and anchor highlights."),
      panel("note",     "Margin notes", "Note cards and gutter markers."),
      panel("archive",  "Archive", "Archived-snippet cards and anchors."),
      panel("quote",    "Quotations", "Quotation cards and their anchors."),
      panel("todo",     "To-dos", "Task cards and checklist markers."),
      panel("cut",      "Cuts", "Deleted-text cards and strikethrough markers."),
      panel("revision", "Revisions", "Revision cards and change markers."),
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
        label: "Admin text color",
        description: "Panel header titles like \"Footnotes\" and \"Citations\".",
      }),
      p({
        type: "font",
        key: "panelAdminTextFont",
        label: "Admin text font",
        description: "Typeface for panel header titles.",
        options: [
          "Inter",
          "system-ui",
          "Helvetica Neue",
          "Open Sans",
          "Lato",
          "Roboto",
          "IBM Plex Sans",
          "Source Sans 3",
          "Source Serif 4",
          "Georgia",
          "Playfair Display",
          "Libre Baskerville",
        ],
      }),
    ],
  },
];
