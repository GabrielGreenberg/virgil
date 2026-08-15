"use client";

/**
 * ExternalChangeBadge — the topbar surface of the external-change subsystem
 * (design: docs/memos/external-change-badge/DESIGN.md §5/§7).
 *
 * Renders the passive "disk-truth" signal: when the on-disk bytes of a file
 * Virgil owns (main `.tex` + resolved `.bib`) drift from what Virgil last
 * wrote/read, this pill appears in the topbar status cluster, beside the
 * collaborator presence pill. It mirrors `CollabStatusPill`'s badge variant —
 * a rounded pill (icon + label), a primary action button, and a kebab for the
 * secondary action.
 *
 * Severity → tone/label/actions (§4/§5):
 *   - severity === null            → renders NOTHING (the common clean case).
 *   - paused (permission lost)     → MUTED, non-actionable "Watching paused"
 *                                    variant; no Reload offered (defer to
 *                                    DocPermissionGate to re-grant).
 *   - 'change' (no unsaved edits)  → AMBER. "Changed on disk" /
 *                                    "Removed on disk". Reload (no confirm) +
 *                                    Dismiss.
 *   - 'conflict' (unsaved edits)   → DANGER. "Disk changed · unsaved edits".
 *                                    Reload (CONFIRM — discards your edits) +
 *                                    "Keep my version".
 *
 * Both reconcile actions resolve `watcher.hasUnresolvedChange()`, so the
 * autosave-clobber pause (DESIGN §4) auto-resumes once the user acts.
 *
 * KEYSTROKE SANCTITY: this reads state ONLY via `useExternalChanges()` →
 * `useSyncExternalStore` over the watcher's stable snapshot. It adds NO editor
 * subscription and does ZERO per-keystroke work — typing leaves
 * `window.__virgilBusStats().emitCount` flat.
 */

import {
  memo,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useExternalChangesOrNull } from "@/hooks/useExternalChanges";
import { useDiskWatcherOrNull } from "@/components/editor-layout/contexts/disk-watcher";
import { useConfirmDialog } from "./ConfirmDialog";
import { MenuProvider } from "./menu/MenuProvider";
import { ANCHORED_MENU_PLACEMENTS } from "./menu/AnchoredMenu";
import { useMenuItem } from "./menu/useMenuItem";
import type {
  ExternalChangeState,
  FileChange,
} from "@/lib/disk-watcher";
import { iconHint } from "@/components/Hint";
import { StatusDot } from "./StatusDot";

// Drop below the trigger, flip above near the viewport bottom — the ONE
// button-anchored placement vocabulary, shared with `<AnchoredMenu>` so a
// fourth copy of this table cannot drift from the other three.
const MENU_PLACEMENTS = ANCHORED_MENU_PLACEMENTS.end;

