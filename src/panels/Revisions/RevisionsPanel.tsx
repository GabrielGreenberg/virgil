"use client";

import { useMemo, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { Comment, Suggestion } from "@/lib/types";
import { PANEL, ItemMenu } from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import PanelThemePicker from "@/components/PanelThemePicker";
import ViewToggle from "@/components/ViewToggle";
import {
  useInTextPositions,
  type PositionItem,
} from "@/hooks/useInTextPositions";
import { resolveAnchorRange, getTextAnchor } from "@/links/links";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CommentCard } from "./CommentCard";
import { SuggestionCard } from "./SuggestionCard";
import { RevisionsHeaderBar } from "./RevisionsHeaderBar";

interface RevisionsPanelProps {
  comments: Comment[];
  suggestions: Suggestion[];
  currentSuggestionIndex: number;
  onAddEmptyComment: () => Comment | null;
  onUpdateContent: (id: string, content: JSONContent) => void;
  onSetAuthor: (id: string, authorId: string) => void;
  onDelete: (id: string) => void;
  onActOnSuggestion: (id: string, action: "accepted" | "rejected" | "skipped") => void;
  onUpdateSuggestionField: (id: string, field: "revision" | "note", value: string) => void;
  onJumpSuggestion: (index: number) => void;
  visible: boolean;
  selectedCommentId: string | null;
  onSelectComment: (id: string | null) => void;
  onHighlight: (text: string | null) => void;
  onHoverComment?: (id: string | null) => void;
  onDropSelection?: (payload: {
    from: number;
    to: number;
    selectedText: string;
  }) => void;
  onDropParagraph?: (paragraphId: string) => void;
  editor?: Editor | null;
  panelSide?: "left" | "right";
  viewMode?: "list" | "in-text";
  onViewModeChange?: (mode: "list" | "in-text") => void;
}

type Item =
  | { kind: "comment"; id: string; createdAt: string; data: Comment }
  | { kind: "suggestion"; id: string; createdAt: string; data: Suggestion };

