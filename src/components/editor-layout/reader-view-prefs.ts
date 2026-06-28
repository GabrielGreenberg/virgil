/**
 * Reader-mode `EditorPaneViewPrefs` + `EditorPaneMenuBarBundle` — THIN
 * consumers of the real view-state engine.
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
 *
 * F#16: the Reader now ALSO passes a `menuBar` bundle, so the docked MenuBar
 * (View menu toggles + paragraph back/forward nav) lights up in BOTH reader
 * contexts (inline panel + outer tab) — both funnel through PaperRender's one
 * `<EditorPane>`. The bundle is built off the SAME ephemeral `vp` instance as
 * the viewPrefs bundle (see `useReaderView`), so a menu toggle ("Hide
 * paragraph titles") mutates the same store the panel rail / rendered text
 * read — no two-engine divergence. Fonts…/Margins… auto-drop via
 * `READER_CHROME.showMenuBarEditItems=false`; the Reader has no shell prefs
 * modal so `onOpenPreferences` is a typed no-op (ViewMenu never renders a
 * Preferences row, so it's not a dead control). Back/forward is a FUNCTIONAL
 * port of EditorLayout's wall-clock recorder (`useParaNavHistory`) — keystroke
 * -safe by construction (no `editor.on(...)` subscription; a `setInterval` +
 * debounced passive `scroll` listener that reads `getActiveParagraphId()` on
 * its own cadence). In a read-only doc there are no keystrokes anyway.
 */

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Editor } from "@tiptap/react";
import type { EditorPaneViewPrefs, EditorPaneMenuBarBundle } from "@/components/EditorPane";
import type { EditorHandle } from "@/components/Editor";
import {
  useViewPrefs,
  type Side,
  type DividerLevel,
} from "@/hooks/useViewPrefs";
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
 * The four paragraph-nav values the MenuBar bundle needs.
 */
export interface ParaNavBundle {
  paraNavBack: () => void;
  paraNavForward: () => void;
  paraNavBackDisabled: boolean;
  paraNavForwardDisabled: boolean;
}

/**
 * Paragraph back/forward history — a FUNCTIONAL port of EditorLayout's
 * recorder (`EditorLayout.tsx:1656-1856`), trimmed for the Reader (no code
 * view, no collab). It is NOT an `editor.on('update'|'transaction')`
 * subscriber: it is a WALL-CLOCK service (a `setInterval` + a debounced,
 * passive `scroll` listener) that reads the active paragraph on its own
 * cadence, so typing leaves `__virgilBusStats().emitCount` flat. In the
 * Reader the doc is read-only (`editable=false`) so there are no keystrokes
 * on this surface at all — but the design is keystroke-safe regardless and
 * needs NO entry in the AGENTS.md permitted-subscriber list (same class as
 * DiskWatcher). Per tick it does O(1) work plus one `getActiveParagraphId`
 * lookup; the history stack is capped at 100.
 *
 * @param editorHandleRef the EditorPane's `EditorHandle` ref (for
 *   `getActiveParagraphId` / `scrollToParagraphId`).
 * @param scrollEl the Reader's scroll container (PaperRender owns it as
 *   state); null until it mounts.
 */
