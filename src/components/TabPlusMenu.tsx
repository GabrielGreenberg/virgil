"use client";

/**
 * The "+" affordance at the end of the tab strip in the Virgil bar.
 * Clicking it opens a dropdown with:
 *   - Recent papers (excluding ones already open as tabs)
 *   - Open folder…  (calls showDirectoryPicker via the parent)
 *   - Create new document…
 *   - New Virgil window (when cross-window plumbing is supported)
 *
 * Selecting a Recent row calls onOpenRecent(id). The parent (useFiles
 * via EditorLayout) is responsible for permission re-grant before
 * activating; the row click is a valid user gesture, so the requestRW
 * path inside the parent runs on the gesture stack as required.
 *
 * ── MENU-PRIMITIVE MIGRATION (Phase C) ──
 * Migrated onto the `<Menu>` primitive (`src/components/menu/`, design
 * `docs/agents/menu-system-design.md` §4 "TabPlusMenu — clean"). The body
 * dropdown now renders via `<MenuProvider layout="list" role="menu" portal>`,
 * which owns positioning (`useFloatingMenuPosition`), the click-outside +
 * Escape dismissal, and the keyboard controller. Each recent-paper row and
 * action row registers via `useMenuItem` + spreads `getItemProps()` onto its
 * existing button, so the menu GAINS Up/Down/Home/End/Enter/Space arrow nav
 * with a visible `data-active` highlight (and `aria-activedescendant` with no
 * focus theft). The "+" trigger is added to `excludeRefs` so it can toggle the
 * menu without click-outside self-closing it; the scroll/resize anchor refresh
 * rides the provider's `trackAnchor` option. Behavior is otherwise identical.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FsaDocMeta } from "@/lib/doc-index";
import { EXAMPLE_DOC_ID } from "@/lib/example-doc/example-identity";
import { ensureRW } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import { multiWindowSupported } from "@/lib/multi-window/bus";
import {
  RECENT_PAPERS_MENU_LIMIT,
  selectRecentDocs,
} from "@/lib/recent-docs";
import { IconPlus } from "./editor-layout/panel-icons";
import { Kbd } from "./Kbd";
import { MenuProvider } from "./menu/MenuProvider";
import { ANCHORED_MENU_PLACEMENTS } from "./menu/AnchoredMenu";
import { useMenuItem } from "./menu/useMenuItem";
import { iconHint } from "@/components/Hint";

interface Props {
  docs: FsaDocMeta[];
  openTabIds: string[];
  currentDocId: string | null;
  onOpenRecent: (id: string) => void;
  onOpenFolder: () => void;
  onCreateNew: () => void;
  onOpenExample: () => void;
  onResetExample: () => void;
  onOpenNewWindow: () => void;
  devStorage: boolean;
  /** Whether the bundled example doc can be offered here (OPFS available
   *  and not the dev backend). */
  exampleAvailable: boolean;
}

// Drop below the trigger, flip above near the viewport bottom — the ONE
// button-anchored placement vocabulary, shared with `<AnchoredMenu>` so a
// fourth copy of this table cannot drift from the other three.
const TAB_PLUS_PLACEMENTS = ANCHORED_MENU_PLACEMENTS.start;

