"use client";

import { useRef } from "react";
import {
  CARD_THEMES,
  PanelCard,
  compressedBodyStyle,
  useCardDeleteKey,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import type { LatexError, LatexErrorSeverity } from "@/lib/latex-errors";
import { canJumpToError, type ErrorJumpMode } from "./error-jump";

const theme = CARD_THEMES.error;

const SEVERITY_COLOR: Record<LatexErrorSeverity, string> = {
  error: "var(--danger)",
  // `warning` IS the error-panel identity color — derive it from the theme
  // (DEFAULT_PANEL_COLORS.error, non-overridable per SYSTEM_THEME_KEYS) so it
  // can't drift from the rest of the error palette. D-3/R27.
  warning: theme.accent,
  // `info` is a deliberate severity CONSTANT (steel), not a theme token: it
  // signals "informational, not the panel's alarm color" and must stay
  // distinct from the warning/error ramp. Tokenized as --status-info (its own
  // dedicated member of the status-dot family) — NOT aliased to another
  // panel's accent (e.g. archive/--latex-comment-color) just because the hex
  // coincides.
  info: "var(--status-info)",
};

/** Short, stable title derived from rule id / message. Prefers a known rule
 *  id (e.g. "Missing reference") so the card's header scans at a glance. */
export function errorTitle(err: LatexError): string {
  if (err.ruleId) {
    switch (err.ruleId) {
      case "ref-undefined":
        return "Missing reference";
      case "cite-undefined":
        return "Missing citation";
      case "env-mismatch":
        return "Environment mismatch";
      case "brace-unbalanced":
        return "Unbalanced braces";
      case "math-unbalanced":
        return "Unbalanced math";
      case "parse-failure":
        return "Parse error";
      case "offline-package":
        return "Package unavailable offline";
      default:
        return err.ruleId.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
    }
  }
  const firstLine = err.message.split("\n")[0];
  return firstLine.length > 60 ? firstLine.slice(0, 60) + "\u2026" : firstLine;
}

/** Triangle-with-exclamation badge, sized to match BadgeLabel. */
function ErrorBadge({ severity }: { severity: LatexErrorSeverity }) {
  const color = SEVERITY_COLOR[severity];
  return (
    <span
      className="inline-flex items-center justify-center w-[18px] h-[18px] shrink-0"
      data-hint={severity} aria-label={severity}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 3 L22 20 L2 20 Z" />
        <line x1="12" y1="10" x2="12" y2="14" />
        <line x1="12" y1="17" x2="12" y2="17.01" />
      </svg>
    </span>
  );
}

export interface ErrorCardProps {
  err: LatexError;
  title: string;
  /** Source snippet from the offending line (auto-assigned from the
   *  document). Shown as a quoted header fragment, like revision cards. */
  snippet?: string;
  selected: boolean;
  /** Panel-local expansion (R5: `error` is non-anchored — not in the shared
   *  cardStore — so its expand axis lives in `ErrorsPanel`, independent of
   *  selection like every other card post-A4). Drives the body compression. */
  expanded: boolean;
  /** Body-click composition (R1): select + expand. Idempotent set-true. */
  onExpand: () => void;
  /** Axis-pure expansion toggle (never selection). Composed with `onSelect`
   *  into the header-click contract (select + toggle, no jump). */
  onToggleExpanded: () => void;
  hasAnchor: boolean;
  /** The MOUNT's jump semantics (task 125) — `"anchor"` for the visual mounts
   *  (docked panel + omni mirror), `"line"` for the code-view sidebar. Required:
   *  the two mounts want opposite answers for the same error, so there is no
   *  safe default to fall back on, and a card that guesses is the bug this prop
   *  exists to retire. Comes from the `ErrorJump` capability its host forwards,
   *  so it always matches the handler in `onJump`. */
  jumpMode: ErrorJumpMode;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onDismiss: (id: string) => void;
  onHoverChange?: (hovering: boolean) => void;
  extraDataAttrs?: Record<string, string>;
}

export function ErrorCard({
  err,
  title,
  snippet,
  selected,
  expanded,
  onExpand,
  onToggleExpanded,
  hasAnchor,
  jumpMode,
  onSelect,
  onJump,
  onDismiss,
  onHoverChange,
  extraDataAttrs,
}: ErrorCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const compressed = !expanded;
  const compressedLines = useCompressedLines();
  const handleDeleteKey = useCardDeleteKey(selected, () => onDismiss(err.id));

  // ONE jumpability answer per card, from the mount's declared semantics
  // (task 125) — used by BOTH the action (the body click below) and the
  // affordance (`PanelCard.canJump`), so the two cannot diverge. Note the
  // affordance is currently inert for this kind: `PanelCard` renders the jump
  // chevron only when popped out, and `error` is ratified NOT poppable (see
  // the note at the end of this component). The load-bearing gate is the
  // action; the affordance is kept correct so a future poppable errors card
  // inherits it rather than re-deriving the formula.
  const canJump = !!onJump && canJumpToError(err, jumpMode, hasAnchor);
  const jumpFromCard = (target: EventTarget & HTMLElement) => {
    if (!canJump) return;
    onJump?.(target.closest("[data-card]") as HTMLElement | null);
  };

  const card = (
    <PanelCard
      ref={cardRef}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={selected}
      isCollapsed={compressed}
      onToggleExpanded={onToggleExpanded}
      // Header click = select + toggle (ratified contract), threaded from the
      // panel-local expansion set — `error` has no slot in the shared cardStore.
      onHeaderActivate={() => {
        onSelect(err.id);
        onToggleExpanded();
      }}
      onTrashClick={() => onDismiss(err.id)}
      extraCardClass=""
      className="focus:outline-none"
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(err.id);
        onExpand();
        // Select + expand ALWAYS; jump only where this mount can actually
        // reach the error. Selection is what paints the editor's error
        // highlight, so a refused jump costs the user nothing.
        jumpFromCard(e.currentTarget as EventTarget & HTMLElement);
      }}
      onKeyDown={handleDeleteKey}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      kind="error"
      footnoteBadge={<ErrorBadge severity={err.severity} />}
      canJump={canJump}
      onJump={(e) => jumpFromCard(e.currentTarget as EventTarget & HTMLElement)}
    >
      {compressed ? (
        <div className="px-3 pt-1.5 pb-1.5 text-xs text-ink-subtle">
          <div style={compressedBodyStyle(compressedLines)}>
            <span
              className="font-medium text-[0.78rem] mr-2"
              style={{ color: theme.titleColor, letterSpacing: "0.02em" }}
            >
              {title}
            </span>
            {err.line > 0 && (
              <span className="text-ink-muted mr-1">
                line {err.line}
                {err.column ? `:${err.column}` : ""} —
              </span>
            )}
            {err.message}
          </div>
        </div>
      ) : (
      <div className="px-3 pt-1.5 pb-2">
        <div
          className="text-[0.78rem] font-medium mb-1"
          style={{ color: theme.titleColor, letterSpacing: "0.02em" }}
          data-hint={title} aria-label={title}
        >
          {title}
        </div>
        {snippet && (
          <div className="text-xs italic text-ink-muted border-l-2 border-edge-subtle pl-2 py-0.5 mb-1.5 font-mono truncate">
            {snippet}
          </div>
        )}

        <div className="text-[10px] mb-1 flex items-center gap-2 flex-wrap text-ink-muted">
          <span className="font-medium" style={{ color: SEVERITY_COLOR[err.severity] }}>
            {err.severity}
          </span>
          <span>·</span>
          <span>{err.source === "lint" ? "lint" : "compile"}</span>
          {err.line > 0 && (
            <>
              <span>·</span>
              <span>
                line {err.line}
                {err.column ? `:${err.column}` : ""}
              </span>
            </>
          )}
          {err.ruleId && (
            <>
              <span>·</span>
              <span>{err.ruleId}</span>
            </>
          )}
        </div>

        <div className="text-sm text-ink-body leading-snug break-words">
          {err.message}
        </div>

        {err.detail && (
          <div className="text-[11px] font-mono text-ink-muted mt-1 truncate">
            {err.detail}
          </div>
        )}
      </div>
      )}
    </PanelCard>
  );

  // `error` is ratified NOT poppable (audit §3.5): it has no `toFloatable`
  // registration, so the float dispatcher never renders one. The dead popout/
  // lift wiring was removed in the A1 gardening pass.
  return card;
}
