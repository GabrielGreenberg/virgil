"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type {
  GeneralRevision,
  RevisionTurn,
  RevisionUser,
  TextRevision,
} from "@/lib/types";
import type { RevisionKind } from "@/hooks/useRevisions";
import {
  panelCard,
  PANEL,
  PanelHeader,
  ItemMenu,
  MenuDelete,
  TargetIcon,
  CARD_THEMES,
  CardPopoutButton,
} from "./panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "./FloatingCards";
import PanelThemePicker from "./PanelThemePicker";
import ViewToggle from "./ViewToggle";
import { useInTextPositions, type PositionItem } from "@/hooks/useInTextPositions";
import { resolveAnchorRange } from "@/lib/linked-anchors";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";

/* ── Helpers ──────────────────────────────────────────────────────── */

const CLAUDE_ID = "claude";

function userById(users: RevisionUser[], id: string): RevisionUser {
  return (
    users.find((u) => u.id === id) ?? {
      id,
      name: "Unknown",
      color: "#9ca3af",
    }
  );
}

function lastAuthorId(rev: { authorId: string; turns: RevisionTurn[] }): string {
  return rev.turns.length > 0 ? rev.turns[rev.turns.length - 1].authorId : rev.authorId;
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

/* ── Avatar / author chip ─────────────────────────────────────────── */

function UserAvatar({ user, size = 18 }: { user: RevisionUser; size?: number }) {
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

/* ── User selector ────────────────────────────────────────────────── */

function UserSelector({
  users,
  activeUserId,
  onSelect,
  onAdd,
}: {
  users: RevisionUser[];
  activeUserId: string;
  onSelect: (id: string) => void;
  onAdd: (name: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#10b981");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = userById(users, activeUserId);
  const selectable = users.filter((u) => u.id !== CLAUDE_ID);

  const submitNew = () => {
    const n = newName.trim();
    if (!n) return;
    onAdd(n, newColor);
    setNewName("");
    setNewColor("#10b981");
    setCreating(false);
    setOpen(false);
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-center p-0.5 rounded-full border border-edge-subtle bg-surface hover:border-edge-strong transition-colors"
        title={`Acting as ${active.name} — click to switch`}
        aria-label={`Acting as ${active.name}`}
      >
        <UserAvatar user={active} size={18} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-surface border border-edge-subtle rounded-md shadow-lg z-[9999] py-1">
          <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-[var(--muted-light)] font-medium">
            Acting as
          </div>
          {selectable.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                onSelect(u.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface-muted transition-colors ${
                u.id === activeUserId ? "bg-amber-50/60" : ""
              }`}
            >
              <UserAvatar user={u} size={16} />
              <span className="text-ink-body flex-1 text-left">{u.name}</span>
              {u.id === activeUserId && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
          <div className="border-t border-stone-100 my-1" />
          {creating ? (
            <div className="px-3 py-2 space-y-1.5">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitNew();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder="Name"
                className="w-full text-xs px-2 py-1 border border-edge-subtle rounded focus:outline-none focus:border-edge-strong"
              />
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-6 h-6 rounded border border-edge-subtle cursor-pointer"
                />
                <button
                  onClick={submitNew}
                  className="flex-1 text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-ink-body transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-surface-muted hover:text-ink-body transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New user
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Sticky progress bar ──────────────────────────────────────────── */

function ProgressHeader({
  total,
  resolved,
  awaitingClaude,
}: {
  total: number;
  resolved: number;
  awaitingClaude: number;
}) {
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  return (
    <div className="sticky top-0 z-20 -mx-2 px-2 py-2 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)]">
      {awaitingClaude > 0 && (
        <div className="mb-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-100 border border-amber-200 text-[10px] font-medium text-amber-800">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          Changes requested · run Claude to get answers
        </div>
      )}
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] tabular-nums text-[var(--muted)] font-medium whitespace-nowrap">
          {resolved} / {total} resolved
        </span>
        <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-surface-muted-strong">
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[10px] tabular-nums text-[var(--muted-light)] w-8 text-right">
          {pct}%
        </span>
      </div>
    </div>
  );
}

/* ── Turn (sub-pod) ───────────────────────────────────────────────── */

function TurnPod({ turn, users }: { turn: RevisionTurn; users: RevisionUser[] }) {
  const author = userById(users, turn.authorId);
  return (
    <div className={`${PANEL.subpod} space-y-1`}>
      <div className="flex items-center gap-1.5">
        <UserAvatar user={author} size={16} />
        <span className="text-[10px] text-[var(--muted-light)] ml-auto tabular-nums">
          {formatTurnTime(turn.createdAt)}
        </span>
      </div>
      <p className="text-xs text-ink-body leading-snug whitespace-pre-wrap">{turn.text}</p>
    </div>
  );
}

/* ── Reply box ────────────────────────────────────────────────────── */

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
    <div className={`${PANEL.subpodWhite} p-2 space-y-1.5`} onClick={(e) => e.stopPropagation()}>
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

/* ── Revision card (shared between general + text) ──────────────── */

interface CardProps {
  kind: RevisionKind;
  id: string;
  users: RevisionUser[];
  activeUser: RevisionUser;
  turns: RevisionTurn[];
  resolved: boolean;
  selected: boolean;
  header?: React.ReactNode;
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
  const popKey = `revision:${id}`;
  const firstTurn = turns[0];
  const firstAuthor = firstTurn ? userById(users, firstTurn.authorId) : null;
  // data-revision-entry lets the shared selection-anchor sync hook detect
  // clicks inside a selected revision card (so click-away doesn't fire).
  // Only set for "text" revisions — general ones have no anchor or
  // click-away semantics tied to the editor.
  const dataAttrs = kind === "text" ? { "data-revision-entry": id } : {};
  const isPoppedInCtx = popped?.isPopped(popKey) ?? false;
  if (!isPoppedOut && isPoppedInCtx) return null;
  const onToggleFromCtx = onTogglePopout ?? (popped ? () => popped.toggle(popKey) : undefined);
  const card = (
    <div
      ref={(el) => registerRef?.(el)}
      onClick={onSelect}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      className={`group cursor-pointer ${panelCard(selected, resolved ? "opacity-60" : "")}${isPoppedOut ? " h-full flex flex-col" : ""}`}
      style={isPoppedOut ? { borderRadius: 0, borderWidth: 0 } : undefined}
      {...dataAttrs}
    >
      {/* Header: author + timestamp, with target icon + menu trailing */}
      <div className={`flex items-center gap-2 px-3 py-1.5 ${selected ? theme.headerSelected : theme.headerDefault}`}>
        {onToggleFromCtx && (
          <CardPopoutButton isPoppedOut={!!isPoppedOut} onClick={onToggleFromCtx} />
        )}
        {firstAuthor && <UserAvatar user={firstAuthor} size={16} />}
        {firstTurn && (
          <span className="text-[10px] text-[var(--muted-light)] tabular-nums shrink-0">
            {formatTurnTime(firstTurn.createdAt)}
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          {selected && onJump && (
            <TargetIcon onClick={onJump} title="Jump to text in document" />
          )}
          <ItemMenu>
            <MenuDelete onClick={onDelete} />
          </ItemMenu>
        </div>
      </div>

      {/* Separator */}
      <div className={`border-t transition-colors ${selected ? theme.separatorSelected : "border-edge-subtle group-hover:border-edge-hover"}`} />

      <div className={`${PANEL.cardInner} space-y-2${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}>
        {/* Context: "Document-wide" / quoted text — passed from caller */}
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
    </div>
  );
  if (isPoppedOut) return <FloatCard cardKey={popKey}>{card}</FloatCard>;
  return card;
}

/* ── New general revision actions ─────────────────────────────────── */

type NewGeneralMode = "comment" | "ai";

function NewGeneralActions({
  activeUser,
  claudeUser,
  onSubmit,
}: {
  activeUser: RevisionUser;
  claudeUser: RevisionUser;
  onSubmit: (text: string, authorId?: string) => void;
}) {
  const [mode, setMode] = useState<NewGeneralMode | null>(null);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode) setTimeout(() => ref.current?.focus(), 10);
  }, [mode]);

  const author = mode === "ai" ? claudeUser : activeUser;

  const submit = () => {
    if (!text.trim() || !mode) return;
    onSubmit(text, mode === "ai" ? claudeUser.id : undefined);
    setText("");
    setMode(null);
  };

  const cancel = () => {
    setMode(null);
    setText("");
  };

  if (!mode) {
    return (
      <div className="flex gap-1.5">
        <button
          onClick={() => setMode("comment")}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-[var(--muted)] hover:text-ink-body hover:bg-surface-muted rounded-md border border-dashed border-edge-subtle hover:border-edge-hover transition-colors"
          title="New revision comment"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Revision comment
        </button>
        <button
          onClick={() => setMode("ai")}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-[var(--muted)] hover:text-ink-body hover:bg-surface-muted rounded-md border border-dashed border-edge-subtle hover:border-edge-hover transition-colors"
          title="New AI suggestion"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2 L13 10 L20 10 L14 14 L16 21 L12 17 L8 21 L10 14 L4 10 L11 10 Z" />
          </svg>
          AI suggestion
        </button>
      </div>
    );
  }

  return (
    <div className={`${panelCard(true)}`}>
      <div className={`${PANEL.cardInner} space-y-2`}>
        <div className="flex items-center gap-1.5">
          <UserAvatar user={author} size={14} />
          <span className="text-[10px] text-[var(--muted)] font-medium">
            {mode === "ai" ? "New AI suggestion" : "New revision comment"}
          </span>
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
            if (e.key === "Escape") cancel();
          }}
          rows={3}
          placeholder={
            mode === "ai"
              ? "AI suggestion for the whole document..."
              : "Revision comment for the whole document..."
          }
          className="w-full bg-surface border border-edge-subtle rounded px-2.5 py-2 text-sm text-ink-strong focus:outline-none focus:border-edge-strong resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--muted-light)]">Cmd+Enter to save</span>
          <div className="flex gap-1.5">
            <button
              onClick={cancel}
              className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-ink-body transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              className="text-xs px-2.5 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Panel props ──────────────────────────────────────────────────── */

interface RevisionsPanelProps {
  users: RevisionUser[];
  activeUserId: string;
  generalRevisions: GeneralRevision[];
  textRevisions: TextRevision[];
  onSetActiveUser: (id: string) => void;
  onAddUser: (name: string, color: string) => void;
  onAddGeneral: (text: string, authorId?: string) => void;
  onAddTurn: (kind: RevisionKind, id: string, text: string) => void;
  onResolve: (kind: RevisionKind, id: string) => void;
  onReopen: (kind: RevisionKind, id: string) => void;
  onDelete: (kind: RevisionKind, id: string) => void;

  visible: boolean;
  pendingSelectedText: string | null;
  onSubmitNew: (text: string) => void;
  onCancelNew: () => void;

  selectedRevisionId: string | null;
  onSelectRevision: (id: string | null) => void;
  onHighlight: (text: string | null) => void;
  /** Hover handler for the text-revision cards. Fires with id on enter, null on leave. */
  onHoverRevision?: (id: string | null) => void;
  /** Called when the selection chip is dropped onto the panel. */
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  /** Called when the user drags a paragraph by its grab bar onto the panel — creates a new text revision bound to that paragraph. */
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}

/* ── Main panel ───────────────────────────────────────────────────── */

export default function RevisionsPanel({
  users,
  activeUserId,
  generalRevisions,
  textRevisions,
  onSetActiveUser,
  onAddUser,
  onAddGeneral,
  onAddTurn,
  onResolve,
  onReopen,
  onDelete,
  visible,
  pendingSelectedText,
  onSubmitNew,
  onCancelNew,
  selectedRevisionId,
  onSelectRevision,
  onHighlight,
  onHoverRevision,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: RevisionsPanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const revisionTheme = useCardTheme("revision");

  const activeUser = userById(users, activeUserId);
  const claudeUser = userById(users, CLAUDE_ID);

  const activeGeneral = useMemo(
    () => generalRevisions.filter((r) => !r.resolved),
    [generalRevisions],
  );
  const activeText = useMemo(
    () => textRevisions.filter((r) => !r.resolved),
    [textRevisions],
  );
  const resolvedGeneral = useMemo(
    () => generalRevisions.filter((r) => r.resolved),
    [generalRevisions],
  );
  const resolvedText = useMemo(
    () => textRevisions.filter((r) => r.resolved),
    [textRevisions],
  );

  const totalCount = generalRevisions.length + textRevisions.length;
  const resolvedCount = resolvedGeneral.length + resolvedText.length;

  // In-text positions: only text revisions with a resolvable anchor.
  const inTextItems = useMemo<PositionItem[]>(() => {
    if (!editor) return [];
    const out: PositionItem[] = [];
    for (const r of activeText) {
      if (!r.anchorId) continue;
      const range = resolveAnchorRange(editor, r.anchorId);
      if (range) out.push({ id: r.id, pos: range.from });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, activeText]);
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null, inTextItems, viewMode === "in-text",
  );

  const awaitingClaudeCount = useMemo(() => {
    let n = 0;
    for (const r of activeGeneral) if (lastAuthorId(r) !== CLAUDE_ID) n++;
    for (const r of activeText) if (lastAuthorId(r) !== CLAUDE_ID) n++;
    return n;
  }, [activeGeneral, activeText]);

  const orderedActiveIds = useMemo(
    () => [...activeGeneral.map((r) => r.id), ...activeText.map((r) => r.id)],
    [activeGeneral, activeText],
  );

  useEffect(() => {
    if (pendingSelectedText) {
      setNewCommentText("");
      setTimeout(() => newCommentRef.current?.focus(), 50);
    }
  }, [pendingSelectedText]);

  const registerCardRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const scrollToNextUnresolved = useCallback(
    (afterId: string) => {
      const idx = orderedActiveIds.indexOf(afterId);
      if (idx < 0) return;
      // Look for the next id that's still in the active list (i.e. wasn't the
      // one we just resolved). Since the list updates async, fall back to the
      // first remaining card after a microtask.
      requestAnimationFrame(() => {
        const remaining = orderedActiveIds.filter((id) => id !== afterId);
        const next = remaining[idx] ?? remaining[remaining.length - 1] ?? null;
        if (next) {
          const el = cardRefs.current.get(next);
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    },
    [orderedActiveIds],
  );

  const handleResolve = useCallback(
    (kind: RevisionKind, id: string) => {
      onResolve(kind, id);
      scrollToNextUnresolved(id);
    },
    [onResolve, scrollToNextUnresolved],
  );

  if (!visible) return null;

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader title="Revisions" count={activeGeneral.length + activeText.length}>
        <div className="flex items-center gap-2">
          {(resolvedGeneral.length + resolvedText.length) > 0 && (
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="text-xs text-[var(--muted)] hover:text-ink-body transition-colors"
            >
              {showResolved ? "Hide" : "Show"} resolved (
              {resolvedGeneral.length + resolvedText.length})
            </button>
          )}
          <UserSelector
            users={users}
            activeUserId={activeUserId}
            onSelect={onSetActiveUser}
            onAdd={onAddUser}
          />
          <ItemMenu>
            <div className="px-3 py-1.5 flex items-center justify-end gap-2">
              <PanelThemePicker panelKey="revision" label="Revision color" />
              {onViewModeChange && (
                <ViewToggle mode={viewMode} onChange={onViewModeChange} />
              )}
            </div>
          </ItemMenu>
        </div>
      </PanelHeader>

      {viewMode === "in-text" ? (
        <div
          ref={panelScrollRef}
          className="flex-1 overflow-y-auto"
          onClick={() => onSelectRevision(null)}
        >
          {activeText.length === 0 ? (
            <div className={PANEL.empty}>
              No anchored revisions. Switch to list view to see all revisions.
            </div>
          ) : (
            <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
              {activeText.map((r) => {
                const top = positions.get(r.id);
                if (top === undefined) return null;
                const isSelected = selectedRevisionId === r.id;
                const preview = r.turns[0]?.text || "";
                const borderColor = revisionTheme.override?.selectedBorder ?? "#9333ea";
                const selectedBg = revisionTheme.override?.headerBgSelected ?? "rgba(147, 51, 234, 0.08)";
                return (
                  <div
                    key={r.id}
                    data-revision-entry={r.id}
                    className={`absolute left-0 right-0 px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${isSelected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover:bg-surface-muted"}`}
                    style={{
                      top,
                      ...(isSelected
                        ? { borderLeftColor: borderColor, backgroundColor: selectedBg }
                        : {}),
                    }}
                    onClick={(e) => { e.stopPropagation(); onSelectRevision(isSelected ? null : r.id); }}
                    onMouseEnter={onHoverRevision ? () => onHoverRevision(r.id) : undefined}
                    onMouseLeave={onHoverRevision ? () => onHoverRevision(null) : undefined}
                  >
                    {r.selectedText && (
                      <div className="text-[10px] italic text-ink-muted truncate mb-0.5">
                        &ldquo;{r.selectedText}&rdquo;
                      </div>
                    )}
                    <p
                      className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
                      style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
                    >
                      {preview || <span className="italic text-ink-muted">Empty revision</span>}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
      <div
        ref={scrollRef}
        className={PANEL.list}
        onDragOver={(onDropSelection || onDropParagraph) ? (e) => {
          const types = e.dataTransfer.types;
          if (
            (onDropSelection && types.includes(MIME_SELECTION_ANCHOR)) ||
            (onDropParagraph && types.includes(MIME_PAR_CAPTURE))
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        } : undefined}
        onDrop={(onDropSelection || onDropParagraph) ? (e) => {
          if (onDropParagraph) {
            const parRaw = e.dataTransfer.getData(MIME_PAR_CAPTURE);
            if (parRaw) {
              e.preventDefault();
              e.stopPropagation();
              try {
                const { uuid } = JSON.parse(parRaw) as { uuid: string };
                if (uuid) onDropParagraph(uuid);
              } catch { /* ignore */ }
              return;
            }
          }
          if (onDropSelection) {
            const raw = e.dataTransfer.getData(MIME_SELECTION_ANCHOR);
            if (!raw) return;
            e.preventDefault();
            try {
              const payload = JSON.parse(raw);
              if (typeof payload.from === "number" && typeof payload.to === "number") {
                onDropSelection(payload);
              }
            } catch { /* ignore */ }
          }
        } : undefined}
      >
        <ProgressHeader
          total={totalCount}
          resolved={resolvedCount}
          awaitingClaude={awaitingClaudeCount}
        />

        {/* General revisions */}
        <div className="px-1 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-light)] font-medium">
          General
        </div>

        <NewGeneralActions
          activeUser={activeUser}
          claudeUser={claudeUser}
          onSubmit={onAddGeneral}
        />

        {activeGeneral.map((r) => (
          <RevisionCard
            key={r.id}
            kind="general"
            id={r.id}
            users={users}
            activeUser={activeUser}
            turns={r.turns}
            resolved={false}
            selected={selectedRevisionId === r.id}
            header={
              <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                Document-wide
              </div>
            }
            onSelect={() => onSelectRevision(selectedRevisionId === r.id ? null : r.id)}
            onResolve={() => handleResolve("general", r.id)}
            onReopen={() => onReopen("general", r.id)}
            onDelete={() => onDelete("general", r.id)}
            onReply={(text) => onAddTurn("general", r.id, text)}
            registerRef={(el) => registerCardRef(r.id, el)}
          />
        ))}

        {/* Text-tied revisions */}
        <div className="px-1 pt-3 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-light)] font-medium">
          Text revisions
        </div>

        {/* New text revision form (driven by editor "+ Revision" button) */}
        {pendingSelectedText && (
          <div className={panelCard(true)}>
            <div className={PANEL.cardInner}>
              <div className="text-xs text-[var(--muted)] mb-1.5 truncate font-medium">
                Revision for: &ldquo;
                {pendingSelectedText.length > 60
                  ? pendingSelectedText.slice(0, 60) + "..."
                  : pendingSelectedText}
                &rdquo;
              </div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <UserAvatar user={activeUser} size={14} />
                <span className="text-[10px] text-[var(--muted)] font-medium">
                  Adding as {activeUser.name}
                </span>
              </div>
              <textarea
                ref={newCommentRef}
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (newCommentText.trim()) {
                      onSubmitNew(newCommentText);
                      setNewCommentText("");
                    }
                  }
                  if (e.key === "Escape") {
                    onCancelNew();
                    setNewCommentText("");
                  }
                }}
                placeholder="Describe the revision..."
                className="w-full bg-surface border border-[var(--border)] rounded px-2.5 py-2 text-sm text-ink-strong focus:outline-none focus:border-edge-strong resize-none"
                rows={3}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-[var(--muted-light)]">Cmd+Enter to save</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      onCancelNew();
                      setNewCommentText("");
                    }}
                    className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-ink-body transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (newCommentText.trim()) {
                        onSubmitNew(newCommentText);
                        setNewCommentText("");
                      }
                    }}
                    className="text-xs px-2.5 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeText.length === 0 && !pendingSelectedText && (
          <div className={PANEL.empty}>
            No text revisions yet. Select text in the editor and click &ldquo;+ Revision&rdquo;.
          </div>
        )}

        {activeText.map((r) => {
          const isSelected = selectedRevisionId === r.id;
          return (
            <RevisionCard
              key={r.id}
              kind="text"
              id={r.id}
              users={users}
              activeUser={activeUser}
              turns={r.turns}
              resolved={false}
              selected={isSelected}
              header={
                <div className="text-xs text-[var(--muted)] truncate font-medium">
                  &ldquo;{r.selectedText}&rdquo;
                </div>
              }
              onSelect={() => {
                // Clear any existing highlight when switching selection —
                // jumps (and the accompanying highlight) happen only via the
                // target icon.
                onHighlight(null);
                if (isSelected) {
                  onSelectRevision(null);
                } else {
                  onSelectRevision(r.id);
                }
              }}
              onJump={() => {
                // Re-trigger onHighlight even if already set, so the editor
                // re-applies the mark and scrolls to the text.
                onHighlight(null);
                // Use a microtask so the null->text transition is observed.
                queueMicrotask(() => onHighlight(r.selectedText));
              }}
              onResolve={() => handleResolve("text", r.id)}
              onReopen={() => onReopen("text", r.id)}
              onDelete={() => onDelete("text", r.id)}
              onReply={(text) => onAddTurn("text", r.id, text)}
              registerRef={(el) => registerCardRef(r.id, el)}
              onHoverChange={onHoverRevision ? (hovering) => onHoverRevision(hovering ? r.id : null) : undefined}
            />
          );
        })}

        {showResolved && (resolvedGeneral.length + resolvedText.length) > 0 && (
          <>
            <div className="px-1 pt-3 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-light)] font-medium">
              Resolved
            </div>
            {resolvedGeneral.map((r) => (
              <RevisionCard
                key={r.id}
                kind="general"
                id={r.id}
                users={users}
                activeUser={activeUser}
                turns={r.turns}
                resolved
                selected={false}
                header={
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                    Document-wide
                  </div>
                }
                onSelect={() => {}}
                onResolve={() => {}}
                onReopen={() => onReopen("general", r.id)}
                onDelete={() => onDelete("general", r.id)}
                onReply={(text) => onAddTurn("general", r.id, text)}
              />
            ))}
            {resolvedText.map((r) => (
              <RevisionCard
                key={r.id}
                kind="text"
                id={r.id}
                users={users}
                activeUser={activeUser}
                turns={r.turns}
                resolved
                selected={false}
                header={
                  <div className="text-xs text-[var(--muted)] truncate font-medium">
                    &ldquo;{r.selectedText}&rdquo;
                  </div>
                }
                onSelect={() => {}}
                onResolve={() => {}}
                onReopen={() => onReopen("text", r.id)}
                onDelete={() => onDelete("text", r.id)}
                onReply={(text) => onAddTurn("text", r.id, text)}
              />
            ))}
          </>
        )}
      </div>
      )}
    </div>
  );
}
