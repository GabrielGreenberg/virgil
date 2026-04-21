"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import type { RevisionTurn, RevisionUser } from "@/lib/types";
import type { RevisionKind } from "@/hooks/useRevisions";
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

function userById(users: RevisionUser[], id: string): RevisionUser {
  return (
    users.find((u) => u.id === id) ?? {
      id,
      name: "Unknown",
      color: "#9ca3af",
    }
  );
}

function formatTurnTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function UserAvatar({
  user,
  size = 18,
}: {
  user: RevisionUser;
  size?: number;
}) {
  const initial = user.name.trim().slice(0, 1).toUpperCase() || "?";
  return (
    <span
      aria-label={user.name}
      title={user.name}
      className="inline-flex items-center justify-center rounded-full text-[10px] font-semibold text-white shrink-0"
      style={{ width: size, height: size, backgroundColor: user.color }}
    >
      {initial}
    </span>
  );
}

function TurnPod({
  turn,
  users,
}: {
  turn: RevisionTurn;
  users: RevisionUser[];
}) {
  const author = userById(users, turn.authorId);
  return (
    <div className={`${PANEL.subpod} space-y-1`}>
      <div className="flex items-center gap-1.5">
        <UserAvatar user={author} size={16} />
        <span className="text-[10px] text-[var(--muted-light)] ml-auto tabular-nums">
          {formatTurnTime(turn.createdAt)}
        </span>
      </div>
      <p className="text-xs text-ink-body leading-snug whitespace-pre-wrap">
        {turn.text}
      </p>
    </div>
  );
}

function ReplyBox({
  activeUser,
  onReply,
}: {
  activeUser: RevisionUser;
  onReply: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 10);
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="text-xs text-[var(--muted)] hover:text-ink-body transition-colors flex items-center gap-1.5"
        title={`Reply as ${activeUser.name}`}
      >
        <UserAvatar user={activeUser} size={14} />
        Reply
      </button>
    );
  }

  const submit = () => {
    if (text.trim()) {
      onReply(text);
      setText("");
      setOpen(false);
    }
  };

  return (
    <div
      className={`${PANEL.subpodWhite} p-2 space-y-1.5`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5">
        <UserAvatar user={activeUser} size={14} />
        <span className="text-[10px] text-[var(--muted)] font-medium">Reply</span>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
          if (e.key === "Escape") {
            setOpen(false);
            setText("");
          }
        }}
        placeholder="Write a reply..."
        rows={2}
        className="w-full bg-surface border border-edge-subtle rounded px-2 py-1.5 text-xs text-ink-strong focus:outline-none focus:border-edge-strong resize-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--muted-light)]">Cmd+Enter</span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              setOpen(false);
              setText("");
            }}
            className="text-xs px-2 py-0.5 rounded text-[var(--muted)] hover:text-ink-body transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="text-xs px-2 py-0.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

interface CardProps {
  kind: RevisionKind;
  id: string;
  users: RevisionUser[];
  activeUser: RevisionUser;
  turns: RevisionTurn[];
  resolved: boolean;
  selected: boolean;
  header?: ReactNode;
  onSelect: () => void;
  onJump?: () => void;
  onResolve: () => void;
  onReopen: () => void;
  onDelete: () => void;
  onReply: (text: string) => void;
  registerRef?: (el: HTMLDivElement | null) => void;
  onHoverChange?: (hovering: boolean) => void;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
}

export function RevisionCard({
  kind,
  id,
  users,
  activeUser,
  turns,
  resolved,
  selected,
  header,
  onSelect,
  onJump,
  onResolve,
  onReopen,
  onDelete,
  onReply,
  registerRef,
  onHoverChange,
  onTogglePopout,
  isPoppedOut,
}: CardProps) {
  const theme = CARD_THEMES.comment;
  const popped = usePoppedCards();
  const cardKey = popKey("revisions", id);
  const firstTurn = turns[0];
  const firstAuthor = firstTurn ? userById(users, firstTurn.authorId) : null;
  const dataAttrs = kind === "text" ? { "data-revision-entry": id } : {};
  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);
  const card = (
    <PanelCard
      ref={(el) => registerRef?.(el)}
      theme={theme}
      selected={selected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      extraCardClass={`cursor-pointer ${resolved ? "opacity-60" : ""}`}
      onClick={onSelect}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      {...dataAttrs}
    >
      <div
        className={`flex items-center gap-2 pl-3 pr-7 py-1.5 ${selected ? theme.headerSelected : theme.headerDefault}`}
      >
        {firstAuthor && <UserAvatar user={firstAuthor} size={16} />}
        {firstTurn && (
          <span className="text-[10px] text-[var(--muted-light)] tabular-nums shrink-0">
            {formatTurnTime(firstTurn.createdAt)}
          </span>
        )}
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
        {header && <div>{header}</div>}

        <div className="space-y-1.5">
          {turns.map((t) => (
            <TurnPod key={t.id} turn={t} users={users} />
          ))}
        </div>

        <div className="flex items-center justify-between pt-1">
          <ReplyBox activeUser={activeUser} onReply={onReply} />
          {resolved ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReopen();
              }}
              className="text-xs text-[var(--muted)] hover:text-ink-body transition-colors"
            >
              Reopen
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              className="text-xs text-emerald-600 hover:text-emerald-700 transition-colors font-medium"
            >
              Resolve
            </button>
          )}
        </div>
      </div>
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
