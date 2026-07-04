"use client";

import {
  memo,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import type { SkillSyncError, SkillSyncNotice } from "@/hooks/useFiles";
import { VIRGIL_COMMAND_NAMES } from "@/lib/tiptap-extensions";
import { applyUpdate } from "@/hooks/useUpdateAvailable";
import { OPEN_CHROME_MENU_Z } from "@/floats/float-policy";
import SkillSyncControls from "../SkillSyncControls";
import CollabStatusPill from "../CollabStatusPill";
import ExternalChangeBadge from "../ExternalChangeBadge";
import { ExternalChangeActiveReporter } from "./ExternalChangeActiveReporter";

/** The subset of the (memoized) Virgil-bar `vbar` value this cluster reads. */
export type StatusClusterVBar = {
  aiDot: "red" | "green" | "yellow" | null;
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
  topbarRightCollapsed: boolean;
  setTopbarRightCollapsed: Dispatch<SetStateAction<boolean>>;

  // Service-worker update banner.
  updateAvailable: boolean;

  // Skill-sync surface.
  hasDoc: boolean;
  skillSyncError: SkillSyncError | null;
  skillSyncNotice: SkillSyncNotice | null;
  onResyncSkills: () => void;
  onDismissSkillSyncError: () => void;
  onDismissSkillSyncNotice: () => void;

  // Status-marker slices.
  externalChangeActive: boolean;
  setExternalChangeActive: (active: boolean) => void;
  focusActive: boolean;
  onFocusDeactivate: () => void;
  helperOn: boolean;
  onHelperToggle: () => void;

  // Collab (CollabStatusPill is built here from stable handlers).
  onEnableCollab: () => void;
  onEditIdentity: () => void;
  onDisableCollab: () => void;

  // Zen + preference-mode toggles.
  onToggleZen: () => void;
  preferencesOpen: boolean;
  setPreferencesOpen: Dispatch<SetStateAction<boolean>>;

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
    updateAvailable,
    hasDoc,
    skillSyncError,
    skillSyncNotice,
    onResyncSkills,
    onDismissSkillSyncError,
    onDismissSkillSyncNotice,
    externalChangeActive,
    setExternalChangeActive,
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

  const collabIconBtn = (
    <CollabStatusPill
      onEnableRequest={onEnableCollab}
      onEditIdentity={onEditIdentity}
      onDisable={onDisableCollab}
      variant="icon"
    />
  );
  const collabBadge = (
    <CollabStatusPill
      onEnableRequest={onEnableCollab}
      onEditIdentity={onEditIdentity}
      onDisable={onDisableCollab}
      variant="badge"
    />
  );

  return (
    <div className="shrink-0 flex items-center px-2">
      {/* Service-worker update banner. Visible whenever a new SW has
          installed and is waiting. Sits before the topbarRightCollapsed gate
          so an update prompt isn't hidden by the user's collapsed-right
          setting. */}
      {updateAvailable && (
        <button
          onClick={applyUpdate}
          className="topbarbtn"
          data-hint="Virgil update"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5" />
            <path d="M13.5 2.5v3h-3" />
            <path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5" />
            <path d="M2.5 13.5v-3h3" />
          </svg>
          Virgil update — click to refresh
        </button>
      )}
      {/* Skill-bundle sync surface. Sits before the topbarRightCollapsed gate
          (like the Virgil-update banner) so a sync failure can't be hidden by
          a collapsed right toolbar. Pure UI: no per-keystroke work. */}
      <SkillSyncControls
        error={skillSyncError}
        notice={skillSyncNotice}
        onResync={onResyncSkills}
        onDismissError={onDismissSkillSyncError}
        onDismissNotice={onDismissSkillSyncNotice}
      />
      {!topbarRightCollapsed && (<>
      {/* ── Status-indicator group (left of divider) ───────────────
          Passive indicators for system-wide modes that are activated
          elsewhere (Focus from card actions, Helper from the "?" menu,
          Collab from the icon button on the right). Each entry doubles as
          the off-toggle for its mode. Stays empty when nothing's active.
          Suppressed in zen mode. */}
      {!zenModeOn && (
        <div className="flex items-center">
          {/* Reporter: a provider-descendant that lifts the badge-active
              boolean up into EditorLayout so the divider gate can OR it in.
              Renders nothing itself. */}
          <ExternalChangeActiveReporter onActiveChange={setExternalChangeActive} />
          {focusActive && (
            <button
              onClick={onFocusDeactivate}
              className="topbarbtn"
              aria-pressed="true"
              data-hint="Focus view"
            >
              Focus view
            </button>
          )}
          {helperOn && (
            <button
              onClick={onHelperToggle}
              className="topbarbtn"
              aria-pressed="true"
              data-hint="Exit helper mode"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M5.8 6.2a2.2 2.2 0 0 1 4.08.8c0 1.2-1.68 1.6-1.68 1.6" />
                <circle cx="8" cy="11.5" r="0.3" fill="currentColor" stroke="none" />
              </svg>
              Helper mode
            </button>
          )}
          {collabEnabled && collabBadge}
          {/* External-change badge — self-gates (renders null when
              severity == null), so it's mounted unconditionally inside the
              cluster. Sits left of the divider, beside the collab pill. */}
          <ExternalChangeBadge />
        </div>
      )}
      {/* Divider — only shown when there's at least one status marker on the
          left, so the line reads as a real boundary between markers and
          standard buttons. Suppressed in zen mode regardless. */}
      {!zenModeOn && (focusActive || helperOn || collabEnabled || externalChangeActive) && (
        <span
          aria-hidden
          className="self-center h-5 w-px mx-2"
          style={{ background: "var(--edge-strong, #a8a29e)" }}
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
      {/* ── Preference Mode toggle ─────────────────────────────────
          Flips the global preference-mode state. When on, every DOM element
          with `data-prefs="<pref-key>"` becomes ctrl+clickable and opens a
          picker showing just those preference entries. */}
      {collabIconBtn}
      <button
        onClick={() => setPreferencesOpen((v) => !v)}
        className="topbarbtn"
        aria-pressed={preferencesOpen}
        data-hint="Preferences"
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
          data-hint="Help"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.5 9a2.75 2.75 0 0 1 5.25 1.1c0 1.6-2.25 2.4-2.75 3.4" />
            <path d="M12 17h.01" />
          </svg>
        </button>
        {helperMenuOpen && typeof document !== "undefined" && createPortal(
          <div
            ref={helperPositionRef}
            className="bg-surface border border-edge-subtle rounded shadow-md text-xs text-ink-body whitespace-nowrap text-left min-w-[160px]"
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
                  className="absolute left-full top-0 ml-1 bg-surface border border-edge-subtle rounded shadow-md text-xs text-ink-body py-1 min-w-[160px]"
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
                SkillSyncControls banner above, independent of this item. */}
            {hasDoc && (
              <button
                onClick={() => { onResyncSkills(); setHelperMenuOpen(false); }}
                className="w-full text-left px-3 py-2 hover-on-light flex items-center justify-between gap-3"
                data-hint="Re-sync the skill bundle to this paper"
              >
                <span>Refresh skills</span>
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
      {/* Print — opens a dialog with toggles for which document elements and
          panel appendices to include. Disabled in code/PDF view. */}
      <button
        onClick={() => setPrintOpen((v) => !v)}
        disabled={!currentDocId || codeView || pdfView}
        className="topbarbtn"
        aria-pressed={printOpen}
        data-hint="Print"
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
        data-hint="AI requests"
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
        {vbar.aiDot && (
          <span
            className="absolute top-0 right-0 w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor:
                vbar.aiDot === "red" ? "#ef4444"
                : vbar.aiDot === "green" ? "#22c55e"
                : "#eab308",
            }}
          />
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
          while a compile is in flight; spinner replaces the play-triangle. */}
      <button
        onClick={vbar.compilePdf}
        disabled={!currentDocId || vbar.isCompiling}
        className="topbarbtn"
        data-hint="Compile"
      >
        {vbar.isCompiling ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="6 4 20 12 6 20 6 4" />
          </svg>
        )}
        Compile
      </button>
      {/* PDF view toggle — same indirection trap as code view: EditorPane
          unmounts in PDF view so paneState's mirror goes stale. Read local
          `pdfView` directly. */}
      <button
        onClick={onTogglePdfView}
        disabled={!currentDocId}
        className="topbarbtn"
        aria-pressed={pdfView}
        data-hint={pdfView ? "Back to editor" : "View PDF"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        PDF
        {vbar.pdfStale && pdfView && (
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 ml-1" data-hint="PDF is out of date" aria-label="PDF is out of date" />
        )}
      </button>
      </>)}
      </>)}
      {/* Collapse toggle — always rendered. Hides everything to its left in
          this cluster so the document area can breathe. State is per-window
          via useViewPrefs. */}
      <button
        onClick={() => setTopbarRightCollapsed((v) => !v)}
        className="topbarbtn"
        aria-pressed={topbarRightCollapsed}
        aria-label={topbarRightCollapsed ? "Expand toolbar" : "Collapse toolbar"}
        data-hint="Collapse toolbar"
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
