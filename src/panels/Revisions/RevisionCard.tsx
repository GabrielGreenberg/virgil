"use client";

import { useCallback } from "react";
import type { JSONContent } from "@tiptap/react";
import type { GeneralRevision, TextRevision } from "@/lib/types";
import {
  EditableCard,
  BadgeLabel,
  BadgeOrphaned,
  CardTargetIcon,
  startTextDrag,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { getLinkedParagraphIds } from "@/links/links";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { normalizeRichContent } from "@/lib/footnote-content";
import { popKey } from "@/panels/panel-registry";

const CLAUDE_ID = "claude";
const ME_ID = "me";

function AiBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[10px] font-medium"
      title="AI request"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 L13 10 L20 10 L14 14 L16 21 L12 17 L8 21 L10 14 L4 10 L11 10 Z" />
      </svg>
      AI
    </span>
  );
}

export type RevisionCardKind = "general" | "text";

export interface RevisionCardProps {
  kind: RevisionCardKind;
  revision: GeneralRevision | TextRevision;
  selected: boolean;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  onUpdateContent: (kind: RevisionCardKind, id: string, content: JSONContent) => void;
  onSetAuthor: (kind: RevisionCardKind, id: string, authorId: string) => void;
  onDelete: (kind: RevisionCardKind, id: string) => void;
  registerRef?: (el: HTMLDivElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
  extraDataAttrs?: Record<string, string>;
}

export function RevisionCard({
  kind,
  revision,
  selected,
  onSelect,
  onJump,
  onUpdateContent,
  onSetAuthor,
  onDelete,
  registerRef,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  extraDataAttrs,
}: RevisionCardProps) {
  const theme = useCardTheme("revision");
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", revision.id);
  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const isAiRequest = revision.authorId === CLAUDE_ID;
  const isTextKind = kind === "text";
  const quotedText = isTextKind ? (revision as TextRevision).selectedText : undefined;
  const isOrphaned =
    isTextKind && getLinkedParagraphIds(revision as TextRevision).length === 0;

  const handleChange = useCallback(
    (json: JSONContent) => {
      onUpdateContent(kind, revision.id, normalizeRichContent(json));
    },
    [onUpdateContent, kind, revision.id],
  );

  const handleToggleAi = useCallback(
    (checked: boolean) => {
      onSetAuthor(kind, revision.id, checked ? CLAUDE_ID : ME_ID);
    },
    [onSetAuthor, kind, revision.id],
  );

  const badge = isAiRequest ? (
    <AiBadge />
  ) : isTextKind && isOrphaned ? (
    <BadgeOrphaned theme={theme} />
  ) : (
    <BadgeLabel label="R" theme={theme} />
  );

  const headerContent = quotedText ? (
    <div className="flex-1 min-w-0 text-xs italic text-[var(--muted)] border-l-2 border-edge-subtle pl-2 truncate">
      &ldquo;{quotedText}&rdquo;
    </div>
  ) : undefined;

  const headerTrailing = isTextKind ? (
    <CardTargetIcon
      selected={selected}
      disabled={!onJump || isOrphaned}
      onClick={(e) => {
        e.stopPropagation();
        if (onJump && !isOrphaned) onJump();
      }}
      title="Jump to text in document"
    />
  ) : undefined;

  const footer = (
    <div
      className="flex items-center justify-between gap-2 px-3 pb-2 pt-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-[var(--muted)] select-none">
        <input
          type="checkbox"
          checked={isAiRequest}
          onChange={(e) => handleToggleAi(e.target.checked)}
          className="cursor-pointer accent-[var(--accent)]"
        />
        <span>AI request</span>
      </label>
    </div>
  );

  const card = (
    <EditableCard
      id={revision.id}
      selected={selected}
      theme={theme}
      grabHandle={false}
      hideToolbar={false}
      inlineDelete
      badge={badge}
      headerContent={headerContent}
      headerTrailing={headerTrailing}
      footer={footer}
      value={revision.content}
      variant="note"
      placeholder="Revision text…"
      onChange={handleChange}
      onDelete={() => onDelete(kind, revision.id)}
      onClick={() => onSelect(selected ? null : revision.id)}
      onTextDragStart={(e) => startTextDrag(e, revision.content, revision.text)}
      onHoverChange={onHoverChange}
      onTogglePopout={onToggleFromCtx}
      isPoppedOut={isPoppedOut}
      dataAttr={isTextKind ? { name: "revision-entry", value: revision.id } : undefined}
      extraDataAttrs={extraDataAttrs}
      wrapperStyle={{}}
    />
  );

  return (
    <div ref={registerRef}>
      {isPoppedOut ? <FloatCard cardKey={cardKey}>{card}</FloatCard> : card}
    </div>
  );
}
