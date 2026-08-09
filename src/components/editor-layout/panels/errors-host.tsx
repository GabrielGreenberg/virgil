"use client";

import { useMemo } from "react";
import ErrorsPanel from "@/panels/Errors";
import type { ErrorJump } from "@/panels/Errors";
import type { LatexError } from "@/lib/latex-errors";

export interface ErrorsHostProps {
  errors: LatexError[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  dismissedIds: Set<string>;
  onDismiss: (id: string) => void;
  /** This mount's jump capability — handler + semantics, forwarded whole from
   *  whoever owns the handler (task 125). `EditorPane`'s docked mount passes
   *  `useDiagnostics.errorJump` (`"anchor"`); `EditorLayout`'s code-view
   *  sidebar passes its own `"line"` capability. */
  jump: ErrorJump;
  /** Pre-computed `error.id → trimmed source-line` snippet map. */
  snippets: Map<string, string>;
  /** Pre-computed `error.id → paragraphUuid` map. Its key set is the
   *  jumpability input for an `"anchor"`-mode mount (task 125): an error with
   *  no resolvable paragraph cannot be reached there, so neither the card nor
   *  the keyboard nav hands it to the handler. */
  paragraphByErrorId: Map<string, string>;
  /** Controlled expansion (R5) — owned by the host's owner (EditorPane /
   *  EditorLayout) and threaded straight through to `ErrorsPanel`. */
  expandedIds: Set<string>;
  onExpand: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  /** Raw compile log surfaced as the panel's footer disclosure so it's
   *  reachable from the docked panel, not just code view. Optional — omit for
   *  mounts that don't want the footer. */
  compileLog?: string | null;
  compileStatus?: number | null;
  isCompiling?: boolean;
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
      jump={p.jump}
      snippets={p.snippets}
      anchoredIds={anchoredIds}
      dismissedIds={p.dismissedIds}
      onDismiss={p.onDismiss}
      expandedIds={p.expandedIds}
      onExpand={p.onExpand}
      onToggleExpanded={p.onToggleExpanded}
      compileLog={p.compileLog}
      compileStatus={p.compileStatus}
      isCompiling={p.isCompiling}
    />
  );
}
