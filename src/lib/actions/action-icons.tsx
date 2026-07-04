/**
 * Card-action presentation table — the icon JSX + label + letter + the
 * menu-chrome flags (separator / destructive) for each of the 11 CARD actions.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ICON OWNERSHIP INVERSION (CHIP 3). Until CHIP 3 this presentation lived in
 * `MENU_ENTRIES` (in `DragHandleMenu.tsx`) and the registry rows DERIVED their
 * icon/label/letter FROM that array — the menu was the SSOT and the registry
 * mirrored it. CHIP 3 inverts that: the **registry** becomes the SSOT and the
 * two live menus (`DragHandleMenu` / `ActionsMenuPanel`) render FROM it. This
 * module is where the icon JSX now lives, referenced by the registry's card
 * rows; `MENU_ENTRIES` is deleted.
 *
 * It is kept as a standalone module (rather than inlining the JSX into
 * `action-registry.ts`) so the registry stays a plain `.ts` data module: the
 * coverage assertion path (`assertActionCoverage`, exercised from a node-env
 * vitest) imports the registry types without dragging icon JSX into a non-DOM
 * importer. The runtime card rows that need the icon reach for it here; type-
 * only importers tree-shake this away.
 * ──────────────────────────────────────────────────────────────────────────
 */

import {
  IconArchive,
  IconCitation,
  IconCutter,
  IconDuplicate,
  IconFootnote,
  IconHighlight,
  IconNotes,
  IconReports,
  IconRevisions,
  IconTodo,
  IconTrash,
} from "@/components/editor-layout/panel-icons";
import type { CardActionId } from "./action-registry";

/** Per-card-action menu presentation. The fields the live menus render
 *  off (icon / label / letter) plus the menu-chrome flags (separator line
 *  above the entry, destructive red styling). */
export interface CardActionPresentation {
  label: string;
  letter: string;
  icon: React.ReactNode;
  /** Draw a divider line above this entry. */
  separator?: boolean;
  /** Render with destructive (red) styling. */
  destructive?: boolean;
}

/**
 * The presentation for each of the 11 card actions, in the canonical
 * MENU-DISPLAY ORDER. This is the order the grab-bar and lightning menus
 * render the action list in; `CARD_ACTION_ORDER` (below) is derived from it
 * so the registry and the menus can never disagree on order, letters, or
 * icons. Lifted verbatim from the former `MENU_ENTRIES` array — same labels,
 * same H/N/F/C/T/E/X/R/D/A/⌫ letters, same icons, same separators above
 * Duplicate + Archive, same destructive flag on Delete.
 */
export const CARD_ACTION_PRESENTATION: Readonly<
  Record<CardActionId, CardActionPresentation>
> = {
  highlight: { label: "Highlight", letter: "H", icon: <IconHighlight size={16} /> },
  note: { label: "Note", letter: "N", icon: <IconNotes size={16} /> },
  footnote: { label: "Footnote", letter: "F", icon: <IconFootnote size={16} /> },
  citation: { label: "Citation", letter: "C", icon: <IconCitation size={16} /> },
  todo: { label: "Todo", letter: "T", icon: <IconTodo size={16} /> },
  "suggest-edit": { label: "Request edit", letter: "E", icon: <IconRevisions size={16} /> },
  cutter: { label: "Request cut", letter: "X", icon: <IconCutter size={16} /> },
  report: { label: "Request report", letter: "R", icon: <IconReports size={16} /> },
  duplicate: { label: "Duplicate", letter: "D", icon: <IconDuplicate size={16} />, separator: true },
  archive: { label: "Archive", letter: "A", icon: <IconArchive size={16} />, separator: true },
  delete: { label: "Delete", letter: "⌫", icon: <IconTrash size={16} />, destructive: true },
};

/**
 * The canonical card-action display order — the exact sequence the two live
 * menus render. Derived from the insertion order of
 * `CARD_ACTION_PRESENTATION` (which mirrors the former `MENU_ENTRIES` order),
 * so the menus and the registry agree by construction. The registry builds
 * its `VIRGIL_ACTION_REGISTRY` rows in this order, and the menus iterate it.
 */
export const CARD_ACTION_ORDER: readonly CardActionId[] = Object.keys(
  CARD_ACTION_PRESENTATION,
) as CardActionId[];
