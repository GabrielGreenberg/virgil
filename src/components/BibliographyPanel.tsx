"use client";

import { useState, useCallback, useMemo, memo } from "react";
import type { BibEntry, CitationRef } from "@/lib/types";
import { PANEL, PanelHeader } from "./panel-primitives";
import BibEntryCard from "./BibEntryCard";

interface BibliographyPanelProps {
  citations: CitationRef[];
  bibEntries: BibEntry[];
  selectedBibKey: string | null;
  onSelectBibKey: (key: string | null) => void;
  onUpdateBibEntry: (key: string, fields: Record<string, string>) => void;
  onUpdateBibKeyAndType: (oldKey: string, newKey: string, newType: string) => void;
  getFormattedBib: (entry: BibEntry) => string;
  // Annotations
  getAnnotation: (key: string) => string;
  setAnnotation: (key: string, text: string) => void;
  // Review requests
  onRequestReview: (bibKey: string, type: "fields" | "notes", requestNotes?: string) => void;
  onCancelReview: (bibKey: string, type: "fields" | "notes") => void;
  getReviewStatus: (bibKey: string, type: "fields" | "notes") => "none" | "pending" | "complete";
  // Occurrence cycling
  allEditorCitations?: Array<{ citationId: string; command: string; keys: string[] }>;
  onScrollToCitation?: (citationId: string) => void;
  onActiveCitationChange?: (citationId: string | null) => void;
  bibPackage?: string;
}

/* ── Main panel ───────────────────────────────────────────────────── */
function BibliographyPanel({
  citations,
  bibEntries,
  selectedBibKey,
  onSelectBibKey,
  onUpdateBibEntry,
  onUpdateBibKeyAndType,
  getFormattedBib,
  getAnnotation,
  setAnnotation,
  onRequestReview,
  onCancelReview,
  getReviewStatus,
  allEditorCitations = [],
  onScrollToCitation,
  onActiveCitationChange,
  bibPackage,
}: BibliographyPanelProps) {
  const [keyOccurrenceIdx, setKeyOccurrenceIdx] = useState<Record<string, number>>({});

  const keyToCitationIds = useCallback(() => {
    const map: Record<string, string[]> = {};
    for (const cit of allEditorCitations) {
      for (const key of cit.keys) {
        if (!map[key]) map[key] = [];
        map[key].push(cit.citationId);
      }
    }
    return map;
  }, [allEditorCitations]);

  const cycleOccurrence = useCallback((key: string, delta: number) => {
    const ids = keyToCitationIds()[key] || [];
    if (ids.length <= 1) return;
    const cur = keyOccurrenceIdx[key] || 0;
    const next = (cur + delta + ids.length) % ids.length;
    setKeyOccurrenceIdx((prev) => ({ ...prev, [key]: next }));
    const targetId = ids[next];
    if (targetId) {
      onScrollToCitation?.(targetId);
      onActiveCitationChange?.(targetId);
    }
  }, [keyToCitationIds, keyOccurrenceIdx, onScrollToCitation, onActiveCitationChange]);

  const handleSelectBibKey = useCallback((key: string | null) => {
    onSelectBibKey(key);
    if (key) {
      const ids = keyToCitationIds()[key] || [];
      const idx = keyOccurrenceIdx[key] || 0;
      const targetId = ids[idx] || ids[0];
      if (targetId) {
        onScrollToCitation?.(targetId);
        onActiveCitationChange?.(targetId);
      }
    } else {
      onActiveCitationChange?.(null);
    }
  }, [onSelectBibKey, keyToCitationIds, keyOccurrenceIdx, onScrollToCitation, onActiveCitationChange]);

  const citedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const cit of citations) {
      for (const k of cit.keys) keys.add(k);
    }
    return keys;
  }, [citations]);

  const sortedEntries = useMemo(() => {
    const seen = new Set<string>();
    const cited = bibEntries.filter((e) => {
      if (!citedKeys.has(e.key) || seen.has(e.key)) return false;
      seen.add(e.key);
      return true;
    });
    return cited.sort((a, b) => {
      const authorA = (a.fields.author || a.key).toLowerCase();
      const authorB = (b.fields.author || b.key).toLowerCase();
      return authorA.localeCompare(authorB);
    });
  }, [bibEntries, citedKeys]);

  return (
    <div className="w-full bg-[var(--background)] flex flex-col overflow-hidden h-full">
      <PanelHeader title="Bibliography" count={sortedEntries.length} />

      <div className={PANEL.list}>
        {sortedEntries.length === 0 && (
          <div className={PANEL.empty}>
            No cited entries found. Add citations in the editor and ensure a .bib file is available.
          </div>
        )}

        {sortedEntries.map((entry) => {
          const isSelected = selectedBibKey === entry.key;
          const ids = keyToCitationIds()[entry.key] || [];
          const idx = keyOccurrenceIdx[entry.key] || 0;

          return (
            <BibEntryCard
              key={entry.key}
              entry={entry}
              isSelected={isSelected}
              onClick={() => handleSelectBibKey(isSelected ? null : entry.key)}
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
              occurrenceInfo={ids.length > 1 ? {
                total: ids.length,
                current: idx,
                onCycle: (delta) => cycleOccurrence(entry.key, delta),
              } : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export default memo(BibliographyPanel);
