/**
 * Reader-mode `EditorPaneViewPrefs` — a THIN consumer of the real
 * view-state engine.
 *
 * The Library Reader mounts the canonical `<EditorPane>` read-only. It used
 * to drive a ~378-line hand-rolled shim that re-implemented half of
 * `useViewPrefs` and stubbed the rest as no-ops — which left the panel-strip
 * buttons, the panel↔text divider, Outline click-to-scroll, the Bibliography
 * filter, and the omni "hide all" toggle all dead.
 *
 * Now the Reader runs the SAME `useViewPrefs` engine in `"ephemeral"` mode
 * (in-memory, no persistence) and assembles its bundle through the SAME
 * `buildEditorPaneViewPrefs` builder the main app uses. The only delta is a
 * single NAMED set of editor handlers (`EditorMutationHandlers`): because the
 * Reader is read-only, MOST are no-ops — but they satisfy the type IN FULL,
 * so a Reader control that's secretly a no-op is now a compile error, not a
 * silent dead control. The one real exception is `onScrollToHeading` (Outline
 * click-to-scroll), ported from the formerly-dead Reader outline branch in
 * EditorPane (it needs the live editor, threaded in as the hook arg).
 *
 * Margins, panel widths, the stacked dock engine, popouts, band heights, and
 * omni toggles all come from the real `vp` now, so they are FUNCTIONAL.
 */

"use client";

import { useCallback, useMemo } from "react";
import type { Editor } from "@tiptap/react";
import type { EditorPaneViewPrefs } from "@/components/EditorPane";
import { useViewPrefs, type Side } from "@/hooks/useViewPrefs";
import {
  buildEditorPaneViewPrefs,
  EMPTY_SECTION_PATHS,
  type EditorMutationHandlers,
  type EditorPaneViewDerivations,
} from "./build-editor-pane-view-prefs";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import {
  PANEL_TO_CATEGORY,
  type OmniCategory,
} from "@/panels/Omni/OmniViewPanel";

// Each OmniCategory → its native side, sourced from PANEL_REGISTRY. Used as
// the `categorySides` map the OmniFilterMenu renders against.
const READER_CATEGORY_SIDES: Record<OmniCategory, Side> = (() => {
  const out: Partial<Record<OmniCategory, Side>> = {};
  for (const entry of Object.values(PANEL_REGISTRY)) {
    const cat = PANEL_TO_CATEGORY[entry.kind];
    if (cat && entry.defaultStripSide) {
      out[cat] = entry.defaultStripSide;
    }
  }
  return out as Record<OmniCategory, Side>;
})();

/**
 * The Reader's no-op editor handlers (everything EXCEPT `onScrollToHeading`,
 * which is supplied per-mount because it needs the live editor). The Reader
 * is read-only, so every doc mutation is a no-op. Typed as the named
 * `EditorMutationHandlers` minus the one live handler so any future addition
 * forces an explicit choice here rather than silently defaulting to nothing.
 */
const READER_NOOP_HANDLERS: Omit<EditorMutationHandlers, "onScrollToHeading"> = {
  onEditOrphan: () => {},
  onDeleteOrphan: () => {},
  onEditOrphanTitle: () => {},
  onReorderBlocks: () => {},
  onRenameHeading: () => {},
  onRenameParTitle: () => {},
  onUpdateLabel: () => {},
  isLabelTaken: () => false,
  onFocusActivate: () => {},
  onFocusDeactivate: () => {},
  onFocusToggleLock: () => {},
  onFocusMoveTo: () => {},
  onFocusExpandTo: () => {},
  onFocusSnapBoundary: () => {},
  focusFloating: () => {},
  setIsResizingPanels: () => {},
  // The real `vp` engine already holds the widths/margins — nothing to snap
  // to a rendered width before a drag.
  syncPanelPrefsToRendered: () => {},
  setZenLeftMargin: () => {},
  setZenRightMargin: () => {},
  // Reader writes are intentionally scoped to note annotations; per-card
  // archive view + the atom-archive warning never change in a read-only doc.
  setCardArchiveView: () => {},
  setSuppressArchiveAtomWarning: () => {},
};

