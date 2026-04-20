"use client";

import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import {
  formatMinimalCitation,
  parseCiteCommand,
  serializeCiteCommand,
} from "@/lib/bib-parser";
import {
  PanelCard,
  PANEL,
  TargetIcon,
  headerOverrideStyle,
  separatorOverrideStyle,
} from "@/components/panel-primitives";
import { useCardTheme } from "@/hooks/usePanelTheme";
import { usePoppedCards } from "@/hooks/usePoppedCards";
import { FloatCard } from "@/components/FloatingCards";
import BibEntryCard from "@/components/BibEntryCard";
import CitationBuilder, {
  type CitationBuilderHandle,
} from "@/components/CitationBuilder";
import { MIME_CITATION } from "@/lib/marginalia";
import { popKey } from "@/panels/panel-registry";

export interface CitationCardProps {
  citation: CitationRef;
  isSelected: boolean;
  bibEntries: BibEntry[];
  bibPackage: string;
  getDisplayText: (command: string) => string;
  onSelect: () => void;
  onJump: () => void;
  onUpdateCitation: (id: string, command: string) => void;
  getFormattedBib: (entry: BibEntry) => string;
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  onRequestReview: (
    bibKey: string,
    type: "fields" | "notes",
    requestNotes?: string,
  ) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (
    bibKey: string,
    type: "fields" | "notes",
  ) => "none" | "pending" | "complete";
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (
    oldKey: string,
    newKey: string,
    newType: string,
  ) => void;
  isAnchored?: boolean;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  extraDataAttrs?: Record<string, string>;
  onTogglePopout?: () => void;
  isPoppedOut?: boolean;
}

