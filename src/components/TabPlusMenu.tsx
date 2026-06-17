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
import { ensureRW } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import { multiWindowSupported } from "@/lib/multi-window/bus";
import type { FloatingMenuPlacement } from "@/hooks/useFloatingMenuPosition";
import { IconPlus } from "./editor-layout/panel-icons";
import { Kbd } from "./Kbd";
import { MenuProvider } from "./menu/MenuProvider";
import { useMenuItem } from "./menu/useMenuItem";

interface Props {
  docs: FsaDocMeta[];
  openTabIds: string[];
  onOpenRecent: (id: string) => void;
  onOpenFolder: () => void;
  onCreateNew: () => void;
  onOpenNewWindow: () => void;
  devStorage: boolean;
}

const TAB_PLUS_PLACEMENTS: FloatingMenuPlacement[] = [
  { side: "below", align: "start" },
  { side: "above", align: "start" },
];

export function TabPlusMenu({
  docs,
  openTabIds,
  onOpenRecent,
  onOpenFolder,
  onCreateNew,
  onOpenNewWindow,
  devStorage,
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

  const openSet = new Set(openTabIds);
  const recents = [...docs]
    .filter((d) => !openSet.has(d.id))
    .sort(
      (a, b) =>
        new Date(b.lastAccessedAt).getTime() -
        new Date(a.lastAccessedAt).getTime(),
    )
    .slice(0, 5);

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
      containerStyle={{
        background: "var(--pod-editor)",
        border: "var(--pod-border)",
        boxShadow: "var(--pod-shadow)",
        borderRadius: "var(--pod-radius)",
      }}
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
    <div ref={setWrapEl} className="self-center inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="topbarbtn topbarbtn-icon"
        style={{ padding: "0 4px" }}
        data-hint="Open paper or create new"
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