export default function RevisionsPanel({
  comments,
  suggestions,
  currentSuggestionIndex,
  onAddEmptyComment,
  onUpdateContent,
  onSetAuthor,
  onDelete,
  onActOnSuggestion,
  onUpdateSuggestionField,
  onJumpSuggestion,
  visible,
  selectedCommentId,
  onSelectComment,
  onHighlight,
  onHoverComment,
  onDropSelection,
  onDropParagraph,
  editor,
  panelSide = "right",
  viewMode = "list",
  onViewModeChange,
}: RevisionsPanelProps) {
  const commentTheme = useCardTheme("revision");

  // Suggestions don't carry createdAt, so they sort by their array order
  // (the order Claude emitted them) interleaved at the front of the list.
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    suggestions.forEach((s, i) => {
      out.push({
        kind: "suggestion",
        id: `suggestion:${s.id}`,
        // Suggestions appear at the top in emit order — synthesize a
        // pre-epoch timestamp keyed by index so they sort before comments.
        createdAt: `0000-${String(i).padStart(10, "0")}`,
        data: s,
      });
    });
    for (const c of comments) {
      out.push({ kind: "comment", id: c.id, createdAt: c.createdAt, data: c });
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }, [comments, suggestions]);

  const totalCount = comments.length + suggestions.length;

  const inTextItems = useMemo<PositionItem[]>(() => {
    if (!editor) return [];
    const out: PositionItem[] = [];
    for (const c of comments) {
      const ta = getTextAnchor(c);
      if (!ta) continue;
      const range = resolveAnchorRange(editor, ta.anchorId);
      if (range) out.push({ id: c.id, pos: range.from });
    }
    return out;
  }, [editor, comments]);
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null,
    inTextItems,
    viewMode === "in-text",
  );

  const dropEnabled = onDropSelection || onDropParagraph;
  const [isDragOver, setIsDragOver] = useState(false);
  const handleDragOver = dropEnabled
    ? (e: React.DragEvent) => {
        const types = e.dataTransfer.types;
        if (
          (onDropSelection && types.includes(MIME_SELECTION_ANCHOR)) ||
          (onDropParagraph && types.includes(MIME_PAR_CAPTURE))
        ) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          if (!isDragOver) setIsDragOver(true);
        }
      }
    : undefined;
  const handleDragLeave = dropEnabled
    ? (e: React.DragEvent) => {
        const current = e.currentTarget as HTMLElement;
        const next = e.relatedTarget as Node | null;
        if (!next || !current.contains(next)) setIsDragOver(false);
      }
    : undefined;
  const handleDrop = dropEnabled
    ? (e: React.DragEvent) => {
        setIsDragOver(false);
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

  const handleAdd = () => {
    const created = onAddEmptyComment();
    if (created) onSelectComment(created.id);
  };

  // Suggestion-list selection id is the synthesized id (`suggestion:${id}`)
  // so the panel can distinguish suggestion vs comment selection without
  // overloading selectedCommentId, which is owned by the comment lookups.
  const handleSelect = (id: string | null) => {
    if (id == null) {
      onSelectComment(null);
      return;
    }
    if (id.startsWith("suggestion:")) {
      // Selection of suggestion cards stays inside the panel — we mirror
      // it as the list's selected id but don't surface it to the cross-cutting
      // comment-selection hook (which deals with anchored cards).
      onSelectComment(id);
      return;
    }
    onSelectComment(id);
  };

  const handleJumpSuggestion = (index: number) => {
    onJumpSuggestion(index);
    const s = suggestions[index];
    if (s) onSelectComment(`suggestion:${s.id}`);
  };

  return (
    <CardListPanel<Item>
      kind="revisions"
      count={totalCount}
      onAdd={handleAdd}
      headerLeading={headerLeading}
      panelExtras={
        <RevisionsHeaderBar
          suggestions={suggestions}
          currentIndex={currentSuggestionIndex}
          onJump={handleJumpSuggestion}
        />
      }
      items={items}
      getId={(it) => it.id}
      selectedId={selectedCommentId}
      onSelect={handleSelect}
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      showDropPlaceholder={isDragOver}
      emptyState={
        <div className={PANEL.empty}>
          No comments or suggestions yet. Click + to add a comment, or drop
          a paragraph or selection here.
        </div>
      }
      renderCard={(it, { selected }) => {
        if (it.kind === "suggestion") {
          return (
            <SuggestionCard
              suggestion={it.data}
              selected={selected}
              onSelect={(nextId) => handleSelect(nextId == null ? null : it.id)}
              onAct={onActOnSuggestion}
              onUpdateField={onUpdateSuggestionField}
            />
          );
        }
        const c = it.data;
        return (
          <CommentCard
            comment={c}
            selected={selected}
            onSelect={(nextId) => {
              if (c.selectedText) onHighlight(null);
              onSelectComment(nextId);
            }}
            onJump={
              c.selectedText
                ? () => {
                    onHighlight(null);
                    queueMicrotask(() => onHighlight(c.selectedText ?? null));
                  }
                : undefined
            }
            onUpdateContent={onUpdateContent}
            onSetAuthor={onSetAuthor}
            onDelete={onDelete}
            onHoverChange={
              onHoverComment
                ? (hovering) => onHoverComment(hovering ? c.id : null)
                : undefined
            }
            extraDataAttrs={
              c.selectedText ? { "data-revision-entry": c.id } : undefined
            }
          />
        );
      }}
      inTextRenderItem={(it, { selected }) => {
        // In-text mode only shows anchored items — suggestions have no
        // anchor (yet), so they stay in list view.
        if (it.kind !== "comment") return null;
        const c = it.data;
        if (!c.selectedText) return null;
        const borderColor = commentTheme.borderSelected;
        const selectedBg = commentTheme.headerSelected;
        return (
          <div
            data-revision-entry={c.id}
            className={`px-2 pr-4 py-2 border-b cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-edge-hover" : "border-b-edge-hover hover-on-light"}`}
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
              onSelectComment(selected ? null : c.id);
            }}
            onMouseEnter={
              onHoverComment ? () => onHoverComment(c.id) : undefined
            }
            onMouseLeave={
              onHoverComment ? () => onHoverComment(null) : undefined
            }
          >
            {c.selectedText && (
              <div className="text-[10px] italic text-ink-muted truncate mb-0.5">
                &ldquo;{c.selectedText}&rdquo;
              </div>
            )}
            <p
              className="text-xs text-ink-body leading-snug line-clamp-2 pr-6"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {c.text || (
                <span className="italic text-ink-muted">Empty comment</span>
              )}
            </p>
          </div>
        );
      }}
    />
  );
}