export function CitationCard({
  citation: cit,
  isSelected,
  bibEntries,
  bibPackage,
  getDisplayText,
  onSelect,
  onJump,
  onUpdateCitation,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  isAnchored = true,
  wrapperClassName,
  wrapperStyle,
  extraDataAttrs,
  onTogglePopout,
  isPoppedOut,
}: CitationCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [expandedBibKey, setExpandedBibKey] = useState<string | null>(null);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const editWrapperRef = useRef<HTMLDivElement>(null);
  const builderHandleRef = useRef<CitationBuilderHandle>(null);
  const theme = useCardTheme("citation");
  const popped = usePoppedCards();
  const cardKey = popKey("citations", cit.id);

  const bibEntryMap = useMemo(
    () => new Map(bibEntries.map((e) => [e.key, e])),
    [bibEntries],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const display = getDisplayText(cit.command);
      const plain = display.replace(/<[^>]+>/g, "");
      e.dataTransfer.setData("text/plain", cit.command);
      e.dataTransfer.setData(
        MIME_CITATION,
        JSON.stringify({ command: cit.command, citationId: cit.id }),
      );
      e.dataTransfer.effectAllowed = "copy";
      const ghost = document.createElement("div");
      ghost.textContent =
        plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 14);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    },
    [cit, getDisplayText],
  );

  const handleBuilderEdit = useCallback(
    (command: string) => {
      onUpdateCitation(cit.id, command);
      setIsEditing(false);
    },
    [cit.id, onUpdateCitation],
  );

  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: MouseEvent) => {
      const wrapper = editWrapperRef.current;
      if (!wrapper || wrapper.contains(e.target as Node)) return;
      builderHandleRef.current?.commit();
      setIsEditing(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isEditing]);

  const toggleBibKey = useCallback((key: string) => {
    setExpandedBibKey((prev) => (prev === key ? null : key));
  }, []);

  const expandedEntry = expandedBibKey
    ? bibEntryMap.get(expandedBibKey)
    : undefined;

  const buildSingleKeyCommand = useCallback(
    (key: string): string => {
      const parsed = parseCiteCommand(cit.command);
      if (!parsed) return `\\cite{${key}}`;
      return serializeCiteCommand(
        {
          type: parsed.type,
          starred: parsed.starred,
          capitalized: parsed.capitalized,
          entries: [{ key }],
        },
        bibPackage,
      );
    },
    [cit.command, bibPackage],
  );

  const handleBibPodDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!expandedBibKey) return;
      e.stopPropagation();
      const cmd = buildSingleKeyCommand(expandedBibKey);
      const display = getDisplayText(cmd);
      const plain = display.replace(/<[^>]+>/g, "");
      e.dataTransfer.setData("text/plain", cmd);
      e.dataTransfer.setData(
        MIME_CITATION,
        JSON.stringify({ command: cmd, bibKey: expandedBibKey }),
      );
      e.dataTransfer.effectAllowed = "copy";
      const ghost = document.createElement("div");
      ghost.textContent =
        plain.length > 80 ? plain.slice(0, 80) + "\u2026" : plain;
      ghost.style.cssText =
        "position:absolute;top:-9999px;left:-9999px;max-width:260px;padding:4px 8px;background:#fdf8e1;border:1px solid #e0d5a8;border-radius:3px;font-size:12px;color:#6b6245;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 10, 14);
      requestAnimationFrame(() => document.body.removeChild(ghost));
    },
    [expandedBibKey, buildSingleKeyCommand, getDisplayText],
  );

  const handleCardDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME_CITATION)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!isDropTarget) setIsDropTarget(true);
    },
    [isDropTarget],
  );

  const handleCardDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && (e.currentTarget as Node).contains(next)) return;
    setIsDropTarget(false);
  }, []);

  const handleCardDrop = useCallback(
    (e: React.DragEvent) => {
      const data = e.dataTransfer.getData(MIME_CITATION);
      if (!data) return;
      let parsed: { command?: string; bibKey?: string; citationId?: string };
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      if (!parsed.bibKey) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDropTarget(false);
      const current = parseCiteCommand(cit.command);
      if (!current) return;
      if (current.entries.some((en) => en.key === parsed.bibKey)) return;
      const newCommand = serializeCiteCommand(
        {
          type: current.type,
          starred: current.starred,
          capitalized: current.capitalized,
          entries: [...current.entries, { key: parsed.bibKey! }],
        },
        bibPackage,
      );
      onUpdateCitation(cit.id, newCommand);
    },
    [cit.id, cit.command, bibPackage, onUpdateCitation],
  );

  const stateClass = isDropTarget
    ? "ring-2 ring-drag-target ring-offset-0"
    : !isAnchored
      ? "border-dashed opacity-80"
      : "";

  const isPoppedInCtx = popped?.isPopped(cardKey) ?? false;
  if (!isPoppedOut && isPoppedInCtx) return null;
  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const card = (
    <PanelCard
      data-citation-entry={cit.id}
      {...(extraDataAttrs || {})}
      theme={theme}
      selected={isSelected}
      isPoppedOut={isPoppedOut}
      onTogglePopout={onToggleFromCtx}
      extraCardClass={`cursor-pointer cursor-grab active:cursor-grabbing ${stateClass}`}
      draggable={!isEditing}
      onDragStart={handleDragStart}
      onDragOver={handleCardDragOver}
      onDragLeave={handleCardDragLeave}
      onDrop={handleCardDrop}
      className={wrapperClassName}
      style={wrapperStyle}
      onClick={onSelect}
      title={
        !isAnchored
          ? "Unanchored citation — drag into the editor to anchor it"
          : undefined
      }
    >
      {isEditing ? (
        <div className={PANEL.cardInner}>
          <div ref={editWrapperRef} onClick={(e) => e.stopPropagation()}>
            <CitationBuilder
              ref={builderHandleRef}
              initialCommand={cit.command}
              bibPackage={bibPackage}
              bibEntries={bibEntries}
              getDisplayText={getDisplayText}
              onSave={handleBuilderEdit}
              onCancel={() => setIsEditing(false)}
              saveLabel="Save"
            />
          </div>
        </div>
      ) : (
        <>
          <div
            className={`flex items-center gap-2 pl-3 pr-7 py-1.5 ${isSelected ? theme.headerSelected : theme.headerDefault}`}
            style={headerOverrideStyle(theme, isSelected)}
          >
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
              {cit.keys.map((key) => {
                const entry = bibEntryMap.get(key);
                const isActive = expandedBibKey === key;
                const label = entry
                  ? formatMinimalCitation(key, bibEntries)
                  : key;
                return (
                  <button
                    key={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBibKey(key);
                    }}
                    className={`inline-block rounded-[3px] border px-1.5 py-0.5 text-xs cursor-pointer transition-colors ${
                      !entry
                        ? "border-dashed border-red-300 text-danger bg-danger-soft/50"
                        : isActive
                          ? "bg-[#fef3c3] border-[#d4a843] text-[#4a3f20]"
                          : "bg-[#fdf8e1] border-[#e0d5a8] text-[#6b6245] hover:bg-[#fef3c3] hover:border-[#d4a843]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <div
              className={`shrink-0 transition-opacity ${isSelected ? "opacity-100" : "opacity-60"}`}
              draggable={false}
              onDragStart={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              <TargetIcon onClick={onJump} title="Jump to citation" />
            </div>
          </div>

          <div
            className={`border-t transition-colors ${isSelected ? theme.separatorSelected : "border-edge-subtle group-hover:border-edge-hover"}`}
            style={separatorOverrideStyle(theme, isSelected)}
          />

          <div
            className={`${PANEL.cardInner}${isPoppedOut ? " flex-1 min-h-0 overflow-auto" : ""}`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="text-xs font-mono text-ink-subtle truncate flex-1 min-w-0">
                {cit.command}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsEditing(true);
                }}
                className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-edge-subtle text-ink-muted hover:text-ink-body hover:bg-surface-muted-strong hover:border-edge-hover transition-colors flex-shrink-0"
                title="Edit citation"
              >
                Edit
              </button>
            </div>

            {cit.keys
              .filter((k) => !bibEntryMap.has(k))
              .map((k) => (
                <div key={k} className="text-xs text-danger mt-1">
                  Key not found in .bib:{" "}
                  <span className="font-mono">{k}</span>
                </div>
              ))}

            {expandedEntry && (
              <div
                draggable
                onDragStart={handleBibPodDragStart}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 rounded-md border border-edge-subtle bg-surface-muted/40 p-2 cursor-grab active:cursor-grabbing"
                title="Drag to insert this citation"
              >
                <BibEntryCard
                  entry={expandedEntry}
                  isSelected={false}
                  onClick={() => {}}
                  getFormattedBib={getFormattedBib}
                  getAnnotation={getAnnotation}
                  setAnnotation={setAnnotation}
                  onRequestReview={onRequestReview}
                  onCancelReview={onCancelReview}
                  getReviewStatus={getReviewStatus}
                  onUpdateBibEntry={onUpdateBibEntry}
                  onUpdateBibKeyAndType={onUpdateBibKeyAndType}
                  bibPackage={bibPackage}
                  bibEntries={bibEntries}
                  compact
                />
              </div>
            )}
          </div>
        </>
      )}
    </PanelCard>
  );
  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;
  return card;
}
