"use client";

import {
  memo,
  useCallback,
  useRef,
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
import { FONT_MONO } from "@/lib/font-stacks";
import {
  FOLDER_TAB_SEAM_OVERLAP,
  FOLDER_TAB_VARIANTS,
  TAB_LABEL_MAX_PX,
} from "@/components/chrome/folder-tab-geometry";
import {
  TAB_LABEL_ATTRS,
  TAB_STRIP_SCROLLER_STYLE,
  autoScrollForDrag,
  tabStripSeamPadding,
  useTabStripScroller,
} from "@/components/chrome/tab-strip-occupancy";
import { iconHint } from "@/components/Hint";

// Negative margins applied to the active folder-tab wrapper so promoting a
// tab from inline → folder keeps the surrounding strip pixel-stable. Kept
// in lockstep with the inline-label padding (see InlineTabLabel).
const ACTIVE_TAB_LEFT_SHIFT_PX = 18;
const ACTIVE_TAB_RIGHT_SHIFT_PX = 8;

// The scroller's trailing slack (px): a LAST active tab's border box extends
// past its own margin box by ACTIVE_TAB_RIGHT_SHIFT_PX (the negative margin
// above) plus the topbar cap's 1px stroke overhang. Inside a scroll
// container that protrusion would be 9px of scrollable overflow — a strip
// that "overflows" by a hair with every tab in view, and a phantom scroll
// range. As the scroller's own padding it is inside the padding box, which a
// scroll container never counts as overflow. (Pre-561 the strip's `px-2`
// absorbed 8 of the 9 and clipped the cap's last column.)
const TAB_ROW_END_SLACK_PX =
  ACTIVE_TAB_RIGHT_SHIFT_PX + FOLDER_TAB_VARIANTS.topbar.capRightOverhang;

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
  onOpenExample: () => void;
  onResetExample: () => void;
  onOpenNewWindow: () => void;
  /** Whether the bundled example doc can be offered (OPFS + not dev backend). */
  exampleAvailable: boolean;

  // ── Bar occupancy (task 395) ──────────────────────────────────────────
  // The two boxes `useBarOccupancy` measures for the bar's ONE width
  // negotiation (see bar-occupancy.ts). Optional so a bare mount (tests,
  // a future host) renders identically with the rule inert.
  /** Ref callback for the strip's SCROLLER box — the tab row's ASSIGNED
   *  width (the strip minus the pinned "+"). */
  stripMeasureRef?: (el: HTMLElement | null) => void;
  /** Ref callback for the tab ROW — measured for its NATURAL width, which
   *  `tabRowNaturalWidth` recovers from the row even while it is compressed. */
  tabsMeasureRef?: (el: HTMLElement | null) => void;
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
    stripMeasureRef,
    tabsMeasureRef,
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
    onOpenExample,
    onResetExample,
    onOpenNewWindow,
    exampleAvailable,
  } = props;

  // ONE stable composed ref for the strip's SCROLLER: the scroll hook's own
  // RefObject plus the bar-occupancy measure callback. Deliberately NOT an
  // inline arrow — React detaches and re-attaches an unstable ref callback on
  // every render, and this one's detach DROPS the strip's measurement, so an
  // inline arrow makes an ordinary re-render look like "the tab strip left the
  // bar" and can bounce the occupancy verdict against its own re-renders.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollerMeasureRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      stripMeasureRef?.(el);
    },
    [stripMeasureRef],
  );

  // Which entry of `outerOrder` is the active one — the key the scroll ladder
  // keeps in view. Same vocabulary the render loop below keys `outerTabRefs`
  // by: the Library root by its singleton id, papers/libraries by their
  // prefixed ids, documents by doc id.
  const activeKey =
    activePane === "doc"
      ? currentDocId
      : activePane === "paper"
        ? currentPaperCitekey !== null
          ? OUTER_PAPER_PREFIX + currentPaperCitekey
          : null
        : currentLibraryOuterId === null
          ? null
          : currentLibraryOuterId === OUTER_LIBRARY_ROOT_ID
            ? OUTER_LIBRARY_ROOT_ID
            : OUTER_LIBRARY_PREFIX + currentLibraryOuterId;

  // The scroll half of the occupancy ladder (task 561): active tab kept in
  // view on activation / open / close / resize, vertical wheel → horizontal.
  useTabStripScroller({
    scrollerRef,
    tabRefs: outerTabRefs,
    activeKey,
    tabCount: outerOrder.length,
  });

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
              fill="var(--library-bg)"
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
            // The Library root is the strip's one PINNED tab (Chrome's
            // pinned tabs): it never compresses, so its `library-pinned`
            // padding — which pre-reserves the folder silhouette's footprint
            // — is never squeezed under its own label.
            className="self-end mb-[3px] shrink-0"
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
              fill="var(--background)"
              title={citekey}
              onClick={() => {}}
            >
              <span
                {...TAB_LABEL_ATTRS}
                className="text-[13px] leading-4 truncate min-w-0"
                style={{ fontFamily: FONT_MONO, maxWidth: TAB_LABEL_MAX_PX }}
              >
                {citekey}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePaper(citekey);
                }}
                className="topbarbtn topbarbtn-icon"
                {...iconHint({ label: "Close tab" })}
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
            // COMPRESSIBLE (task 561): `shrink` (flex 0 1 auto) with the
            // automatic flex minimum, which is this tab's fixed chrome plus
            // the shared label floor (InlineTabLabel). Inactive tabs yield
            // first; the active tab is `shrink-0` and resists.
            className="self-end mb-[3px] shrink"
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
        borderRadius: isEntryDropTarget ? "var(--pod-radius)" : undefined,
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
              fill="var(--library-bg)"
              title={label}
              onClick={() => {}}
            >
              <IconLibrary />
              <span
                {...TAB_LABEL_ATTRS}
                className="text-[13px] leading-4 truncate min-w-0"
                style={{ maxWidth: TAB_LABEL_MAX_PX }}
              >
                {label}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseLibraryOuter(libId);
                }}
                className="topbarbtn topbarbtn-icon"
                {...iconHint({ label: "Close tab" })}
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
            className="self-end mb-[3px] shrink"
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
            fill="var(--main-tab-bg)"
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
                // The same cap the label it replaces carries: `size` grows the
                // input with the typed name, and past the strip's clip the
                // user would be typing blind with no scroll to follow them.
                style={{ maxWidth: TAB_LABEL_MAX_PX }}
                className="text-[13px] leading-4 bg-transparent outline-none border-b border-ink-muted min-w-0 px-0"
              />
            ) : (
              <span
                {...TAB_LABEL_ATTRS}
                className="text-[13px] leading-4 truncate min-w-0"
                // The bar-wide label cap (task 395). `max-width` clamps the
                // span's max-content CONTRIBUTION, so the tab's
                // `calc-size(max-content, …)` width follows it — an active tab
                // with a long composed name can no longer grow without bound
                // and push the tab row across the status cluster. Same value
                // the inline (inactive) twin has always used.
                style={{ maxWidth: TAB_LABEL_MAX_PX }}
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
              {...iconHint({ label: "Close tab" })}
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
          className="self-end mb-[3px] shrink"
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
      className="flex items-end flex-1 min-w-0 gap-0.5 pl-2 self-stretch relative"
      // ── The bar's structural FLOOR, and the occupancy ladder under it ──
      // (task 395, renegotiated by 561.) The tabs are TIER 2 of the bar's
      // ladder (bar-occupancy.ts): when they and the collapsible tools cannot
      // both fit, the tools yield FIRST. When the tabs still do not fit after
      // that, this strip degrades in a stated order rather than clipping —
      // tab-strip-occupancy.ts, shared with the Library's inner strip:
      // COMPRESS (inactive tabs share the width and ellipsize to a floor; the
      // active tab resists) → SCROLL (the SCROLLER below is `overflow-x: auto`
      // with a hidden scrollbar, and the active tab is always nudged into
      // view). The floor is still structural: a scroll container clips, so
      // the tab row can never paint over the status cluster's protected
      // data-integrity badges, whatever the rule decides — and this ROOT
      // never overflows (its only flex children are the pinned "+" and the
      // `min-w-0 flex-1` scroller), so it needs no clip of its own. It stays
      // `position: relative` because the drop indicator is positioned
      // against it (see below).
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
        // Viewport rects, so this is correct at any scrollLeft.
        let idx = outerOrder.length;
        for (let i = 0; i < outerOrder.length; i++) {
          const el = outerTabRefs.current.get(outerOrder[i]);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (e.clientX < r.left + r.width / 2) { idx = i; break; }
        }
        if (paperDropIndex !== idx) setPaperDropIndex(idx);
        // Edge-zone auto-scroll (after the reads above, so the write never
        // sits between two of the gesture's own rect reads).
        if (scrollerRef.current) autoScrollForDrag(scrollerRef.current, e.clientX);
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
      {/* The "+" is an ACTION, not a tab: it stays PINNED outside the
          scroller, so a crowded strip can never scroll it out of reach. */}
      <TabPlusMenu
        docs={docs}
        openTabIds={openTabIds}
        currentDocId={currentDocId}
        onOpenRecent={onOpenRecent}
        onOpenFolder={onOpenFolder}
        onCreateNew={onCreateNew}
        onOpenExample={onOpenExample}
        onResetExample={onResetExample}
        onOpenNewWindow={onOpenNewWindow}
        devStorage={devStorage}
        exampleAvailable={exampleAvailable}
      />
      {/* The SCROLLER (task 561): the tab row's ASSIGNED box, and the one the
          occupancy rule measures as `tabStripPx`. `overflow-x: auto` with the
          scrollbar hidden; `overflow-y` stated `hidden` explicitly (per CSS
          Overflow 3 an unstated `visible` axis would be coerced to `auto` and
          grow a 1px vertical scroll range from the active tab's seam
          overhang). The overhang is kept INSIDE the clip by the seam
          padding/margin pair instead — the mechanism the inner strip has
          carried since task 324 — so the active folder tab still hangs
          FOLDER_TAB_SEAM_OVERLAP below the bar and merges into the canvas.
          `self-stretch` fills the bar height so the tabs stay at the seam
          (task 289). */}
      <div
        ref={scrollerMeasureRef}
        data-bar-occupant="tab-strip"
        className="flex items-end flex-1 min-w-0 self-stretch"
        style={{
          ...TAB_STRIP_SCROLLER_STYLE,
          ...tabStripSeamPadding(FOLDER_TAB_SEAM_OVERLAP),
          paddingRight: TAB_ROW_END_SLACK_PX,
        }}
      >
        {/* The tab ROW. `width: max-content` capped at the scroller's width
            (`max-width: 100%`, `min-w-0`): ROOMY, its box IS the tabs'
            natural width; CROWDED, it sits at the scroller's width and its
            flexible children compress — inactive wrappers `shrink`, the
            active one `shrink-0` — and past their floors the tabs overflow it
            into the scroller's scroll range. The occupancy rule recovers the
            NATURAL width from this element in every regime
            (`tabRowNaturalWidth`, tab-strip-occupancy.ts) — never the
            compressed box, which would make the tools decompress the tabs by
            expanding and oscillate (bar-occupancy.ts). It adds no layout of
            its own: the strip's `items-end` + `gap-0.5`, and a
            bottom-aligned item's negative margin resolves identically one
            level in. */}
        <div
          ref={tabsMeasureRef}
          data-bar-occupant="tabs"
          className="flex items-end gap-0.5 min-w-0"
          style={{ width: "max-content", maxWidth: "100%" }}
        >
          {tabNodes}
        </div>
      </div>
      {paperDropIndex !== null && (
        /* Live geometry read by design: the drop indicator measures the strip +
           tab rects at paint time, and this branch only renders while a drag is
           active (paperDropIndex != null). Reading the refs during render is the
           intended behaviour (carried over verbatim from the inline original) —
           the rule flags it as a false positive here. It is a child of this
           NON-scrolling root, clamped to the scroller's visible span, so it is
           visible for a drop past the scrolled-out boundary too. */
        /* eslint-disable react-hooks/refs */
        <PaperDropIndicator
          stripEl={tabStripRef.current}
          scrollerEl={scrollerRef.current}
          tabRefs={outerTabRefs.current}
          order={outerOrder}
          index={paperDropIndex}
        />
        /* eslint-enable react-hooks/refs */
      )}
      {/* (Retired, task 395.) A comment here described a "zero-width sentinel"
          marking the end of the bar's left content, read as the left clamp of
          the floating MenuBar's home position. There was never an element:
          the pod that read a clamp was retired when the MenuBar moved into the
          pod chrome header (93b286c0) and its `menuLocation` pref was deleted
          as dead (bab3a399), and the prose outlived the mechanism. What holds
          the "tabs and tools never overlap" invariant now is the pair above —
          the measured occupancy rule in bar-occupancy.ts and the scroller's
          own clip — both of which are code. */}
    </div>
  );
}

export const TabStrip = memo(TabStripImpl);
