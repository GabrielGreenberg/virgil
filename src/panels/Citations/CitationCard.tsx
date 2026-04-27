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

  // Editable LaTeX command in the footer. Debounced auto-save: each
  // keystroke schedules an onUpdateCitation; subsequent keystrokes
  // cancel and reschedule. Done/click-outside flushes any pending save
  // before closing.
  const [latexDraft, setLatexDraft] = useState(cit.command);
  const latexDraftRef = useRef(cit.command);
  const latexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latexInputRef = useRef<HTMLInputElement>(null);
  // Pin the cit.command at edit-open so re-renders triggered by the
  // auto-save itself don't reset the LaTeX input mid-typing.
  const editOpenCommandRef = useRef(cit.command);
  const updateDraft = useCallback((v: string) => {
    latexDraftRef.current = v;
    setLatexDraft(v);
    if (latexDebounceRef.current) clearTimeout(latexDebounceRef.current);
    latexDebounceRef.current = setTimeout(() => {
      latexDebounceRef.current = null;
      if (v) onUpdateCitation(cit.id, v);
    }, 250);
  }, [cit.id, onUpdateCitation]);
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

  // Reset the editable LaTeX draft each time the user re-enters edit mode.
  // Intentionally NOT depending on cit.command — auto-save updates that
  // mid-edit, and resetting on every cit.command change would clobber the
  // user's in-progress typing.
  useEffect(() => {
    if (isEditing) {
      editOpenCommandRef.current = cit.command;
      latexDraftRef.current = cit.command;
      setLatexDraft(cit.command);
    } else {
      // Cancel any pending debounced save when leaving edit mode.
      if (latexDebounceRef.current) {
        clearTimeout(latexDebounceRef.current);
        latexDebounceRef.current = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  // Close the editor extension. Flushes any pending debounced LaTeX save
  // synchronously so nothing is lost on quick Done/click-outside.
  const closeEditor = useCallback(() => {
    if (latexDebounceRef.current) {
      clearTimeout(latexDebounceRef.current);
      latexDebounceRef.current = null;
      const v = latexDraftRef.current;
      if (v) onUpdateCitation(cit.id, v);
    }
    setIsEditing(false);
  }, [cit.id, onUpdateCitation]);

  // Bridge for the structured editor's auto-save: forward the command,
  // and also update the LaTeX input to reflect the new command — but
  // only if the user isn't currently typing in the LaTeX input (in
  // which case their typing wins).
  const handleStructuredSave = useCallback((command: string) => {
    if (!command) return;
    onUpdateCitation(cit.id, command);
    if (document.activeElement !== latexInputRef.current) {
      latexDraftRef.current = command;
      setLatexDraft(command);
    }
  }, [cit.id, onUpdateCitation]);

  useEffect(() => {
    if (!isEditing) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Treat clicks anywhere on this same citation card (Bib buttons,
      // header, footer input, Done button) as "inside" — only clicks
      // outside the card should close the editor.
      if (target.closest(`[data-link-card="citation:${cit.id}"]`)) return;
      closeEditor();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isEditing, cit.id, closeEditor]);

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
      <div
        className="flex items-center gap-2 pl-3 pr-7 py-1.5"
        style={{ backgroundColor: isSelected ? theme.headerSelected : theme.headerDefault }}
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
        className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
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
        className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
        style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
      />

      <div className="flex items-center gap-1.5 min-w-0 px-3 py-1 bg-surface-muted/30">
        {isEditing ? (
          <input
            ref={latexInputRef}
            type="text"
            value={latexDraft}
            onChange={(e) => updateDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                closeEditor();
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeEditor();
              }
            }}
            spellCheck={false}
            className="text-[11px] font-mono text-ink-body bg-transparent border-0 outline-none flex-1 min-w-0 p-0 focus:ring-0"
            title="Edit raw LaTeX command (auto-saves)"
          />
        ) : (
          <div className="text-[11px] font-mono text-ink-subtle truncate flex-1 min-w-0">
            {cit.command}
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (isEditing) {
              closeEditor();
            } else {
              setIsEditing(true);
            }
          }}
          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-edge-subtle text-ink-muted hover:text-ink-body hover-on-light hover:border-edge-hover flex-shrink-0"
          title={isEditing ? "Finish editing" : "Edit citation"}
        >
          {isEditing ? "Done" : "Edit"}
        </button>
      </div>

      {isEditing && (
        <>
          <div
            className={`border-t transition-colors ${isSelected ? "" : "border-edge-subtle group-hover:border-edge-hover"}`}
            style={isSelected ? { borderTopColor: theme.separatorSelected } : undefined}
          />
          <div ref={editWrapperRef} onClick={(e) => e.stopPropagation()}>
            <CitationBuilder
              ref={builderHandleRef}
              initialCommand={cit.command}
              bibPackage={bibPackage}
              bibEntries={bibEntries}
              getDisplayText={getDisplayText}
              onSave={handleStructuredSave}
              onCancel={closeEditor}
              variant="inline"
            />
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
      <div className="ml-4">
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
