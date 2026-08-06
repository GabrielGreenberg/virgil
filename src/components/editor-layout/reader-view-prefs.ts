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
 * F#16 (deferred half): the Reader breadcrumb / Outline active-line is now
 * FUNCTIONAL too. `useReaderSectionPath` derives the live `activeSectionPath`
 * (the section you're scrolled into) and threads it into
 * `buildEditorPaneViewPrefs` in place of the old `EMPTY_SECTION_PATHS` stub, so
 * the docked SectionLozenge + Outline active-line light up. It is keystroke-safe
 * by construction: the Reader doc is read-only, so the path changes only on
 * SCROLL — derived on the same RAF-coalesced passive-scroll cadence as
 * `useParaNavHistory`, NEVER via `editor.on('update')`.
 *
 * F#16: the Reader now ALSO passes a `menuBar` bundle, so the docked MenuBar
 * (View menu toggles + paragraph back/forward nav) lights up in BOTH reader
 * contexts (inline panel + outer tab) — both funnel through PaperRender's one
 * `<EditorPane>`. The bundle is built off the SAME ephemeral `vp` instance as
 * the viewPrefs bundle (see `useReaderView`), so a menu toggle ("Hide
 * paragraph titles") mutates the same store the panel rail / rendered text
 * read — no two-engine divergence. Fonts…/Margins… auto-drop via
 * `READER_CHROME.showMenuBarEditItems=false`. Back/forward is a FUNCTIONAL
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
  type EditorMutationHandlers,
  type EditorPaneSectionPaths,
  type EditorPaneViewDerivations,
} from "./build-editor-pane-view-prefs";
import { SECTION_ACTIVE_LINE_FRACTION } from "./layout-scroll";
import type { SectionPathEntry } from "@/panels/Outline";
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
      showCardTitles: vp.prefs.showCardTitles,
      showLatexComments: vp.prefs.showLatexComments,
      showHeadingLabels: vp.prefs.showHeadingLabels,
      omniDimResting: vp.prefs.omniDimResting,
      cardOutlineChrome: vp.prefs.cardOutlineChrome,
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
      onToggleCardTitles: () => vp.toggleViewPref("showCardTitles"),
      onToggleLatexComments: vp.toggleLatexComments,
      toggleHeadingLabels: vp.toggleHeadingLabels,
      onToggleOmniDimResting: () => vp.toggleViewPref("omniDimResting"),
      onToggleCardOutline: () => vp.toggleViewPref("cardOutlineChrome"),
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
 * Reader breadcrumb / Outline-active-line section path (F#16 deferred half).
 *
 * A FUNCTIONAL port of EditorLayout's section-path recompute
 * (`EditorLayout.tsx:2000-2117`), trimmed for the Reader: single-pane (no
 * mirror), no focus mode (no out-of-band skip). It derives the
 * `activeSectionPath` — the section breadcrumb you are scrolled INTO — plus the
 * active parTitle index, exactly as the main app does (same
 * `SECTION_ACTIVE_LINE_FRACTION = 0.25` reference line + the same bottom-clamp
 * so the last section can become current).
 *
 * KEYSTROKE SANCTITY: this is NOT an `editor.on('update'|'transaction')`
 * subscriber. The Reader doc is read-only (`editable=false`), so the section
 * path can ONLY change on SCROLL (or resize). It rides the SAME wall-clock /
 * passive-scroll cadence as `useParaNavHistory` — a RAF-coalesced passive
 * `scroll` listener on the Reader scroll container + a one-shot `compute()` on
 * mount/dep-change, PLUS a small fixed set of one-shot settle recomputes
 * (double-rAF + a ~200ms setTimeout) so the breadcrumb isn't blank on fresh
 * open before the doc has laid out (all cancel on unmount; still no standing
 * subscriber). There is no per-keystroke (or any per-transaction) work, so
 * it needs NO entry in the AGENTS.md permitted-subscriber list (same class as
 * DiskWatcher / the para-nav recorder). Each tick is O(top-level headings +
 * parTitled blocks) — one `coordsAtPos` per candidate — never doc-size on a
 * keystroke (there are no keystrokes here at all).
 *
 * @param editor the live TipTap editor (null until it mounts).
 * @param scrollEl the Reader's scroll container (PaperRender owns it as state).
 */
function useReaderSectionPath(
  editor: Editor | null,
  scrollEl: HTMLElement | null,
): EditorPaneSectionPaths {
  const [activeSectionPath, setActiveSectionPath] = useState<
    SectionPathEntry[]
  >([]);
  const [activeParTitleIndex, setActiveParTitleIndex] = useState<number | null>(
    null,
  );

  useEffect(() => {
    if (!editor || !scrollEl) return;
    const view = editor.view;

    const compute = () => {
      // Keep-alive: a hidden (display:none) pane reports offsetHeight 0, so
      // every coordsAtPos/rect collapses to 0 — bail and keep the last-good
      // path (scroll can't change while hidden). Mirrors EditorLayout :2011.
      if (scrollEl.offsetHeight === 0) return;
      const doc = editor.state.doc;
      const scrollRect = scrollEl.getBoundingClientRect();

      // Reference line = the SHARED section-active line (top 25% of the
      // viewport), with the same bottom-clamp EditorLayout uses so the final
      // section near the doc end — which can't be scrolled up to the 25% line —
      // can still become current when parked at the bottom.
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
      const atBottom = maxScroll > 4 && maxScroll - scrollEl.scrollTop <= 2;
      const referenceY = atBottom
        ? scrollRect.bottom
        : scrollRect.top + scrollRect.height * SECTION_ACTIVE_LINE_FRACTION;

      const stack: {
        level: number;
        text: string;
        index: number;
        sectionNumber: string | null;
      }[] = [];
      let lastCrossedStack: typeof stack = [];
      let activeParTitleIdx: number | null = null;

      doc.forEach((node, offset, index) => {
        if (node.type.name === "heading" && node.attrs?.level) {
          const level = node.attrs.level as number;
          let headingTop: number | null = null;
          try {
            headingTop = view.coordsAtPos(offset + 1).top;
          } catch {
            headingTop = null;
          }
          if (headingTop == null) return;
          if (headingTop <= referenceY) {
            while (
              stack.length > 0 &&
              stack[stack.length - 1].level >= level
            ) {
              stack.pop();
            }
            stack.push({
              level,
              text: node.textContent || "Untitled",
              index,
              sectionNumber: (node.attrs?.sectionNumber as string) ?? null,
            });
            lastCrossedStack = [...stack];
            activeParTitleIdx = null;
          }
          return;
        }

        if (
          (node.type.name === "paragraph" ||
            node.type.name === "bulletList" ||
            node.type.name === "orderedList") &&
          node.attrs?.parTitle
        ) {
          let top: number | null = null;
          try {
            top = view.coordsAtPos(offset + 1).top;
          } catch {
            top = null;
          }
          if (top == null) return;
          if (top <= referenceY) activeParTitleIdx = index;
        }
      });

      const path: SectionPathEntry[] = lastCrossedStack.map((s) => ({
        text: s.text,
        index: s.index,
        sectionNumber: s.sectionNumber,
      }));
      setActiveSectionPath((prev) =>
        prev.length === path.length &&
        prev.every(
          (v, i) =>
            v.text === path[i].text &&
            v.index === path[i].index &&
            v.sectionNumber === path[i].sectionNumber,
        )
          ? prev
          : path,
      );
      setActiveParTitleIndex((prev) =>
        prev === activeParTitleIdx ? prev : activeParTitleIdx,
      );
    };

    // RAF-coalesced scroll/resize cadence (NOT editor.on(update)).
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(compute);
    };
    compute();
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    // Fresh-open breadcrumb fix: the synchronous mount-time compute() above
    // runs BEFORE the doc has laid out, so coordsAtPos reads stale/zero tops
    // (or scrollEl.offsetHeight is still 0) and the breadcrumb comes up EMPTY
    // until the user scrolls. Schedule a couple of ONE-SHOT recomputes once the
    // post-mount layout settles. These are NOT standing subscribers — they fire
    // a fixed number of times and all cancel on unmount, so keystroke sanctity
    // is preserved (the Reader doc is read-only anyway). Each recompute is
    // O(headings) and the compute()'s state-equality bail makes a redundant run
    // a no-op.
    //   (a) double-rAF: measure after the browser has painted the first frame.
    //   (b) a short setTimeout fallback for layouts that aren't ready by then
    //       (e.g. fonts/images still settling, or a hidden→visible flip).
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(compute);
    });
    const settleTimer = setTimeout(compute, 200);

    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(settleTimer);
      scrollEl.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [editor, scrollEl]);

  // Reader is single-pane — no mirror view, so the mirror fields stay empty.
  return useMemo<EditorPaneSectionPaths>(
    () => ({
      activeSectionPath,
      activeParTitleIndex,
      mirrorSectionPath: [],
      mirrorParTitleIndex: null,
    }),
    [activeSectionPath, activeParTitleIndex],
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
  /** Seed the panel columns ("gutters") folded IN (collapsed) when the reader
   *  mounts. The Library inline reader passes true (a clean reading view); the
   *  popped-out Virgil-bar tab passes false so it opens with columns out, like a
   *  doc. This is the STANDING DEFAULT, re-applied on each fresh reader mount
   *  (the ephemeral prefs live in PaperReader, which remounts on a PDF↔text swap
   *  — like all reader view-state, the fold resets then). A user can expand/
   *  collapse within a text-mode session; switching papers within the ReaderLRU
   *  keep-alive preserves that (a display:none flip, not a remount). */
  foldGutters = false,
): { viewPrefs: EditorPaneViewPrefs; menuBar: EditorPaneMenuBarBundle } {
  // The real engine, but in-memory only — its setters mutate session state
  // and never touch the user's persisted editor layout.
  const vp = useViewPrefs({
    persistence: "ephemeral",
    initialOverrides: foldGutters
      ? { collapsedLeft: true, collapsedRight: true }
      : undefined,
  });

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
      // Reader has no focus mode, no zen mode. (Section paths are passed
      // separately — see `useReaderSectionPath` below — Phase 5a.)
      isResizingPanels: false,
      focusState: null,
      focusBand: null,
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

  // Reader breadcrumb — the current-session section path you're scrolled into
  // (F#16 deferred half). Keystroke-safe by construction (scroll-driven, no
  // editor.on(update); see `useReaderSectionPath`). Split into its own memo so
  // its scroll-churn doesn't bust the otherwise-stable `derivations` bundle.
  const sectionPaths = useReaderSectionPath(editor, scrollEl);

  const viewPrefs = useMemo<EditorPaneViewPrefs>(
    () => buildEditorPaneViewPrefs(vp, handlers, derivations, sectionPaths),
    [vp, handlers, derivations, sectionPaths],
  );

  // Paragraph back/forward — functional, keystroke-safe (see hook doc).
  const paraNav = useParaNavHistory(editorHandleRef, scrollEl);
  const menuBar = useReaderMenuBarBundle(vp, editor, paraNav);

  return { viewPrefs, menuBar };
}
