"use client";

import type { JSONContent } from "@tiptap/react";
import OutlinePanel, { type SectionPathEntry } from "@/panels/Outline";
import type { FocusState } from "@/hooks/useFocusMode";

export interface OutlineHostProps {
  content: JSONContent | null;
  onScrollTo: (blockIndex: number) => void;
  onReorderBlocks: (fromIndex: number, count: number, toIndex: number) => void;
  onRenameHeading: (blockIndex: number, newText: string) => void;
  onRenameParTitle: (blockIndex: number, newTitle: string) => void;
  onUpdateLabel: (blockIndex: number, newLabel: string | null) => void;
  activeSectionPath: SectionPathEntry[];
  activeParTitleIndex: number | null;
  editorSplit: boolean;
  mirrorSectionPath: SectionPathEntry[];
  mirrorParTitleIndex: number | null;
  focusState: FocusState;
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
      onScrollTo={p.onScrollTo}
      onReorderBlocks={p.onReorderBlocks}
      onRenameHeading={p.onRenameHeading}
      onRenameParTitle={p.onRenameParTitle}
      onUpdateLabel={p.onUpdateLabel}
      activeSectionPath={p.activeSectionPath}
      activeParTitleIndex={p.activeParTitleIndex}
      editorSplit={p.editorSplit}
      mirrorSectionPath={p.mirrorSectionPath}
      mirrorParTitleIndex={p.mirrorParTitleIndex}
      focusState={p.focusState}
      onFocusActivate={p.onFocusActivate}
      onFocusDeactivate={p.onFocusDeactivate}
      onFocusToggleLock={p.onFocusToggleLock}
      onFocusMoveTo={p.onFocusMoveTo}
      onFocusExpandTo={p.onFocusExpandTo}
      onFocusSnapBoundary={p.onFocusSnapBoundary}
    />
  );
}
