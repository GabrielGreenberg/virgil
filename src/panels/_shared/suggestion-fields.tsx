"use client";

/**
 * Shared suggestion-card field vocabulary for the Cutter and Revisions
 * panels. Their suggestion cards (CutterSuggestionCard /
 * RevisionSuggestionCard) had byte-identical copies of the field maps,
 * `FieldBlock`, `AuthorChip`, and the status/author header trailing — the
 * only real difference being the per-panel body typography key. This module
 * is the single source of truth; both cards consume it (Cutter passes
 * `panelKey="cut"`, Revisions `panelKey="revision"`).
 *
 * `FieldTitleRow` / `CopyButton` live here too (CutterSuggestionCard re-exports
 * them for backward compatibility).
 */

import { useRef, useState } from "react";
import { Chevron } from "@/components/panel-primitives";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { countWords } from "@/hooks/useWordCount";
import type { PanelBodyKey } from "@/lib/panel-typography";

export type SuggestionField =
  | "original_text"
  | "suggested_text"
  | "explanation"
  | "user_text"
  | "instructions";

/** The two cards share a
 *  `"pending" | "applied" | "stale" | "accepted" | "rejected"` status union.
 *  `applied`/`stale` are flag-ON-only (pending-changes-flag). */
export type SuggestionStatus =
  | "pending"
  | "applied"
  | "stale"
  | "accepted"
  | "rejected";
export type SuggestionAuthor = "human" | "ai";

export const STATUS_DOT: Record<SuggestionStatus, string> = {
  pending: "bg-blue-400",
  applied: "bg-sky-300",
  stale: "bg-amber-400",
  accepted: "bg-emerald-500",
  rejected: "bg-red-400",
};

export const STATUS_LABEL: Record<SuggestionStatus, string> = {
  pending: "Pending",
  applied: "Applied",
  stale: "Stale",
  accepted: "Accepted",
  rejected: "Rejected",
};

export const FIELD_LABEL: Record<SuggestionField, string> = {
  original_text: "Original",
  suggested_text: "Suggested",
  explanation: "Explanation",
  user_text: "Your text",
  instructions: "Instructions",
};

export const FIELD_PLACEHOLDER: Record<SuggestionField, string> = {
  original_text: "Target text…",
  suggested_text: "Replacement text…",
  explanation: "Why this change…",
  user_text: "Your revision…",
  instructions: "Instructions for the AI…",
};

export const FIELD_TEXTAREA_CLASS: Record<SuggestionField, string> = {
  original_text:
    "w-full bg-danger-soft border border-red-200 rounded px-2 py-1.5 text-red-700 placeholder:text-red-300 focus:outline-none focus:border-red-400 resize-none min-h-[36px]",
  suggested_text:
    "w-full bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5 text-emerald-800 placeholder:text-emerald-400 focus:outline-none focus:border-emerald-400 resize-none min-h-[36px]",
  explanation:
    "w-full bg-surface border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]",
  user_text:
    "w-full bg-surface-muted border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]",
  instructions:
    "w-full bg-surface-muted border border-[var(--border)] rounded px-2 py-1.5 placeholder:text-ink-muted focus:outline-none focus:border-edge-strong resize-none min-h-[36px]",
};

export const FIELD_ORDER: SuggestionField[] = [
  "original_text",
  "suggested_text",
  "explanation",
  "user_text",
];

// Per the design rule: substantive fields show a word count + copy button next
// to the section title. Explanation is meta and skips both.
export const FIELDS_WITH_WORD_COUNT: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
  "user_text",
  "instructions",
]);

/** Fields whose className already provides a deliberate color cue (red for
 *  original, green for suggested). At those textareas we apply only the
 *  registry's font family + size, not its color, so the visual cue is
 *  preserved. */
export const FIELDS_WITH_COLOR_CUE: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
]);