export function TabPlusMenu({
  docs,
  openTabIds,
  currentDocId,
  onOpenRecent,
  onOpenFolder,
  onCreateNew,
  onOpenExample,
  onResetExample,
  onOpenNewWindow,
  devStorage,
  exampleAvailable,
}: Props) {
  const [open, setOpen] = useState(false);
  const [canMultiWindow, setCanMultiWindow] = useState(false);
  // Anchor rect for the body-portaled dropdown (captured from the "+"
  // button). Null when closed.
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // The wrap element is held in STATE (not a ref) so it can be passed to the
  // provider's `excludeRefs` without reading a ref during render (React
  // Compiler's react-hooks/refs rule). A callback ref captures it on mount.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Feature-detect cross-window plumbing on the client. Hidden for
  // Safari (no BroadcastChannel-backed lock semantics) so users don't
  // see a menu item that wouldn't work coherently.
  useEffect(() => {
    setCanMultiWindow(multiWindowSupported());
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setAnchorRect(null);
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      const next = !o;
      setAnchorRect(next ? (btnRef.current?.getBoundingClientRect() ?? null) : null);
      return next;
    });
  }, []);

  // Scroll/resize re-anchor — the provider's `trackAnchor` RAF-coalesces this
  // re-read of the "+" button rect so the dropdown tracks the sticky bar if the
  // viewport shifts (replaces the bespoke resize/scroll listeners).
  const trackAnchor = useCallback(
    () => btnRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  const recents = selectRecentDocs(docs, {
    excludeIds: openTabIds,
    limit: RECENT_PAPERS_MENU_LIMIT,
  });

  const handleRecentClick = useCallback(
    async (id: string) => {
      // In FSA mode, we must call requestPermission inside the gesture
      // stack — keep this path synchronous-up-to-the-await.
      if (!devStorage) {
        const handle = await getDocHandle(id);
        if (handle) {
          const ok = await ensureRW(handle);
          if (!ok) {
            close();
            return;
          }
        }
      }
      onOpenRecent(id);
      close();
    },
    [devStorage, onOpenRecent, close],
  );

  const menu = open && anchorRect && typeof document !== "undefined" && (
    <MenuProvider
      id="tab-plus"
      layout="list"
      role="menu"
      portal
      anchorRect={anchorRect}
      placements={TAB_PLUS_PLACEMENTS}
      gap={4}
      trackAnchor={trackAnchor}
      // The portaled menu lives outside the wrap element, so the "+" trigger
      // must be an explicit click-outside exemption — otherwise the toggle's own
      // click would land "outside" and immediately self-close the menu it just
      // opened.
      excludeRefs={[wrapEl]}
      onClose={close}
      ariaLabel="Open paper or create new"
      containerClassName="min-w-[280px] py-1.5"
    >
      {recents.length > 0 && (
        <>
          <div className="text-[11px] uppercase tracking-wide text-ink-subtle px-3 pt-1 pb-1">
            Recent
          </div>
          <div className="px-1 flex flex-col gap-0.5">
            {recents.map((doc) => (
              <RecentRowItem
                key={doc.id}
                doc={doc}
                onOpen={handleRecentClick}
              />
            ))}
          </div>
          <div aria-hidden className="my-1.5 mx-2 h-px bg-edge-hover/50" />
        </>
      )}
      {!devStorage && (
        <MenuActionItem
          id="open-folder"
          label="Open folder…"
          run={() => {
            onOpenFolder();
            close();
          }}
        >
          <FolderIcon />
        </MenuActionItem>
      )}
      <MenuActionItem
        id="create-new"
        label="Create new document…"
        run={() => {
          onCreateNew();
          close();
        }}
      >
        <PlusIcon />
      </MenuActionItem>
      {exampleAvailable && (
        <MenuActionItem
          id="open-example"
          label="Open example document"
          run={() => {
            onOpenExample();
            close();
          }}
        >
          <ExampleIcon />
        </MenuActionItem>
      )}
      {exampleAvailable && currentDocId === EXAMPLE_DOC_ID && (
        <MenuActionItem
          id="reset-example"
          label="Reset example document"
          run={() => {
            onResetExample();
            close();
          }}
        >
          <ResetIcon />
        </MenuActionItem>
      )}
      {canMultiWindow && (
        <>
          <div aria-hidden className="my-1.5 mx-2 h-px bg-edge-hover/50" />
          <MenuActionItem
            id="new-window"
            label="New Virgil window"
            shortcut="Mod+Shift+N"
            run={() => {
              onOpenNewWindow();
              close();
            }}
          >
            <WindowIcon />
          </MenuActionItem>
        </>
      )}
    </MenuProvider>
  );

  return (
    <div
      ref={setWrapEl}
      // self-end mb-[3px]: seam-anchor the "+" to the bar's bottom edge (was
      // self-center, which floated it UP to seam−H/2 as the WCO bar grew taller,
      // above the seam-anchored tab titles). The 24px topbarbtn + mb-[3px] lands
      // the icon's optical center at seam−15, matching the tab titles (task 094)
      // and the StatusCluster icons — one shared bar baseline (task 289).
      className="self-end mb-[3px] inline-flex"
    >
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="topbarbtn topbarbtn-icon"
        style={{ padding: "0 4px" }}
        {...iconHint({ label: "Open paper or create new" })}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconPlus />
      </button>
      {menu}
    </div>
  );
}

/**
 * A recent-paper row registered as a menu item. Reuses the same visual the
 * shared `RecentPaperRow` paints (folder icon + name/subtitle + relative time)
 * but carries the primitive's `getItemProps()` so it joins the roving nav
 * snapshot with a `data-active` highlight. `run` = the existing open handler.
 */
function RecentRowItem({
  doc,
  onOpen,
}: {
  doc: FsaDocMeta;
  onOpen: (id: string) => void;
}) {
  const { active, getItemProps } = useMenuItem({
    id: `recent-${doc.id}`,
    region: "list",
    run: () => onOpen(doc.id),
  });
  const subtitle =
    doc.folderName && doc.folderName !== doc.name ? doc.folderName : null;
  return (
    <button
      {...getItemProps()}
      type="button"
      className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover-on-light text-left"
      style={{
        background: active ? "var(--menu-roving-bg)" : undefined,
      }}
    >
      <FolderIcon />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-sm text-ink-strong truncate">{doc.name}</span>
        {subtitle && (
          <span className="text-[11px] text-ink-subtle truncate">
            {subtitle}
          </span>
        )}
      </span>
      <span className="text-[11px] text-ink-subtle shrink-0">
        {formatRelative(doc.lastAccessedAt)}
      </span>
    </button>
  );
}

/**
 * An action row (Open folder… / Create new… / New window). Registered as a menu
 * item so arrow nav + Enter/Space reach it; `run` = the row's existing handler.
 */
function MenuActionItem({
  id,
  label,
  run,
  children,
  shortcut,
}: {
  id: string;
  label: string;
  run: () => void;
  children: ReactNode;
  shortcut?: string;
}) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run });
  return (
    <button
      {...getItemProps()}
      type="button"
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-ink-strong hover-on-light text-left"
      style={{
        background: active ? "var(--menu-roving-bg)" : undefined,
      }}
    >
      {children}
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd keys={shortcut} />}
    </button>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const y = Math.floor(d / 365);
  return `${y}y ago`;
}

function WindowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-subtle shrink-0"
    >
      <rect x="3" y="4" width="13" height="11" rx="1.5" />
      <rect x="8" y="9" width="13" height="11" rx="1.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-subtle shrink-0"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="text-ink-subtle shrink-0"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function ExampleIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-subtle shrink-0"
    >
      <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H17l3 3v13.5A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5z" />
      <path d="m9.2 9.2 1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-subtle shrink-0"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}
