"use client";

import { useEffect, useRef, useState } from "react";
import type { CutterSuggestionCard as CutterSuggestionCardData } from "@/lib/types";
import {
  Button,
  Chevron,
  PanelCard,
  compressedBodyStyle,
} from "@/components/panel-primitives";
import { useCompressedLines } from "@/components/editor-layout/contexts/card-display";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedTextObjectIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { FloatCard } from "@/components/FloatingCards";
import { cardPopKey } from "@/panels/panel-registry";
import { useAnchoredCard } from "@/links/_shared/useAnchoredCard";
import { cardStore } from "@/links/_shared/anchored-card-store";
import { MIME_CUT } from "@/lib/marginalia";
import { countWords } from "@/hooks/useWordCount";

type SuggestionField =
  | "original_text"
  | "suggested_text"
  | "explanation"
  | "user_text"
  | "instructions";

const STATUS_DOT: Record<CutterSuggestionCardData["status"], string> = {
  pending: "bg-blue-400",
  accepted: "bg-emerald-500",
  rejected: "bg-red-400",
};

const STATUS_LABEL: Record<CutterSuggestionCardData["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

const FIELD_LABEL: Record<SuggestionField, string> = {
  original_text: "Original",
  suggested_text: "Suggested",
  explanation: "Explanation",
  user_text: "Your text",
  instructions: "Instructions",
};

const FIELD_PLACEHOLDER: Record<SuggestionField, string> = {
  original_text: "Target text…",
  suggested_text: "Replacement text…",
  explanation: "Why this change…",
  user_text: "Your revision…",
  instructions: "Instructions for the AI…",
};

const FIELD_TEXTAREA_CLASS: Record<SuggestionField, string> = {
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

/** Fields whose className already provides a deliberate color cue
 *  (red for original, green for suggested). At those textareas we
 *  apply only the registry's font family + size, not its color, so
 *  the visual cue is preserved. */
const FIELDS_WITH_COLOR_CUE: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
]);

const FIELD_ORDER: SuggestionField[] = [
  "original_text",
  "suggested_text",
  "explanation",
  "user_text",
];

// Per the design rule: substantive fields show a word count + copy
// button next to the section title. Explanation is meta and skips both.
const FIELDS_WITH_WORD_COUNT: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
  "user_text",
  "instructions",
]);

