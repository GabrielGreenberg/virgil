"use client";

import {
  Fragment,
  memo,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import type { SkillSyncError, SkillSyncNotice } from "@/hooks/useFiles";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap-extensions";
import { SoftwareUpdateBanner } from "@/components/SoftwareUpdateBanner";
import CoworkPenBadge from "@/components/CoworkPenBadge";
import { MirrorRecoveryBadge } from "@/components/MirrorRecoveryBadge";
import { SaveStateBadge } from "@/components/SaveStateBadge";
import { OPEN_CHROME_MENU_Z } from "@/floats/float-policy";
import SkillSyncControls from "../SkillSyncControls";
import CollabStatusPill from "../CollabStatusPill";
import ExternalChangeBadge from "../ExternalChangeBadge";
import PreservationNoticeBadge from "../PreservationNoticeBadge";
import SyncConflictBadge from "../SyncConflictBadge";
import { PomodoroTimer, PomodoroToggleButton } from "../PomodoroTimer";
import { CompileStatusChip, FocusViewChip, HelperModeChip } from "@/components/BarModeChips";
import { iconHint } from "@/components/Hint";
import { StatusDot } from "@/components/StatusDot";
import { BAR_STATUS_ORDER, type BarStatusItemId } from "@/lib/bar-status-policy";
import type { AiDotTone } from "@/components/AIWindow";

/** The subset of the (memoized) Virgil-bar `vbar` value this cluster reads. */
export type StatusClusterVBar = {
  aiDot: AiDotTone | null;
  compilePdf: () => void;
  isCompiling: boolean;
  pdfStale: boolean;
};

export type StatusClusterProps = {
  vbar: StatusClusterVBar;
  /** Whether collab mode is on (for the badge/marker conditionals). The live
   *  collab object itself is read from CollabContext by CollabStatusPill, so a
   *  collab pen/presence tick re-renders only the pill, not this whole cluster. */
  collabEnabled: boolean;

  // Whether the bar's owning layout is in zen mode (suppresses status markers
  // + the divider + the prefs/help/print/etc. button group).
  zenModeOn: boolean;
  /**
   * The EFFECTIVE collapsed state of the collapsible tool group. `TopBar`
   * overrides the raw pref with the bar's occupancy verdict (user pref ∨ the
   * auto rule in bar-occupancy.ts); a bare mount gets the pref alone.
   */
  topbarRightCollapsed: boolean;
  /**
   * The user's persisted pref setter. Written ONLY by an explicit toggle —
   * the auto rule never touches it. Kept in the bundle because `TopBar`'s
   * occupancy hook is what threads it into the toggle below.
   */
  setTopbarRightCollapsed: Dispatch<SetStateAction<boolean>>;
  /**
   * The chip's click handler, supplied by `TopBar`'s occupancy hook so that
   * expanding out of an AUTO collapse can out-rank the rule instead of writing
   * a pref the user never set. Falls back to a plain pref toggle for a bare
   * mount, so the chip is never a control that does nothing.
   */
  onToggleTools?: () => void;
  /**
   * Ref callback for the collapsible group's `max-content` wrapper — the
   * NATURAL width the occupancy rule needs in BOTH states (bar-occupancy.ts).
   */
  toolsMeasureRef?: (el: HTMLElement | null) => void;

  // Service-worker update banner.

  // Skill-sync surface.
  hasDoc: boolean;
  skillSyncError: SkillSyncError | null;
  skillSyncNotice: SkillSyncNotice | null;
  onResyncSkills: () => void;
  onDismissSkillSyncError: () => void;
  onDismissSkillSyncNotice: () => void;

  // Status-marker slices.
  focusActive: boolean;
  onFocusDeactivate: () => void;
  helperOn: boolean;
  onHelperToggle: () => void;

  // Collab (CollabStatusPill is built here from stable handlers).
  onEnableCollab: () => void;
  onEditIdentity: () => void;
  onDisableCollab: () => void;

  // Zen toggle.
  onToggleZen: () => void;
  preferencesOpen: boolean;
  setPreferencesOpen: Dispatch<SetStateAction<boolean>>;

  // Bug-report drop window (dev tool; rendered only when the per-machine
  // `virgil:bug-report` flag + FSA gate resolves true — see EditorLayout).
  bugReportEnabled: boolean;
  bugReportOpen: boolean;
  setBugReportOpen: Dispatch<SetStateAction<boolean>>;

  // Help dropdown (body-portaled).
  appVersion: string;
  helperBtnRef: RefObject<HTMLButtonElement | null>;
  helperMenuOpen: boolean;
  setHelperMenuOpen: Dispatch<SetStateAction<boolean>>;
  helperPositionRef: (el: HTMLElement | null) => void;
  helperPositionStyle: React.CSSProperties;
  commandsPopoutOpen: boolean;
  setCommandsPopoutOpen: Dispatch<SetStateAction<boolean>>;
  onInsertVirgilCommand: (name: string) => void;

  // Print / AI-window / Style / Code / Compile / PDF buttons.
  currentDocId: string | null;
  codeView: boolean;
  pdfView: boolean;
  printOpen: boolean;
  setPrintOpen: Dispatch<SetStateAction<boolean>>;
  aiWindowOpen: boolean;
  setAiWindowOpen: Dispatch<SetStateAction<boolean>>;
  manageStylesOpen: boolean;
  setManageStylesOpen: Dispatch<SetStateAction<boolean>>;
  onToggleCodeView: () => void;
  onTogglePdfView: () => void;
};

function StatusClusterImpl(props: StatusClusterProps) {
  const {
    vbar,
    collabEnabled,
    zenModeOn,
    topbarRightCollapsed,
    setTopbarRightCollapsed,
    onToggleTools,
    toolsMeasureRef,
    hasDoc,
    skillSyncError,
    skillSyncNotice,
    onResyncSkills,
    onDismissSkillSyncError,
    onDismissSkillSyncNotice,
    focusActive,
    onFocusDeactivate,
    helperOn,
    onHelperToggle,
    onEnableCollab,
    onEditIdentity,
    onDisableCollab,
    onToggleZen,
    preferencesOpen,
    setPreferencesOpen,
    bugReportEnabled,
    bugReportOpen,
    setBugReportOpen,
    appVersion,
    helperBtnRef,
    helperMenuOpen,
    setHelperMenuOpen,
    helperPositionRef,
    helperPositionStyle,
    commandsPopoutOpen,
    setCommandsPopoutOpen,
    onInsertVirgilCommand,
    currentDocId,
    codeView,
    pdfView,
    printOpen,
    setPrintOpen,
    aiWindowOpen,
    setAiWindowOpen,
    manageStylesOpen,
    setManageStylesOpen,
    onToggleCodeView,
    onTogglePdfView,
  } = props;

  // ── Collapse focus hand-off (task 395) ──────────────────────────────────
  // The group is hidden by `aria-hidden` + `visibility: hidden` and its
  // children are remounted, so a collapse that lands while focus is INSIDE it
  // drops the caret to <body> and, for one commit, puts `aria-hidden` over the
  // focused element — which ARIA forbids and which loses the user's place with
  // nothing on screen to explain it. Focus moves to the chip instead: the chip
  // is TIER 1 (always rendered) and is the affordance that brings the group
  // back, so it is the correct landing spot rather than merely a safe one.
  // A LAYOUT effect, so the move happens in the same commit that hides the
  // group — a passive one would let a frame paint with focus in a hidden
  // subtree.
  // `document.activeElement` is the WRONG question by the time the effect can
  // ask it: the collapse REMOUNTS the group's children, so React has already
  // detached the focused button and the browser has already dropped focus to
  // <body>. What survives the commit is the tracked fact, so the group records
  // focus-within itself — `focusin` sets it, `focusout` clears it (including
  // the legitimate move to the chip, which is outside the group), and node
  // REMOVAL fires neither, which is exactly why the flag is still true when
  // the effect runs. Asking `activeElement === body` instead would steal focus
  // whenever the bar auto-collapsed with nothing focused at all.
  const toolsGroupRef = useRef<HTMLDivElement | null>(null);
  const collapseChipRef = useRef<HTMLButtonElement | null>(null);
  const groupHadFocusRef = useRef(false);
  useLayoutEffect(() => {
    if (!topbarRightCollapsed) return;
    if (!groupHadFocusRef.current) return;
    groupHadFocusRef.current = false;
    collapseChipRef.current?.focus();
  }, [topbarRightCollapsed]);

  // ── TIER 1: the protected status items (task 1131) ─────────────────────
  // Mounted in the ONE policy's order (`BAR_STATUS_ORDER`), keyed by its ids —
  // a `Record` over `BarStatusItemId`, so an item the policy table does not
  // name cannot be mounted here. Every item renders only while its state is
  // MUST-SEE: each one's single visibility return reads `barStatusVisible`
  // (bar-status-policy.ts). None of them reads `topbarRightCollapsed` or
  // `zenModeOn` — a layout preference does not decide what the user must see,
  // and keeping the verdict out of tier 1 is what keeps the occupancy
  // predicate state-independent (bar-occupancy.ts). Census:
  // `bar-status-policy.test.tsx`.
  const statusItems: Record<BarStatusItemId, ReactNode> = {
    // Service-worker update chip — "⟳ Virgil update", nothing more. Since
    // task 391 its click refuses to reload while any open paper's work is
    // still in memory (this button triggered the 2026-08-19 data loss).
    "software-update": <SoftwareUpdateBanner />,
    // Cowork pen (task 489): an `/editor/*` skill holds this paper's pen, so
    // the main text is read-only and autosave is paused — the notice explains
    // why typing stopped.
    "cowork-pen": <CoworkPenBadge docId={currentDocId} />,
    // Preservation notice (task 357 hole 4): a gate refused a write that would
    // have dropped content, so Virgil is not saving this paper.
    preservation: <PreservationNoticeBadge docId={currentDocId} />,
    // Emergency-mirror recovery (task 391): a mirrored model never reached disk.
    "mirror-recovery": <MirrorRecoveryBadge docId={currentDocId} />,
    // Sync-conflict notice (task 363): conflicted copies may hold unseen writing.
    "sync-conflict": <SyncConflictBadge docId={currentDocId} />,
    // External-change notice (task 364): the file changed on disk and the
    // clobber guard may have paused autosave. Tier 1 since task 392, so the
    // pause the save badge's "Resolve…" routes to is never unreachable.
    "external-change": <ExternalChangeBadge />,
    // SAVE STATE (task 392): shown only once work has not landed (unsaved) or
    // a gate holds it (blocked), naming the gate with a button into its flow.
    "save-state": <SaveStateBadge docId={currentDocId} />,
    // Skill-bundle sync FAILURE pill. A success is informational and lives on
    // the Help menu's "Refresh skills" row below.
    "skill-sync": (
      <SkillSyncControls
        error={skillSyncError}
        onResync={onResyncSkills}
        onDismissError={onDismissSkillSyncError}
      />
    ),
    // The bar timer's WIDGET (task 354) — shown while the user has it open,
    // through collapse and zen alike (a timed sitting is when zen is on).
    // PROP-LESS: it reads the session store directly, so a tick cannot
    // re-render this memoized cluster. Its ICON is an ordinary tool below.
    pomodoro: <PomodoroTimer />,
    // A running compile's ONE progress indicator (task 1353) — the Compile
    // tool below only disables, so a collapsed bar still shows the work.
    compile: <CompileStatusChip compiling={vbar.isCompiling} />,
    // MODES THE USER TURNED ON (task 1353). Each chip is its mode's off-switch
    // (Focus from the Outline / card actions, Helper from the "?" menu,
    // Collab from its icon tool), so it lives here and survives the tools'
    // collapse; zen hides them by the policy's own rule, read from the zen
    // store inside each chip. Before 1353 they sat inside the collapsible
    // group and the Focus-view chip vanished with it.
    "focus-view": <FocusViewChip active={focusActive} onExit={onFocusDeactivate} />,
    "helper-mode": <HelperModeChip on={helperOn} onExit={onHelperToggle} />,
    collab: (
      <CollabStatusPill
        onEnableRequest={onEnableCollab}
        onEditIdentity={onEditIdentity}
        onDisable={onDisableCollab}
        variant="badge"
      />
    ),
  };

  const collabIconBtn = (
    <CollabStatusPill
      onEnableRequest={onEnableCollab}
      onEditIdentity={onEditIdentity}
      onDisable={onDisableCollab}
      variant="icon"
    />
  );

  return (
    <div
      // self-end mb-[var(--bar-seam-lift)]: bottom-anchor this 24px-tall icon row to the bar's
      // seam and lift it 3px so its optical center lands at seam−15 — the same
      // anchor the tab titles use (task 094), so titles + icons share one
      // baseline in BOTH the 32px base bar and the taller WCO-folded bar. The
      // inner items-center keeps the buttons centered within this 24px row
      // (task 289).
      className="shrink-0 flex items-center self-end mb-[var(--bar-seam-lift)] px-2"
    >
      {/* The STATUS SEGMENT (task 1354): neighbour spacing is the CONTAINER's,
          stated once by `--bar-occupant-gap` — no occupant carries a margin.
          `gap` spaces the pills from each other; the trailing margin spaces
          the last one from what follows (the first tool, or the « chip when
          the tools are collapsed). It sits on the segment, not as a root
          `gap`, because the collapsed tool group is a zero-width flex item a
          root gap would double around. Every hidden item returns null, so an
          all-quiet segment is `:empty` and `empty:hidden` takes its margin
          with it. Not an occupancy box: useBarOccupancy measures only the tab
          strip, the tab row and the tools wrapper. */}
      <div
        data-bar-segment="status"
        className="flex items-center gap-[var(--bar-occupant-gap)] mr-[var(--bar-occupant-gap)] empty:hidden"
      >
        {BAR_STATUS_ORDER.map((id) => (
          <Fragment key={id}>{statusItems[id]}</Fragment>
        ))}
      </div>
      {/* ── TIER 3: the collapsible tool group (task 395) ──────────────────
          Everything above this point is TIER 1 (PROTECTED) and everything in
          here is the bar's lowest-priority occupant: under compression it
          yields its width to the tabs, which is Gabriel's stated priority
          ("text tabs should occlude the tools in this case"). The verdict is
          resolved once, in bar-occupancy.ts, and arrives as
          `topbarRightCollapsed` — the user's own pref OR the auto rule.

          It COLLAPSES by width rather than unmounting, and that is what makes
          the rule cheap and honest: the `max-content` inner wrapper keeps
          reporting the group's NATURAL width in BOTH states, so the predicate
          never has to guess (or cache) how wide the group would be if it were
          open. `visibility: hidden` gives the collapsed group exactly the
          semantics unmounting gave it — out of the tab order, out of the
          hit-test, out of the accessibility tree — while `width: 0` +
          `overflow: hidden` hand every pixel back to the tab strip. */}
      <div
        ref={toolsGroupRef}
        data-bar-tier="collapsible"
        onFocus={() => { groupHadFocusRef.current = true; }}
        onBlur={() => { groupHadFocusRef.current = false; }}
        className="flex items-center shrink-0"
        style={{
          // Clip ONLY while collapsed. An unconditional `overflow: hidden`
          // clips every button's `:focus-visible` ring against the group's own
          // edge in the EXPANDED state too — the keyboard affordance trimmed
          // by a rule that exists for the zero-width one.
          width: topbarRightCollapsed ? 0 : undefined,
          overflow: topbarRightCollapsed ? "hidden" : undefined,
        }}
        aria-hidden={topbarRightCollapsed || undefined}
      >
      <div
        ref={toolsMeasureRef}
        data-bar-occupant="status-tools"
        className="flex items-center"
        style={{
          width: "max-content",
          visibility: topbarRightCollapsed ? "hidden" : undefined,
          pointerEvents: topbarRightCollapsed ? "none" : undefined,
        }}
      >
      {/* KEYED on the collapse state, so flipping it REMOUNTS the group's
          children. That is not churn-for-nothing: it restores byte-for-byte
          what unmounting used to give, which is that a child's own open menu
          CLOSES when the group goes away. `visibility: hidden` cannot reach a
          child that body-PORTALS its dropdown (CollabStatusPill through
          `MenuProvider`, and the shared `<Menu>` primitive generally), so
          without this a collapse leaves a menu floating over the canvas with
          no trigger under it. Remounting answers it for every portal owner
          present and future, where a per-child gate answers it for the one
          somebody remembered. The measured wrapper above is deliberately
          OUTSIDE the key: its ref must stay bound, or the collapse would drop
          the measurement and the rule would fail open into a flip-flop.
          A surface whose OPEN state lives outside the group (the help menu,
          owned by EditorLayout) is unaffected by a remount and is gated
          explicitly below — same behaviour as pre-395 unmounting, where the
          prop likewise re-opened it on expand. */}
      <div key={topbarRightCollapsed ? "collapsed" : "expanded"} className="flex items-center">
      {(<>
      {/* Divider — the boundary between the mode chips (TIER 1, just left of
          this group since task 1353) and the standard tools. It lives IN the
          group, so it shows only while the tools are expanded; and only when a
          mode chip is on, which is the same predicate as the chips' policy
          entries (`!zen && mode`). Suppressed in zen mode regardless. */}
      {!zenModeOn && (focusActive || helperOn || collabEnabled) && (
        <span
          aria-hidden
          className="self-center h-5 w-px mr-2"
          // Its left side already has the status segment's trailing
          // `--bar-occupant-gap` (a chip is on, so the segment is non-empty);
          // top it up to the same 8px as the right rather than adding a
          // second, independent margin.
          style={{ background: "var(--edge-strong)", marginLeft: "calc(0.5rem - var(--bar-occupant-gap))" }}
        />
      )}
      {/* Zen mode toggle — render-gates editor chrome so the document area
          stands alone. Top bar stays visible so this button is always
          reachable. */}
      <button
        onClick={onToggleZen}
        className="topbarbtn"
        aria-pressed={zenModeOn}
        data-hint="Zen mode"
      >
        Zen
      </button>
      {!zenModeOn && (<>
      {collabIconBtn}
      {/* ── Bug-report drop (dev tool) ─────────────────────────────
          Per-machine opt-in via localStorage `virgil:bug-report`. Opens the
          always-mounted BugReportWindow (EditorLayout). Deliberately NOT
          disabled without a doc — reports can be filed from the empty
          state. */}
      {bugReportEnabled && (
        <button
          onClick={() => setBugReportOpen((v) => !v)}
          className="topbarbtn"
          aria-pressed={bugReportOpen}
          {...iconHint({ label: "Report a bug" })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m8 2 1.88 1.88" />
            <path d="M14.12 3.88 16 2" />
            <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
            <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
            <path d="M12 20v-9" />
            <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
            <path d="M6 13H2" />
            <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
            <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
            <path d="M22 13h-4" />
            <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
          </svg>
        </button>
      )}
      <button
        onClick={() => setPreferencesOpen((v) => !v)}
        className="topbarbtn"
        aria-pressed={preferencesOpen}
        {...iconHint({ label: "Preferences" })}
      >
        {/* Painter's palette icon — solid silhouette with the classic
            thumb-hole cutout on the right and four color wells punched
            through via fill-rule="evenodd". */}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2 0-.52-.2-.97-.54-1.32-.34-.36-.54-.82-.54-1.33 0-1.1.9-2 2-2h2.35C19.93 15.35 22 13.24 22 10.65 22 5.88 17.52 2 12 2zM6.5 12a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
        </svg>
      </button>
      <div className="relative">
        <button
          ref={helperBtnRef}
          onClick={(e) => { e.stopPropagation(); setHelperMenuOpen((v) => !v); }}
          className="topbarbtn"
          {...iconHint({ label: "Help" })}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.5 9a2.75 2.75 0 0 1 5.25 1.1c0 1.6-2.25 2.4-2.75 3.4" />
            <path d="M12 17h.01" />
          </svg>
        </button>
        {/* `!topbarRightCollapsed` (task 395): this dropdown PORTALS to
            <body>, so it is the one child of the collapsible group that
            `visibility: hidden` cannot reach. Gating it here reproduces
            exactly what unmounting the group used to do — otherwise an auto
            collapse (an OS window narrowing while the menu is open) would
            leave the menu floating with no trigger under it. */}
        {helperMenuOpen && !topbarRightCollapsed && typeof document !== "undefined" && createPortal(
          <div
            ref={helperPositionRef}
            // MENU tier (task 459). The Help menu and its Commands sub-menu
            // below are two floating command surfaces in one declaration, and
            // both hand-authored `--edge-subtle` + `shadow-md`; the surface is
            // `.menu-surface`'s now, whatever either one is anchored to.
            className="menu-surface text-xs text-ink-body whitespace-nowrap text-left min-w-[160px]"
            style={{ ...helperPositionStyle, zIndex: OPEN_CHROME_MENU_Z }}
            onClick={(e) => e.stopPropagation()}
            onMouseLeave={() => setCommandsPopoutOpen(false)}
          >
            <div className="px-3 py-2">
              <div className="font-medium text-ink-body mb-0.5">Version</div>
              <div>Virgil v{appVersion}</div>
            </div>
            <div className="border-t border-edge-subtle" />
            <div
              className="relative flex items-center justify-between px-3 py-2 cursor-default hover-on-light"
              onMouseEnter={() => setCommandsPopoutOpen(true)}
            >
              <span className="font-medium text-ink-body">Commands</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {commandsPopoutOpen && (
                <div
                  className="absolute left-full top-0 ml-1 menu-surface text-xs text-ink-body py-1 min-w-[160px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {VIRGIL_COMMAND_NAMES.map((name) => (
                    <button
                      key={name}
                      onClick={() => onInsertVirgilCommand(name)}
                      className="block w-full text-left px-3 py-1 font-mono text-ink-body hover-on-light"
                    >
                      {`\\${name}`}
                    </button>
                  ))}
                  <div className="border-t border-edge-subtle mt-1 pt-1.5 pb-1 px-3 text-[10px] text-ink-muted flex items-center gap-1">
                    <span>Type text +</span>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 10 4 15 9 20" />
                      <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
            <div className="border-t border-edge-subtle" />
            {/* Refresh skills — the manual re-sync (formerly a persistent
                top-bar icon). An edge action: auto-sync runs on doc-open, so
                this is only for force-refresh or re-granting FSA permission
                after a revoked grant. A menu click is still a user gesture, so
                the permission re-grant path is preserved. Only meaningful with
                a paper open. Sync failures still surface loudly via the
                SkillSyncControls pill above, independent of this item.
                Task 1131: a SUCCESSFUL sync is informational, so it is not on
                the bar — its version and the restart hint live on this row. */}
            {hasDoc && (
              <button
                onClick={() => {
                  // The new sync supersedes the last one's note.
                  onDismissSkillSyncNotice();
                  onResyncSkills();
                  setHelperMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover-on-light flex items-center justify-between gap-3"
                data-hint="Re-sync the skill bundle to this paper"
                data-skill-sync-notice={skillSyncNotice ? skillSyncNotice.version : undefined}
              >
                <span className="flex flex-col items-start gap-0.5">
                  <span>Refresh skills</span>
                  {skillSyncNotice && (
                    <span className="text-[10px] text-ink-subtle leading-snug">
                      Updated to v{skillSyncNotice.version} — restart your Claude
                      Code cowork session to pick up the new commands.
                    </span>
                  )}
                </span>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-ink-muted">
                  <path d="M2 5.2V12a1.2 1.2 0 0 0 1.2 1.2h9.6A1.2 1.2 0 0 0 14 12V6.2A1.2 1.2 0 0 0 12.8 5H7.4L6 3.2H3.2A1.2 1.2 0 0 0 2 4.4Z" />
                  <path d="M8 7.2v3.4M6.4 9.2 8 10.8l1.6-1.6" />
                </svg>
              </button>
            )}
            <button
              onClick={() => { onHelperToggle(); setHelperMenuOpen(false); }}
              className="w-full text-left px-3 py-2 hover-on-light flex items-center justify-between gap-3"
            >
              <span>Helper mode</span>
              <span className="text-[var(--accent)]">{helperOn ? "✓" : ""}</span>
            </button>
          </div>,
          document.body,
        )}
      </div>
      {/* The bar timer's ICON (task 354) — an ordinary tool, so it takes the
          ordinary tool rules: it lives inside the collapsible group and inside
          the zen gate, rather than minting an exception for itself. A timer is
          STARTED from a normal bar and stays VISIBLE in a stripped one, which
          is the asymmetry the widget's placement above encodes. Prop-less for
          the same reason the widget is; its status dot is what keeps a timer
          running behind a closed widget visible. */}
      <PomodoroToggleButton />
      {/* Print — opens a dialog with toggles for which document elements and
          panel appendices to include. Disabled in code/PDF view. */}
      <button
        onClick={() => setPrintOpen((v) => !v)}
        disabled={!currentDocId || codeView || pdfView}
        className="topbarbtn"
        aria-pressed={printOpen}
        {...iconHint({ label: "Print" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      </button>
      {/* AI request — sun-star. Mode toggle: clicking again closes the
          window. */}
      <button
        onClick={() => setAiWindowOpen((v) => !v)}
        className="topbarbtn relative"
        aria-pressed={aiWindowOpen}
        {...iconHint({ label: "AI requests" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <g transform="rotate(15 12 12)">
            {/* Cardinals */}
            <line x1="12" y1="2" x2="12" y2="22" />
            <line x1="2" y1="12" x2="22" y2="12" />
            {/* Diagonals (length 10 each half = matches cardinals) */}
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            <line x1="19.07" y1="4.93" x2="4.93" y2="19.07" />
          </g>
        </svg>
        {/* The producer names the STATE, so nothing maps a state to a colour
            here — the tone travels straight through (task 315). Decorative:
            the button it overlays carries its own hint + aria-label. */}
        {vbar.aiDot && (
          <StatusDot tone={vbar.aiDot} size="sm" className="absolute top-0 right-0" />
        )}
      </button>
      {/* ── Document style ─────────────────────────────────────────
          Mode toggle: opens ManageStylesModal. aria-pressed mirrors the
          modal's open state. */}
      <button
        onClick={() => setManageStylesOpen((v) => !v)}
        disabled={!currentDocId}
        className="topbarbtn"
        aria-pressed={manageStylesOpen}
        data-hint="Document style"
      >
        Style
      </button>
      {/* Code view toggle — reads local `codeView` (not `vbar.codeView`)
          because EditorPane unmounts in code view, leaving paneState's mirror
          stale. `onToggleCodeView` dispatches to the correct switchTo/switchFrom
          internally. */}
      <button
        onClick={onToggleCodeView}
        className="topbarbtn"
        aria-pressed={codeView}
        data-hint="Code"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
          <line x1="14.5" y1="4" x2="9.5" y2="20" />
        </svg>
        Code
      </button>
      {/* Compile — runs SwiftLaTeX's pdfTeX over the paper folder. Disabled
          while a compile is in flight; the in-flight spinner is the protected
          tier's `compile` status item (task 1353), so it shows once, and shows
          while the tools are collapsed. */}
      <button
        onClick={vbar.compilePdf}
        disabled={!currentDocId || vbar.isCompiling}
        className="topbarbtn"
        data-hint="Compile"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <polygon points="6 4 20 12 6 20 6 4" />
        </svg>
        Compile
      </button>
      {/* PDF view toggle. Read local `pdfView` directly for the toggle's own
          pressed state (the view flag lives at the shell level). Since task
          1320 the PDF opens in the right-hand pane of the text split (the
          slot code view uses), so the editor stays visible beside it; the
          PDF and the `vbar.pdfStale` dot read the pane's live bubbled state. */}
      <button
        onClick={onTogglePdfView}
        disabled={!currentDocId}
        className="topbarbtn"
        aria-pressed={pdfView}
        data-hint={pdfView ? "Hide PDF" : "View PDF"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        PDF
        {vbar.pdfStale && pdfView && (
          <StatusDot tone="warn" size="sm" className="ml-1" label="PDF is out of date" />
        )}
      </button>
      </>)}
      </>)}
      </div>
      </div>
      </div>
      {/* Collapse toggle — TIER 1 (protected): always rendered, never hidden,
          because it is what makes a collapse REVERSIBLE. Hides everything to
          its left in this cluster so the document area can breathe. The user's
          own choice is per-window state in useViewPrefs; since task 395 the
          click routes through the bar's occupancy hook instead of writing the
          pref directly, so expanding out of an AUTO collapse out-ranks the
          rule rather than clearing a pref the user never set. */}
      <button
        ref={collapseChipRef}
        onClick={() =>
          onToggleTools
            ? onToggleTools()
            : setTopbarRightCollapsed((v) => !v)
        }
        className="topbarbtn"
        aria-pressed={topbarRightCollapsed}
        {...iconHint({ label: topbarRightCollapsed ? "Expand toolbar" : "Collapse toolbar", hint: "Collapse toolbar" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {topbarRightCollapsed ? (
            <>
              <polyline points="11 17 6 12 11 7" />
              <polyline points="18 17 13 12 18 7" />
            </>
          ) : (
            <>
              <polyline points="13 17 18 12 13 7" />
              <polyline points="6 17 11 12 6 7" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}

export const StatusCluster = memo(StatusClusterImpl);