export function useParaNavHistory(
  editorHandleRef: RefObject<EditorHandle | null>,
  scrollEl: HTMLElement | null,
): ParaNavBundle {
  // Stack always includes the current position; idx points to where we are.
  // Back: idx--, Forward: idx++, New position: truncate-forward + push.
  const paraHistoryRef = useRef<{ stack: string[]; idx: number }>({
    stack: [],
    idx: -1,
  });
  const currentParaRef = useRef<string | null>(null);
  const navigatingRef = useRef(false);
  // Disabled flags as STATE (not a ref read during render — react-hooks/refs).
  // Recomputed from the ref after every mutation/nav via `syncDisabled`.
  const [paraNavBackDisabled, setBackDisabled] = useState(true);
  const [paraNavForwardDisabled, setForwardDisabled] = useState(true);
  const syncDisabled = useCallback(() => {
    const h = paraHistoryRef.current;
    setBackDisabled(h.idx <= 0);
    setForwardDisabled(h.idx >= h.stack.length - 1);
  }, []);

  // Recorder: poll the active paragraph on a wall clock + on scroll.
  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const checkParagraph = () => {
      if (navigatingRef.current) return;
      const paraId = editorHandleRef.current?.getActiveParagraphId() ?? null;
      if (!paraId || paraId === currentParaRef.current) return;
      currentParaRef.current = paraId;
      const h = paraHistoryRef.current;
      h.stack = h.stack.slice(0, h.idx + 1);
      h.stack.push(paraId);
      if (h.stack.length > 100) h.stack.shift();
      h.idx = h.stack.length - 1;
      syncDisabled();
    };

    const debouncedCheck = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(checkParagraph, 1000);
    };

    scrollEl?.addEventListener("scroll", debouncedCheck, { passive: true });
    const interval = setInterval(debouncedCheck, 2000);
    return () => {
      scrollEl?.removeEventListener("scroll", debouncedCheck);
      clearInterval(interval);
      if (timerId) clearTimeout(timerId);
    };
  }, [editorHandleRef, scrollEl, syncDisabled]);

  const scrollToParagraph = useCallback(
    (uuid: string) => {
      if (uuid === "__DOC_TOP__") {
        editorHandleRef.current?.scrollToHeading(-1);
        return;
      }
      editorHandleRef.current?.scrollToParagraphId(uuid);
    },
    [editorHandleRef],
  );

  const paraNavBack = useCallback(() => {
    const h = paraHistoryRef.current;
    if (h.idx <= 0) return;
    h.idx--;
    const targetId = h.stack[h.idx];
    navigatingRef.current = true;
    currentParaRef.current = targetId;
    scrollToParagraph(targetId);
    syncDisabled();
    setTimeout(() => {
      navigatingRef.current = false;
    }, 1500);
  }, [scrollToParagraph, syncDisabled]);

  const paraNavForward = useCallback(() => {
    const h = paraHistoryRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx++;
    const targetId = h.stack[h.idx];
    navigatingRef.current = true;
    currentParaRef.current = targetId;
    scrollToParagraph(targetId);
    syncDisabled();
    setTimeout(() => {
      navigatingRef.current = false;
    }, 1500);
  }, [scrollToParagraph, syncDisabled]);

  return {
    paraNavBack,
    paraNavForward,
    paraNavBackDisabled,
    paraNavForwardDisabled,
  };
}

/**
 * Build the Reader's `EditorPaneMenuBarBundle` off the SAME ephemeral `vp`
 * the viewPrefs bundle reads from. Internal — called by `useReaderView` so
 * both bundles share one engine (a second `useViewPrefs` call would give a
 * divergent store whose menu toggles wouldn't reflect in the rail).
 */
