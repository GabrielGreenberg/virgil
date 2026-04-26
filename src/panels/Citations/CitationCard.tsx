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
  formatMediumCitationParts,
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
import { usePanelBodyStyle } from "@/hooks/usePanelTypography";
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
  const bodyStyle = usePanelBodyStyle("citation");
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

  const onToggleFromCtx =
    onTogglePopout ?? (popped ? () => popped.toggle(cardKey) : undefined);

  const card = (
    <PanelCard
      data-link-card={`citation:${cit.id}`}
      data-pristine-card-id={cit.id}
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
            <div
              data-panel-kind="citation"
              className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
              style={{
                fontSize: "var(--par-title-size, 0.78rem)",
                color: theme.titleColor,
                fontWeight: 500,
                fontFamily: "var(--font-sans), Inter, sans-serif",
                letterSpacing: "0.02em",
                ...bodyStyle,
              }}
              title={getDisplayText(cit.command).replace(/<[^>]+>/g, "")}
              dangerouslySetInnerHTML={{
                __html: getDisplayText(cit.command),
              }}
            />
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
            <ul className="flex flex-col gap-1 list-none m-0 p-0">
              {cit.keys.map((key, idx) => {
                const entry = bibEntryMap.get(key);
                const isActive = expandedBibKey === key;
                const { author, year, title } = formatMediumCitationParts(
                  key,
                  bibEntries,
                );
                return (
                  <li key={`${idx}:${key}`} className="flex flex-col gap-1">
                    <div className="flex items-start gap-2">
                      <div
                        className={`flex-1 min-w-0 text-xs leading-snug ${
                          !entry ? "text-danger" : "text-ink-body"
                        }`}
                      >
                        {entry ? (
                          <>
                            <span className="font-medium">{author}</span>
                            <span className="text-ink-subtle"> ({year})</span>
                            {title && (
                              <span className="text-ink-subtle">
                                {" — "}
                                <span className="italic">{title}</span>
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="font-mono">{key}</span>
                        )}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!entry) return;
                          toggleBibKey(key);
                        }}
                        disabled={!entry}
                        className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border transition-colors ${
                          !entry
                            ? "border-dashed border-red-300 text-danger/70 bg-danger-soft/30 cursor-not-allowed"
                            : isActive
                              ? "bg-[#fef3c3] border-[#d4a843] text-[#4a3f20]"
                              : "bg-[#fdf8e1] border-[#e0d5a8] text-[#6b6245] hover:bg-[#fef3c3] hover:border-[#d4a843]"
                        }`}
                        title={
                          entry
                            ? isActive
                              ? "Hide BibTeX entry"
                              : "Show BibTeX entry"
                            : "Entry not found in .bib"
                        }
                      >
                        Bib
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {cit.keys
              .filter((k) => !bibEntryMap.has(k))
              .map((k) => (
                <div key={k} className="text-xs text-danger mt-1">
                  Key not found in .bib:{" "}
                  <span className="font-mono">{k}</span>
                </div>
              ))}
          </div>

          <div
            className={`border-t transition-colors ${isSelected ? theme.separatorSelected : "border-edge-subtle group-hover:border-edge-hover"}`}
            style={separatorOverrideStyle(theme, isSelected)}
          />

          <div className="flex items-center gap-1.5 min-w-0 px-3 py-1 bg-surface-muted/30">
            <div className="text-[11px] font-mono text-ink-subtle truncate flex-1 min-w-0">
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
        </>
      )}
    </PanelCard>
  );
  const expandedEntry = expandedBibKey
    ? bibEntryMap.get(expandedBibKey)
    : undefined;

  const grouped = expandedEntry ? (
    <div className="space-y-2">
      {card}
      <div className="ml-4 [filter:brightness(0.96)_saturate(0.92)]">
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
          isCited
        />
      </div>
    </div>
  ) : (
    card
  );

  if (isPoppedOut) return <FloatCard cardKey={cardKey}>{grouped}</FloatCard>;
  return grouped;
}