export function startCutterSuggestionDrag(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(
    MIME_CUT,
    JSON.stringify({ cardId, kind: "suggestion" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

function AuthorChip({ author }: { author: CutterSuggestionCardData["author"] }) {
  const isAi = author === "ai";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide ${
        isAi
          ? "bg-[var(--accent)]/10 text-[var(--accent)]"
          : "bg-surface-muted-strong text-ink-body"
      }`}
      data-hint={isAi ? "AI-authored" : "Human-authored"} aria-label={isAi ? "AI-authored" : "Human-authored"}
    >
      {isAi ? "AI" : "Human"}
    </span>
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

function FieldBlock({
  field,
  value,
  onChange,
  readOnly,
  kindHint,
}: {
  field: SuggestionField;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  kindHint?: string | null;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();
  const [folded, setFolded] = useState(false);
  const bodyStyle = usePanelBodyStyle("cut");
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

export function CutterSuggestionCard({
  card,
  selected,
  onUpdateField,
  onAccept,
  onReject,
  onDelete,
  onSelect,
  onJump,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: {
  card: CutterSuggestionCardData;
  selected: boolean;
  onUpdateField: (
    id: string,
    field: SuggestionField,
    value: string,
  ) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: (sourceEl?: HTMLElement | null) => void;
  onTogglePopout?: (anchor: DOMRect) => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}) {
  const theme = useCardTheme("cut");
  const cardRef = useRef<HTMLDivElement>(null);
  const isPending = card.status === "pending";
  const isAnchored =
    getLinkedTextObjectIds(card).length > 0 || hasTextAnchor(card);
  const anchorKind: "selection" | "paragraph" | null = hasTextAnchor(card)
    ? "selection"
    : getLinkedTextObjectIds(card).length > 0
      ? "paragraph"
      : null;
  const popped = usePoppedCards();
  const cardKey = cardPopKey("cutter-suggestion", card.id);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);
  const ac = useAnchoredCard({ kind: "cutter-suggestion", id: card.id });
  const isExpanded = ac.expanded || selected;
  const isSelected = ac.selected || selected;
  const compressed = !isExpanded && !isPoppedOut;
  const compressedLines = useCompressedLines();
  const cardBodyStyle = usePanelBodyStyle("cut");

  const dot = (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[card.status]}`}
      data-hint={STATUS_LABEL[card.status]} aria-label={STATUS_LABEL[card.status]}
    />
  );

  const cardEl = (
    <PanelCard
      ref={cardRef}
      data-cutter-suggestion-entry={card.id}
      data-card-key={cardKey}
      data-pristine-card-id={card.id}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={isSelected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onTrashClick={() => onDelete(card.id)}
      draggable={!isSelected}
      onDragStart={(e) => startCutterSuggestionDrag(e, card.id)}
      tabIndex={isSelected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        cardStore.toggleSelection(ac.ref);
        if (!cardStore.isExpanded(ac.ref)) return;
        onSelect(card.id);
        if (isAnchored && onJump) {
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
        }
      }}
      onMouseEnter={() => cardStore.setHover(ac.ref)}
      onMouseLeave={() => {
        const h = cardStore.getState().hover;
        if (h && h.kind === ac.ref.kind && h.id === ac.ref.id) cardStore.setHover(null);
      }}
      onKeyDown={(e) => {
        if (!isSelected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(card.id);
        }
      }}
      className="focus:outline-none mb-2"
      kind="cutter-suggestion"
      canJump={isAnchored && !!onJump}
      onJump={(e) => {
        if (onJump && isAnchored)
          onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
      }}
      headerTrailing={
        <>
          {dot}
          <AuthorChip author={card.author} />
          <span className="text-[10px] text-ink-muted">
            {STATUS_LABEL[card.status]}
          </span>
        </>
      }
    >
      {compressed ? (
        <div className="px-3 pt-1.5 pb-1.5">
          <div style={{ ...cardBodyStyle, ...compressedBodyStyle(compressedLines) }}>
            {card.suggested_text ? (
              <span className="text-emerald-700/90">{card.suggested_text.replace(/\s+/g, " ").trim()}</span>
            ) : card.original_text ? (
              <span className="text-ink-subtle">→ <span className="text-red-700/70 italic">{card.original_text.replace(/\s+/g, " ").trim()}</span></span>
            ) : (
              <span className="text-ink-faint italic">empty suggestion</span>
            )}
          </div>
        </div>
      ) : (
      <div
        className={`px-3 pt-2 pb-2 space-y-2.5${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {FIELD_ORDER.map((field) => (
          <FieldBlock
            key={field}
            field={field}
            value={card[field]}
            onChange={(v) => onUpdateField(card.id, field, v)}
            readOnly={
              field === "original_text" ||
              (card.author === "ai" && field !== "user_text")
            }
            kindHint={field === "original_text" ? anchorKind : null}
          />
        ))}

        {card.author === "ai" && (
          <FieldBlock
            field="instructions"
            value={card.instructions}
            onChange={(v) => onUpdateField(card.id, "instructions", v)}
          />
        )}

        {isPending && (
          <div className="flex gap-1.5 pt-1 pr-7">
            <Button
              variant="danger"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onReject(card.id);
              }}
            >
              Reject
            </Button>
            <Button
              variant="warm"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAccept(card.id);
              }}
            >
              Accept
            </Button>
          </div>
        )}
      </div>
      )}
    </PanelCard>
  );

  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{cardEl}</FloatCard>;
  return cardEl;
}
