"use client";

import {
  PanelCard,
  PANEL,
  ItemMenu,
  MenuDelete,
  TargetIcon,
  CARD_THEMES,
} from "@/components/panel-primitives";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import { popKey } from "@/panels/panel-registry";

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

export interface RevisionCardProps {
  id: string;
  text: string;
  isAiRequest: boolean;
  quotedText?: string;
  selected: boolean;
  onSelect: () => void;
  onJump?: () => void;
  onDelete: () => void;
  registerRef?: (el: HTMLDivElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
  dataAttrs?: Record<string, string>;
}

export function RevisionCard({
  id,
  text,
  isAiRequest,
  quotedText,
  selected,
  onSelect,
  onJump,
  onDelete,
  registerRef,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
  dataAttrs,
}: RevisionCardProps) {
  const theme = CARD_THEMES.comment;
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", id);
  const isPoppedInCtx = popped?.isPopped(cardKey) ?? false;
  if (!isPoppedOut && isPoppedInCtx) return null;
  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const card = (
    <PanelCard
      ref={(el) => registerRef?.(el)}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      extraCardClass="cursor-pointer"
      onClick={onSelect}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      {...(dataAttrs ?? {})}
    >
      <div
        className={`flex items-center gap-2 pl-3 pr-7 py-1.5 ${selected ? theme.headerSelected : theme.headerDefault}`}
      >
        {isAiRequest && <AiBadge />}
        <div className="flex-1" />
        <div
          className="flex items-center gap-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {selected && onJump && (
            <TargetIcon onClick={onJump} title="Jump to text in document" />
          )}
          <ItemMenu>
            <MenuDelete onClick={onDelete} />
          </ItemMenu>
        </div>
      </div>

      <div
        className={`border-t transition-colors ${selected ? theme.separatorSelected : "border-edge-subtle group-hover:border-edge-hover"}`}
      />

      <div
        className={`${PANEL.cardInner} space-y-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
      >
        {quotedText && (
          <div className="text-xs italic text-[var(--muted)] border-l-2 border-edge-subtle pl-2 truncate">
            &ldquo;{quotedText}&rdquo;
          </div>
        )}
        <p className="text-sm text-ink-body leading-snug whitespace-pre-wrap">
          {text}
        </p>
      </div>
    </PanelCard>
  );

  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
