"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { UserComment } from "@/lib/types";
import ViewToggle, { ViewMode } from "./ViewToggle";
import { useInTextPositions, findTextPosition } from "@/hooks/useInTextPositions";
import { panelCard, PANEL, PanelHeader } from "./panel-primitives";

interface CommentPanelProps {
  comments: UserComment[];
  activeComments: UserComment[];
  resolvedComments: UserComment[];
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, comment: string) => void;
  onHighlight: (text: string | null) => void;
  visible: boolean;
  pendingSelectedText: string | null;
  onSubmitNew: (comment: string) => void;
  onCancelNew: () => void;
  selectedCommentId: string | null;
  onSelectComment: (id: string | null) => void;
  onClose?: () => void;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
}

export default function RevisionsPanel({
  activeComments,
  resolvedComments,
  onResolve,
  onDelete,
  onUpdate,
  onHighlight,
  visible,
  pendingSelectedText,
  onSubmitNew,
  onCancelNew,
  selectedCommentId,
  onSelectComment,
  onClose,
  editor,
  panelSide,
  viewMode,
  onViewModeChange,
}: CommentPanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const inTextItems = useMemo(
    () => activeComments.map((c) => ({ id: c.id, pos: findTextPosition(editor, c.selectedText) })),
    [activeComments, editor]
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor, inTextItems, viewMode === "in-text"
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [newCommentText, setNewCommentText] = useState("");
  const newCommentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (pendingSelectedText) {
      setNewCommentText("");
      setTimeout(() => newCommentRef.current?.focus(), 50);
    }
  }, [pendingSelectedText]);

  if (!visible) return null;

  const startEdit = (c: UserComment) => {
    setEditingId(c.id);
    setEditText(c.comment);
  };

  const saveEdit = (id: string) => {
    onUpdate(id, editText);
    setEditingId(null);
    setEditText("");
  };

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Revisions" count={activeComments.length}>
        <div className="flex items-center gap-2">
          {resolvedComments.length > 0 && (
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="text-xs text-[var(--muted)] hover:text-stone-600 transition-colors"
            >
              {showResolved ? "Hide" : "Show"} resolved ({resolvedComments.length})
            </button>
          )}
          <ViewToggle mode={viewMode} onChange={onViewModeChange} />
        </div>
      </PanelHeader>

      <div
        ref={viewMode === "in-text" ? panelScrollRef : undefined}
        className={PANEL.list}
      >
        {/* New comment form */}
        {pendingSelectedText && (
          <div className={panelCard(true)}>
            <div className={PANEL.cardInner}>
              <div className="text-xs text-[var(--muted)] mb-1.5 truncate font-medium">
                Revision for: &ldquo;{pendingSelectedText.length > 60 ? pendingSelectedText.slice(0, 60) + "..." : pendingSelectedText}&rdquo;
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
                    onClick={() => { onCancelNew(); setNewCommentText(""); }}
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

        {activeComments.length === 0 && !showResolved && !pendingSelectedText && (
          <div className={PANEL.empty}>
            No revisions yet. Select text and click &quot;+ Revision&quot; to add one.
          </div>
        )}

        {viewMode === "in-text" && activeComments.length > 0 ? (
          <div className="relative" style={{ height: editorScrollHeight || "100%" }}>
            {activeComments.map((c) => {
              const top = positions.get(c.id);
              if (top === undefined) return null;
              const isSelected = selectedCommentId === c.id;
              return (
                <div
                  key={c.id}
                  className={`absolute left-2 right-2 cursor-pointer transition-colors in-text-connector in-text-connector-${panelSide} ${panelCard(isSelected)}`}
                  style={{ top }}
                  onClick={() => {
                    if (isSelected) { onSelectComment(null); onHighlight(null); }
                    else { onSelectComment(c.id); onHighlight(c.selectedText); }
                  }}
                >
                  <div className={PANEL.cardInner}>
                    <div className="text-[10px] text-[var(--muted)] truncate font-medium">
                      &ldquo;{c.selectedText}&rdquo;
                    </div>
                    <p className="text-xs text-stone-600 leading-snug line-clamp-2 mt-0.5">{c.comment}</p>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (

        activeComments.map((c) => {
          const isSelected = selectedCommentId === c.id;
          return (
            <div
              key={c.id}
              className={`cursor-pointer transition-colors ${panelCard(isSelected)}`}
              onClick={() => {
                if (isSelected) {
                  onSelectComment(null);
                  onHighlight(null);
                } else {
                  onSelectComment(c.id);
                  onHighlight(c.selectedText);
                }
              }}
            >
              <div className={PANEL.cardInner}>
                <div className="text-xs text-[var(--muted)] mb-1.5 truncate font-medium">
                  &ldquo;{c.selectedText}&rdquo;
                </div>

                {editingId === c.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      className="w-full bg-white border border-[var(--border)] rounded px-2 py-1.5 text-sm text-stone-800 focus:outline-none focus:border-stone-400 resize-none"
                      rows={3}
                      autoFocus
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => saveEdit(c.id)}
                        className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-stone-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">
                      {c.comment}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => startEdit(c)}
                        className="text-xs text-[var(--muted)] hover:text-stone-600 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onResolve(c.id)}
                        className="text-xs text-emerald-600 hover:text-emerald-700 transition-colors"
                      >
                        Resolve
                      </button>
                      <button
                        onClick={() => onDelete(c.id)}
                        className="text-xs text-red-500 hover:text-red-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        }))
        }

        {showResolved && resolvedComments.length > 0 && (
          <>
            <div className="px-4 py-2 text-xs text-[var(--muted)] font-medium uppercase tracking-wider">
              Resolved
            </div>
            {resolvedComments.map((c) => (
              <div
                key={c.id}
                className={panelCard(false, "opacity-60")}
              >
                <div className={PANEL.cardInner}>
                  <div className="text-xs text-[var(--muted)] mb-1 truncate">
                    &ldquo;{c.selectedText}&rdquo;
                  </div>
                  <p className="text-sm text-stone-600 line-through">
                    {c.comment}
                  </p>
                  <button
                    onClick={() => onDelete(c.id)}
                    className="text-xs text-[var(--muted)] hover:text-red-500 mt-1 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
