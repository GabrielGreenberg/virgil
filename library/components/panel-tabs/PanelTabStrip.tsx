"use client";

import {
  forwardRef,
  Fragment,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal, flushSync } from "react-dom";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { ENTRIES_DT_TYPE, ENTRY_DT_TYPE, LIBRARY_DT_TYPE, PAPER_DT_TYPE, TAB_DT_TYPE } from "@library/lib/dnd-types";
import { isCentral } from "@library/lib/library-store";
import { attachClampedDragGhost } from "@/lib/drag-ghost";
import { useFloatingMenuPosition } from "@/hooks/useFloatingMenuPosition";
import { PanelFolderTab } from "./PanelFolderTab";
import {
  STRIP_SIDE_PAD,
  STRIP_TOP_HEADROOM,
} from "@/components/chrome/folder-tab-geometry";
import { parkDuringPaneDrag } from "@/lib/pane-resize";

// F#15 inactive-tab floor: inactive tabs absorb the squeeze first and
// ellipsize their names down to this width before the active tab compresses.
const INACTIVE_MIN_CONTENT = 60;

export type TabDef = {
  id: string;
  label: string;
  closable: boolean;
  renamable: boolean;
  icon?: ReactNode;
  /** When set, a vertical-dots trigger renders inside the tab on the left,
   *  opening a per-tab dropdown of the given items. */
  menu?: PanelMenuItem[];
  /** Pinned state. When defined, a pin toggle renders on the tab; clicking
   *  it calls onTogglePin. Pinned tabs are not replaced when another tab
   *  opens into the same panel. Applies to every kind (Central, custom,
   *  paper); per-doc project tabs don't surface a pin toggle. */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Citekey for paper-kind tabs. When set, the dragstart handler also
   *  publishes a PAPER_DT_TYPE payload so consumers outside the library
   *  (e.g. the Virgil bar) can promote the paper to an outer tab. */
  paperCitekey?: string;
  /** Library id for non-Central library tabs (project / custom). When
   *  set, dragstart also publishes a LIBRARY_DT_TYPE payload so the
   *  Virgil bar can promote the library to an outer tab (copy semantics
   *  — the donor inner tab stays put). */
  outerDraggableLibraryId?: string;
};

export type RecentLibrary = {
  id: string;
  label: string;
};

export interface PanelMenuItem {
  label: string;
  onClick: () => void;
}

type Props = {
  panel: PanelKey;
  tabs: TabDef[];
  activeId: string;
  recentLibraries: RecentLibrary[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, label: string) => void;
  /** Create a new library; returns its id so the strip can enter edit mode. */
  onCreate: () => string;
  onOpenRecent: (id: string) => void;
  onMoveTab: (libId: string, toPanel: PanelKey, toIndex: number) => void;
  /** Add an entry (from a row drag) to the library matching libId. */
  /** Always batched — see TabbedLibraryPanel.onAddEntriesToLibrary. */
  onDropEntries: (libId: string, entryKeys: readonly string[]) => void;
  /**
   * Ref to the surrounding library panel container (tab strip + list).
   * Used as the HTML5 drag image so dragging a tab visually carries the
   * whole library with it, preserving the bond between tab and content.
   */
  panelRef?: RefObject<HTMLDivElement | null>;
  /** Render the trailing "+" button + add-tab popup. False when an outer
   *  navigator owns library creation; true for legacy 2-column callers. */
  showAddTab?: boolean;
  /** Surface closed customs/projects in the AddTabMenu's "Recent" section.
   *  Only meaningful when showAddTab is also true. */
  showRecent?: boolean;
  /** True while an OS file is being dragged over the Library (gated on the
   *  dataTransfer `"Files"` type upstream in LibraryView). When set, the
   *  Central tab renders the shared drop-target highlight as a drop-ready
   *  affordance — the file itself is ingested by LibraryView's container-level
   *  drop handler, so this strip only owns the visual box. */
  fileDragActive?: boolean;
};

