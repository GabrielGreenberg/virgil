"use client";

import { useEffect, useRef, useState } from "react";
import type { RevisionSuggestionCard as RevisionSuggestionCardData } from "@/lib/types";
import {
  BadgeLabel,
  Button,
  CardDragHandle,
  CardTargetIcon,
  CardTypeLabel,
  Chevron,
  PanelCard,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds, hasTextAnchor } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
import { useTabIndent } from "@/hooks/useTabIndent";
import { FloatCard } from "@/components/FloatingCards";
import { popKey } from "@/panels/panel-registry";
import { MIME_REVISION } from "./mime";
import { countWords } from "@/hooks/useWordCount";
import {
  CopyButton,
  FieldTitleRow,
} from "@/panels/Cutter/CutterSuggestionCard";

type SuggestionField =
  | "original_text"
  | "suggested_text"
  | "explanation"
  | "user_text"
  | "instructions";

const STATUS_DOT: Record<RevisionSuggestionCardData["status"], string> = {
  pending: "bg-blue-400",
  accepted: "bg-emerald-500",
  rejected: "bg-red-400",
};

const STATUS_LABEL: Record<RevisionSuggestionCardData["status"], string> = {
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

const FIELD_ORDER: SuggestionField[] = [
  "original_text",
  "suggested_text",
  "explanation",
  "user_text",
];

const FIELDS_WITH_WORD_COUNT: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
  "user_text",
  "instructions",
]);

/** Fields whose className already provides a deliberate color cue
 *  (red for original, green for suggested). At those textareas we
 *  apply only the registry's font family + size, not its color. */
const FIELDS_WITH_COLOR_CUE: Set<SuggestionField> = new Set([
  "original_text",
  "suggested_text",
]);

export function startRevisionSuggestionDrag(e: React.DragEvent, cardId: string) {
  e.dataTransfer.setData(
    MIME_REVISION,
    JSON.stringify({ cardId, kind: "suggestion" }),
  );
  e.dataTransfer.effectAllowed = "copy";
}

function AuthorChip({ author }: { author: RevisionSuggestionCardData["author"] }) {
  const isAi = author === "ai";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium tracking-wide ${
        isAi
          ? "bg-[var(--accent)]/10 text-[var(--accent)]"
          : "bg-surface-muted-strong text-ink-body"
      }`}
      title={isAi ? "AI-authored" : "Human-authored"}
    >
      {isAi ? "AI" : "Human"}
    </span>
  );
}

function FieldBlock({
  field,
  value,
  onChange,
  readOnly,
  kindHint,
  collapsedAffordance,
}: {
  field: SuggestionField;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  kindHint?: string | null;
  collapsedAffordance?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const onTextareaKeyDown = useTabIndent<HTMLTextAreaElement>();
  const [expanded, setExpanded] = useState(!collapsedAffordance || !!value);
  const [folded, setFolded] = useState(false);
  const bodyStyle = usePanelBodyStyle("revision");
  const textareaStyle: React.CSSProperties = FIELDS_WITH_COLOR_CUE.has(field)
    ? { fontFamily: bodyStyle.fontFamily, fontSize: bodyStyle.fontSize }
    : bodyStyle;

  useEffect(() => {
    if (expanded && !value && collapsedAffordance) taRef.current?.focus();
  }, [expanded, value, collapsedAffordance]);

  if (!value && !expanded && collapsedAffordance) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(true);
        }}
        className="text-[10px] text-[var(--muted)] hover:text-ink-strong cursor-pointer rounded px-1 py-0.5 hover-on-light"
      >
        {collapsedAffordance}
      </button>
    );
  }

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

// Silence unused-import warnings — Chevron, CopyButton, countWords are
// referenced indirectly through FieldTitleRow / FieldBlock elsewhere when
// we reuse helper components but TypeScript still wants them imported.
void Chevron;
void CopyButton;
void countWords;

export function RevisionSuggestionCard({
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
}: {
  card: RevisionSuggestionCardData;
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
}) {
  const theme = useCardTheme("revision");
  const cardRef = useRef<HTMLDivElement>(null);
  const isPending = card.status === "pending";
  const isAnchored =
    getLinkedParagraphIds(card).length > 0 || hasTextAnchor(card);
  const anchorKind: "selection" | "paragraph" | null = hasTextAnchor(card)
    ? "selection"
    : getLinkedParagraphIds(card).length > 0
      ? "paragraph"
      : null;
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", `s:${card.id}`);
  const onToggleFromCtx =
    onTogglePopout ??
    (popped ? (anchor: DOMRect) => popped.toggleAtAnchor(cardKey, anchor) : undefined);
  const compressed = !selected && !isPoppedOut;

  const dot = (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[card.status]}`}
      title={STATUS_LABEL[card.status]}
    />
  );

  const cardEl = (
    <PanelCard
      ref={cardRef}
      data-revision-suggestion-entry={card.id}
      data-card-key={cardKey}
      data-pristine-card-id={card.id}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      cardKey={cardKey}
      isCollapsed={compressed}
      onTrashClick={() => onDelete(card.id)}
      draggable={!selected}
      onDragStart={(e) => startRevisionSuggestionDrag(e, card.id)}
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(selected ? null : card.id);
      }}
      onKeyDown={(e) => {
        if (!selected) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onDelete(card.id);
        }
      }}
      className="focus:outline-none mb-2"
    >
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: selected ? theme.headerSelected : theme.headerDefault }}
      >
        <CardDragHandle />
        <BadgeLabel label="S" theme={theme} />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {dot}
          <CardTypeLabel kind="suggestion" />
          <AuthorChip author={card.author} />
          <span className="text-[10px] text-ink-muted">
            {STATUS_LABEL[card.status]}
          </span>
        </div>
        {onJump && (
          <CardTargetIcon
            selected={selected}
            disabled={!isAnchored}
            onClick={(e) => {
              e.stopPropagation();
              if (isAnchored)
                onJump((e.currentTarget as HTMLElement).closest('[data-card]') as HTMLElement | null);
            }}
            title={
              isAnchored
                ? "Jump to text in document"
                : "Not anchored in document"
            }
          />
        )}
      </div>

      <div
        className={`border-t transition-colors ${selected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={selected ? { borderTopColor: theme.separatorSelected } : undefined}
      />

      {compressed ? (
        <div className="px-3 pt-1 pb-1.5 text-xs truncate">
          {card.suggested_text ? (
            <span className="text-emerald-700/90">{card.suggested_text.replace(/\s+/g, " ").trim()}</span>
          ) : card.original_text ? (
            <span className="text-ink-subtle">→ <span className="text-red-700/70 italic">{card.original_text.replace(/\s+/g, " ").trim()}</span></span>
          ) : (
            <span className="text-ink-faint italic">empty suggestion</span>
          )}
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
            collapsedAffordance="+ Instructions"
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