function useReaderMenuBarBundle(
  vp: ReturnType<typeof useViewPrefs>,
  editor: Editor | null,
  paraNav: ParaNavBundle,
): EditorPaneMenuBarBundle {
  // Divider levels actually present in the doc — walked once per `editor`
  // identity over TOP-LEVEL blocks only (O(top-level children), never per
  // keystroke; the Reader is read-only so the doc never changes anyway).
  const availableDividerLevels = useMemo(() => {
    const s = new Set<DividerLevel>();
    editor?.state.doc.forEach((n) => {
      if (n.type.name === "heading") {
        const lv = n.attrs.level;
        if (typeof lv === "number" && lv >= 0 && lv <= 6) {
          s.add(lv as DividerLevel);
        }
      }
    });
    return s;
  }, [editor]);

  const activeDividerLevels = useMemo(() => {
    const s = new Set<DividerLevel>();
    for (const l of vp.prefs.dividerLevels) {
      if (availableDividerLevels.has(l as DividerLevel)) s.add(l as DividerLevel);
    }
    return s;
  }, [vp.prefs.dividerLevels, availableDividerLevels]);

  // Memoize the hidden-type Sets on their `vp.prefs.*` source so MenuBar's
  // `memo()` isn't defeated each render (mirrors EditorLayout :912 / :1184).
  const hiddenMarginaliaTypes = useMemo(
    () => new Set(vp.prefs.hiddenMarginaliaTypes),
    [vp.prefs.hiddenMarginaliaTypes],
  );
  const hiddenHighlightTypes = useMemo(
    () => new Set(vp.prefs.hiddenHighlightTypes),
    [vp.prefs.hiddenHighlightTypes],
  );

  return useMemo<EditorPaneMenuBarBundle>(
    () => ({
      // ── Read state ──────────────────────────────────────────────
      showParTitles: vp.prefs.showParTitles,
      showLatexComments: vp.prefs.showLatexComments,
      showHeadingLabels: vp.prefs.showHeadingLabels,
      omniDimResting: vp.prefs.omniDimResting,
      showMarginalia: vp.prefs.showMarginalia,
      hiddenMarginaliaTypes,
      hiddenHighlightTypes,
      availableDividerLevels,
      activeDividerLevels,
      dividerWidth: vp.prefs.dividerWidth,
      editorSplit: vp.prefs.editorSplit,
      // Reader is single-pane; the split toggle has no real second pane (it's
      // wired below for type-completeness). Hardcode the active pane.
      activeSplitPane: "top",

      // ── Toggle setters (all off the same ephemeral `vp`) ────────
      onToggleParTitles: vp.toggleParTitles,
      onToggleLatexComments: vp.toggleLatexComments,
      toggleHeadingLabels: vp.toggleHeadingLabels,
      onToggleOmniDimResting: () => vp.toggleViewPref("omniDimResting"),
      toggleMarginalia: vp.toggleMarginalia,
      toggleMarginaliaType: vp.toggleMarginaliaType,
      toggleHighlightType: vp.toggleHighlightType,
      toggleDividerLevel: vp.toggleDividerLevel,
      setDividerWidth: vp.setDividerWidth,
      setShowHighlights: vp.setShowHighlights,
      // Single-pane Reader: the split toggle rides the real ephemeral setter
      // for type-completeness (session-only; no real second pane is rendered).
      toggleEditorSplit: () => vp.setEditorSplit((s) => !s),
      closeAllPanels: vp.closeAllPanels,

      // ── Paragraph back/forward nav (functional port) ────────────
      paraNavBack: paraNav.paraNavBack,
      paraNavForward: paraNav.paraNavForward,
      paraNavBackDisabled: paraNav.paraNavBackDisabled,
      paraNavForwardDisabled: paraNav.paraNavForwardDisabled,

      // ── Dialog openers ──────────────────────────────────────────
      // The Reader has no shell Preferences modal; ViewMenu never renders a
      // Preferences row, so a no-op is not a dead control.
      onOpenPreferences: () => {},
      // Fonts…/Margins… auto-drop via READER_CHROME.showMenuBarEditItems=false
      // (MenuBar passes them as undefined when showEditItems is false), so
      // these typed no-ops satisfy the contract without re-adding the entries.
      onOpenFontsDialog: () => {},
      onOpenMarginsMode: () => {},
    }),
    [vp, availableDividerLevels, activeDividerLevels, hiddenMarginaliaTypes, hiddenHighlightTypes, paraNav],
  );
}

/**
 * The Reader's combined view-state: BOTH the `EditorPaneViewPrefs` bundle and
 * the `EditorPaneMenuBarBundle`, built off ONE ephemeral `useViewPrefs`
 * instance so a menu toggle and a rail click mutate the same store. This is
 * the load-bearing correctness constraint (F#16 risk #1: the two-engine trap).
 *
 * @param editor the live TipTap editor (Outline click-to-scroll + the
 *   divider-level walk); null until the editor mounts.
 * @param editorHandleRef the EditorPane `EditorHandle` ref (paragraph nav).
 * @param scrollEl the Reader scroll container (paragraph-nav recorder).
 */
export function useReaderView(
  editor: Editor | null,
  editorHandleRef: RefObject<EditorHandle | null>,
  scrollEl: HTMLElement | null,
): { viewPrefs: EditorPaneViewPrefs; menuBar: EditorPaneMenuBarBundle } {
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

  // Outline click-to-scroll — the one REAL Reader editor handler. Ported
  // verbatim from the formerly-dead `// Reader path — direct OutlinePanel`
  // branch in EditorPane: find the heading by its top-level block index,
  // select it, and scroll its DOM node into view.
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

  const viewPrefs = useMemo<EditorPaneViewPrefs>(
    () => buildEditorPaneViewPrefs(vp, handlers, derivations, EMPTY_SECTION_PATHS),
    [vp, handlers, derivations],
  );

  // Paragraph back/forward — functional, keystroke-safe (see hook doc).
  const paraNav = useParaNavHistory(editorHandleRef, scrollEl);
  const menuBar = useReaderMenuBarBundle(vp, editor, paraNav);

  return { viewPrefs, menuBar };
}