export function PanelTabStrip({
  panel,
  tabs,
  activeId,
  recentLibraries,
  onActivate,
  onClose,
  onRename,
  onCreate,
  onOpenRecent,
  onMoveTab,
  onDropEntries,
  panelRef,
  showAddTab = false,
  showRecent = false,
  fileDragActive = false,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  // Rect captured at toggle so the portaled AddTabMenu can anchor to the "+"
  // button without reading a ref during render (react-hooks/refs).
  const [addAnchorRect, setAddAnchorRect] = useState<DOMRect | null>(null);
  const [tabMenuOpenId, setTabMenuOpenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [entryDragOverTabId, setEntryDragOverTabId] = useState<string | null>(
    null,
  );
  // Task 053 — whether the ACTIVE tab's right foot is flush against the body's
  // top-right corner (its wrapper's right edge coincides with the body's right
  // edge). The left is reliably `i === 0` (first tab always sits at the strip
  // pad === body inset), but "flush right" can't be read from the tab INDEX: a
  // single narrow tab is last yet NOT flush-right (trailing space), while a
  // multi-tab strip pushes the active last tab flush via the grow-to-fill
  // inactive tabs. So the right foot is measured, not inferred.
  const [activeFlushRight, setActiveFlushRight] = useState(false);

  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());
  const addBtnRef = useRef<HTMLButtonElement | null>(null);

  // F#15 scroll-active-into-view. Engages ONLY past the floor: when every tab
  // has compressed to its min-width and the total still exceeds the strip
  // (scrollWidth > clientWidth, i.e. the overflow:hidden strip has off-screen
  // content), nudge the active tab fully into view via scrollLeft so its 1px
  // bridge stays attached to the body. Above the floor the tabs share the width
  // and there's nothing to scroll, so this is a no-op. Keyed on activeId + tab
  // count so it re-runs on selection / open / close — not on every render, and
  // never on a doc keystroke (the strip subscribes to no editor events).
  useEffect(() => {
    const strip = stripRef.current;
    const el = tabRefs.current.get(activeId);
    if (!strip || !el) return;
    if (strip.scrollWidth <= strip.clientWidth) return; // above the floor
    const stripRect = strip.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.right > stripRect.right) {
      strip.scrollLeft += elRect.right - stripRect.right;
    } else if (elRect.left < stripRect.left) {
      strip.scrollLeft -= stripRect.left - elRect.left;
    }
  }, [activeId, tabs.length]);

  // Task 053 — measure whether the active tab's right foot sits on the body's
  // top-right corner, so its swoop can tuck into the corner (the mirror of the
  // first tab's left foot). The body is inset from the panel by STRIP_SIDE_PAD
  // on both sides, so "flush right" is: active-tab wrapper right ≈ panel right −
  // pad. RAF-coalesced + equality-gated; re-runs on selection / tab-count change
  // and on any resize. Library chrome, not a doc-keystroke subscriber.
  //
  // KEPT ResizeObserver (the tab chrome itself is layout-driven and needs
  // none): whether the active tab's right edge coincides with the body's
  // right edge depends on the SUM of the sibling tabs' natural widths versus
  // the strip's width — a cross-subtree layout relationship CSS cannot
  // express (no "am I flush with my scroll container's edge" selector), and
  // it toggles a discrete art variant (the tucked right cap), not a style
  // that could stretch. Equality-bailed boolean + RAF-coalesced + parked on
  // the PaneDragBus below.
  useEffect(() => {
    const panel = panelRef?.current;
    if (!panel) {
      setActiveFlushRight(false);
      return;
    }
    let raf = 0;
    const measure = () => {
      const el = tabRefs.current.get(activeId);
      if (!el) {
        setActiveFlushRight((prev) => (prev ? false : prev));
        return;
      }
      const t = el.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const flush = Math.abs(t.right - (p.right - STRIP_SIDE_PAD)) <= 2;
      setActiveFlushRight((prev) => (prev === flush ? prev : flush));
    };
    // Parked during a pane-resize drag (parkDuringPaneDrag on the app-wide
    // bus): this measure is already RAF-coalesced + equality-gated so it
    // rarely setStates, but parking also skips its two per-frame
    // getBoundingClientRect reads. The tuck settles once on the end edge; the
    // silhouette itself is layout-driven and tracks the drag live, so a
    // one-gesture-stale tuck is the only deferred geometry.
    const park = parkDuringPaneDrag(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    });
    park.fire();
    const ro = new ResizeObserver(() => park.fire());
    ro.observe(panel);
    if (stripRef.current) ro.observe(stripRef.current);
    // Also observe the ACTIVE tab itself: on selection the strip's own size is
    // stable (tabs redistribute WITHIN it), so only the active tab's width
    // change signals "it just became flush-right" — without this the measure
    // can read a stale pre-activation width and miss the tuck.
    const activeEl = tabRefs.current.get(activeId);
    if (activeEl) ro.observe(activeEl);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      park.dispose();
    };
  }, [activeId, tabs.length, panelRef]);

  const startEditing = (id: string, label: string) => {
    setEditingId(id);
    setDraftLabel(label);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const label = draftLabel.trim() || "Untitled";
    onRename(editingId, label);
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleNewLibrary = () => {
    const id = onCreate();
    setMenuOpen(false);
    setEditingId(id);
    setDraftLabel("Untitled");
  };

  const handleOpenRecent = (id: string) => {
    onOpenRecent(id);
    setMenuOpen(false);
  };

  const computeInsertionIndex = (clientX: number): number => {
    for (let i = 0; i < tabs.length; i++) {
      const el = tabRefs.current.get(tabs[i].id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) return i;
    }
    return tabs.length;
  };

  const dataTransferHas = (
    e: DragEvent<HTMLElement>,
    type: string,
  ): boolean => {
    const types = e.dataTransfer.types;
    for (let i = 0; i < types.length; i++) {
      if (types[i] === type) return true;
    }
    return false;
  };

  // Read the multi-row drag payload if present, falling back to the
  // single-key payload. See `ENTRIES_DT_TYPE` in dnd-types.ts.
  const readEntryKeys = (e: DragEvent<HTMLElement>): string[] => {
    const multi = e.dataTransfer.getData(ENTRIES_DT_TYPE);
    if (multi) {
      try {
        const parsed = JSON.parse(multi);
        if (
          Array.isArray(parsed) &&
          parsed.every((k): k is string => typeof k === "string")
        ) {
          return parsed;
        }
      } catch {
        // fall through
      }
    }
    const single = e.dataTransfer.getData(ENTRY_DT_TYPE);
    return single ? [single] : [];
  };

  // Bounding-box hit test: which tab (if any) is the cursor over?
  // Used in place of e.target.closest("[data-tab-id]"), which fails when
  // e.target is an SVGElement (active-tab shape) or the strip itself
  // (cursor in gap/padding). The flex-laid-out wrapper rects don't
  // overlap, so first match is correct.
  const findTabAtPosition = (
    clientX: number,
    clientY: number,
  ): string | null => {
    for (const [tabId, el] of tabRefs.current.entries()) {
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        return tabId;
      }
    }
    return null;
  };

  const handleStripDragOver = (e: DragEvent<HTMLDivElement>) => {
    // Tab drag (reorder / move-between-panels):
    if (dataTransferHas(e, TAB_DT_TYPE)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverIndex(computeInsertionIndex(e.clientX));
      setEntryDragOverTabId(null);
      return;
    }
    // Entry drag (row → library):
    if (dataTransferHas(e, ENTRY_DT_TYPE)) {
      const tabId = findTabAtPosition(e.clientX, e.clientY);
      if (!tabId) {
        if (entryDragOverTabId !== null) setEntryDragOverTabId(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (entryDragOverTabId !== tabId) setEntryDragOverTabId(tabId);
      setDragOverIndex(null);
      return;
    }
  };

  const handleStripDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (next && stripRef.current?.contains(next)) return;
    setDragOverIndex(null);
    setEntryDragOverTabId(null);
  };

  const handleStripDrop = (e: DragEvent<HTMLDivElement>) => {
    const tabLibId = e.dataTransfer.getData(TAB_DT_TYPE);
    if (tabLibId) {
      e.preventDefault();
      const idx = computeInsertionIndex(e.clientX);
      setDragOverIndex(null);
      setDraggingId(null);
      onMoveTab(tabLibId, panel, idx);
      return;
    }
    const entryKeys = readEntryKeys(e);
    if (entryKeys.length > 0) {
      const tabId = findTabAtPosition(e.clientX, e.clientY);
      if (!tabId) return;
      e.preventDefault();
      setEntryDragOverTabId(null);
      onDropEntries(tabId, entryKeys);
      return;
    }
  };


  const handleTabDragStart = (e: DragEvent<HTMLElement>, tab: TabDef) => {
    const libId = tab.id;
    // Activate the dragged tab synchronously so the panel re-renders to
    // show its library content BEFORE the browser captures the drag image
    // — that way the visual that follows the cursor matches the tab the
    // user picked up, even if a different tab was active before.
    if (libId !== activeId) {
      flushSync(() => onActivate(libId));
    }
    e.dataTransfer.setData(TAB_DT_TYPE, libId);
    if (tab.paperCitekey) {
      // Sibling payload so the Virgil bar (outside the library subsystem)
      // can promote a paper to an outer tab without parsing libId.
      e.dataTransfer.setData(PAPER_DT_TYPE, tab.paperCitekey);
    }
    if (tab.outerDraggableLibraryId) {
      // Sibling payload for promoting a library tab (non-Central) to an
      // outer tab. Copy semantics — donor inner tab stays.
      e.dataTransfer.setData(LIBRARY_DT_TYPE, tab.outerDraggableLibraryId);
    }
    // copyMove keeps both options open: in-strip drops behave as move
    // (reorder / cross-panel), the outer Virgil bar treats the drop as
    // copy at the dataTransfer level (paper tabs close via a separate
    // event; library tabs simply stay put after the copy).
    e.dataTransfer.effectAllowed =
      tab.paperCitekey || tab.outerDraggableLibraryId ? "copyMove" : "move";
    const wholePanelEl: HTMLElement | null = panelRef?.current ?? null;
    if (wholePanelEl) {
      const rect = wholePanelEl.getBoundingClientRect();
      attachClampedDragGhost({
        dragStartEvent: e,
        // Clone the whole panel so the ghost outlines a manila file: the
        // active tab's trapezoid on top, the rounded body below. Other
        // tabs are hidden so only the dragged one is visible; the strip
        // background is cleared so the trapezoid silhouette stays clean.
        // drop-shadow follows the combined alpha outline (trapezoid +
        // rounded body), not a bounding square.
        buildGhost: () => {
          const clone = wholePanelEl.cloneNode(true) as HTMLElement;
          const strip = clone.firstElementChild as HTMLElement | null;
          if (strip) {
            strip.style.background = "transparent";
            for (const child of Array.from(strip.children) as HTMLElement[]) {
              if (child.getAttribute("data-tab-id") !== libId) {
                child.style.visibility = "hidden";
              }
            }
          }
          // The ghost lives for the full drag (not one frame), so drop
          // iframes / scrollable content rather than carry a live view.
          for (const iframe of Array.from(clone.querySelectorAll("iframe"))) {
            iframe.remove();
          }
          clone.style.width = `${rect.width}px`;
          clone.style.height = `${rect.height}px`;
          clone.style.opacity = "0.92";
          clone.style.filter = "drop-shadow(0 8px 16px rgba(0,0,0,0.25))";
          return clone;
        },
        cursorOffsetX: e.clientX - rect.left,
        cursorOffsetY: e.clientY - rect.top,
      });
    }
    setDraggingId(libId);
  };

  const handleTabDragEnd = () => {
    setDraggingId(null);
    setDragOverIndex(null);
  };

  return (
    <div
      ref={stripRef}
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        // Ink-cushion by construction (geometry SSOT,
        // src/components/chrome/folder-tab-geometry.ts): STRIP_TOP_HEADROOM
        // (≥2px) of real top padding keeps the active tab's top stroke well
        // clear of this strip's overflow clip at any DPR — the top edge gets
        // TAB_TOP_GUTTER (inside the cap SVGs) PLUS this headroom, so no
        // stroke ink is ever adjacent to a clip boundary (the pre-task-087
        // top-stroke-eater class, dead by construction).
        // 1px bottom padding + -1px bottom margin lets the active tab's 1px
        // bottom fill row spill exactly 1px below the strip and overlap the
        // body's top border — covering it under the active tab so the tab
        // merges into the page with NO seam line — without changing the
        // strip's outer footprint. The overflowY:hidden scroll-clip would
        // otherwise eat that 1px; the padding keeps it inside the clip box.
        // The strip bg is the solid --library-bg, so the inter-tab gaps and
        // the tail past the last tab read as PURE library field — no chrome
        // there (task 048); the page outline lives ONLY under the ACTIVE tab
        // (its silhouette stroke + bottom fill row merging into the body
        // edge). Inactive tabs are deliberately FLAT BackgroundTab divs with
        // no stroke of their own (task 048) — the only line under them is the
        // body's top border. Horizontal pad is the STRIP_SIDE_PAD SSOT: the
        // body below insets by the SAME constant so its rounded top corners
        // tuck exactly under the outermost tabs' swoop feet (task 047 no-wing).
        padding: `${STRIP_TOP_HEADROOM}px ${STRIP_SIDE_PAD}px 1px`,
        marginBottom: -1,
        // The strip + the (transparent) inactive tabs sit on the LIBRARY
        // backdrop (--library-bg) so unselected tabs read as part of the
        // library background; only the active tab's manila fill (--surface /
        // --background for paper) and the body pop as the white "page".
        background: "var(--library-bg)",
        // No strip-wide baseline seam. A former inset bottom-shadow seam in the
        // --topbar-border token (inset 0 -1px 0) painted a 1px line
        // across the WHOLE strip — including the inter-tab gaps and the tail — so
        // the outline ran continuously. But --topbar-border (warm taupe #cbc3b8)
        // clashed hard over the cool --library-bg field, showing as a discolored
        // stripe in the gaps (task 048). Dropped: the gaps are now blank library
        // field, and the surviving page edges (tab strokes, body frame, NavPod)
        // are re-toned onto --library-edge — a tint of --library-bg that cannot
        // drift from it. The active-tab merge is unaffected: it rides the
        // fill-bridge + body border, not this shadow.
        flexShrink: 0,
        // F#15: the strip itself must be able to shrink to its panel column
        // (which is min-width:0), so tabs SHARE the width Chrome-style instead
        // of overflowing. Without this the flex parent would let the strip grow
        // to its content and the share-the-width contract would never engage.
        minWidth: 0,
        position: "relative",
        zIndex: 20,
        // F#15: tabs SHARE the strip width — inactive tabs are flex:1 1 auto
        // (they compress and their names ellipsize first), while the ACTIVE
        // tab is flex:0 0 auto and RESISTS, holding its full name down to its
        // reserved min-width floor (see PanelFolderTab). Only past the floors
        // does total content exceed the strip; then the scroll-active-into-view
        // effect below keeps the active tab visible via scrollLeft. Scrollbar
        // hidden — the strip stays visually clean. Per-tab menus are
        // body-portaled (see TabMenuTrigger) so this overflow can't clip them.
        overflowX: "hidden",
        overflowY: "hidden",
        scrollbarWidth: "none",
      }}
      onDragOver={handleStripDragOver}
      onDragLeave={handleStripDragLeave}
      onDrop={handleStripDrop}
    >
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeId;
        const isEditing = tab.id === editingId;
        const isDragging = tab.id === draggingId;
        const isEntryDropTarget = tab.id === entryDragOverTabId;
        // An OS-file drag over the Library lights the Central tab as the
        // drop-ready target (task 089). It shares the entry-drop highlight
        // vocabulary — one "this tab is the current drop target" treatment,
        // regardless of the payload kind (row entry vs OS file).
        const isFileDropTarget = fileDragActive && isCentral(tab.id);
        const isDropTarget = isEntryDropTarget || isFileDropTarget;

        const setRef = (el: HTMLElement | null) => {
          if (el) tabRefs.current.set(tab.id, el);
          else tabRefs.current.delete(tab.id);
        };

        const dragProps = {
          draggable: !isEditing,
          onDragStart: (e: DragEvent<HTMLElement>) =>
            handleTabDragStart(e, tab),
          onDragEnd: handleTabDragEnd,
        };

        if (isActive) {
          // Paper-kind tabs fill the warm Virgil canvas so the active
          // tab merges seamlessly with the paper-file body — that's the
          // same background the editor/view sits on elsewhere in Virgil.
          // Other tab kinds keep the white surface fill.
          const activeFill = tab.paperCitekey ? "var(--background)" : "var(--surface)";
          return (
            <Fragment key={tab.id}>
              <PanelFolderTab
                ref={setRef}
                fill={activeFill}
                title={tab.label}
                dataTabId={tab.id}
                // Task 053 — only the ACTIVE tab has a swoop silhouette
                // (inactive tabs are flat), so it's the only one whose outer
                // feet can notch a body corner. LEFT: the first tab always sits
                // flush against the body's top-left corner (strip pad === body
                // inset), so tuck it (immediate, no measure). RIGHT: measured —
                // tuck only when the active tab is genuinely flush-right.
                tuckLeftFoot={i === 0}
                tuckRightFoot={activeFlushRight}
                wrapperProps={{
                  ...dragProps,
                  style: {
                    opacity: isDragging ? 0.5 : 1,
                    outline: isDropTarget
                      ? "2px solid var(--accent)"
                      : undefined,
                    outlineOffset: isDropTarget ? -2 : undefined,
                    borderRadius: isDropTarget ? 8 : undefined,
                    // Shaded fill so the drop-ready target reads as a box, not
                    // just a ring (the affordance Gabriel named, task 089).
                    background: isDropTarget ? "var(--accent-light)" : undefined,
                  },
                }}
              >
                {tab.onTogglePin && !isEditing && (
                  <PinButton
                    pinned={!!tab.pinned}
                    onClick={tab.onTogglePin}
                    muted={false}
                  />
                )}
                {tab.icon}
                {isEditing ? (
                  <TabTitleInput
                    value={draftLabel}
                    onChange={setDraftLabel}
                    onCommit={commitEdit}
                    onCancel={cancelEdit}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: 13,
                      lineHeight: "16px",
                      whiteSpace: "nowrap",
                      // F#15: the active tab sizes to its content by layout
                      // (in-flow content row, flex 0 0 auto), so the name
                      // shows in full; the ellipsis engages only at the
                      // reserved-min-width floor. min-w-0 lets flex actually
                      // shrink this span below its content width there.
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      cursor: tab.renamable ? "text" : "default",
                    }}
                    onDoubleClick={
                      tab.renamable
                        ? () => startEditing(tab.id, tab.label)
                        : undefined
                    }
                  >
                    {tab.label}
                  </span>
                )}
                {tab.menu && tab.menu.length > 0 && !isEditing && (
                  <TabMenuTrigger
                    open={tabMenuOpenId === tab.id}
                    onToggle={() =>
                      setTabMenuOpenId((prev) => (prev === tab.id ? null : tab.id))
                    }
                    onClose={() => setTabMenuOpenId(null)}
                    items={tab.menu}
                    muted={false}
                    pushRight
                  />
                )}
                {tab.closable && !isEditing && (
                  <CloseButton
                    onClick={() => onClose(tab.id)}
                    muted={false}
                    pushRight={!tab.menu}
                  />
                )}
              </PanelFolderTab>
            </Fragment>
          );
        }

        return (
          <BackgroundTab
            key={tab.id}
            ref={setRef}
            tabId={tab.id}
            label={tab.label}
            closable={tab.closable}
            isDragging={isDragging}
            isDropTarget={isDropTarget}
            dragProps={dragProps}
            onClick={() => onActivate(tab.id)}
            onClose={() => onClose(tab.id)}
            menu={tab.menu}
            menuOpen={tabMenuOpenId === tab.id}
            onMenuToggle={() =>
              setTabMenuOpenId((prev) => (prev === tab.id ? null : tab.id))
            }
            onMenuClose={() => setTabMenuOpenId(null)}
            pinned={tab.pinned}
            onTogglePin={tab.onTogglePin}
          />
        );
      })}
      {showAddTab && (
        <div style={{ position: "relative", flexShrink: 0 }}>
          <AddTabButton
            ref={addBtnRef}
            onClick={() => {
              setAddAnchorRect(addBtnRef.current?.getBoundingClientRect() ?? null);
              setMenuOpen((v) => !v);
            }}
          />
          {menuOpen && addAnchorRect && (
            <AddTabMenu
              anchorRect={addAnchorRect}
              recent={showRecent ? recentLibraries : []}
              onNewLibrary={handleNewLibrary}
              onOpenRecent={handleOpenRecent}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
      )}
      {dragOverIndex !== null && (
        <DropIndicator
          stripEl={stripRef.current}
          tabRefs={tabRefs.current}
          tabs={tabs}
          index={dragOverIndex}
        />
      )}
    </div>
  );
}

