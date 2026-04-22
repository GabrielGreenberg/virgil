"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { PANEL, PrevNextCounter } from "@/components/panel-primitives";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import type { LatexError } from "@/lib/latex-errors";
import { ErrorCard, errorTitle } from "./ErrorCard";

export interface ErrorsPanelProps {
  errors: LatexError[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Jump to the error's location. In code view scrolls the CodeEditor; in
   *  rich-text view switches into code view at the line (or jumps to an
   *  anchored paragraph when one was found). */
  onJump: (err: LatexError) => void;
  /** Maps `err.id` → a short source snippet (e.g. the offending code line).
   *  Shown as the card's quoted header fragment. */
  snippets?: Map<string, string>;
  /** Maps `err.id` → a paragraph-anchor id when the error's line was
   *  resolved to a paragraph. Used purely to dim the jump target title
   *  ("Jump to in text" vs. "Jump to line in code"). */
  anchoredIds?: Set<string>;
  dismissedIds: Set<string>;
  onDismiss: (id: string) => void;
  onHover?: (id: string | null) => void;
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
  onHover,
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

  // Clear selection if the selected error drops out of the filtered list
  // (filter change, dismissal, or re-lint that removed the error).
  useEffect(() => {
    if (selectedId && !filtered.some((e) => e.id === selectedId)) {
      onSelect(null);
    }
  }, [filtered, selectedId, onSelect]);

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

  return (
    <CardListPanel<LatexError>
      kind="errors"
      count={visible.length}
      headerExtras={headerExtras}
      panelExtras={panelExtras}
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
          hasAnchor={anchoredIds?.has(err.id) ?? false}
          onSelect={onSelect}
          onJump={() => onJump(err)}
          onDismiss={onDismiss}
          onHoverChange={
            onHover ? (hovering) => onHover(hovering ? err.id : null) : undefined
          }
        />
      )}
    />
  );
}

export default memo(ErrorsPanel);
