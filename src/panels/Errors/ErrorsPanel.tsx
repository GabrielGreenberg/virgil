"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { PANEL, PrevNextCounter } from "@/components/panel-primitives";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import CompileLogDisclosure from "@/components/CompileLogDisclosure";
import type { LatexError } from "@/lib/latex-errors";
import { ErrorCard, errorTitle } from "./ErrorCard";

export interface ErrorsPanelProps {
  errors: LatexError[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Jump to the error's location in the rich-text editor. Scrolls the
   *  mapped paragraph into view and applies a transient highlight to the
   *  offending range. Always stays in (or switches to) the visual editor —
   *  never the code view. */
  onJump: (err: LatexError) => void;
  /** Maps `err.id` → a short source snippet (e.g. the offending code line).
   *  Shown as the card's quoted header fragment. */
  snippets?: Map<string, string>;
  /** Maps `err.id` → a paragraph-anchor id when the error's line was
   *  resolved to a paragraph. Used to dim the jump-target icon when no
   *  anchor was found. */
  anchoredIds?: Set<string>;
  dismissedIds: Set<string>;
  onDismiss: (id: string) => void;
  /** Expansion is fully CONTROLLED (R5): `error` is non-anchored, so it has
   *  no slot in the shared cardStore — the expand axis is owned by the host
   *  (EditorPane for the docked panel, shared with the omni mirror;
   *  EditorLayout for the code-view sidebar) and threaded in. Independent of
   *  selection (the A4 N1 2×2). `onExpand` is the idempotent body-click
   *  set-true; `onToggleExpanded` is the header chevron. */
  expandedIds: Set<string>;
  onExpand: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  /** Raw pdfTeX log from the last compile — rendered as a collapsible footer
   *  disclosure so the raw log is reachable from the DOCKED panel, not just
   *  code view. Undefined → no footer (e.g. the code-view sidebar mount, which
   *  already has its own drawer). */
  compileLog?: string | null;
  compileStatus?: number | null;
  isCompiling?: boolean;
}

function ErrorsPanel({
  errors,
  selectedId,
  onSelect,
  onJump,
  snippets,
  anchoredIds,
  dismissedIds,
  onDismiss,
  expandedIds,
  onExpand,
  onToggleExpanded,
  compileLog,
  compileStatus,
  isCompiling,
}: ErrorsPanelProps) {
  const [filter, setFilter] = useState("");

  const visible = useMemo(
    () => errors.filter((e) => !dismissedIds.has(e.id)),
    [errors, dismissedIds],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        (e.detail?.toLowerCase().includes(q) ?? false) ||
        (e.ruleId?.toLowerCase().includes(q) ?? false),
    );
  }, [visible, filter]);

  // Clear selection ONLY when the selected error leaves the shared error set —
  // i.e. it was dismissed or removed by a re-lint (both drop it from `visible`).
  // `selectedId`/`onSelect` are shared cross-surface state (the omni mirror
  // renders all errors and paints its halo from `selectedId`; the editor's
  // error highlight is driven by it), so this MUST gate on `visible`, not
  // `filtered`. The panel-local text filter is a docked-view concern and must
  // not mutate shared selection: a filter that merely hides the selected card
  // keeps the selection (and the omni halo + editor highlight) intact. The
  // docked list tolerates a selected-but-filtered-out card — `selectedIdx`
  // resolves to null and the nav keys already handle that.
  useEffect(() => {
    if (selectedId && !visible.some((e) => e.id === selectedId)) {
      onSelect(null);
    }
  }, [visible, selectedId, onSelect]);

  const selectedIdx = useMemo(() => {
    if (!selectedId) return null;
    const i = filtered.findIndex((e) => e.id === selectedId);
    return i < 0 ? null : i;
  }, [filtered, selectedId]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next =
          selectedIdx == null ? 0 : (selectedIdx + 1) % filtered.length;
        onSelect(filtered[next].id);
        onJump(filtered[next]);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev =
          selectedIdx == null
            ? filtered.length - 1
            : (selectedIdx - 1 + filtered.length) % filtered.length;
        onSelect(filtered[prev].id);
        onJump(filtered[prev]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const idx = selectedIdx ?? 0;
        onSelect(filtered[idx].id);
        onJump(filtered[idx]);
      }
    },
    [filtered, selectedIdx, onSelect, onJump],
  );

  const headerExtras = (
    <PrevNextCounter
      current={selectedIdx}
      total={filtered.length}
      label="errors"
    />
  );

  const panelExtras =
    visible.length > 0 ? (
      <div className="px-3 py-2 border-b border-[var(--border-light)]">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter errors…"
          className="w-full text-sm bg-transparent outline-none placeholder:text-ink-muted"
        />
      </div>
    ) : undefined;

  // Raw-log footer disclosure — only when the host threads the compile log
  // through (the docked panel). The code-view sidebar leaves it undefined
  // because it already renders the drawer beneath the CodeEditor.
  const footer =
    compileLog !== undefined ? (
      <CompileLogDisclosure
        log={compileLog}
        status={compileStatus ?? null}
        isCompiling={isCompiling ?? false}
        openMaxHeight="240px"
      />
    ) : undefined;

  return (
    <CardListPanel<LatexError>
      kind="errors"
      count={visible.length}
      headerExtras={headerExtras}
      panelExtras={panelExtras}
      footer={footer}
      items={filtered}
      getId={(e) => e.id}
      selectedId={selectedId}
      onSelect={onSelect}
      scrollTabIndex={0}
      onKeyDown={handleNavKeys}
      emptyState={
        errors.length === 0 ? (
          <p className={PANEL.empty}>
            No errors. Edit or compile to surface diagnostics.
          </p>
        ) : visible.length === 0 ? (
          <p className={PANEL.empty}>All errors dismissed.</p>
        ) : (
          <p className={PANEL.empty}>No errors match the filter.</p>
        )
      }
      renderCard={(err, { selected }) => (
        <ErrorCard
          err={err}
          title={errorTitle(err)}
          snippet={snippets?.get(err.id)}
          selected={selected}
          expanded={expandedIds.has(err.id)}
          onExpand={() => onExpand(err.id)}
          onToggleExpanded={() => onToggleExpanded(err.id)}
          hasAnchor={anchoredIds?.has(err.id) ?? false}
          onSelect={onSelect}
          onJump={() => onJump(err)}
          onDismiss={onDismiss}
        />
      )}
    />
  );
}

export default memo(ErrorsPanel);
