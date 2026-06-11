/**
 * Chrome configuration for the EditorLayout / Editor surface.
 *
 * The shape lets a host (the main app, the Library Reader, or any future
 * embedding) selectively suppress UI surfaces while keeping the full
 * panel/marginalia/popout machinery live. The default `FULL_CHROME`
 * preserves the existing main-app behavior; `READER_CHROME` is the
 * Library Reader's preset (read-with-Note-only).
 *
 * When adding a new gate, prefer turning OFF a single named element
 * rather than introducing inverse "hide" flags — readability stays
 * cleaner and the FULL_CHROME default reads as "everything on".
 */

import type { CardKind, PanelKind } from "@/panels/_shared/types";

export interface EditorChromeConfig {
  /** Whether the formatting toolbar (bold/italic/headings/etc.) renders. */
  showFormattingToolbar: boolean;
  /**
   * Whether the MenuBar exposes its edit-mutating items (Fonts dialog,
   * margins-mode toggle, etc.). View toggles (margins, marginalia,
   * dividers, highlights) always render.
   */
  showMenuBarEditItems: boolean;
  /** Heading float — keep label-edit input. */
  showHeadingFloatLabelEdit: boolean;
  /** Paragraph float — keep editable title `<input>`. */
  showParagraphFloatTitleEdit: boolean;
  /**
   * Whitelist of panels visible in the left/right strips. `undefined` =
   * all panels (default). When set, the strip filters PANEL_REGISTRY to
   * only these kinds; placements that resolve to hidden kinds are
   * elided.
   */
  visiblePanelKinds?: PanelKind[];
  /**
   * Whitelist of card kinds whose content can be edited (rich-text
   * editors inside the cards stay live for these kinds; for others the
   * card editor mounts as read-only). `undefined` = all editable
   * (default). Reader uses `["note"]` so users can write inside note
   * cards without enabling the rest.
   */
  editableCardKinds?: CardKind[];
  /**
   * The active EditorPane's MenuBar view-toggle bundle, threaded through
   * so DOM-portaled float popouts (which live outside `.editor-pane-column`)
   * can re-derive the same view-toggle ancestor classes the column carries
   * (dividers, hide-par-titles, etc.) via `viewToggleClasses`. `undefined`
   * for hosts without a MenuBar (e.g. the Library Reader) → no classes.
   * Type-only inline import keeps this tiny config module out of any
   * runtime import cycle with the (large) EditorPane module.
   */
  menuBar?: import("../EditorPane").EditorPaneMenuBarBundle;
}

/**
 * Build the view-toggle class tokens that gate divider / hide-* / width
 * CSS. Mirrors the `editor-pane-column` className expression in
 * `EditorPane.tsx` (search "editor-pane-column") so DOM-portaled float
 * popouts get an ancestor carrying the same `.show-dividers-N`,
 * `.hide-par-titles`, `.hide-latex-comments`, `.hide-heading-labels`,
 * and `.dividers-width-*` classes the main column has. Returns `""` when
 * there's no MenuBar (Reader / no view toggles). Single source so the
 * float and the column can't drift.
 */
export function viewToggleClasses(
  menuBar: import("../EditorPane").EditorPaneMenuBarBundle | undefined,
): string {
  if (!menuBar) return "";
  const tokens: string[] = [];
  if (menuBar.showParTitles === false) tokens.push("hide-par-titles");
  if (menuBar.showLatexComments === false) tokens.push("hide-latex-comments");
  if (menuBar.showHeadingLabels === false) tokens.push("hide-heading-labels");
  for (const lvl of menuBar.activeDividerLevels) tokens.push(`show-dividers-${lvl}`);
  tokens.push(`dividers-width-${menuBar.dividerWidth}`);
  return tokens.join(" ");
}

export const FULL_CHROME: EditorChromeConfig = {
  showFormattingToolbar: true,
  showMenuBarEditItems: true,
  showHeadingFloatLabelEdit: true,
  showParagraphFloatTitleEdit: true,
  // visiblePanelKinds undefined → show all
  // editableCardKinds undefined → all editable
};

/**
 * Reader preset: read-only main text, formatting toolbar hidden, MenuBar
 * edit items hidden, the six reading-affordance panels are visible.
 * Mirrors the user's explicit list (outline / footnotes / examples /
 * citations / bibliography / notes). Note cards stay editable so users
 * can write inside them.
 */
export const READER_CHROME: EditorChromeConfig = {
  showFormattingToolbar: false,
  showMenuBarEditItems: false,
  showHeadingFloatLabelEdit: false,
  showParagraphFloatTitleEdit: false,
  visiblePanelKinds: [
    "outline",
    "footnotes",
    "examples",
    "citations",
    "bibliography",
    "notes",
  ],
  editableCardKinds: ["note"],
};

/**
 * Helper: filter a list of panel kinds against the chrome's whitelist.
 * Returns `kinds` unchanged when no whitelist is set.
 */
export function filterPanelKinds<K extends PanelKind>(
  chrome: EditorChromeConfig,
  kinds: readonly K[],
): K[] {
  if (!chrome.visiblePanelKinds) return [...kinds];
  const set = new Set(chrome.visiblePanelKinds);
  return kinds.filter((k) => set.has(k));
}
