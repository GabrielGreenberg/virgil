"use client";

import {
  Fragment,
  memo,
  useLayoutEffect,
  useRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { SkillSyncError, SkillSyncNotice } from "@/hooks/useFiles";
import { SoftwareUpdateBanner } from "@/components/SoftwareUpdateBanner";
import CoworkPenBadge from "@/components/CoworkPenBadge";
import { MirrorRecoveryBadge } from "@/components/MirrorRecoveryBadge";
import { SaveStateBadge } from "@/components/SaveStateBadge";
import SkillSyncControls from "../SkillSyncControls";
import { BarMoreMenu, BAR_VIEW_LABEL, type BarView } from "./BarMoreMenu";
import CollabStatusPill from "../CollabStatusPill";
import ExternalChangeBadge from "../ExternalChangeBadge";
import PreservationNoticeBadge from "../PreservationNoticeBadge";
import SyncConflictBadge from "../SyncConflictBadge";
import { PomodoroTimer } from "../PomodoroTimer";
import { BarModeDivider, CompileStatusChip, FocusViewChip, HelperModeChip, ZenModeChip } from "@/components/BarModeChips";
import { BarStatusAnnouncer } from "@/components/status/BarStatusAnnouncer";
import { iconHint } from "@/components/Hint";
import { SegmentedToggle, type SegmentedOption } from "@/components/SegmentedToggle";
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
  // Whether the bar's owning layout is in zen mode (suppresses the
  // collapsible tool group and the status pills zen hides). Collab is NOT a prop: every reader
  // (the collab pill, the mode divider) takes the one CollabContext, so a
  // collab pen/presence tick re-renders only those leaves.
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
   * The ⋯ menu's Hide/Show toolbar row, supplied by `TopBar`'s occupancy hook
   * so that expanding out of an AUTO collapse can out-rank the rule instead of
   * writing a pref the user never set. Falls back to a plain pref toggle for a
   * bare mount, so the row is never a control that does nothing.
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
  setPreferencesOpen: Dispatch<SetStateAction<boolean>>;

  // Bug-report drop window (dev tool; rendered only when the per-machine
  // `virgil:bug-report` flag + FSA gate resolves true — see EditorLayout).
  bugReportEnabled: boolean;
  setBugReportOpen: Dispatch<SetStateAction<boolean>>;

  // The ⋯ menu (`BarMoreMenu` — its open state, anchor and sub-menu are its own).
  appVersion: string;
  onInsertVirgilCommand: (name: string) => void;

  // Print / AI-window / Style / Code / Compile / PDF buttons.
  currentDocId: string | null;
  codeView: boolean;
  pdfView: boolean;
  setPrintOpen: Dispatch<SetStateAction<boolean>>;
  aiWindowOpen: boolean;
  setAiWindowOpen: Dispatch<SetStateAction<boolean>>;
  setManageStylesOpen: Dispatch<SetStateAction<boolean>>;
  onToggleCodeView: () => void;
  onTogglePdfView: () => void;
};

