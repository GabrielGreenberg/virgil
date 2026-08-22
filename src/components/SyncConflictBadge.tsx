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
 * ## What it offers, and the line it does not cross (task 411)
 *
 * Virgil deliberately does not MERGE. The two sides are whole-file snapshots
 * taken at unknown times; picking a winner is precisely the destructive act the
 * sync service itself declined to make, and doing it silently on the user's
 * writing would be worse than the divergence. That has not changed, and it is
 * why there is still no in-app compare (DECIDED, Gabriel 2026-08-21): a real
 * one needs a reader for arbitrary sidecar shapes AND an adopt path through
 * each panel's own hook — a genuine feature with its own design pass, not a
 * badge affordance. `tools/triage-sync-conflicts.mjs --extract` is where a
 * human reads a divergent fork.
 *
 * What it now offers is a one-click DELETE of the debris the app's own
 * declarations PROVE carries nothing — a fork of a VIEW-tier sidecar, and
 * browser `.crswap` leftovers. The set is decided in ONE place
 * ([sync-conflict-cleanup.ts](../lib/sync-conflict-cleanup.ts)) and re-derived
 * by the storage door from a fresh listing, so this component cannot name a
 * file into it; **a fork of a content sidecar is never deletable from inside
 * Virgil**, whatever a comparison of its bytes might say.
 *
 * Two counts, and they are deliberately different numbers: the PILL says how
 * many forks the folder holds (that is the report), and the cleanup row says
 * how many of them are proved inert (that is the offer). Conflating them would
 * make one of the two lie.
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

import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSyncConflictNotice } from "@/hooks/useSyncConflictNotice";
import { dismissSyncConflictNotice } from "@/lib/sync-conflict-notice";
import { SYNC_ORIGIN_LABEL } from "@/lib/sync-conflict";
import {
  isEmptyCleanupReceipt,
  planSidecarCleanup,
} from "@/lib/sync-conflict-cleanup";
import { runSyncConflictCleanup } from "@/lib/sync-conflict-scan";
import { useConfirmDialog } from "./ConfirmDialog";
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

