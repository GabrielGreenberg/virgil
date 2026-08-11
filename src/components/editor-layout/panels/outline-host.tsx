"use client";

import type { JSONContent } from "@tiptap/react";
import OutlinePanel, { type SectionPathEntry } from "@/panels/Outline";
import type { FocusBand } from "@/lib/focus-view";

export interface OutlineHostProps {
  content: JSONContent | null;
  /** Scopes the persisted fold set to this document (task 111). */
  docId: string;
  onScrollTo: (blockIndex: number) => void;
  onReorderBlocks: (fromIndex: number, count: number, toIndex: number) => void;
  // T3 (W3a): rename/label address by durable block uuid, not integer index.
  onRenameHeading: (uuid: string, newText: string) => void;
  onRenameParTitle: (uuid: string, newTitle: string) => void;
  onUpdateLabel: (uuid: string, newLabel: string | null) => void;
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;
  activeSectionPath: SectionPathEntry[];
  activeParTitleIndex: number | null;
  /** UUID-anchored focus band; OutlinePanel resolves it to index boundaries
   *  against its own snapshot (task 307). */
  focusBand: FocusBand | null;
  onFocusActivate: () => void;
  onFocusDeactivate: () => void;
  onFocusToggleLock: () => void;
  onFocusMoveTo: (blockIndex: number) => void;
  onFocusExpandTo: (blockIndex: number) => void;
  onFocusSnapBoundary: (edge: "top" | "bottom", blockIndex: number) => void;
}

export function OutlineHost(p: OutlineHostProps) {
  return (
    <OutlinePanel
      content={p.content}
      docId={p.docId}
      onScrollTo={p.onScrollTo}
      onReorderBlocks={p.onReorderBlocks}
      onRenameHeading={p.onRenameHeading}
      onRenameParTitle={p.onRenameParTitle}
      onUpdateLabel={p.onUpdateLabel}
      isLabelTaken={p.isLabelTaken}
      activeSectionPath={p.activeSectionPath}
      activeParTitleIndex={p.activeParTitleIndex}
      focusBand={p.focusBand}
      onFocusActivate={p.onFocusActivate}
      onFocusDeactivate={p.onFocusDeactivate}
      onFocusToggleLock={p.onFocusToggleLock}
      onFocusMoveTo={p.onFocusMoveTo}
      onFocusExpandTo={p.onFocusExpandTo}
      onFocusSnapBoundary={p.onFocusSnapBoundary}
    />
  );
}