export function AuthorChip({ author }: { author: SuggestionAuthor }) {
  const isAi = author === "ai";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide ${
        isAi
          ? "bg-[var(--accent)]/10 text-[var(--accent)]"
          : "bg-surface-muted-strong text-ink-body"
      }`}
      data-hint={isAi ? "AI-authored" : "Human-authored"}
      aria-label={isAi ? "AI-authored" : "Human-authored"}
    >
      {isAi ? "AI" : "Human"}
    </span>
  );
}

/** Status dot + author chip + status label — the suggestion-card header
 *  trailing, shown docked and (via the `toFloatable` factory) in `FloatChrome`.
 *  Shared by both the cutter and revision suggestion cards. */
export function SuggestionTrailing({
  status,
  author,
}: {
  status: SuggestionStatus;
  author: SuggestionAuthor;
}) {
  return (
    <>
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[status]}`}
        data-hint={STATUS_LABEL[status]}
        aria-label={STATUS_LABEL[status]}
      />
      <AuthorChip author={author} />
      <span className="text-[10px] text-ink-muted">{STATUS_LABEL[status]}</span>
    </>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={handle}
      onMouseDown={(e) => e.stopPropagation()}
      disabled={!text}
      data-hint="Copy"
      data-hint-pos="above"
      aria-label="Copy"
      className="text-[var(--muted-light)] hover:text-ink-strong cursor-pointer disabled:opacity-40 disabled:cursor-default"
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

export function FieldTitleRow({
  label,
  kindHint,
  text,
  showCopy,
  showWordCount,
  folded,
  onToggleFold,
}: {
  label: string;
  kindHint?: string | null;
  text: string;
  showCopy: boolean;
  showWordCount: boolean;
  folded?: boolean;
  onToggleFold?: () => void;
}) {
  const words = countWords(text);
  return (
    <div className="flex items-center justify-between gap-2 mb-1">
      <div className="flex items-center gap-1.5 min-w-0">
        {onToggleFold && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFold();
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="text-[var(--muted)] hover:text-ink-strong cursor-pointer flex items-center"
            data-hint="Toggle fold"
            data-hint-pos="above"
            aria-label={folded ? "Expand" : "Collapse"}
            aria-expanded={!folded}
          >
            <Chevron expanded={!folded} />
          </button>
        )}
        <span className="text-[10px] text-[var(--muted)] uppercase tracking-wider font-medium">
          {label}
        </span>
        {kindHint && (
          <span className="text-[10px] text-[var(--muted-light)] lowercase">
            {kindHint}
          </span>
        )}
      </div>
      {(showWordCount || showCopy) && (
        <div className="flex items-center gap-2 shrink-0">
          {showWordCount && (
            <span className="text-[10px] text-[var(--muted-light)] tabular-nums">
              {words} {words === 1 ? "word" : "words"}
            </span>
          )}
          {showCopy && <CopyButton text={text} />}
        </div>
      )}
    </div>
  );
}

/** A single labelled suggestion field (title row + textarea). `panelKey`
 *  selects the per-panel body typography ("cut" or "revision"); everything
 *  else is shared. */
export function FieldBlock({
  field,
  value,
  onChange,
  readOnly,
  kindHint,
  panelKey,
}: {
  field: SuggestionField;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  kindHint?: string | null;
  panelKey: PanelBodyKey;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();
  const [folded, setFolded] = useState(false);
  const bodyStyle = usePanelBodyStyle(panelKey);
  const textareaStyle: React.CSSProperties = FIELDS_WITH_COLOR_CUE.has(field)
    ? { fontFamily: bodyStyle.fontFamily, fontSize: bodyStyle.fontSize }
    : bodyStyle;

  const isSubstantive = FIELDS_WITH_WORD_COUNT.has(field);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <FieldTitleRow
        label={FIELD_LABEL[field]}
        kindHint={kindHint}
        text={value}
        showCopy={isSubstantive}
        showWordCount={isSubstantive}
        folded={folded}
        onToggleFold={() => setFolded((f) => !f)}
      />
      {!folded && (
        <textarea
          ref={taRef}
          value={value}
          readOnly={readOnly}
          onChange={readOnly ? undefined : (e) => onChange(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={readOnly ? undefined : onTextareaKeyDown}
          placeholder={readOnly ? "" : FIELD_PLACEHOLDER[field]}
          style={textareaStyle}
          className={`${FIELD_TEXTAREA_CLASS[field]}${readOnly ? " cursor-default" : ""}`}
          rows={2}
        />
      )}
    </div>
  );
}
