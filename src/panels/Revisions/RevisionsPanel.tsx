"use client";

import { useMemo, useState } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import type { GeneralRevision, TextRevision } from "@/lib/types";
import type { RevisionKind } from "@/hooks/useRevisions";
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
import { RevisionCard } from "./RevisionCard";

interface RevisionsPanelProps {
  generalRevisions: GeneralRevision[];
  textRevisions: TextRevision[];
  onAddEmptyGeneral: () => GeneralRevision | null;
  onUpdateContent: (kind: RevisionKind, id: string, content: JSONContent) => void;
  onSetAuthor: (kind: RevisionKind, id: string, authorId: string) => void;
  onDelete: (kind: RevisionKind, id: string) => void;
  visible: boolean;
  selectedRevisionId: string | null;
  onSelectRevision: (id: string | null) => void;
  onHighlight: (text: string | null) => void;
  onHoverRevision?: (id: string | null) => void;
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

type RevisionItem =
  | { kind: "general"; id: string; data: GeneralRevision }
  | { kind: "text"; id: string; data: TextRevision };

export default function RevisionsPanel({
  generalRevisions,
  textRevisions,
  onAddEmptyGeneral,
  onUpdateContent,
  onSetAuthor,
  onDelete,
  visible,
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
  const revisionTheme = useCardTheme("revision");

  const sortedGeneral = useMemo(
    () =>
      [...generalRevisions].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [generalRevisions],
  );
  const sortedText = useMemo(
    () =>
      [...textRevisions].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [textRevisions],
  );

  const totalCount = generalRevisions.length + textRevisions.length;

  const inTextItems = useMemo<PositionItem[]>(() => {
    if (!editor) return [];
    const out: PositionItem[] = [];
    for (const r of sortedText) {
      const ta = getTextAnchor(r);
      if (!ta) continue;
      const range = resolveAnchorRange(editor, ta.anchorId);
      if (range) out.push({ id: r.id, pos: range.from });
    }
    return out;
  }, [editor, sortedText]);
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor ?? null,
    inTextItems,
    viewMode === "in-text",
  );

  const items = useMemo<RevisionItem[]>(() => {
    const out: RevisionItem[] = [];
    for (const r of sortedGeneral) out.push({ kind: "general", id: r.id, data: r });
    for (const r of sortedText) out.push({ kind: "text", id: r.id, data: r });
    return out;
  }, [sortedGeneral, sortedText]);

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
    const created = onAddEmptyGeneral();
    if (created) onSelectRevision(created.id);
  };

  return (
    <CardListPanel<RevisionItem>
      kind="revisions"
      count={totalCount}
      onAdd={handleAdd}
      headerLeading={headerLeading}
      items={items}
      getId={(it) => it.id}
      selectedId={selectedRevisionId}
      onSelect={onSelectRevision}
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
          No revisions yet. Click + to add one, or drop a paragraph or
          selection here.
        </div>
      }
      renderCard={(it, { selected }) => {
        if (it.kind === "general") {
          return (
            <RevisionCard
              kind="general"
              revision={it.data}
              selected={selected}
              onSelect={onSelectRevision}
              onUpdateContent={onUpdateContent}
              onSetAuthor={onSetAuthor}
              onDelete={onDelete}
            />
          );
        }
        const r = it.data;
        return (
          <RevisionCard
            kind="text"
            revision={r}
            selected={selected}
            onSelect={(id) => {
              onHighlight(null);
              onSelectRevision(id);
            }}
            onJump={() => {
              onHighlight(null);
              queueMicrotask(() => onHighlight(r.selectedText));
            }}
            onUpdateContent={onUpdateContent}
            onSetAuthor={onSetAuthor}
            onDelete={onDelete}
            onHoverChange={
              onHoverRevision
                ? (hovering) => onHoverRevision(hovering ? r.id : null)
                : undefined
            }
            extraDataAttrs={{ "data-revision-entry": r.id }}
          />
        );
      }}
      inTextRenderItem={(it, { selected }) => {
        if (it.kind !== "text") return null;
        const r = it.data;
        const borderColor =
          revisionTheme.borderSelected;
        const selectedBg = revisionTheme.headerSelected;
        return (
          <div
            data-revision-entry={r.id}
            className={`px-2 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${selected ? "border-l-2 border-b-edge-hover" : "border-b-edge-hover hover-on-light"}`}
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
              {r.text || (
                <span className="italic text-ink-muted">Empty revision</span>
              )}
            </p>
          </div>
        );
      }}
    />
  );
}
