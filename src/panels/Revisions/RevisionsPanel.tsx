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
  ItemMenu,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import { resolveAnchorRange } from "@/links/links";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { RevisionCard, UserAvatar } from "./RevisionCard";

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
  return rev.turns.length > 0
    ? rev.turns[rev.turns.length - 1].authorId
    : rev.authorId;
}

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
    <div className="px-2 py-2 bg-[var(--background)]/95 border-b border-[var(--border)]">
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
  onHoverRevision?: (id: string | null) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}

/** Discriminated union covering everything that can appear in the
 *  Revisions list — section headers, the new-general form, the
 *  pending-text form, and the actual revision cards. CardListPanel
 *  iterates this single array; renderCard switches on `kind`. */
type RevisionItem =
  | { kind: "progress"; id: string }
  | { kind: "general-header"; id: string }
  | { kind: "new-general"; id: string }
  | { kind: "general"; id: string; data: GeneralRevision }
  | { kind: "text-header"; id: string }
  | { kind: "pending-text"; id: string }
  | { kind: "text-empty"; id: string }
  | { kind: "text"; id: string; data: TextRevision };

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
    editor ?? null,
    inTextItems,
    viewMode === "in-text",
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

  const registerCardRef = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      if (el) cardRefs.current.set(id, el);
      else cardRefs.current.delete(id);
    },
    [],
  );

  const scrollToNextUnresolved = useCallback(
    (afterId: string) => {
      const idx = orderedActiveIds.indexOf(afterId);
      if (idx < 0) return;
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

  const items = useMemo<RevisionItem[]>(() => {
    const out: RevisionItem[] = [
      { kind: "progress", id: "__progress" },
      { kind: "general-header", id: "__general-header" },
      { kind: "new-general", id: "__new-general" },
    ];
    for (const r of activeGeneral) out.push({ kind: "general", id: r.id, data: r });
    out.push({ kind: "text-header", id: "__text-header" });
    if (pendingSelectedText) {
      out.push({ kind: "pending-text", id: "__pending-text" });
    }
    if (activeText.length === 0 && !pendingSelectedText) {
      out.push({ kind: "text-empty", id: "__text-empty" });
    }
    for (const r of activeText) out.push({ kind: "text", id: r.id, data: r });
    return out;
  }, [activeGeneral, activeText, pendingSelectedText]);

  const dropEnabled = onDropSelection || onDropParagraph;
  const handleDragOver = dropEnabled
    ? (e: React.DragEvent) => {
        const types = e.dataTransfer.types;
        if (
          (onDropSelection && types.includes(MIME_SELECTION_ANCHOR)) ||
          (onDropParagraph && types.includes(MIME_PAR_CAPTURE))
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }
    : undefined;
  const handleDrop = dropEnabled
    ? (e: React.DragEvent) => {
        if (onDropParagraph) {
          const parRaw = e.dataTransfer.getData(MIME_PAR_CAPTURE);
          if (parRaw) {
            e.preventDefault();
            e.stopPropagation();
            try {
              const { uuid } = JSON.parse(parRaw) as { uuid: string };
              if (uuid) onDropParagraph(uuid);
            } catch {
              // ignore
            }
            return;
          }
        }
        if (onDropSelection) {
          const raw = e.dataTransfer.getData(MIME_SELECTION_ANCHOR);
          if (!raw) return;
          e.preventDefault();
          try {
            const payload = JSON.parse(raw);
            if (
              typeof payload.from === "number" &&
              typeof payload.to === "number"
            ) {
              onDropSelection(payload);
            }
          } catch {
            // ignore
          }
        }
      }
    : undefined;

  if (!visible) return null;

  const headerLeading = (
    <ItemMenu align="left">
      <div className="px-3 py-1.5 flex items-center justify-end gap-2">
        <PanelThemePicker panelKey="revision" label="Revision color" />
        {onViewModeChange && (
          <ViewToggle mode={viewMode} onChange={onViewModeChange} />
        )}
      </div>
    </ItemMenu>
  );

  const headerExtras = (
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
    </div>
  );

  const listTrailing =
    showResolved && resolvedGeneral.length + resolvedText.length > 0 ? (
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
    ) : null;

  return (
    <CardListPanel<RevisionItem>
      kind="revisions"
      count={activeGeneral.length + activeText.length}
      headerLeading={headerLeading}
      headerExtras={headerExtras}
      items={items}
      getId={(it) => it.id}
      selectedId={selectedRevisionId}
      onSelect={onSelectRevision}
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      listTrailing={listTrailing}
      renderCard={(it, { selected }) => {
        switch (it.kind) {
          case "progress":
            return (
              <ProgressHeader
                total={totalCount}
                resolved={resolvedCount}
                awaitingClaude={awaitingClaudeCount}
              />
            );
          case "general-header":
            return (
              <div className="px-1 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-light)] font-medium">
                General
              </div>
            );
          case "new-general":
            return (
              <NewGeneralActions
                activeUser={activeUser}
                claudeUser={claudeUser}
                onSubmit={onAddGeneral}
              />
            );
          case "general": {
            const r = it.data;
            return (
              <RevisionCard
                kind="general"
                id={r.id}
                users={users}
                activeUser={activeUser}
                turns={r.turns}
                resolved={false}
                selected={selected}
                header={
                  <div className="text-[10px] uppercase tracking-wider text-[var(--muted)] font-medium">
                    Document-wide
                  </div>
                }
                onSelect={() =>
                  onSelectRevision(selected ? null : r.id)
                }
                onResolve={() => handleResolve("general", r.id)}
                onReopen={() => onReopen("general", r.id)}
                onDelete={() => onDelete("general", r.id)}
                onReply={(text) => onAddTurn("general", r.id, text)}
                registerRef={(el) => registerCardRef(r.id, el)}
              />
            );
          }
          case "text-header":
            return (
              <div className="px-1 pt-3 pb-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-light)] font-medium">
                Text revisions
              </div>
            );
          case "pending-text":
            return (
              <div className={panelCard(true)}>
                <div className={PANEL.cardInner}>
                  <div className="text-xs text-[var(--muted)] mb-1.5 truncate font-medium">
                    Revision for: &ldquo;
                    {pendingSelectedText && pendingSelectedText.length > 60
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
                    <span className="text-[10px] text-[var(--muted-light)]">
                      Cmd+Enter to save
                    </span>
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
            );
          case "text-empty":
            return (
              <div className={PANEL.empty}>
                No text revisions yet. Select text in the editor and click
                &ldquo;+ Revision&rdquo;.
              </div>
            );
          case "text": {
            const r = it.data;
            return (
              <RevisionCard
                kind="text"
                id={r.id}
                users={users}
                activeUser={activeUser}
                turns={r.turns}
                resolved={false}
                selected={selected}
                header={
                  <div className="text-xs text-[var(--muted)] truncate font-medium">
                    &ldquo;{r.selectedText}&rdquo;
                  </div>
                }
                onSelect={() => {
                  onHighlight(null);
                  if (selected) {
                    onSelectRevision(null);
                  } else {
                    onSelectRevision(r.id);
                  }
                }}
                onJump={() => {
                  onHighlight(null);
                  queueMicrotask(() => onHighlight(r.selectedText));
                }}
                onResolve={() => handleResolve("text", r.id)}
                onReopen={() => onReopen("text", r.id)}
                onDelete={() => onDelete("text", r.id)}
                onReply={(text) => onAddTurn("text", r.id, text)}
                registerRef={(el) => registerCardRef(r.id, el)}
                onHoverChange={
                  onHoverRevision
                    ? (hovering) => onHoverRevision(hovering ? r.id : null)
                    : undefined
                }
              />
            );
          }
        }
      }}
      inTextRenderItem={(it, { selected }) => {
        if (it.kind !== "text") return null;
        const r = it.data;
        const preview = r.turns[0]?.text || "";
        const borderColor =
          revisionTheme.override?.selectedBorder ?? "#9333ea";
        const selectedBg =
          revisionTheme.override?.headerBgSelected ??
          "rgba(147, 51, 234, 0.08)";
        return (
          <div
            data-revision-entry={r.id}
            className={`px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-stone-300" : "border-b-stone-300 hover:bg-surface-muted"}`}
            style={
              selected
                ? {
                    borderLeftColor: borderColor,
                    backgroundColor: selectedBg,
                  }
                : undefined
            }
            onClick={(e) => {
              e.stopPropagation();
              onSelectRevision(selected ? null : r.id);
            }}
            onMouseEnter={
              onHoverRevision ? () => onHoverRevision(r.id) : undefined
            }
            onMouseLeave={
              onHoverRevision ? () => onHoverRevision(null) : undefined
            }
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
              {preview || (
                <span className="italic text-ink-muted">Empty revision</span>
              )}
            </p>
          </div>
        );
      }}
    />
  );
}
