"use client";

import { useMemo } from "react";
import ErrorsPanel from "@/panels/Errors";
import type { LatexError } from "@/lib/latex-errors";

export interface ErrorsHostProps {
  errors: LatexError[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  dismissedIds: Set<string>;
  onDismiss: (id: string) => void;
  onJump: (err: LatexError) => void;
  /** Pre-computed `error.id → trimmed source-line` snippet map. */
  snippets: Map<string, string>;
  /** Pre-computed `error.id → paragraphUuid` map. Drives the dimmed
   *  state of the per-card jump-target icon when an error has no
   *  resolvable paragraph anchor. */
  paragraphByErrorId: Map<string, string>;
  /** Controlled expansion (R5) — owned by the host's owner (EditorPane /
   *  EditorLayout) and threaded straight through to `ErrorsPanel`. */
  expandedIds: Set<string>;
  onExpand: (id: string) => void;
  onToggleExpanded: (id: string) => void;
}

export function ErrorsHost(p: ErrorsHostProps) {
  const anchoredIds = useMemo(
    () => new Set(p.paragraphByErrorId.keys()),
    [p.paragraphByErrorId],
  );

  return (
    <ErrorsPanel
      errors={p.errors}
      selectedId={p.selectedId}
      onSelect={p.onSelect}
      onJump={p.onJump}
      snippets={p.snippets}
      anchoredIds={anchoredIds}
      dismissedIds={p.dismissedIds}
      onDismiss={p.onDismiss}
      expandedIds={p.expandedIds}
      onExpand={p.onExpand}
      onToggleExpanded={p.onToggleExpanded}
    />
  );
}
