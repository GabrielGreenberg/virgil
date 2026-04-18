"use client";

import { useCallback, useMemo } from "react";
import type { JSONContent } from "@tiptap/react";
import type { CutItem } from "@/lib/types";
import {
  CARD_THEMES,
  EditableCard,
  PANEL,
  PanelHeader,
  BadgeLabel,
  BadgeOrphaned,
  CardTitleInput,
  CardTargetIcon,
  startTextDrag,
} from "./panel-primitives";
import { normalizeRichContent } from "@/lib/footnote-content";
import { MIME_CUT, MIME_SELECTION_ANCHOR } from "@/lib/marginalia";
import { MIME_PAR_CAPTURE } from "@/hooks/usePanelCapture";

function startCutDrag(e: React.DragEvent, cutId: string) {
  e.dataTransfer.setData(MIME_CUT, JSON.stringify({ cutId }));
  e.dataTransfer.effectAllowed = "copy";
}

export function CutCard({
  cut,
  selected,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  onJump,
  onHoverChange,
}: {
  cut: CutItem;
  selected: boolean;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  onJump?: () => void;
  onHoverChange?: (hovering: boolean) => void;
}) {
  const handleChange = useCallback(
    (json: JSONContent) => onUpdate(cut.id, normalizeRichContent(json)),
    [cut.id, onUpdate],
  );

  const isOrphaned = cut.paragraphIds.length === 0 && !cut.anchorId;

  return (
    <EditableCard
      id={cut.id}
      selected={selected}
      theme={CARD_THEMES.cut}
      grabHandle
      hideToolbar
      inlineDelete
      orphaned={isOrphaned}
      badge={isOrphaned
        ? <BadgeOrphaned theme={CARD_THEMES.cut} />
        : <BadgeLabel label="C" theme={CARD_THEMES.cut} />
      }
      headerContent={<CardTitleInput defaultValue={cut.title} onChange={(t) => onUpdateTitle(cut.id, t)} theme={CARD_THEMES.cut} />}
      headerTrailing={onJump
        ? <CardTargetIcon selected={selected} onClick={onJump} title="Jump to cut anchor" />
        : <CardTargetIcon selected={false} disabled onClick={() => {}} />
      }
      onClick={() => onSelect(selected ? null : cut.id)}
      onDragStart={(e) => startCutDrag(e, cut.id)}
      onTextDragStart={(e) => startTextDrag(e, cut.content, cut.title)}
      onDelete={() => onDelete(cut.id)}
      value={cut.content}
      variant="footnote"
      placeholder="Cut text…"
      onChange={handleChange}
      dataAttr={{ name: "cut-entry", value: cut.id }}
      onHoverChange={onHoverChange}
    />
  );
}

export default function CutterPanel({
  cuts,
  onAdd,
  onUpdate,
  onUpdateTitle,
  onDelete,
  onSelect,
  selectedId,
  onScrollToParagraphId,
  onHoverCut,
  onDropSelection,
  onDropParagraph,
}: {
  cuts: CutItem[];
  onAdd: () => CutItem;
  onUpdate: (id: string, content: JSONContent) => void;
  onUpdateTitle: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  onScrollToParagraphId?: (uuid: string) => void;
  onHoverCut?: (id: string | null) => void;
  onDropSelection?: (payload: { from: number; to: number; selectedText: string }) => void;
  /** Called when the user drags a paragraph by its grab bar onto the panel — creates a new cut bound to that paragraph. */
  onDropParagraph?: (paragraphId: string) => void;
}) {
  const sorted = useMemo(
    () => [...cuts].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    ),
    [cuts],
  );

  return (
    <div className="w-full bg-transparent flex flex-col overflow-hidden h-full">
      <PanelHeader title="Cutter" count={cuts.length} onAdd={() => onAdd()} />

      <div
        className={PANEL.list}
        onClick={() => onSelect(null)}
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
        {sorted.length === 0 && (
          <div className={PANEL.empty}>
            No cuts yet. Select text and click the Cutter button in the toolbar, or drag a selection into this panel.
          </div>
        )}

        {sorted.map((cut) => (
          <CutCard
            key={cut.id}
            cut={cut}
            selected={selectedId === cut.id}
            onUpdate={onUpdate}
            onUpdateTitle={onUpdateTitle}
            onDelete={onDelete}
            onSelect={onSelect}
            onJump={onScrollToParagraphId && cut.paragraphIds[0]
              ? () => onScrollToParagraphId(cut.paragraphIds[0])
              : undefined
            }
            onHoverChange={onHoverCut ? (hovering) => onHoverCut(hovering ? cut.id : null) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
