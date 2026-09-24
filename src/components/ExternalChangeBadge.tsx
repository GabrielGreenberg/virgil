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
 *                                    Dismiss. Nothing of the user's is at
 *                                    stake, so this tier is unchanged.
 *   - 'conflict' (unsaved edits)   → WARNING (a stronger amber, NOT danger).
 *                                    "Changed on disk · unsaved edits", with
 *                                    BOTH doors offered: "Keep mine" and
 *                                    "Use disk".
 *
 * Both reconcile actions resolve `watcher.hasUnresolvedChange()`, so the
 * autosave-clobber pause (DESIGN §4) auto-resumes once the user acts.
 *
 * ## The conflict tier (task 364)
 *
 * Before this the conflict state offered exactly one action — Reload, i.e.
 * discard your unsaved edits — behind a red pill and a danger confirm. The
 * detection was honest and the affordance was one-sided: the DISK side had a
 * door and the user's own side had none.
 *
 * > **A conflict has two sides, so it gets two doors, and each archives BOTH
 * > sides first.** The order lives in
 * > [conflict-resolution.ts](@/lib/conflict-resolution) — this surface only
 * > offers the choice and reports what the net actually holds.
 *
 * That is also why the red is gone. RED is for an action that would destroy
 * content WITHOUT a net; with the net unconditional, neither door qualifies,
 * and a red alarm on a recoverable, ordinary event (a sync service touching the
 * file) reads to a user alone at the keyboard as corruption. The tier is a
 * firm-but-calm warning: the same warm family the 'change' tier uses, one step
 * up. And the copy NAMES the likely writer, because "Disk changed" names
 * nobody — Virgil cannot know which app it was (FSA hands out no paths), so it
 * says the true general thing rather than nothing.
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
import type { ConflictChoice } from "@/lib/conflict-resolution";
import { iconHint } from "@/components/Hint";
import { StatusDot } from "./StatusDot";
import { useUnsavedAgeLabel } from "@/hooks/useUnsavedWork";
import { describeAge } from "@/lib/save-state";
import { paletteForTone, toneForInterruptionKind } from "@/lib/interruption-tone";
import { useBlockingFlowRequest } from "@/hooks/useSaveState";
import { useDocumentInterruption } from "@/hooks/useDocumentInterruption";
import {
  conflictOutcomeNotice,
  interruptionPillLabel,
  type DocumentInterruption,
} from "@/lib/document-interruption";

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

