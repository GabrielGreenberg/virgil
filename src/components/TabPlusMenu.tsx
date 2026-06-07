"use client";

/**
 * The "+" affordance at the end of the tab strip in the Virgil bar.
 * Clicking it opens a dropdown with:
 *   - Recent papers (excluding ones already open as tabs)
 *   - Open folder…  (calls showDirectoryPicker via the parent)
 *   - Create new document…
 *
 * Selecting a Recent row calls onOpenRecent(id). The parent (useFiles
 * via EditorLayout) is responsible for permission re-grant before
 * activating; the row click is a valid user gesture, so the requestRW
 * path inside the parent runs on the gesture stack as required.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { FsaDocMeta } from "@/lib/doc-index";
import { ensureRW } from "@/lib/fsa-permissions";
import { getDocHandle } from "@/lib/doc-index";
import { multiWindowSupported } from "@/lib/multi-window/bus";
import { IconPlus } from "./editor-layout/panel-icons";
import { RecentPaperRow } from "./RecentPapersList";
import { Kbd } from "./Kbd";

interface Props {
  docs: FsaDocMeta[];
  openTabIds: string[];
  onOpenRecent: (id: string) => void;
  onOpenFolder: () => void;
  onCreateNew: () => void;
  onOpenNewWindow: () => void;
  devStorage: boolean;
}

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
  const wrapRef = useRef<HTMLDivElement>(null);

  // Feature-detect cross-window plumbing on the client. Hidden for
  // Safari (no BroadcastChannel-backed lock semantics) so users don't
  // see a menu item that wouldn't work coherently.
  useEffect(() => {
    setCanMultiWindow(multiWindowSupported());
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  return (
    <div ref={wrapRef} className="relative self-center inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="topbarbtn topbarbtn-icon"
        style={{ padding: "0 4px" }}
        data-hint="Open paper or create new"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconPlus />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute z-50 left-0 mt-1 min-w-[280px] py-1.5 rounded-md"
          style={{
            top: "100%",
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
                  <RecentPaperRow
                    key={doc.id}
                    doc={doc}
                    onOpen={handleRecentClick}
                  />
                ))}
              </div>
              <div
                aria-hidden
                className="my-1.5 mx-2 h-px bg-edge-hover/50"
              />
            </>
          )}
          {!devStorage && (
            <MenuItem
              label="Open folder…"
              onClick={() => {
                onOpenFolder();
                close();
              }}
            >
              <FolderIcon />
            </MenuItem>
          )}
          <MenuItem
            label="Create new document…"
            onClick={() => {
              onCreateNew();
              close();
            }}
          >
            <PlusIcon />
          </MenuItem>
          {canMultiWindow && (
            <>
              <div
                aria-hidden
                className="my-1.5 mx-2 h-px bg-edge-hover/50"
              />
              <MenuItem
                label="New Virgil window"
                shortcut="Mod+Shift+N"
                onClick={() => {
                  onOpenNewWindow();
                  close();
                }}
              >
                <WindowIcon />
              </MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  children,
  shortcut,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-ink-strong hover-on-light text-left"
    >
      {children}
      <span className="flex-1">{label}</span>
      {shortcut && <Kbd keys={shortcut} />}
    </button>
  );
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
