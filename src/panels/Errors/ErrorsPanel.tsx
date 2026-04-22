"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  panelCard,
  PANEL,
  PrevNextCounter,
  clearStaleHover,
} from "@/components/panel-primitives";
import { Panel } from "@/panels/_shared/Panel";
import type { LatexError, LatexErrorSeverity } from "@/lib/latex-errors";

interface ErrorsPanelProps {
  errors: LatexError[];
  /** Jump CodeEditor to (line, column). EditorLayout always passes a
   *  callback when this panel is rendered, since the panel is gated to
   *  code view. */
  onJumpToLine: (line: number, column?: number) => void;
}

const SEVERITY_COLOR: Record<LatexErrorSeverity, string> = {
  error: "var(--danger)",
  warning: "#b45757",
  info: "#7191b0",
};

const SEVERITY_LABEL: Record<LatexErrorSeverity, string> = {
  error: "error",
  warning: "warning",
  info: "info",
};

function ErrorsPanel({ errors, onJumpToLine }: ErrorsPanelProps) {
  const [filter, setFilter] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return errors;
    return errors.filter(
      (e) =>
        e.message.toLowerCase().includes(q) ||
        (e.detail?.toLowerCase().includes(q) ?? false) ||
        (e.ruleId?.toLowerCase().includes(q) ?? false),
    );
  }, [errors, filter]);

  // Clamp selection if list shrinks under us.
  useEffect(() => {
    if (selectedIdx != null && selectedIdx >= filtered.length) {
      setSelectedIdx(null);
    }
  }, [filtered, selectedIdx]);

  const lintItems = useMemo(
    () => filtered.filter((e) => e.source === "lint"),
    [filtered],
  );
  const compileItems = useMemo(
    () => filtered.filter((e) => e.source === "compile"),
    [filtered],
  );

  const navigate = useCallback(
    (err: LatexError, idx: number) => {
      setSelectedIdx(idx);
      if (err.line > 0) onJumpToLine(err.line, err.column);
      requestAnimationFrame(() => {
        const card = listRef.current?.querySelector(
          `[data-result-idx="${idx}"]`,
        );
        card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    [onJumpToLine],
  );

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (filtered.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        const next =
          selectedIdx == null ? 0 : (selectedIdx + 1) % filtered.length;
        navigate(filtered[next], next);
        clearStaleHover(listRef.current);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        const prev =
          selectedIdx == null
            ? filtered.length - 1
            : (selectedIdx - 1 + filtered.length) % filtered.length;
        navigate(filtered[prev], prev);
        clearStaleHover(listRef.current);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const idx = selectedIdx ?? 0;
        navigate(filtered[idx], idx);
      }
    },
    [filtered, selectedIdx, navigate],
  );

  const headerExtras = (
    <PrevNextCounter
      current={selectedIdx}
      total={filtered.length}
      label="errors"
    />
  );

  const panelExtras =
    errors.length > 0 ? (
      <div className="px-3 py-2 border-b border-[var(--border-light)]">
        <input
          type="text"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setSelectedIdx(null);
          }}
          placeholder="Filter errors…"
          className="w-full text-sm bg-transparent outline-none placeholder:text-ink-muted"
        />
      </div>
    ) : undefined;

  // Render groups with a single flat index so arrow-nav matches what the user sees.
  const renderGroup = (
    label: string,
    items: LatexError[],
    startIdx: number,
    isFirst: boolean,
  ) => {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div
          className={`text-[10px] font-medium text-stone-500 uppercase tracking-wide px-2 mb-1.5 ${
            isFirst ? "" : "mt-3 pt-2 border-t border-stone-200"
          }`}
        >
          {label}{" "}
          <span className="text-ink-muted normal-case tracking-normal">
            ({items.length})
          </span>
        </div>
        <div className="space-y-2">
          {items.map((err, i) => {
            const idx = startIdx + i;
            return (
              <ErrorRow
                key={err.id}
                err={err}
                idx={idx}
                selected={selectedIdx === idx}
                onClick={() => navigate(err, idx)}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Panel
      kind="errors"
      headerExtras={headerExtras}
      panelExtras={panelExtras}
      scrollRef={listRef}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
    >
      {errors.length === 0 && (
        <p className={PANEL.empty}>
          No errors. Edit or compile to surface diagnostics.
        </p>
      )}
      {errors.length > 0 && filtered.length === 0 && (
        <p className={PANEL.empty}>No errors match the filter.</p>
      )}
      {renderGroup("From lint", lintItems, 0, true)}
      {renderGroup("From compile", compileItems, lintItems.length, lintItems.length === 0)}
    </Panel>
  );
}

function ErrorRow({
  err,
  idx,
  selected,
  onClick,
}: {
  err: LatexError;
  idx: number;
  selected: boolean;
  onClick: () => void;
}) {
  const color = SEVERITY_COLOR[err.severity];
  return (
    <button
      data-result-idx={idx}
      onClick={onClick}
      className={`${panelCard(selected)} w-full text-left`}
      style={{ borderLeftColor: color, borderLeftWidth: 3 }}
    >
      <div className={PANEL.cardInner}>
        <div className="text-[10px] mb-1 flex items-center gap-2 flex-wrap">
          <span className="font-medium" style={{ color }}>
            {SEVERITY_LABEL[err.severity]}
          </span>
          {err.line > 0 && (
            <span className="text-ink-muted">
              line {err.line}
              {err.column ? `:${err.column}` : ""}
            </span>
          )}
          {err.ruleId && (
            <span className="text-ink-muted">· {err.ruleId}</span>
          )}
        </div>
        <div className="text-sm text-ink-body leading-snug break-words">
          {err.message}
        </div>
        {err.detail && (
          <div className="text-[11px] font-mono text-ink-muted mt-1 truncate">
            {err.detail}
          </div>
        )}
      </div>
    </button>
  );
}

export default memo(ErrorsPanel);
