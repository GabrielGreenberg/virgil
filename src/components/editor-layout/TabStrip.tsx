"use client";

import {
  memo,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import type { FsaDocMeta, ActivePaneKind } from "@/lib/doc-index";
import {
  OUTER_LIBRARY_PREFIX,
  OUTER_LIBRARY_ROOT_ID,
  OUTER_PAPER_PREFIX,
} from "@/lib/doc-index";
import type { Library } from "@library/lib/library-store";
import { ENTRY_DT_TYPE, LIBRARY_DT_TYPE, PAPER_DT_TYPE } from "@library/lib/dnd-types";
import { addEntryToLibraryGlobal } from "@library/lib/library-store";
import { IconLibrary, IconX } from "./panel-icons";
import { DocumentFolderTab } from "./DocumentFolderTab";
import { InlineTabLabel } from "./InlineTabLabel";
import { TabSeparator } from "./TabSeparator";
import { TabPlusMenu } from "../TabPlusMenu";
import { PaperDropIndicator } from "./PaperDropIndicator";

// Negative margins applied to the active folder-tab wrapper so promoting a
// tab from inline → folder keeps the surrounding strip pixel-stable. Kept
// in lockstep with the inline-label padding (see InlineTabLabel).
const ACTIVE_TAB_LEFT_SHIFT_PX = 18;
const ACTIVE_TAB_RIGHT_SHIFT_PX = 8;

export type TabStripProps = {
  /** Open docs (for TabPlusMenu + per-tab render). */
  docs: FsaDocMeta[];
  /** Stable, memoized array of open tab ids for TabPlusMenu. */
  openTabIds: string[];
  /** Render order of all outer tabs (Library root, papers, libraries, docs). */
  outerOrder: string[];
  /** Which outer pane kind is active. */
  activePane: ActivePaneKind;
  /** Active doc id (for the doc-tab folder/inline split). */
  currentDocId: string | null;
  /** Active library-outer id, when activePane === "library-outer". */
  currentLibraryOuterId: string | null;
  /** Active paper citekey, when activePane === "paper". */
  currentPaperCitekey: string | null;
  /** Custom-library registry (label lookup for library outer tabs). */
  libraryRegistry: Map<string, Library>;
  devStorage: boolean;

  // Inline-rename state (doc tabs).
  editingTabId: string | null;
  setEditingTabId: Dispatch<SetStateAction<string | null>>;
  nameInput: string;
  setNameInput: Dispatch<SetStateAction<string>>;
  nameInputRef: RefObject<HTMLInputElement | null>;

  // Strip refs + paper/library drop state.
  tabStripRef: RefObject<HTMLDivElement | null>;
  outerTabRefs: MutableRefObject<Map<string, HTMLElement>>;
  paperDropIndex: number | null;
  setPaperDropIndex: Dispatch<SetStateAction<number | null>>;
  entryDropOuterLibId: string | null;
  setEntryDropOuterLibId: Dispatch<SetStateAction<string | null>>;

  // Stable handlers (all useCallback-stable in useFiles / EditorLayout).
  onActivateDoc: (id: string) => void;
  onCloseDoc: (id: string) => void;
  onActivatePaper: (citekey: string) => void;
  onClosePaper: (citekey: string) => void;
  onActivateLibraryOuter: (libId: string) => void;
  onCloseLibraryOuter: (libId: string) => void;
  onRenameDoc: (id: string, name: string) => void;
  openPaperTab: (citekey: string, atIndex?: number) => void;
  openLibraryOuterTab: (libId: string, atIndex?: number) => void;

  // TabPlusMenu actions.
  onOpenRecent: (id: string) => void;
  onOpenFolder: () => void;
  onCreateNew: () => void;
  onOpenNewWindow: () => void;
};

function TabStripImpl(props: TabStripProps) {
  const {
    docs,
    openTabIds,
    outerOrder,
    activePane,
    currentDocId,
    currentLibraryOuterId,
    currentPaperCitekey,
    libraryRegistry,
    devStorage,
    editingTabId,
    setEditingTabId,
    nameInput,
    setNameInput,
    nameInputRef,
    tabStripRef,
    outerTabRefs,
    paperDropIndex,
    setPaperDropIndex,
    entryDropOuterLibId,
    setEntryDropOuterLibId,
    onActivateDoc,
    onCloseDoc,
    onActivatePaper,
    onClosePaper,
    onActivateLibraryOuter,
    onCloseLibraryOuter,
    onRenameDoc,
    openPaperTab,
    openLibraryOuterTab,
    onOpenRecent,
    onOpenFolder,
    onCreateNew,
    onOpenNewWindow,
  } = props;

  // Outer-tab strip render. Library root + the currently active entry render
  // as full DocumentFolderTab silhouettes; every other entry collapses to a
  // flat InlineTabLabel. A vertical separator slot sits between every pair of
  // non-Library tabs and is only painted when both neighbors are inline.
  const tabNodes: ReactNode[] = [];
  type PrevKind = "inline" | "folder" | null;
  let prevKind: PrevKind = null;
  const pushSeparator = (currentKind: "inline" | "folder", entryId: string) => {
    if (prevKind !== null) {
      const visible = prevKind === "inline" && currentKind === "inline";
      tabNodes.push(<TabSeparator key={`sep-${entryId}`} visible={visible} />);
    }
  };
  for (const entryId of outerOrder) {
    if (entryId === OUTER_LIBRARY_ROOT_ID) {
      const isActive =
        activePane === "library-outer" &&
        currentLibraryOuterId === OUTER_LIBRARY_ROOT_ID;
      if (isActive) {
        pushSeparator("folder", entryId);
        tabNodes.push(
          <div
            key={entryId}
            ref={(el) => {
              if (el) outerTabRefs.current.set(entryId, el);
              else outerTabRefs.current.delete(entryId);
            }}
            className="flex items-end shrink-0"
          >
            <DocumentFolderTab
              active
              fill="var(--library-bg)"
              dataPrefs="libraryBg,topbarBorder"
              title="Library"
              onClick={() => {}}
            >
              <IconLibrary />
              <span className="text-[13px] leading-4 mr-2.5">Library</span>
            </DocumentFolderTab>
          </div>,
        );
        prevKind = "folder";
      } else {
        pushSeparator("inline", entryId);
        tabNodes.push(
          <div
            key={entryId}
            ref={(el) => {
              if (el) outerTabRefs.current.set(entryId, el);
              else outerTabRefs.current.delete(entryId);
            }}
            className="self-center shrink-0"
          >
            <InlineTabLabel
              id={OUTER_LIBRARY_ROOT_ID}
              icon={<IconLibrary />}
              label="Library"
              title="Library"
              variant="library-pinned"
              onActivate={onActivateLibraryOuter}
            />
          </div>,
        );
        prevKind = "inline";
      }
      continue;
    }

    if (entryId.startsWith(OUTER_PAPER_PREFIX)) {
      const citekey = entryId.slice(OUTER_PAPER_PREFIX.length);
      const isActive =
        activePane === "paper" && currentPaperCitekey === citekey;
      if (isActive) {
        pushSeparator("folder", entryId);
        tabNodes.push(
          <div
            key={entryId}
            ref={(el) => {
              if (el) outerTabRefs.current.set(entryId, el);
              else outerTabRefs.current.delete(entryId);
            }}
            className="flex items-end shrink-0"
            style={{
              marginLeft: -ACTIVE_TAB_LEFT_SHIFT_PX,
              marginRight: -ACTIVE_TAB_RIGHT_SHIFT_PX,
            }}
          >
            <DocumentFolderTab
              active
              fill="var(--background)"
              dataPrefs="background,topbarBorder"
              title={citekey}
              onClick={() => {}}
            >
              <span
                className="text-[13px] leading-4 truncate min-w-0"
                style={{ fontFamily: "var(--mono)" }}
              >
                {citekey}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePaper(citekey);
                }}
                className="topbarbtn topbarbtn-icon"
                data-hint="Close tab"
              >
                <IconX />
              </button>
            </DocumentFolderTab>
          </div>,
        );
        prevKind = "folder";
      } else {
        pushSeparator("inline", entryId);
        tabNodes.push(
          <div
            key={entryId}
            ref={(el) => {
              if (el) outerTabRefs.current.set(entryId, el);
              else outerTabRefs.current.delete(entryId);
            }}
            className="self-center shrink-0"
          >
            <InlineTabLabel
              id={citekey}
              label={citekey}
              title={citekey}
              monospace
              onActivate={onActivatePaper}
              onClose={onClosePaper}
            />
          </div>,
        );
        prevKind = "inline";
      }
      continue;
    }

    if (entryId.startsWith(OUTER_LIBRARY_PREFIX)) {
      const libId = entryId.slice(OUTER_LIBRARY_PREFIX.length);
      const isActive =
        activePane === "library-outer" && currentLibraryOuterId === libId;
      const lib = libraryRegistry.get(libId);
      const label = lib?.label ?? libId;
      // Entry drops are accepted on custom libraries only — Central / Project /
      // paper compute their membership and can't be appended to.
      const acceptsEntryDrop = lib?.kind === "custom";
      const isEntryDropTarget =
        acceptsEntryDrop && entryDropOuterLibId === libId;
      const dropHandlers = {
        onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
          if (!acceptsEntryDrop) return;
          const types = e.dataTransfer.types;
          let hasEntry = false;
          for (let i = 0; i < types.length; i++) {
            if (types[i] === ENTRY_DT_TYPE) { hasEntry = true; break; }
          }
          if (!hasEntry) return;
          e.preventDefault();
          e.stopPropagation(); // beat the strip-level paper-tab handler
          e.dataTransfer.dropEffect = "copy";
          if (entryDropOuterLibId !== libId) setEntryDropOuterLibId(libId);
        },
        onDragLeave: (e: React.DragEvent<HTMLDivElement>) => {
          const next = e.relatedTarget as Node | null;
          if (next && (e.currentTarget as HTMLElement).contains(next)) return;
          if (entryDropOuterLibId === libId) setEntryDropOuterLibId(null);
        },
        onDrop: (e: React.DragEvent<HTMLDivElement>) => {
          if (!acceptsEntryDrop) return;
          const entryKey = e.dataTransfer.getData(ENTRY_DT_TYPE);
          if (!entryKey) return;
          e.preventDefault();
          e.stopPropagation();
          setEntryDropOuterLibId(null);
          addEntryToLibraryGlobal(libId, entryKey);
        },
      };
      const dropStyle = {
        outline: isEntryDropTarget
          ? "2px solid var(--accent)"
          : undefined,
        outlineOffset: isEntryDropTarget ? -2 : undefined,
        borderRadius: isEntryDropTarget ? 8 : undefined,
        background: isEntryDropTarget
          ? "var(--accent-light)"
          : undefined,
      };
      if (isActive) {
        pushSeparator("folder", entryId);
        tabNodes.push(
          <div
            key={entryId}
            ref={(el) => {
              if (el) outerTabRefs.current.set(entryId, el);
              else outerTabRefs.current.delete(entryId);
            }}
            className="flex items-end shrink-0"
            {...dropHandlers}
            style={{
              ...dropStyle,
              marginLeft: -ACTIVE_TAB_LEFT_SHIFT_PX,
              marginRight: -ACTIVE_TAB_RIGHT_SHIFT_PX,
            }}
          >
            <DocumentFolderTab
              active
              fill="var(--library-bg)"
              dataPrefs="libraryBg,topbarBorder"
              title={label}
              onClick={() => {}}
            >
              <IconLibrary />
              <span className="text-[13px] leading-4 truncate min-w-0">
                {label}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseLibraryOuter(libId);
                }}
                className="topbarbtn topbarbtn-icon"
                data-hint="Close tab"
              >
                <IconX />
              </button>
            </DocumentFolderTab>
          </div>,
        );
        prevKind = "folder";
      } else {
        pushSeparator("inline", entryId);
        tabNodes.push(
          <div
            key={entryId}
            ref={(el) => {
              if (el) outerTabRefs.current.set(entryId, el);
              else outerTabRefs.current.delete(entryId);
            }}
            className="self-center shrink-0"
            {...dropHandlers}
            style={dropStyle}
          >
            <InlineTabLabel
              id={libId}
              icon={<IconLibrary />}
              label={label}
              title={label}
              onActivate={onActivateLibraryOuter}
              onClose={onCloseLibraryOuter}
            />
          </div>,
        );
        prevKind = "inline";
      }
      continue;
    }

    const doc = docs.find((d) => d.id === entryId);
    if (!doc) continue;
    const isCurrentDoc = doc.id === currentDocId;
    const isDocPaneActive = isCurrentDoc && activePane === "doc";
    const composedDefault = `${doc.folderName}: ${doc.texFilename}`;
    const displayName =
      doc.name && doc.name !== doc.folderName ? doc.name : composedDefault;
    if (isDocPaneActive) {
      const isEditing = editingTabId === doc.id;
      const commit = () => {
        const next = nameInput.trim();
        if (next && next !== displayName) onRenameDoc(doc.id, next);
        setEditingTabId(null);
      };
      pushSeparator("folder", doc.id);
      tabNodes.push(
        <div
          key={doc.id}
          ref={(el) => {
            if (el) outerTabRefs.current.set(doc.id, el);
            else outerTabRefs.current.delete(doc.id);
          }}
          className="flex items-end shrink-0"
          style={{
            marginLeft: -ACTIVE_TAB_LEFT_SHIFT_PX,
            marginRight: -ACTIVE_TAB_RIGHT_SHIFT_PX,
          }}
        >
          <DocumentFolderTab
            active
            fill="var(--main-tab-bg)"
            dataPrefs="backgroundColor,topbarBorder"
            title={displayName}
            onClick={() => {
              if (isEditing) return;
            }}
          >
            {isEditing ? (
              <input
                ref={nameInputRef}
                type="text"
                value={nameInput}
                size={Math.max(nameInput.length + 1, 8)}
                onChange={(e) => setNameInput(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingTabId(null);
                  }
                }}
                onBlur={commit}
                className="text-[13px] leading-4 bg-transparent outline-none border-b border-ink-muted min-w-0 px-0"
              />
            ) : (
              <span
                className="text-[13px] leading-4 truncate min-w-0"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setNameInput(displayName);
                  setEditingTabId(doc.id);
                }}
              >
                {displayName}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onCloseDoc(doc.id); }}
              className="topbarbtn topbarbtn-icon"
              data-hint="Close tab"
            >
              <IconX />
            </button>
          </DocumentFolderTab>
        </div>,
      );
      prevKind = "folder";
    } else {
      pushSeparator("inline", doc.id);
      tabNodes.push(
        <div
          key={doc.id}
          ref={(el) => {
            if (el) outerTabRefs.current.set(doc.id, el);
            else outerTabRefs.current.delete(doc.id);
          }}
          className="self-center shrink-0"
        >
          <InlineTabLabel
            id={doc.id}
            label={displayName}
            title={displayName}
            onActivate={onActivateDoc}
            onClose={onCloseDoc}
          />
        </div>,
      );
      prevKind = "inline";
    }
  }

  return (
    <div
      ref={tabStripRef}
      className="flex items-end flex-1 min-w-0 gap-0.5 px-2 self-stretch relative"
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        let acceptable = false;
        for (let i = 0; i < types.length; i++) {
          if (types[i] === PAPER_DT_TYPE || types[i] === LIBRARY_DT_TYPE) {
            acceptable = true;
            break;
          }
        }
        if (!acceptable) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        // Insertion index = first outer-tab whose midpoint is right of cursor.
        let idx = outerOrder.length;
        for (let i = 0; i < outerOrder.length; i++) {
          const el = outerTabRefs.current.get(outerOrder[i]);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (e.clientX < r.left + r.width / 2) { idx = i; break; }
        }
        if (paperDropIndex !== idx) setPaperDropIndex(idx);
      }}
      onDragLeave={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && tabStripRef.current?.contains(next)) return;
        setPaperDropIndex(null);
      }}
      onDrop={(e) => {
        const citekey = e.dataTransfer.getData(PAPER_DT_TYPE);
        const libId = e.dataTransfer.getData(LIBRARY_DT_TYPE);
        if (!citekey && !libId) return;
        e.preventDefault();
        const dropIdx = paperDropIndex ?? outerOrder.length;
        setPaperDropIndex(null);
        if (citekey) {
          // Paper tearout (move): close the donor inner tab first so the paper
          // exists in only one place. We defer activating the new outer paper
          // tab to the next macrotask so React processes the inner-tab close +
          // persist BEFORE switching activePane to "paper".
          window.dispatchEvent(
            new CustomEvent("virgil-library-close-paper-tab", {
              detail: { citekey },
            }),
          );
          setTimeout(() => openPaperTab(citekey, dropIdx), 0);
          return;
        }
        // Library copy: donor inner tab stays put. Just spawn the outer tab
        // synchronously and activate it.
        openLibraryOuterTab(libId, dropIdx);
      }}
    >
      <TabPlusMenu
        docs={docs}
        openTabIds={openTabIds}
        onOpenRecent={onOpenRecent}
        onOpenFolder={onOpenFolder}
        onCreateNew={onCreateNew}
        onOpenNewWindow={onOpenNewWindow}
        devStorage={devStorage}
      />
      {tabNodes}
      {paperDropIndex !== null && (
        /* Live geometry read by design: the drop indicator measures the strip +
           tab rects at paint time, and this branch only renders while a drag is
           active (paperDropIndex != null). Reading the refs during render is the
           intended behaviour (carried over verbatim from the inline original) —
           the rule flags it as a false positive here. */
        /* eslint-disable react-hooks/refs */
        <PaperDropIndicator
          stripEl={tabStripRef.current}
          tabRefs={outerTabRefs.current}
          order={outerOrder}
          index={paperDropIndex}
        />
        /* eslint-enable react-hooks/refs */
      )}
      {/* Zero-width sentinel marking the end of the top-bar's left content
          (tabs + logo + "+" button). The floating MenuBar's home position
          uses this x-coordinate as its left clamp — measuring the flex-1
          parent's right edge would be wrong because flex-1 expands to fill
          the whole middle gap. */}
    </div>
  );
}

export const TabStrip = memo(TabStripImpl);