function deriveCopy(
  state: ExternalChangeState,
  unsavedAge: string | null,
  view: DocumentInterruption | null,
): BadgeCopy {
  const files = state.changes.map((c) => c.relPath).join(", ");
  const detailFiles = files ? ` (${files})` : "";
  // TASK 545 — ONE VOICE. When the interruption view is about THIS external
  // change it supplies the label and the sentence, so the pill names the
  // writer exactly as the in-document band does ("Virgil's AI edited this
  // paper" rather than "another app"). The legacy composition below survives
  // only for the no-provider / no-doc render this badge also serves.
  if (view && (view.kind === "conflict" || view.kind === "disk-change")) {
    return {
      label: interruptionPillLabel(view, unsavedAge),
      detail: view.body + (detailFiles ? ` Files: ${files}.` : ""),
    };
  }
  if (state.severity === "conflict") {
    // TASK 391 — THE PAUSE GETS A CLOCK. A conflict pauses autosave, and on
    // 2026-08-19 that pause outlived the 1500 ms debounce by seventy minutes
    // behind a pill that said the same thing at minute 1 and at minute 70. A
    // static badge is how a warning becomes furniture; the AGE is the fact
    // that makes the user act, and it is the one thing only this surface can
    // say.
    const aged = unsavedAge ? ` · ${unsavedAge} unsaved` : "";
    return {
      label:
        (anyRemoved(state.changes)
          ? "Removed on disk · unsaved edits"
          : "Changed on disk · unsaved edits") + aged,
      // Names the writer as far as it is knowable. Virgil holds an FSA
      // directory handle, not a path, so it cannot tell WHICH app wrote — but
      // the honest general answer ("another app or a sync service") is what a
      // user alone at the keyboard needs to stop reading this as corruption.
      detail:
        `Another app or a sync service — Dropbox, Overleaf, a text editor — changed this paper on disk${detailFiles} while you have unsaved edits here.` +
        (unsavedAge
          ? ` Virgil has NOT saved this paper for ${unsavedAge}, and will not until you answer this. An emergency copy is being kept in this browser meanwhile.`
          : "") +
        ` Both versions are copied into virgil/.history/ before either one is applied, so neither is lost whichever you keep.`,
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
        // interruption-tone-exempt: a destructive-CHOICE ink for this menu row —
        // task 528's family ("a button's paint describes what pressing it
        // DOES"), not an interruption register; the row paints a choice, never
        // the state the pill above it presents.
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
  // TASK 391 — the age of the unsaved work this pause is holding. Null when
  // nothing is unsaved, which is the ordinary 'change'-tier case.
  const unsavedAge = useUnsavedAgeLabel(diskCtx?.activeDocId, describeAge);
  // TASK 545 — the writer-attributed view of the same change (null with no
  // doc, or when a higher-priority state — the cowork hold, a refusal —
  // outranks it; the pill then keeps its generic copy, and the band speaks).
  const view = useDocumentInterruption(diskCtx?.activeDocId);
  const reloadFromDisk = diskCtx?.reloadFromDisk;
  const resolveConflict = diskCtx?.resolveConflict;
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

  // TASK 392 — "Save now" on a CONFLICT-blocked document routes here rather
  // than re-attempting the write the 364 guard is deliberately holding. This
  // badge owns the two doors that answer it, so the button asks it to open
  // itself; only `describeBlockReason` decides which surface a reason leads to,
  // so the two halves cannot disagree.
  const openMenu = useCallback(() => {
    setMenuOpen(true);
    setAnchorRect(kebabRef.current?.getBoundingClientRect() ?? null);
  }, []);
  useBlockingFlowRequest(diskCtx?.activeDocId, "external-change", openMenu);

  const isConflict = state.severity === "conflict";

  // 'change' tier only: nothing of the user's is at stake, so this stays the
  // one-click reload it has always been. The conflict tier routes through
  // `resolveConflict` instead, which nets both sides first.
  const handleReload = useCallback(async () => {
    closeMenu();
    await reloadFromDisk?.();
  }, [closeMenu, reloadFromDisk]);

  /**
   * The two conflict doors (task 364). Neither takes a destructive confirm:
   * the net is unconditional, so neither can destroy content — which is
   * exactly the condition the danger tone is reserved for.
   *
   * The only thing worth interrupting for is a resolution that did NOT get its
   * net, or that failed to apply. Both are rare (an FSA permission loss pauses
   * the watcher and hides these doors entirely), and both are reported rather
   * than inferred: a door promising "kept in history" while the copy silently
   * failed is the false-affordance shape this task exists to close.
   */
  const runConflictChoice = useCallback(
    async (choice: ConflictChoice) => {
      closeMenu();
      const outcome = await resolveConflict?.(choice);
      if (!outcome) return;
      // TASK 545 — the outcome copy is the vocabulary's, shared with the
      // in-document band, so the two report one result in one voice.
      const notice = conflictOutcomeNotice(outcome);
      if (notice) {
        await confirm({
          title: notice.title,
          message: notice.message,
          confirmLabel: "OK",
          hideCancel: true,
          tone: notice.tone === "danger" ? "danger" : undefined,
        });
      }
    },
    [closeMenu, resolveConflict, confirm],
  );

  // 'change' tier only. Re-baseline the ledger to the current disk bytes so the
  // badge clears; Virgil's version then wins on the next save. Resolves
  // `hasUnresolvedChange()` → autosave resumes. The conflict tier's "keep mine"
  // is NOT this: it nets both sides and writes immediately, rather than leaving
  // the outcome to whenever the next autosave happens to fire.
  const handleDismiss = useCallback(async () => {
    closeMenu();
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

  const copy = deriveCopy(state, unsavedAge, view);
  const writer =
    view && (view.kind === "conflict" || view.kind === "disk-change")
      ? view.writer
      : "unknown";

  // Tone tokens, read off the ONE kind → tone → palette table
  // (`interruption-tone.ts`, task 571) for the kind THIS pill presents —
  // deliberately not off `view.tone`, which is the top-priority state and may
  // be a cowork hold or a refusal while this pill is about the disk change.
  // A conflict is the WARNING register (the same warm family as a change, one
  // step up, never the alarm ramp: red is reserved for an action that
  // destroys content with no net, and after task 364 neither door does); a
  // change with nothing unsaved is `info`. Text uses a legible ink on the soft
  // tinted background, with the icon/border carrying the hue.
  const palette = paletteForTone(toneForInterruptionKind(isConflict ? "conflict" : "disk-change"));
  const tone = {
    bg: palette.bg,
    border: palette.edge,
    icon: palette.edge,
    actionText: palette.ink,
  };

  const reloadLabel = "Reload";
  const dismissLabel = "Dismiss";

  const menu: ReactNode =
    menuOpen && anchorRect && typeof document !== "undefined" ? (
      <MenuProvider
        id="external-change-menu"
        layout="list"
        role="menu"
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
        {isConflict ? (
          <>
            <MenuRow
              id="keep-mine"
              label="Keep my version"
              detail="Saves what's in the editor over the file on disk. The disk version is kept in virgil/.history/."
              run={() => void runConflictChoice("keep-mine")}
            />
            <MenuRow
              id="take-disk"
              label="Load the disk version"
              detail="Loads the file as it is on disk. Your unsaved edits are kept in virgil/.history/."
              run={() => void runConflictChoice("take-disk")}
            />
          </>
        ) : (
          <>
            <MenuRow
              id="reload"
              label="Reload from disk"
              run={() => void handleReload()}
            />
            <MenuRow
              id="dismiss"
              label={dismissLabel}
              detail="Dismiss — keep your version; the next save overwrites the disk change."
              run={() => void handleDismiss()}
            />
          </>
        )}
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
      data-external-writer={writer}
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

      {/* The action(s). A conflict offers BOTH doors inline — the whole point of
          task 364 is that the user's own side is reachable without opening a
          menu; the kebab carries the full labels and the loss-side sentences. */}
      {isConflict ? (
        <>
          <button
            type="button"
            onClick={() => void runConflictChoice("keep-mine")}
            className="px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-[var(--accent-light)]"
            style={{ color: tone.actionText }}
            data-hint="Save your version over the disk one — the disk version is kept in virgil/.history/"
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={() => void runConflictChoice("take-disk")}
            className="px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-[var(--accent-light)]"
            style={{ color: tone.actionText }}
            data-hint="Load the version on disk — your unsaved edits are kept in virgil/.history/"
          >
            Use disk
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => void handleReload()}
          className="px-2 py-0.5 rounded text-[11px] font-medium transition-colors hover:bg-[var(--accent-light)]"
          style={{ color: tone.actionText }}
          data-hint="Reload the on-disk version"
        >
          {reloadLabel}
        </button>
      )}

      {/* Kebab — the secondary action (Dismiss / Keep my version) + detail. */}
      <button
        ref={kebabRef}
        type="button"
        onClick={toggleMenu}
        className="w-5 h-5 inline-flex items-center justify-center rounded hover-on-dark text-ink-subtle focus-ring"
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