/** RefreshCw — a 16px stroke-only circular-arrows glyph (the "reload" affordance). */
function ReloadIcon() {
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
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** FileWarning — a 16px stroke-only document-with-alert glyph (the conflict affordance). */
function ConflictIcon() {
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
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M12 11v3" />
      <path d="M12 17h.01" />
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

/** True when at least one change is a `removed` (so the label reads "Removed"). */
function anyRemoved(changes: readonly FileChange[]): boolean {
  return changes.some((c) => c.kind === "removed");
}

interface BadgeCopy {
  label: string;
  /** Tooltip / menu detail line — the affected files. */
  detail: string;
}

function deriveCopy(state: ExternalChangeState): BadgeCopy {
  const files = state.changes.map((c) => c.relPath).join(", ");
  const detailFiles = files ? ` (${files})` : "";
  if (state.severity === "conflict") {
    return {
      label: anyRemoved(state.changes)
        ? "Removed on disk · unsaved edits"
        : "Disk changed · unsaved edits",
      detail: `An external writer changed this paper while you have unsaved edits${detailFiles}. Reload discards your edits; Keep my version overwrites theirs on the next save.`,
    };
  }
  // severity === 'change'
  return {
    label: anyRemoved(state.changes) ? "Removed on disk" : "Changed on disk",
    detail: `This paper changed on disk outside Virgil${detailFiles}. Reload to load the on-disk version.`,
  };
}

/** A single menu row — registers into the provider so arrow nav reaches it. */
function MenuRow({
  id,
  label,
  detail,
  danger,
  run,
}: {
  id: string;
  label: string;
  detail?: string;
  danger?: boolean;
  run: () => void;
}) {
  const { active, getItemProps } = useMenuItem({ id, region: "list", run });
  return (
    <button
      {...getItemProps()}
      type="button"
      className="w-full flex flex-col items-start gap-0.5 px-3 py-1.5 text-left hover-on-light"
      style={{ background: active ? "var(--menu-roving-bg)" : undefined }}
    >
      <span
        className="text-[12px]"
        style={{ color: danger ? "var(--danger)" : "var(--ink-strong)" }}
      >
        {label}
      </span>
      {detail && (
        <span className="text-[10px] text-ink-subtle leading-snug">{detail}</span>
      )}
    </button>
  );
}

function ExternalChangeBadge() {
  // Nullable variants: the badge renders in the topbar even on the no-document
  // landing screen, where DiskWatcherProviderGate mounts NO provider (it needs a
  // real docId). The throwing hooks here crashed the whole app on that boot path
  // — the dev preview masked it by auto-loading a doc. With no provider,
  // useExternalChangesOrNull yields a clean snapshot (severity null) and the
  // render gate below returns null, so the badge simply shows nothing.
  const { state, watcher } = useExternalChangesOrNull();
  const diskCtx = useDiskWatcherOrNull();
  const reloadFromDisk = diskCtx?.reloadFromDisk;
  const { confirm, dialog } = useConfirmDialog();

  const [menuOpen, setMenuOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // The pill wrapper is held in STATE (not a ref) so it can be passed to the
  // menu provider's `excludeRefs` without reading a ref during render.
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

  const isConflict = state.severity === "conflict";

  const handleReload = useCallback(async () => {
    closeMenu();
    if (isConflict) {
      // Conflict: a reload discards the user's unsaved in-editor edits, so gate
      // it behind an explicit destructive confirm (DESIGN §5).
      const ok = await confirm({
        title: "Reload from disk?",
        message:
          "This loads the on-disk version and discards your unsaved edits. This can't be undone.",
        confirmLabel: "Reload — discard my edits",
        tone: "danger",
      });
      if (!ok) return;
    }
    await reloadFromDisk?.();
  }, [closeMenu, isConflict, confirm, reloadFromDisk]);

  const handleDismiss = useCallback(async () => {
    closeMenu();
    // "Dismiss" (change) / "Keep my version" (conflict): re-baseline the ledger
    // to the current disk bytes so the badge clears; Virgil's version then wins
    // on the next save. Resolves `hasUnresolvedChange()` → autosave resumes.
    await watcher?.acknowledge();
  }, [closeMenu, watcher]);

  // ── render gate ────────────────────────────────────────────────────
  // Clean — OR no provider at all (no doc open) → render nothing. The no-doc
  // case arrives here as the clean snapshot (severity null) from
  // useExternalChangesOrNull, so this single check covers both.
  if (state.severity == null) return null;

  // Paused (permission lost mid-session): a MUTED, non-actionable variant. We
  // do NOT offer Reload while watching is paused — DocPermissionGate owns the
  // re-grant. Renders as a quiet grey pill.
  if (state.paused) {
    return (
      <div className="inline-flex items-center" data-external-change-badge="paused">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border text-ink-subtle"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border-light)",
          }}
          data-hint="Disk watching paused — file access was lost"
          aria-label="Disk watching paused"
        >
          <PausedDot />
          <span className="truncate max-w-[160px]">Watching paused</span>
        </span>
      </div>
    );
  }

  const copy = deriveCopy(state);

  // Tone tokens. 'change' → amber family; 'conflict' → danger family. Text uses
  // a legible ink on the soft tinted background (the amber/danger -500 values
  // are too light to read at 11px), with the icon/border carrying the hue.
  const tone = isConflict
    ? {
        bg: "var(--danger-soft)",
        border: "var(--danger)",
        icon: "var(--danger)",
        actionText: "var(--danger)",
      }
    : {
        bg: "var(--amber-50)",
        border: "var(--amber-200)",
        icon: "var(--amber-500)",
        actionText: "var(--ink-strong)",
      };

  const reloadLabel = "Reload";
  const dismissLabel = isConflict ? "Keep my version" : "Dismiss";

  const menu: ReactNode =
    menuOpen && anchorRect && typeof document !== "undefined" ? (
      <MenuProvider
        id="external-change-menu"
        layout="list"
        role="menu"
        portal
        anchorRect={anchorRect}
        placements={MENU_PLACEMENTS}
        gap={4}
        trackAnchor={trackAnchor}
        // The kebab trigger lives outside the portaled menu, so exempt the pill
        // wrapper from click-outside (else the toggle click self-closes it).
        excludeRefs={[wrapEl]}
        onClose={closeMenu}
        ariaLabel="External change actions"
        // Body-portaled at the menu primitive's CHROME_Z (z:2000-tier) so the
        // sticky topbar's z-30 stacking context can't clip the dropdown; its
        // surface chrome is the primitive's `.menu-surface` (task 295).
        containerClassName="min-w-[240px] max-w-[320px] py-1"
      >
        <MenuRow
          id="reload"
          label={
            isConflict ? "Reload — discards your unsaved edits" : "Reload from disk"
          }
          danger={isConflict}
          run={() => void handleReload()}
        />
        <MenuRow
          id="dismiss"
          label={dismissLabel}
          detail={
            isConflict
              ? "Keep your version — overwrites the disk change on the next save."
              : "Dismiss — keep your version; the next save overwrites the disk change."
          }
          run={() => void handleDismiss()}
        />
        {copy.detail && (
          <div className="px-3 pt-1.5 mt-1 border-t border-edge-subtle text-[10px] text-ink-subtle leading-snug">
            {copy.detail}
          </div>
        )}
      </MenuProvider>
    ) : null;

  return (
    <div
      ref={setWrapEl}
      className="relative inline-flex items-center gap-1"
      data-external-change-badge={state.severity}
    >
      <span
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] border max-w-[260px]"
        style={{
          background: tone.bg,
          borderColor: tone.border,
          color: "var(--ink-strong)",
        }}
        data-hint="Changed outside Virgil"
        aria-label={copy.label}
      >
        <span aria-hidden style={{ color: tone.icon, display: "inline-flex" }}>
          {isConflict ? <ConflictIcon /> : <ReloadIcon />}
        </span>
        <span className="truncate">{copy.label}</span>
      </span>

      {/* Primary action — Reload. For a conflict it routes through the confirm. */}
      <button
        type="button"
        onClick={() => void handleReload()}
        className="px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-[var(--accent-light)]"
        style={{ color: tone.actionText }}
        data-hint={
          isConflict
            ? "Reload from disk (discards your unsaved edits)"
            : "Reload the on-disk version"
        }
      >
        {reloadLabel}
      </button>

      {/* Kebab — the secondary action (Dismiss / Keep my version) + detail. */}
      <button
        ref={kebabRef}
        type="button"
        onClick={toggleMenu}
        className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-surface-muted text-ink-subtle focus-ring"
        {...iconHint({ label: "External change options" })}
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

/** The paused indicator is the shared dot at the `inactive` tone (task 315) —
 *  the private twin of the collab pill's markup this used to be is gone. */
function PausedDot() {
  return <StatusDot tone="inactive" size="md" className="shrink-0" />;
}

export default memo(ExternalChangeBadge);