function MenuRow({
  id,
  label,
  run,
  disabled,
}: {
  id: string;
  label: string;
  run: () => void;
  disabled?: boolean;
}) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run });
  return (
    <button
      {...getItemProps()}
      type="button"
      disabled={disabled}
      className="w-full px-3 py-1.5 text-left text-[12px] hover-on-light disabled:opacity-50"
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
  const { confirm, dialog } = useConfirmDialog();
  const [cleaning, setCleaning] = useState(false);
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

  // What Virgil may delete from THIS report, derived — never a set this
  // component decides. The storage door re-derives the same answer from a fresh
  // listing at delete time, so these names are only ever a filter over it.
  const plan = useMemo(
    () =>
      notice
        ? planSidecarCleanup([
            ...notice.groups.flatMap((g) => g.siblings.map((sib) => sib.name)),
            ...notice.swapFiles,
          ])
        : [],
    [notice],
  );

  const handleCleanup = useCallback(async () => {
    closeMenu();
    if (!docId || plan.length === 0 || cleaning) return;
    const forks = plan.filter((e) => e.reason === "view-tier");
    const swaps = plan.filter((e) => e.reason === "swap");
    // How many forks this run is deliberately NOT touching — the half the
    // confirm has to name, or "delete the safe ones" reads as "delete them all".
    const kept = notice?.contentTotal ?? 0;
    const ok = await confirm({
      title: `Delete ${plan.length} file${plan.length === 1 ? "" : "s"}?`,
      message: (
        <div className="flex flex-col gap-2 text-[12px]">
          <p>
            These are the files in this paper&apos;s <code>virgil/</code> folder
            that Virgil can prove carry nothing:{" "}
            {forks.length > 0 && (
              <>
                copies of files it keeps only view state in (a scroll position,
                which sections are folded, who is editing)
              </>
            )}
            {forks.length > 0 && swaps.length > 0 && ", and "}
            {swaps.length > 0 && <>leftover browser temp files</>}. Deleting is
            permanent — Virgil keeps no copy.
          </p>
          <ul className="list-none font-mono text-[11px] leading-snug max-h-[180px] overflow-y-auto">
            {plan.map((e) => (
              <li key={e.name} className="truncate">
                {e.name}
              </li>
            ))}
          </ul>
          {kept > 0 && (
            <p>
              The {kept} cop
              {kept === 1 ? "y" : "ies"} of files that hold
              your writing {kept === 1 ? "is" : "are"} NOT
              touched. Open the folder in Finder to compare those.
            </p>
          )}
        </div>
      ),
      confirmLabel: `Delete ${plan.length} file${plan.length === 1 ? "" : "s"}`,
      tone: "danger",
    });
    if (!ok) return;
    setCleaning(true);
    let receipt;
    try {
      receipt = await runSyncConflictCleanup(
        docId,
        plan.map((e) => e.name),
      );
    } finally {
      setCleaning(false);
    }
    // THE REPORT IS THE PERMISSION (tasks 357/364/392): a door that infers
    // success from the absence of a throw is the false-affordance shape this
    // cluster legislates against. A clean run needs no words — the re-scan
    // inside the runner drops the names and the pill updates or disappears by
    // itself — but anything that did NOT happen is said, in the shape it
    // happened in. The two failures are genuinely different facts: "the door
    // ran and kept some" is not "the door never ran", and one message covering
    // both would tell the user a number that is not true of their folder.
    if (isEmptyCleanupReceipt(receipt)) {
      await confirm({
        title: "Nothing was deleted",
        message:
          `Virgil could not reach this paper's virgil/ folder just now, so ` +
          `none of the ${plan.length} file${plan.length === 1 ? "" : "s"} ` +
          `${plan.length === 1 ? "was" : "were"} removed. Nothing was changed. ` +
          `Try again, or open the folder in Finder.`,
        confirmLabel: "OK",
        hideCancel: true,
      });
      return;
    }
    const unremoved = receipt.refused.length + receipt.failed.length;
    if (unremoved > 0) {
      await confirm({
        title: "Some files were kept",
        message:
          `Removed ${receipt.deleted.length} of ${plan.length}. ` +
          `${unremoved} could not be removed and ${unremoved === 1 ? "is" : "are"} ` +
          `still in the folder — open it in Finder to deal with ` +
          `${unremoved === 1 ? "it" : "them"}.`,
        confirmLabel: "OK",
        hideCancel: true,
      });
    }
  }, [closeMenu, confirm, docId, plan, cleaning, notice]);

  // ── render gate ────────────────────────────────────────────────────
  // Nothing to report, or the user has seen it → nothing to say. `.crswap`
  // debris ALONE is deliberately not worth a pill: it is never user data, so it
  // rides an existing conflict report as context and raises nothing on its own.
  // Consequence, stated rather than discovered: a folder holding ONLY debris
  // offers no cleanup either, because there is no surface to offer it from. That
  // is the right trade — raising a pill for files the user was never told to
  // care about would make a warning out of housekeeping.
  if (!notice || notice.total === 0) return null;

  const { total, contentTotal, groups, swapFiles, origin } = notice;
  // Name the service when every fork agrees on one — "Dropbox could not merge
  // these" is actionable where the four-way family list is a shrug.
  const writer = origin
    ? SYNC_ORIGIN_LABEL[origin]
    : "A file-sync service (Dropbox, iCloud Drive, Google Drive, Syncthing)";
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
        {plan.length > 0 && (
          <MenuRow
            id="cleanup"
            label={
              cleaning
                ? "Deleting…"
                : `Delete ${plan.length} file${plan.length === 1 ? "" : "s"} that carry nothing…`
            }
            run={handleCleanup}
            disabled={cleaning}
          />
        )}
        <MenuRow id="dismiss" label="Dismiss for this session" run={handleDismiss} />
        <div className="px-3 pt-1.5 mt-1 border-t border-edge-subtle text-[10px] text-ink-subtle leading-snug">
          {writer} could not merge two versions of these files, so it kept both
          and renamed one aside. Virgil is using the un-renamed one.
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
      {dialog}
    </div>
  );
}

export default memo(SyncConflictBadge);