function StatusClusterImpl(props: StatusClusterProps) {
  const {
    vbar,
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
    setPreferencesOpen,
    bugReportEnabled,
    setBugReportOpen,
    appVersion,
    onInsertVirgilCommand,
    currentDocId,
    codeView,
    pdfView,
    setPrintOpen,
    aiWindowOpen,
    setAiWindowOpen,
    setManageStylesOpen,
    onToggleCodeView,
    onTogglePdfView,
  } = props;

  // ── Collapse focus hand-off (task 395) ──────────────────────────────────
  // The group is hidden by `aria-hidden` + `visibility: hidden` and its
  // children are remounted, so a collapse that lands while focus is INSIDE it
  // drops the caret to <body> and, for one commit, puts `aria-hidden` over the
  // focused element — which ARIA forbids and which loses the user's place with
  // nothing on screen to explain it. Focus moves to ⋯ instead: it is TIER 1
  // (always rendered) and holds the tools while they are folded, so it is the
  // correct landing spot rather than merely a safe one.
  // A LAYOUT effect, so the move happens in the same commit that hides the
  // group — a passive one would let a frame paint with focus in a hidden
  // subtree.
  // `document.activeElement` is the WRONG question by the time the effect can
  // ask it: the collapse REMOUNTS the group's children, so React has already
  // detached the focused button and the browser has already dropped focus to
  // <body>. What survives the commit is the tracked fact, so the group records
  // focus-within itself — `focusin` sets it, `focusout` clears it (including
  // the legitimate move to ⋯, which is outside the group), and node
  // REMOVAL fires neither, which is exactly why the flag is still true when
  // the effect runs. Asking `activeElement === body` instead would steal focus
  // whenever the bar auto-collapsed with nothing focused at all.
  const toolsGroupRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const groupHadFocusRef = useRef(false);
  useLayoutEffect(() => {
    if (!topbarRightCollapsed) return;
    if (!groupHadFocusRef.current) return;
    groupHadFocusRef.current = false;
    moreMenuRef.current?.querySelector("button")?.focus();
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
    // the ⋯ menu's "Refresh skills" row (BarMoreMenu).
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
    // (Focus from the Outline / card actions, Helper from the ⋯ menu,
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
    // Zen's off-switch (task 1552): zen strips the bar to it, so it is a
    // protected mode chip, not a tool — a collapsed toolbar cannot hide it.
    zen: <ZenModeChip onExit={onToggleZen} />,
  };

  // The bar's switch names what the right-hand pane shows. The pane has one
  // slot, so `code` and `pdf` can't both be on and the three are a real choice.
  const view: BarView = codeView ? "code" : pdfView ? "pdf" : "text";
  const setView = (next: BarView) => {
    if (next === view) return;
    if (next === "code") return onToggleCodeView();
    if (next === "pdf") return onTogglePdfView();
    if (codeView) onToggleCodeView();
    if (pdfView) onTogglePdfView();
  };
  const noPaper = "Open a paper first";
  const pdfBlocked = currentDocId ? undefined : noPaper;
  const compileBlocked = !currentDocId
    ? noPaper
    : vbar.isCompiling
      ? "Already compiling"
      : undefined;
  const printBlocked = !currentDocId
    ? noPaper
    : codeView || pdfView
      ? "Switch to Text to print"
      : undefined;
  const viewOptions: readonly SegmentedOption<BarView>[] = [
    { value: "text", label: BAR_VIEW_LABEL.text, hint: "Text only" },
    { value: "code", label: BAR_VIEW_LABEL.code, hint: "LaTeX source beside the text" },
    {
      value: "pdf",
      label: (
        <>
          {BAR_VIEW_LABEL.pdf}
          {vbar.pdfStale && pdfView && (
            <StatusDot tone="warn" size="sm" className="ml-1" label="PDF is out of date" />
          )}
        </>
      ),
      hint: "Compiled PDF beside the text",
      disabled: !!pdfBlocked,
      disabledHint: pdfBlocked,
    },
  ];

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
          the last one from what follows (the first tool, or ⋯ when
          the tools are collapsed). It sits on the segment, not as a root
          `gap`, because the collapsed tool group is a zero-width flex item a
          root gap would double around. Every hidden item returns null, so an
          all-quiet segment is `:empty` and `empty:hidden` takes its margin
          with it. Not an occupancy box: useBarOccupancy measures only the tab
          strip, the tab row and the tools wrapper. */}
      {/* The bar's ONE announcer (task 1390): mounted for the cluster's
          life, so a pill's sentence lands in a region assistive tech already
          knows. Its two visually-hidden regions sit OUTSIDE the segment, so
          an all-quiet segment stays `:empty`. */}
      <BarStatusAnnouncer>
      <div
        data-bar-segment="status"
        className="flex items-center gap-[var(--bar-occupant-gap)] mr-[var(--bar-occupant-gap)] empty:hidden"
      >
        {BAR_STATUS_ORDER.map((id) => (
          <Fragment key={id}>{statusItems[id]}</Fragment>
        ))}
      </div>
      </BarStatusAnnouncer>
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
          ⋯ sits OUTSIDE this key (below), so its own open menu is unaffected
          by a collapse; no other surface keeps open state outside the group,
          so there is nothing further to gate. */}
      <div key={topbarRightCollapsed ? "collapsed" : "expanded"} className="flex items-center gap-1.5">
      {(<>
      {/* Divider between the mode chips and the tools. It lives IN the
          group, so it shows only while the tools are expanded; whether a mode
          chip is on is answered by the chips' own policy verdicts
          (`useAnyBarModeVisible`, task 1391), never re-derived here. */}
      <BarModeDivider focusActive={focusActive} helperOn={helperOn} />
      {/* In zen the tools are stripped entirely — zen's off-switch is the
          protected tier's `zen` chip (task 1552), so it survives a collapse;
          the rest of the time Zen lives in ⋯ with the other occasional tools. */}
      {!zenModeOn && (<>
      {/* The right-hand pane, as one choice. Reads local `codeView` / `pdfView`
          (not `vbar`) because EditorPane unmounts in code view, leaving
          paneState's mirror stale; the stale dot is the pane's live bubbled
          state. */}
      <SegmentedToggle
        ariaLabel="View"
        size="bar"
        value={view}
        onChange={setView}
        options={viewOptions}
      />
      {/* Compile — runs SwiftLaTeX's pdfTeX over the paper folder. Disabled
          while a compile is in flight; the in-flight spinner is the protected
          tier's `compile` status item (task 1353), so it shows once, and shows
          while the tools are collapsed. A soft tile, not a fill: compiling is not
          something you do often. */}
      <button
        onClick={vbar.compilePdf}
        disabled={!!compileBlocked}
        className="topbarbtn topbarbtn-tile"
        data-hint={compileBlocked ?? "Compile"}
      >
        Compile
      </button>
      {/* AI request — sun-star. Mode toggle: clicking again closes the
          window. */}
      <button
        onClick={() => setAiWindowOpen((v) => !v)}
        className="topbarbtn relative"
        aria-pressed={aiWindowOpen}
        {...iconHint({ label: "AI requests" })}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
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
      </>)}
      </>)}
      </div>
      </div>
      </div>
      {/* ⋯ — TIER 1 (protected): always rendered, never hidden, because it
          is what keeps a folded tool reachable and what makes a collapse
          REVERSIBLE. Its own width never depends on the verdict, which is what
          keeps the occupancy predicate state-independent; the folded tools'
          rows appear inside it. The user's own collapse is per-window state in
          useViewPrefs; since task 395 the row routes through the bar's
          occupancy hook instead of writing the pref directly, so expanding out
          of an AUTO collapse out-ranks the rule rather than clearing a pref the
          user never set. */}
      <div ref={moreMenuRef} className="ml-1.5 flex items-center">
        <BarMoreMenu
          appVersion={appVersion}
          hasDoc={hasDoc}
          skillSyncNotice={skillSyncNotice}
          onResyncSkills={onResyncSkills}
          onDismissSkillSyncNotice={onDismissSkillSyncNotice}
          helperOn={helperOn}
          onHelperToggle={onHelperToggle}
          onInsertVirgilCommand={onInsertVirgilCommand}
          zenOn={zenModeOn}
          onToggleZen={onToggleZen}
          onOpenStyle={() => setManageStylesOpen(true)}
          styleBlocked={currentDocId ? undefined : noPaper}
          onOpenPrint={() => setPrintOpen(true)}
          printBlocked={printBlocked}
          onOpenPreferences={() => setPreferencesOpen(true)}
          onEnableCollab={onEnableCollab}
          onDisableCollab={onDisableCollab}
          onOpenBugReport={bugReportEnabled ? () => setBugReportOpen(true) : undefined}
          toolsCollapsed={topbarRightCollapsed}
          onToggleTools={
            onToggleTools ?? (() => setTopbarRightCollapsed((v) => !v))
          }
          view={view}
          onViewChange={setView}
          pdfBlocked={pdfBlocked}
          onCompile={vbar.compilePdf}
          compileBlocked={compileBlocked}
          onOpenAiRequests={() => setAiWindowOpen(true)}
        />
      </div>
    </div>
  );
}

export const StatusCluster = memo(StatusClusterImpl);
