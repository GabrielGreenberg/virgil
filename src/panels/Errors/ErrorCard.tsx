"use client";

import { useCallback, useRef } from "react";
import {
  CARD_THEMES,
  PanelCard,
  CardTargetIcon,
  CardTypeLabel,
  CardDragHandle,
} from "@/components/panel-primitives";
import { useInOmni } from "@/components/editor-layout/contexts/omni";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { popKey } from "@/panels/panel-registry";
import type { LatexError, LatexErrorSeverity } from "@/lib/latex-errors";
import { MIME_TEXT_INSERT } from "@/lib/marginalia";

const theme = CARD_THEMES.error;

const SEVERITY_COLOR: Record<LatexErrorSeverity, string> = {
  error: "var(--danger)",
  warning: "#b45757",
  info: "#7191b0",
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
      className="inline-flex items-center justify-center w-5 h-5 shrink-0"
      title={severity}
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
  hasAnchor: boolean;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl: HTMLElement | null) => void;
  onDismiss: (id: string) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}

export function ErrorCard({
  err,
  title,
  snippet,
  selected,
  hasAnchor,
  onSelect,
  onJump,
  onDismiss,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: ErrorCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const popped = usePoppedCards();
  const cardKey = popKey("errors", err.id);
  const onToggleFromCtx = onTogglePopout
    ?? (popped
      ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor)
      : undefined);
  const inOmni = useInOmni() != null;
  const compressed = !selected && !isPoppedOut;

  // TODO(grip-redesign): drop-into-document via the grip is disabled
  // during the unified header redesign. Re-introduce thoughtfully via a
  // separate body-level affordance, not the grip. Original helper:
  // const handleDragStart = useCallback(
  //   (e: React.DragEvent) => {
  //     e.stopPropagation();
  //     const plain = `${title}${err.line > 0 ? ` (line ${err.line})` : ""}: ${err.message}`;
  //     e.dataTransfer.setData("text/plain", plain);
  //     e.dataTransfer.setData(
  //       MIME_TEXT_INSERT,
  //       JSON.stringify({
  //         content: {
  //           type: "doc",
  //           content: [
  //             { type: "paragraph", content: [{ type: "text", text: plain }] },
  //           ],
  //         },
  //       }),
  //     );
  //     e.dataTransfer.effectAllowed = "copy";
  //     if (cardRef.current) {
  //       e.dataTransfer.setDragImage(cardRef.current, 20, -10);
  //     }
  //   },
  //   [title, err.line, err.message],
  // );

  const card = (
    <PanelCard
      ref={cardRef}
      data-card-key={cardKey}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onTrashClick={() => onDismiss(err.id)}
      extraCardClass=""
      className="focus:outline-none"
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(err.id);
        onJump?.((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      onKeyDown={(e) => {
        if (!selected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDismiss(err.id);
        }
      }}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{
          backgroundColor: selected ? theme.headerSelected : theme.headerDefault,
          borderLeft: `3px solid ${SEVERITY_COLOR[err.severity]}`,
        }}
      >
        <CardDragHandle />

        <ErrorBadge severity={err.severity} />

        {inOmni && <CardTypeLabel kind="error" />}

        <div
          className="flex-1 min-w-0 truncate text-[0.78rem] font-medium"
          style={{ color: theme.titleColor, letterSpacing: "0.02em" }}
          title={title}
        >
          {title}
        </div>

        <CardTargetIcon
          selected={selected}
          disabled={!onJump}
          onClick={(e) => {
            e.stopPropagation();
            onJump?.((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
          }}
          title={
            hasAnchor || err.line > 0 ? "Jump to in text" : "No location"
          }
        />
      </div>

      <div
        className={`border-t transition-colors ${selected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={selected ? { borderTopColor: theme.separatorSelected } : undefined}
      />

      {compressed ? (
        <div className="px-3 pt-1 pb-1.5 text-xs text-ink-subtle truncate">
          {err.line > 0 && (
            <span className="text-ink-muted mr-1">
              line {err.line}
              {err.column ? `:${err.column}` : ""} —
            </span>
          )}
          {err.message}
        </div>
      ) : (
      <div
        className={`px-3 pt-1.5 pb-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
      >
        {snippet && (
          <div className="text-xs italic text-[var(--muted)] border-l-2 border-edge-subtle pl-2 py-0.5 mb-1.5 font-mono truncate">
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

  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
