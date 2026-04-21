"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type { Editor } from "@tiptap/react";
import type { GeneralRevision, TextRevision } from "@/lib/types";
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
import { resolveAnchorRange, getTextAnchor } from "@/links/links";
import { MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { RevisionCard } from "./RevisionCard";

const CLAUDE_ID = "claude";

function NewRevisionForm({
  placeholder,
  quotedText,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  quotedText?: string;
  onSubmit: (text: string, isAiRequest: boolean) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [isAiRequest, setIsAiRequest] = useState(true);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed, isAiRequest);
  };

  return (
    <div
      className={panelCard(true)}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={`${PANEL.cardInner} space-y-2`}>
        {quotedText && (
          <div className="text-xs italic text-[var(--muted)] border-l-2 border-edge-subtle pl-2 truncate">
            &ldquo;
            {quotedText.length > 80
              ? quotedText.slice(0, 80) + "…"
              : quotedText}
            &rdquo;
          </div>
        )}
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
              e.preventDefault();
              onCancel();
            }
          }}
          rows={3}
          placeholder={placeholder}
          className="w-full bg-surface border border-edge-subtle rounded px-2.5 py-2 text-sm text-ink-strong focus:outline-none focus:border-edge-strong resize-none"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-ink-body select-none">
            <input
              type="checkbox"
              checked={isAiRequest}
              onChange={(e) => setIsAiRequest(e.target.checked)}
              className="cursor-pointer accent-[var(--accent)]"
            />
            <span>AI request</span>
          </label>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[var(--muted-light)] mr-1">
              Cmd+Enter
            </span>
            <button
              onClick={onCancel}
              className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-ink-body transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!text.trim()}
              className="text-xs px-2.5 py-1 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface RevisionsPanelProps {
  generalRevisions: GeneralRevision[];
  textRevisions: TextRevision[];
  onAddGeneral: (text: string, authorId?: string) => void;
  onDelete: (kind: RevisionKind, id: string) => void;
  visible: boolean;
  pendingSelectedText: string | null;
  onSubmitNew: (text: string, authorId?: string) => void;
  onCancelNew: () => void;
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
  | { kind: "new-general"; id: string }
  | { kind: "pending-text"; id: string; selectedText: string }
  | { kind: "general"; id: string; data: GeneralRevision }
  | { kind: "text"; id: string; data: TextRevision };

export default function RevisionsPanel({
  generalRevisions,
  textRevisions,
  onAddGeneral,
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
  const [addingGeneral, setAddingGeneral] = useState(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
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

  const registerCardRef = useCallback(
    (id: string, el: HTMLDivElement | null) => {
      if (el) cardRefs.current.set(id, el);
      else cardRefs.current.delete(id);
    },
    [],
  );

  const items = useMemo<RevisionItem[]>(() => {
    const out: RevisionItem[] = [];
    if (addingGeneral) out.push({ kind: "new-general", id: "__new-general" });
    if (pendingSelectedText)
      out.push({
        kind: "pending-text",
        id: "__pending-text",
        selectedText: pendingSelectedText,
      });
    for (const r of sortedGeneral) out.push({ kind: "general", id: r.id, data: r });
    for (const r of sortedText) out.push({ kind: "text", id: r.id, data: r });
    return out;
  }, [addingGeneral, pendingSelectedText, sortedGeneral, sortedText]);

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

  return (
    <CardListPanel<RevisionItem>
      kind="revisions"
      count={totalCount}
      onAdd={() => setAddingGeneral(true)}
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
      onDrop={handleDrop}
      emptyState={
        <div className={PANEL.empty}>
          No revisions yet. Click + to add one, or drop a paragraph or
          selection here.
        </div>
      }
      renderCard={(it, { selected }) => {
        switch (it.kind) {
          case "new-general":
            return (
              <NewRevisionForm
                placeholder="Revision for the whole document…"
                onSubmit={(text, isAi) => {
                  onAddGeneral(text, isAi ? CLAUDE_ID : undefined);
                  setAddingGeneral(false);
                }}
                onCancel={() => setAddingGeneral(false)}
              />
            );
          case "pending-text":
            return (
              <NewRevisionForm
                placeholder="Revision for the selected text…"
                quotedText={it.selectedText}
                onSubmit={(text, isAi) =>
                  onSubmitNew(text, isAi ? CLAUDE_ID : undefined)
                }
                onCancel={onCancelNew}
              />
            );
          case "general": {
            const r = it.data;
            return (
              <RevisionCard
                id={r.id}
                text={r.text}
                isAiRequest={r.authorId === CLAUDE_ID}
                selected={selected}
                onSelect={() => onSelectRevision(selected ? null : r.id)}
                onDelete={() => onDelete("general", r.id)}
                registerRef={(el) => registerCardRef(r.id, el)}
              />
            );
          }
          case "text": {
            const r = it.data;
            return (
              <RevisionCard
                id={r.id}
                text={r.text}
                isAiRequest={r.authorId === CLAUDE_ID}
                quotedText={r.selectedText}
                selected={selected}
                onSelect={() => {
                  onHighlight(null);
                  onSelectRevision(selected ? null : r.id);
                }}
                onJump={() => {
                  onHighlight(null);
                  queueMicrotask(() => onHighlight(r.selectedText));
                }}
                onDelete={() => onDelete("text", r.id)}
                registerRef={(el) => registerCardRef(r.id, el)}
                onHoverChange={
                  onHoverRevision
                    ? (hovering) =>
                        onHoverRevision(hovering ? r.id : null)
                    : undefined
                }
                dataAttrs={{ "data-revision-entry": r.id }}
              />
            );
          }
        }
      }}
      inTextRenderItem={(it, { selected }) => {
        if (it.kind !== "text") return null;
        const r = it.data;
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