/**
 * Returns a stable `EditorPaneViewPrefs` for the Reader, backed by the real
 * `useViewPrefs` engine in ephemeral mode. Strip clicks, the panel↔text
 * divider, dock stacking, margins, popouts, the Bibliography filter, Outline
 * click-to-scroll, and the omni hide-all toggle are all functional by
 * construction.
 *
 * @param editor the live TipTap editor (for Outline click-to-scroll); null
 *   until the editor mounts, in which case scroll is a no-op.
 */
export function useReaderViewPrefs(editor: Editor | null): EditorPaneViewPrefs {
  // The real engine, but in-memory only — its setters mutate session state
  // and never touch the user's persisted editor layout.
  const vp = useViewPrefs({ persistence: "ephemeral" });

  // Omni read-helpers derived from the live ephemeral prefs (same shape the
  // main app derives in EditorLayout). Reference-stable per side so the
  // OmniViewPanel `memo()` isn't broken on each render.
  const leftEnabled = useMemo(
    () => new Set(vp.prefs.omniCategories.left),
    [vp.prefs.omniCategories.left],
  );
  const rightEnabled = useMemo(
    () => new Set(vp.prefs.omniCategories.right),
    [vp.prefs.omniCategories.right],
  );
  const getOmniEnabled = useCallback(
    (side: Side) => (side === "left" ? leftEnabled : rightEnabled),
    [leftEnabled, rightEnabled],
  );
  const getOmniHideAll = useCallback(
    (side: Side) => vp.prefs.omniHideAllCards[side],
    [vp.prefs.omniHideAllCards],
  );

  // Outline click-to-scroll — the one REAL Reader handler. Ported verbatim
  // from the formerly-dead `// Reader path — direct OutlinePanel` branch in
  // EditorPane: find the heading by its top-level block index, select it,
  // and scroll its DOM node into view.
  const onScrollToHeading = useCallback(
    (headingIndex: number) => {
      if (!editor) return;
      let idx = 0;
      let foundPos: number | null = null;
      editor.state.doc.forEach((_node, pos) => {
        if (idx === headingIndex) foundPos = pos;
        idx++;
      });
      if (foundPos == null) return;
      editor.commands.focus();
      editor.commands.setTextSelection(foundPos);
      const { view } = editor;
      const dom = view.nodeDOM(foundPos) as HTMLElement | null;
      dom?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [editor],
  );

  const handlers = useMemo<EditorMutationHandlers>(
    () => ({ ...READER_NOOP_HANDLERS, onScrollToHeading }),
    [onScrollToHeading],
  );

  const derivations = useMemo<EditorPaneViewDerivations>(
    () => ({
      // Reader has no focus mode, no section-path band, no zen mode.
      // (Section paths are passed separately as EMPTY_SECTION_PATHS — 5a.)
      isResizingPanels: false,
      focusState: null,
      zenMode: false,
      zenLeftMargin: 0,
      zenRightMargin: 0,
      getOmniEnabled,
      getOmniHideAll,
      setOmniSideToDefault: vp.resetOmniSide,
      categorySides: READER_CATEGORY_SIDES,
      // The real engine owns the card-popout-key remap; route it through.
      remapCardPopKey: (oldKey: string, newKey: string) =>
        vp.migratePoppedOutCards((k) => (k === oldKey ? newKey : k)),
      // No float z-index painter in the Reader (no MRU focus stack).
    }),
    // `vp` is referentially stable (useViewPrefs memoizes its return), so
    // listing the whole object — which exhaustive-deps prefers over the
    // individual `vp.*` member reads used here — adds no spurious recompute.
    [vp, getOmniEnabled, getOmniHideAll],
  );

  return useMemo<EditorPaneViewPrefs>(
    () => buildEditorPaneViewPrefs(vp, handlers, derivations, EMPTY_SECTION_PATHS),
    [vp, handlers, derivations],
  );
}
