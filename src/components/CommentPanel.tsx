"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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
} from "./panel-primitives";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";

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
        className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-stone-200 bg-white hover:border-stone-300 transition-colors text-xs"
        title="Switch acting user"
      >
        <UserAvatar user={active} size={14} />
        <span className="text-stone-700 font-medium">{active.name}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-stone-200 rounded-md shadow-lg z-[9999] py-1">
          <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider text-[var(--muted-light)] font-medium">
            Acting as
          </div>
          {users.map((u) => (
            <button
              key={u.id}
              onClick={() => {
                onSelect(u.id);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-stone-50 transition-colors ${
                u.id === activeUserId ? "bg-amber-50/60" : ""
              }`}
            >
              <UserAvatar user={u} size={16} />
              <span className="text-stone-700 flex-1 text-left">{u.name}</span>
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
                className="w-full text-xs px-2 py-1 border border-stone-200 rounded focus:outline-none focus:border-stone-400"
              />
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-6 h-6 rounded border border-stone-200 cursor-pointer"
                />
                <button
                  onClick={submitNew}
                  className="flex-1 text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => setCreating(false)}
                  className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-stone-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-stone-50 hover:text-stone-700 transition-colors"
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
        <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-stone-100">
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
        <span className="text-[11px] font-medium text-stone-700">{author.name}</span>
        <span className="text-[10px] text-[var(--muted-light)] ml-auto tabular-nums">
          {formatTurnTime(turn.createdAt)}
        </span>
      </div>
      <p className="text-xs text-stone-700 leading-snug whitespace-pre-wrap">{turn.text}</p>
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
        className="text-xs text-[var(--muted)] hover:text-stone-700 transition-colors flex items-center gap-1.5"
      >
        <UserAvatar user={activeUser} size={14} />
        Reply as {activeUser.name}
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
        <span className="text-[10px] text-[var(--muted)] font-medium">
          Reply as {activeUser.name}
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
          if (e.key === "Escape") {
            setOpen(false);
            setText("");
          }
        }}
        placeholder="Write a reply..."
        rows={2}
        className="w-full bg-white border border-stone-200 rounded px-2 py-1.5 text-xs text-stone-800 focus:outline-none focus:border-stone-400 resize-none"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[var(--muted-light)]">Cmd+Enter</span>
        <div className="flex gap-1">
          <button
            onClick={() => {
              setOpen(false);
              setText("");
            }}
            className="text-xs px-2 py-0.5 rounded text-[var(--muted)] hover:text-stone-600 transition-colors"
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
}

function RevisionCard({
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
}: CardProps) {
  const theme = CARD_THEMES.comment;
  const firstTurn = turns[0];
  const firstAuthor = firstTurn ? userById(users, firstTurn.authorId) : null;
  return (
    <div
      ref={(el) => registerRef?.(el)}
      onClick={onSelect}
      onMouseEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onMouseLeave={onHoverChange ? () => onHoverChange(false) : undefined}
      className={`group cursor-pointer ${panelCard(selected, resolved ? "opacity-60" : "")}`}
    >
      {/* Header: author + timestamp, with target icon + menu trailing */}
      <div className={`flex items-center gap-2 px-3 py-1.5 ${selected ? theme.headerSelected : theme.headerDefault}`}>
        {firstAuthor && <UserAvatar user={firstAuthor} size={16} />}
        {firstAuthor && (
          <span className="text-xs font-medium text-stone-700 truncate">{firstAuthor.name}</span>
        )}
        {firstTurn && (
          <span className="text-[10px] text-[var(--muted-light)] tabular-nums shrink-0">
            · {formatTurnTime(firstTurn.createdAt)}
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
      <div className={`border-t transition-colors ${selected ? theme.separatorSelected : "border-stone-200 group-hover:border-stone-300"}`} />

      <div className={`${PANEL.cardInner} space-y-2`}>
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
              className="text-xs text-[var(--muted)] hover:text-stone-600 transition-colors"
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
}

/* ── New general revision form ────────────────────────────────────── */

function NewGeneralForm({
  activeUser,
  onSubmit,
}: {
  activeUser: RevisionUser;
  onSubmit: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => ref.current?.focus(), 10);
  }, [open]);

  const submit = () => {
    if (text.trim()) {
      onSubmit(text);
      setText("");
      setOpen(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--muted)] hover:text-stone-700 hover:bg-stone-50 rounded-md border border-dashed border-stone-200 hover:border-stone-300 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add a general revision for the whole document
      </button>
    );
  }

  return (
    <div className={`${panelCard(true)}`}>
      <div className={`${PANEL.cardInner} space-y-2`}>
        <div className="flex items-center gap-1.5">
          <UserAvatar user={activeUser} size={14} />
          <span className="text-[10px] text-[var(--muted)] font-medium">
            New general revision as {activeUser.name}
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
            if (e.key === "Escape") {
              setOpen(false);
              setText("");
            }
          }}
          rows={3}
          placeholder="Instructions for Claude that apply to the whole document..."
          className="w-full bg-white border border-stone-200 rounded px-2.5 py-2 text-sm text-stone-800 focus:outline-none focus:border-stone-400 resize-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[var(--muted-light)]">Cmd+Enter to save</span>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                setOpen(false);
                setText("");
              }}
              className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-stone-600 transition-colors"
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
  onAddGeneral: (text: string) => void;
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
}: RevisionsPanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [newCommentText, setNewCommentText] = useState("");
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeUser = userById(users, activeUserId);

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
              className="text-xs text-[var(--muted)] hover:text-stone-600 transition-colors"
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
        </div>
      </PanelHeader>

      <div
        ref={scrollRef}
        className={PANEL.list}
        onDragOver={onDropSelection ? (e) => {
          if (e.dataTransfer.types.includes(MIME_SELECTION_ANCHOR)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }
        } : undefined}
        onDrop={onDropSelection ? (e) => {
          const raw = e.dataTransfer.getData(MIME_SELECTION_ANCHOR);
          if (!raw) return;
          e.preventDefault();
          try {
            const payload = JSON.parse(raw);
            if (typeof payload.from === "number" && typeof payload.to === "number") {
              onDropSelection(payload);
            }
          } catch { /* ignore */ }
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

        <NewGeneralForm activeUser={activeUser} onSubmit={onAddGeneral} />

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
                className="w-full bg-white border border-[var(--border)] rounded px-2.5 py-2 text-sm text-stone-800 focus:outline-none focus:border-stone-400 resize-none"
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
                    className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-stone-600 transition-colors"
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
    </div>
  );
}
