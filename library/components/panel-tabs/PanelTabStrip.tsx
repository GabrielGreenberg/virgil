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
import { flushSync } from "react-dom";
import type { PanelKey } from "@library/hooks/useLibraryTabs";
import { ENTRY_DT_TYPE, TAB_DT_TYPE } from "@library/lib/dnd-types";
import { PanelFolderTab } from "./PanelFolderTab";

export type TabDef = {
  id: string;
  label: string;
  closable: boolean;
  renamable: boolean;
  icon?: ReactNode;
  /** When set, a vertical-dots trigger renders inside the tab on the left,
   *  opening a per-tab dropdown of the given items. */
  menu?: PanelMenuItem[];
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
  onDropEntry: (libId: string, entryKey: string) => void;
  /**
   * Ref to the surrounding library panel container (tab strip + list).
   * Used as the HTML5 drag image so dragging a tab visually carries the
   * whole library with it, preserving the bond between tab and content.
   */
  panelRef?: RefObject<HTMLDivElement | null>;
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
  onDropEntry,
  panelRef,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [tabMenuOpenId, setTabMenuOpenId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [entryDragOverTabId, setEntryDragOverTabId] = useState<string | null>(
    null,
  );

  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLElement>>(new Map());

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
    const entryKey = e.dataTransfer.getData(ENTRY_DT_TYPE);
    if (entryKey) {
      const tabId = findTabAtPosition(e.clientX, e.clientY);
      if (!tabId) return;
      e.preventDefault();
      setEntryDragOverTabId(null);
      onDropEntry(tabId, entryKey);
      return;
    }
  };


  const handleTabDragStart = (e: DragEvent<HTMLElement>, libId: string) => {
    // Activate the dragged tab synchronously so the panel re-renders to
    // show its library content BEFORE the browser captures the drag image
    // — that way the visual that follows the cursor matches the tab the
    // user picked up, even if a different tab was active before.
    if (libId !== activeId) {
      flushSync(() => onActivate(libId));
    }
    e.dataTransfer.setData(TAB_DT_TYPE, libId);
    e.dataTransfer.effectAllowed = "move";
    const panelEl = panelRef?.current;
    if (panelEl) {
      const rect = panelEl.getBoundingClientRect();
      e.dataTransfer.setDragImage(
        panelEl,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
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
        padding: "0 4px",
        background: "var(--library-bg)",
        flexShrink: 0,
        position: "relative",
        zIndex: 20,
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

        const setRef = (el: HTMLElement | null) => {
          if (el) tabRefs.current.set(tab.id, el);
          else tabRefs.current.delete(tab.id);
        };

        const dragProps = {
          draggable: !isEditing,
          onDragStart: (e: DragEvent<HTMLElement>) =>
            handleTabDragStart(e, tab.id),
          onDragEnd: handleTabDragEnd,
        };

        if (isActive) {
          return (
            <Fragment key={tab.id}>
              <PanelFolderTab
                ref={setRef}
                active
                fill="var(--surface)"
                title={tab.label}
                dataTabId={tab.id}
                wrapperProps={{
                  ...dragProps,
                  style: {
                    opacity: isDragging ? 0.5 : 1,
                    outline: isEntryDropTarget
                      ? "2px solid var(--accent)"
                      : undefined,
                    outlineOffset: isEntryDropTarget ? -2 : undefined,
                    borderRadius: isEntryDropTarget ? 8 : undefined,
                  },
                }}
              >
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
                  <CloseButton onClick={() => onClose(tab.id)} muted={false} />
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
            isEntryDropTarget={isEntryDropTarget}
            dragProps={dragProps}
            onClick={() => onActivate(tab.id)}
            onClose={() => onClose(tab.id)}
            menu={tab.menu}
            menuOpen={tabMenuOpenId === tab.id}
            onMenuToggle={() =>
              setTabMenuOpenId((prev) => (prev === tab.id ? null : tab.id))
            }
            onMenuClose={() => setTabMenuOpenId(null)}
          />
        );
      })}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <AddTabButton onClick={() => setMenuOpen((v) => !v)} />
        {menuOpen && (
          <AddTabMenu
            recent={recentLibraries}
            onNewLibrary={handleNewLibrary}
            onOpenRecent={handleOpenRecent}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
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
    isEntryDropTarget: boolean;
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
  }
>(function BackgroundTab(
  {
    tabId,
    label,
    closable,
    isDragging,
    isEntryDropTarget,
    dragProps,
    onClick,
    onClose,
    menu,
    menuOpen,
    onMenuToggle,
    onMenuClose,
  },
  ref,
) {
  const hasMenu = !!menu && menu.length > 0;
  return (
    <div
      ref={ref}
      {...dragProps}
      data-tab-id={tabId}
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        height: 32,
        opacity: isDragging ? 0.5 : 1,
        cursor: dragProps.draggable ? "grab" : "default",
        outline: isEntryDropTarget ? "2px solid var(--accent)" : "none",
        outlineOffset: isEntryDropTarget ? -2 : 0,
        borderRadius: isEntryDropTarget ? 6 : 0,
        background: isEntryDropTarget ? "var(--accent-light)" : "transparent",
        paddingRight: hasMenu && !closable ? 4 : 0,
      }}
    >
      <button
        type="button"
        onClick={onClick}
        title={label}
        style={{
          background: "transparent",
          border: "none",
          padding: closable || hasMenu ? "0 4px 0 14px" : "0 14px",
          height: 32,
          fontSize: 13,
          lineHeight: "16px",
          color: "var(--muted)",
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontFamily: "inherit",
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

function CloseButton({
  onClick,
  muted,
}: {
  onClick: () => void;
  muted: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title="Close tab"
      aria-label="Close tab"
      style={{
        flexShrink: 0,
        background: "transparent",
        border: "none",
        width: 18,
        height: 18,
        marginRight: 0,
        marginLeft: muted ? 4 : "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        lineHeight: 1,
        color: muted ? "var(--muted-light)" : "var(--muted)",
        cursor: "pointer",
        borderRadius: 3,
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

function AddTabButton({ onClick }: { onClick: () => void }) {
  return (
    <button
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
}

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
        type="button"
        onClick={(e) => {
          e.stopPropagation();
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
          borderRadius: 3,
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
      {open && (
        <PanelMenuPopup items={items} onClose={onClose} />
      )}
    </div>
  );
}

function PanelMenuPopup({
  items,
  onClose,
}: {
  items: PanelMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

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

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 2,
        minWidth: 180,
        background: "var(--surface)",
        border: "1px solid var(--border-light)",
        borderRadius: 6,
        boxShadow: "var(--pod-shadow)",
        padding: "4px 0",
        zIndex: 50,
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
    </div>
  );
}

function AddTabMenu({
  recent,
  onNewLibrary,
  onOpenRecent,
  onClose,
}: {
  recent: RecentLibrary[];
  onNewLibrary: () => void;
  onOpenRecent: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

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

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        marginTop: 2,
        minWidth: 200,
        background: "var(--surface)",
        border: "1px solid var(--border-light)",
        borderRadius: 6,
        boxShadow: "var(--pod-shadow)",
        padding: "4px 0",
        zIndex: 50,
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
    </div>
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
