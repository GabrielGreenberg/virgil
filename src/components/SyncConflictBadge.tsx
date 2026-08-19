"use client";

/**
 * SyncConflictBadge — the topbar surface of the sync-conflict scan (task 363).
 *
 * A cloud-sync daemon that cannot merge two versions of a file does not tell
 * the application anything: it renames one side aside as a "conflicted copy"
 * and walks away. Virgil's model has no idea — the file it owns still parses,
 * the panels still render, and a fork holding a note the user wrote sits in the
 * folder unread. In the paper this was filed from, four content sidecars had
 * records that exist ONLY in a fork.
 *
 * So this pill says the two things Virgil can honestly say: **how many forks
 * are in this paper's `virgil/` folder**, and **which of them are files that
 * hold writing**. The menu lists them by name, because "some files" is not
 * something a user can act on and a filename is.
 *
 * ## Why it offers no fix
 *
 * Virgil deliberately does not merge or delete. The two sides are whole-file
 * snapshots taken at unknown times; picking a winner is precisely the
 * destructive act the sync service itself declined to make, and doing it
 * silently on the user's writing would be worse than the divergence. Deleting
 * is the same call one step further. So the badge REPORTS, and the user deals
 * with the folder in Finder — which is also the only place they can, since a
 * web app cannot reveal a file.
 *
 * ## Tone
 *
 * Not danger. Nothing here threatens the user's document: their file is intact
 * and Virgil's writes are correct. This is a WARNING about the folder — the same
 * warm family the external-change badge's 'change' tier uses. And it is
 * dismissible for the session, because a folder with four months of accumulated
 * forks would otherwise wear a permanent banner, which is how a real signal
 * becomes furniture.
 *
 * KEYSTROKE SANCTITY: reads state ONLY through `useSyncConflictNotice()` →
 * `useSyncExternalStore`. No editor subscription, no polling, no per-keystroke
 * work.
 */

import { memo, useCallback, useRef, useState, type ReactNode } from "react";
import { useSyncConflictNotice } from "@/hooks/useSyncConflictNotice";
import { dismissSyncConflictNotice } from "@/lib/sync-conflict-notice";
import { MenuProvider } from "./menu/MenuProvider";
import { ANCHORED_MENU_PLACEMENTS } from "./menu/AnchoredMenu";
import { useMenuItem } from "./menu/useMenuItem";
import { iconHint } from "@/components/Hint";

const MENU_PLACEMENTS = ANCHORED_MENU_PLACEMENTS.end;

/** Copy — a 16px stroke-only two-sheets glyph (the "there are two of these" idea). */
function ForkIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function KebabIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

function MenuRow({ id, label, run }: { id: string; label: string; run: () => void }) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run });
  return (
    <button
      {...getItemProps()}
      type="button"
      className="w-full px-3 py-1.5 text-left text-[12px] hover-on-light"
      style={{
        background: active ? "var(--menu-roving-bg)" : undefined,
        color: "var(--ink-strong)",
      }}
    >
      {label}
    </button>
  );
}

function SyncConflictBadge({ docId }: { docId: string | null }) {
  const notice = useSyncConflictNotice(docId);
  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const kebabRef = useRef<HTMLButtonElement | null>(null);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setAnchorRect(null);
  }, []);

  const toggleMenu = useCallback(() => {
    setMenuOpen((o) => {
      const next = !o;
      setAnchorRect(
        next ? (kebabRef.current?.getBoundingClientRect() ?? null) : null,
      );
      return next;
    });
  }, []);

  const trackAnchor = useCallback(
    () => kebabRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  const handleDismiss = useCallback(() => {
    closeMenu();
    if (docId) dismissSyncConflictNotice(docId);
  }, [closeMenu, docId]);

  // ── render gate ────────────────────────────────────────────────────
  // Nothing to report, or the user has seen it → nothing to say. `.crswap`
  // debris ALONE is deliberately not worth a pill: it is never user data, so it
  // rides an existing conflict report as context and raises nothing on its own.
  if (!notice || notice.total === 0) return null;

  const { total, contentTotal, groups, swapFiles } = notice;
  const label =
    contentTotal > 0
      ? `${total} conflicted ${total === 1 ? "copy" : "copies"} · ${contentTotal} with content`
      : `${total} conflicted ${total === 1 ? "copy" : "copies"}`;

  const menu: ReactNode =
    menuOpen && anchorRect && typeof document !== "undefined" ? (
      <MenuProvider
        id="sync-conflict-menu"
        layout="list"
        role="menu"
        portal
        anchorRect={anchorRect}
        placements={MENU_PLACEMENTS}
        gap={4}
        excludeRefs={[wrapEl]}
        onClose={closeMenu}
        ariaLabel="Sync conflict details"
        trackAnchor={trackAnchor}
        containerClassName="min-w-[280px] max-w-[360px] py-1"
      >
        <MenuRow id="dismiss" label="Dismiss for this session" run={handleDismiss} />
        <div className="px-3 pt-1.5 mt-1 border-t border-edge-subtle text-[10px] text-ink-subtle leading-snug">
          A file-sync service (Dropbox, iCloud Drive, Google Drive, Syncthing)
          could not merge two versions of these files, so it kept both and
          renamed one aside. Virgil is using the un-renamed one.
          {contentTotal > 0 && (
            <>
              {" "}
              The files marked below hold your writing, so a copy may contain
              notes or cards you cannot see in the app. Virgil does not merge or
              delete them — open the paper&apos;s <code>virgil/</code> folder in
              Finder to compare and clean up.
            </>
          )}
        </div>
        <ul className="px-3 pt-1.5 pb-1 text-[10px] text-ink-subtle leading-snug list-none">
          {groups.map((g) => (
            <li key={g.base} className="flex items-baseline justify-between gap-2">
              <span
                className="font-mono truncate"
                style={g.tier === "content" ? { color: "var(--ink-body)" } : undefined}
              >
                {g.base}
              </span>
              <span className="shrink-0">
                {g.siblings.length}
                {g.tier === "content" ? " · content" : ""}
              </span>
            </li>
          ))}
          {swapFiles.length > 0 && (
            <li className="mt-1 pt-1 border-t border-edge-subtle">
              {swapFiles.length} leftover <code>.crswap</code> temp{" "}
              {swapFiles.length === 1 ? "file" : "files"} (not your data — safe
              to delete)
            </li>
          )}
        </ul>
      </MenuProvider>
    ) : null;

  return (
    <div
      ref={setWrapEl}
      className="relative inline-flex items-center gap-1"
      data-sync-conflict-notice={String(total)}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border max-w-[280px]"
        style={{
          // The same warm amber family the external-change badge's 'change'
          // tier uses — this is a warning about the FOLDER, never an alarm
          // about the document. Red stays reserved for an action that would
          // destroy content with no net.
          background: "var(--amber-50)",
          borderColor: "var(--amber-200)",
          color: "var(--ink-strong)",
        }}
        data-hint="A sync service left conflicted copies in this paper's virgil/ folder"
        aria-label={`${label} in this paper's sidecar folder`}
      >
        <span aria-hidden style={{ color: "var(--amber-500)", display: "inline-flex" }}>
          <ForkIcon />
        </span>
        <span className="truncate">{label}</span>
      </span>

      <button
        ref={kebabRef}
        type="button"
        onClick={toggleMenu}
        className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-surface-muted text-ink-subtle focus-ring"
        {...iconHint({ label: "Conflicted copy details" })}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <KebabIcon />
      </button>

      {menu}
    </div>
  );
}

export default memo(SyncConflictBadge);
