"use client";

import { useState, useRef, useEffect } from "react";
import type { UserComment } from "@/lib/types";
import ViewToggle, { ViewMode } from "./ViewToggle";

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
}

export default function CommentPanel({
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
}: CommentPanelProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-stone-700">
          Comments
          {activeComments.length > 0 && (
            <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">
              ({activeComments.length})
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {resolvedComments.length > 0 && (
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="text-xs text-[var(--muted)] hover:text-stone-600 transition-colors"
            >
              {showResolved ? "Hide" : "Show"} resolved ({resolvedComments.length})
            </button>
          )}
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* New comment form */}
        {pendingSelectedText && (
          <div className="px-4 py-3 border-b border-[var(--border)] bg-amber-50/50">
            <div className="text-xs text-[var(--muted)] mb-1.5 truncate font-medium">
              Commenting on: &ldquo;{pendingSelectedText.length > 60 ? pendingSelectedText.slice(0, 60) + "..." : pendingSelectedText}&rdquo;
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
              placeholder="Write your comment..."
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
        )}

        {activeComments.length === 0 && !showResolved && !pendingSelectedText && (
          <div className="p-6 text-center text-[var(--muted)] text-sm">
            No comments yet. Select text and click &quot;+ Comment&quot; to add one.
          </div>
        )}

        {activeComments.map((c) => (
          <div
            key={c.id}
            className={`px-4 py-3 border-b cursor-pointer transition-colors ${
              selectedCommentId === c.id
                ? "bg-amber-50 border-l-2 border-l-amber-400 border-b-[var(--border-light)]"
                : "border-b-[var(--border-light)] hover:bg-stone-50"
            }`}
            onClick={() => {
              if (selectedCommentId === c.id) {
                onSelectComment(null);
                onHighlight(null);
              } else {
                onSelectComment(c.id);
                onHighlight(c.selectedText);
              }
            }}
          >
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
        ))}

        {showResolved && resolvedComments.length > 0 && (
          <>
            <div className="px-4 py-2 bg-stone-50 text-xs text-[var(--muted)] font-medium uppercase tracking-wider">
              Resolved
            </div>
            {resolvedComments.map((c) => (
              <div
                key={c.id}
                className="px-4 py-3 border-b border-[var(--border-light)] opacity-60"
              >
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
            ))}
          </>
        )}
      </div>
    </div>
  );
}