const BackgroundTab = forwardRef<
  HTMLDivElement,
  {
    tabId: string;
    label: string;
    closable: boolean;
    isDragging: boolean;
    isDropTarget: boolean;
    dragProps: {
      draggable: boolean;
      onDragStart: (e: DragEvent<HTMLElement>) => void;
      onDragEnd: () => void;
    };
    onClick: () => void;
    onClose: () => void;
    menu?: PanelMenuItem[];
    menuOpen: boolean;
    onMenuToggle: () => void;
    onMenuClose: () => void;
    pinned?: boolean;
    onTogglePin?: () => void;
  }
>(function BackgroundTab(
  {
    tabId,
    label,
    closable,
    isDragging,
    isDropTarget,
    dragProps,
    onClick,
    onClose,
    menu,
    menuOpen,
    onMenuToggle,
    onMenuClose,
    pinned,
    onTogglePin,
  },
  ref,
) {
  const hasMenu = !!menu && menu.length > 0;
  const hasPin = !!onTogglePin;
  const hasTrailing = closable || hasMenu;
  return (
    <div
      ref={ref}
      {...dragProps}
      data-tab-id={tabId}
      // Inactive tabs darken on hover (like regular tabs in the Virgil bar:
      // bg-black/5). Imperative on the resting bg, matching the icon-button
      // hover pattern elsewhere in this file; skipped while a drag-drop target
      // so the accent-light highlight isn't overwritten.
      onMouseEnter={(e) => {
        if (!isDropTarget)
          (e.currentTarget as HTMLDivElement).style.background =
            "rgba(0,0,0,0.05)";
      }}
      onMouseLeave={(e) => {
        if (!isDropTarget)
          (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        // F#15: inactive tabs SHARE the strip width and absorb the squeeze
        // first — flex:1 1 auto down to INACTIVE_MIN_CONTENT, then their names
        // ellipsize (the button below carries min-w-0 + text-overflow:ellipsis).
        // They yield before the active tab compresses, so the active name stays
        // intact longest.
        flex: "1 1 auto",
        minWidth: INACTIVE_MIN_CONTENT,
        // Cap at the natural content width so a short-named inactive tab does
        // NOT stretch to fill the strip — it only shares width when crowded.
        maxWidth: "max-content",
        height: 32,
        opacity: isDragging ? 0.5 : 1,
        cursor: dragProps.draggable ? "grab" : "default",
        outline: isDropTarget ? "2px solid var(--accent)" : "none",
        outlineOffset: isDropTarget ? -2 : 0,
        borderRadius: "var(--radius-md)",
        background: isDropTarget ? "var(--accent-light)" : "transparent",
        transition: "background 90ms ease",
        paddingLeft: hasPin ? 4 : 0,
        paddingRight: hasTrailing ? 4 : 0,
      }}
    >
      {hasPin && (
        <PinButton pinned={!!pinned} onClick={onTogglePin!} muted />
      )}
      <button
        type="button"
        onClick={onClick}
        title={label}
        style={{
          background: "transparent",
          border: "none",
          padding: hasPin
            ? (hasTrailing ? "0 4px 0 0" : "0 14px 0 0")
            : (hasTrailing ? "0 4px 0 14px" : "0 14px"),
          height: 32,
          fontSize: 13,
          lineHeight: "16px",
          color: "var(--muted)",
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontFamily: "inherit",
          // F#15: the label is the part that ellipsizes when the inactive tab
          // is squeezed — it takes the flex shrink (the pin/menu/close stay
          // fixed) and clips with an ellipsis. min-w-0 lets it shrink below its
          // text width; the title attr keeps the full name on hover.
          flex: "1 1 auto",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </button>
      {hasMenu && (
        <TabMenuTrigger
          open={menuOpen}
          onToggle={onMenuToggle}
          onClose={onMenuClose}
          items={menu!}
          muted
        />
      )}
      {closable && <CloseButton onClick={onClose} muted />}
    </div>
  );
});

// Pinned state colors the icon itself blue. The button chrome (ring,
// background) stays neutral so the affordance reads as "ON" without
// dominating the tab strip.
const PIN_ACTIVE_COLOR = "#2563eb";

function PinButton({
  pinned,
  onClick,
  muted,
}: {
  pinned: boolean;
  onClick: () => void;
  muted: boolean;
}) {
  const idleColor = muted ? "var(--muted-light)" : "var(--muted)";
  const activeColor = pinned ? PIN_ACTIVE_COLOR : idleColor;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title={pinned ? "Unpin tab — opening another tab will replace it" : "Pin tab — keep open when another tab is opened"}
      aria-label={pinned ? "Unpin tab" : "Pin tab"}
      aria-pressed={pinned}
      style={{
        flexShrink: 0,
        background: "transparent",
        border: "none",
        width: 18,
        height: 18,
        // Pin always sits at the left of the tab content with a small
        // gap before the title.
        marginLeft: 0,
        marginRight: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: activeColor,
        cursor: "pointer",
        borderRadius: "var(--radius-xs)",
        padding: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "rgba(0,0,0,0.08)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden
      >
        <path d="M9.828.722a.5.5 0 0 1 .354.146l4.95 4.95a.5.5 0 0 1 0 .707c-.48.48-1.072.588-1.503.588-.177 0-.335-.018-.46-.039l-3.134 3.134a5.927 5.927 0 0 1 .16 1.013c.046.702-.032 1.687-.72 2.375a.5.5 0 0 1-.707 0l-2.829-2.828-3.182 3.182c-.195.195-1.219.902-1.414.707-.195-.195.512-1.22.707-1.414l3.182-3.182-2.828-2.829a.5.5 0 0 1 0-.707c.688-.688 1.673-.767 2.375-.72a5.922 5.922 0 0 1 1.013.16l3.134-3.133a2.772 2.772 0 0 1-.04-.461c0-.43.108-1.022.589-1.503a.5.5 0 0 1 .353-.146zm.122 2.112v-.002.002zm0-.002v.002a.5.5 0 0 1-.122.51L6.293 6.878a.5.5 0 0 1-.511.12H5.78l-.014-.004a4.507 4.507 0 0 0-.288-.076 4.922 4.922 0 0 0-.765-.116c-.422-.028-.836.008-1.175.15l5.51 5.509c.141-.34.177-.753.149-1.175a4.924 4.924 0 0 0-.192-1.054l-.004-.013v-.001a.5.5 0 0 1 .12-.512l3.536-3.535a.5.5 0 0 1 .532-.115l.096.022c.087.017.208.034.344.034.114 0 .23-.011.343-.04L9.927 2.028c-.029.113-.04.23-.04.343a1.779 1.779 0 0 0 .062.46z" />
      </svg>
    </button>
  );
}

function CloseButton({
  onClick,
  muted,
  pushRight,
}: {
  onClick: () => void;
  muted: boolean;
  /** When true (active tab without a menu), use marginLeft: auto so the
   *  close hugs the right edge instead of sitting next to the title. */
  pushRight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      title="Close tab"
      aria-label="Close tab"
      style={{
        flexShrink: 0,
        background: "transparent",
        border: "none",
        width: 18,
        height: 18,
        marginLeft: pushRight ? "auto" : muted ? 4 : 2,
        marginRight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        lineHeight: 1,
        color: muted ? "var(--muted-light)" : "var(--muted)",
        cursor: "pointer",
        borderRadius: "var(--radius-xs)",
        fontFamily: "inherit",
        padding: 0,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "rgba(0,0,0,0.08)";
        (e.currentTarget as HTMLButtonElement).style.color =
          "var(--foreground)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = muted
          ? "var(--muted-light)"
          : "var(--muted)";
      }}
    >
      ×
    </button>
  );
}

const AddTabButton = forwardRef<HTMLButtonElement, { onClick: () => void }>(
  function AddTabButton({ onClick }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      title="New tab"
      aria-label="New tab"
      style={{
        flexShrink: 0,
        background: "transparent",
        border: "none",
        width: 28,
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        lineHeight: 1,
        color: "var(--muted)",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      +
    </button>
  );
});

function TabMenuTrigger({
  open,
  onToggle,
  onClose,
  items,
  muted,
  pushRight,
}: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  items: PanelMenuItem[];
  muted: boolean;
  /** When true (active tab), use marginLeft: auto to push the trigger to
   *  the right edge of the tab content. */
  pushRight?: boolean;
}) {
  const idleColor = muted ? "var(--muted)" : "var(--foreground)";
  const btnRef = useRef<HTMLButtonElement | null>(null);
  // Capture the trigger rect into state at toggle time (not during render) so
  // the portaled popup can anchor to it — mirrors TabPlusMenu's pattern and
  // keeps the react-hooks/refs rule happy.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  return (
    <div
      style={{
        position: "relative",
        flexShrink: 0,
        marginLeft: pushRight ? "auto" : undefined,
        marginRight: pushRight ? -4 : undefined,
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setAnchorRect(btnRef.current?.getBoundingClientRect() ?? null);
          onToggle();
        }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Library options"
        aria-label="Library options"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          width: 12,
          height: 18,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          lineHeight: 1,
          color: idleColor,
          cursor: "pointer",
          fontFamily: "inherit",
          padding: 0,
          borderRadius: "var(--radius-xs)",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(0,0,0,0.08)";
          (e.currentTarget as HTMLButtonElement).style.color =
            "var(--foreground)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = idleColor;
        }}
      >
        ⋮
      </button>
      {open && anchorRect && (
        <PanelMenuPopup anchorRect={anchorRect} items={items} onClose={onClose} />
      )}
    </div>
  );
}

// Body-portaled so it escapes the folder frame's overflow:hidden and the
// tab strip's horizontal scroll-overflow (both clip absolutely-positioned
// children). Anchored to the trigger via getBoundingClientRect +
// useFloatingMenuPosition, the same convention the editor chrome menus use.
function PanelMenuPopup({
  anchorRect,
  items,
  onClose,
}: {
  anchorRect: DOMRect | null;
  items: PanelMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { ref: positionRef, style: positionStyle } = useFloatingMenuPosition({
    anchorRect,
    placements: [
      { side: "below", align: "start" },
      { side: "above", align: "start" },
    ],
    gap: 4,
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={(el) => {
        ref.current = el;
        positionRef(el);
      }}
      role="menu"
      style={{
        ...positionStyle,
        minWidth: 180,
        background: "var(--surface)",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--pod-shadow)",
        padding: "4px 0",
        zIndex: 2000,
      }}
    >
      {items.map((item, i) => (
        <MenuItem
          key={i}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </MenuItem>
      ))}
    </div>,
    document.body,
  );
}

// Body-portaled for the same reason as PanelMenuPopup — the folder frame's
// overflow:hidden + the strip's scroll-overflow would otherwise clip it.
function AddTabMenu({
  anchorRect,
  recent,
  onNewLibrary,
  onOpenRecent,
  onClose,
}: {
  anchorRect: DOMRect | null;
  recent: RecentLibrary[];
  onNewLibrary: () => void;
  onOpenRecent: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { ref: positionRef, style: positionStyle } = useFloatingMenuPosition({
    anchorRect,
    placements: [
      { side: "below", align: "start" },
      { side: "above", align: "start" },
    ],
    gap: 4,
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const t = setTimeout(() => {
      window.addEventListener("mousedown", onDown);
    }, 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={(el) => {
        ref.current = el;
        positionRef(el);
      }}
      role="menu"
      style={{
        ...positionStyle,
        minWidth: 200,
        background: "var(--surface)",
        border: "1px solid var(--border-light)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--pod-shadow)",
        padding: "4px 0",
        zIndex: 2000,
      }}
    >
      <MenuItem onClick={onNewLibrary}>+ New Library</MenuItem>
      {recent.length > 0 && (
        <>
          <div
            style={{
              height: 1,
              background: "var(--border)",
              margin: "4px 0",
            }}
          />
          <div
            style={{
              fontSize: 10,
              color: "var(--muted)",
              padding: "2px 12px 4px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontFamily: "var(--mono)",
            }}
          >
            Recent
          </div>
          {recent.map((lib) => (
            <MenuItem key={lib.id} onClick={() => onOpenRecent(lib.id)}>
              {lib.label}
            </MenuItem>
          ))}
        </>
      )}
    </div>,
    document.body,
  );
}

function MenuItem({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        background: "transparent",
        border: "none",
        padding: "6px 12px",
        fontSize: 13,
        color: "var(--foreground)",
        cursor: "pointer",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "var(--accent-light)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}

function TabTitleInput({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={handleKeyDown}
      size={Math.max(value.length, 1)}
      style={{
        background: "transparent",
        border: "none",
        outline: "none",
        padding: 0,
        margin: 0,
        fontSize: 13,
        lineHeight: "16px",
        fontFamily: "inherit",
        color: "inherit",
      }}
    />
  );
}

function DropIndicator({
  stripEl,
  tabRefs,
  tabs,
  index,
}: {
  stripEl: HTMLDivElement | null;
  tabRefs: Map<string, HTMLElement>;
  tabs: TabDef[];
  index: number;
}) {
  if (!stripEl) return null;
  const stripRect = stripEl.getBoundingClientRect();
  let x: number;
  if (tabs.length === 0) {
    x = 4;
  } else if (index <= 0) {
    const first = tabRefs.get(tabs[0].id);
    x = first ? first.getBoundingClientRect().left - stripRect.left - 1 : 4;
  } else if (index >= tabs.length) {
    const last = tabRefs.get(tabs[tabs.length - 1].id);
    x = last ? last.getBoundingClientRect().right - stripRect.left + 1 : 4;
  } else {
    const left = tabRefs.get(tabs[index - 1].id);
    const right = tabRefs.get(tabs[index].id);
    if (left && right) {
      const leftR = left.getBoundingClientRect();
      const rightR = right.getBoundingClientRect();
      x = (leftR.right + rightR.left) / 2 - stripRect.left - 1;
    } else {
      x = 4;
    }
  }
  return (
    <div
      style={{
        position: "absolute",
        top: 4,
        bottom: 0,
        left: x,
        width: 2,
        background: "var(--accent)",
        borderRadius: 1,
        pointerEvents: "none",
        zIndex: 20,
      }}
    />
  );
}
