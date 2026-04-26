"use client";

import { useCallback, useEffect, useMemo, memo } from "react";
import type { Editor } from "@tiptap/react";
import type { ExampleInfo } from "@/components/Editor";
import ViewToggle from "@/components/ViewToggle";
import { useInTextPositions } from "@/hooks/useInTextPositions";
import {
  ItemMenu,
  PANEL,
  PrevNextCounter,
  TargetIcon,
  useCycle,
  clearStaleHover,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { ExampleCard } from "./ExampleCard";
import { useCardTheme } from "@/hooks/usePanelTheme";

interface ExamplesPanelProps {
  examples: ExampleInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJump: (id: string) => void;
  editor: Editor | null;
  panelSide: "left" | "right";
  viewMode: "list" | "in-text";
  onViewModeChange: (mode: "list" | "in-text") => void;
  onAdd?: () => void;
}

function ExamplesPanel({
  examples,
  selectedId,
  onSelect,
  onJump,
  editor,
  panelSide,
  viewMode,
  onViewModeChange,
  onAdd,
}: ExamplesPanelProps) {
  const theme = useCardTheme("example");
  const inTextItems = useMemo(
    () => examples.map((e) => ({ id: e.exampleId, pos: e.pos })),
    [examples],
  );
  const { positions, editorScrollHeight, panelScrollRef } = useInTextPositions(
    editor,
    inTextItems,
    viewMode === "in-text",
  );

  const onActivate = useCallback(
    (ex: ExampleInfo) => {
      onSelect(ex.exampleId);
      onJump(ex.exampleId);
    },
    [onSelect, onJump],
  );
  const {
    idx: cycleIdx,
    next: cycleNext,
    prev: cyclePrev,
    setIdx: setCycleIdx,
  } = useCycle(examples, onActivate);

  useEffect(() => {
    if (!selectedId) {
      if (cycleIdx != null) setCycleIdx(null);
      return;
    }
    const i = examples.findIndex((ex) => ex.exampleId === selectedId);
    if (i >= 0 && i !== cycleIdx) setCycleIdx(i);
  }, [selectedId, examples, cycleIdx, setCycleIdx]);

  const handleNavKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (examples.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        cycleNext();
        clearStaleHover(e.currentTarget as HTMLElement);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        cyclePrev();
        clearStaleHover(e.currentTarget as HTMLElement);
      }
    },
    [examples, cycleNext, cyclePrev],
  );

  return (
    <CardListPanel
      kind="examples"
      onAdd={onAdd}
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="example" label="Example color" />
            <ViewToggle mode={viewMode} onChange={onViewModeChange} />
          </div>
        </ItemMenu>
      }
      headerExtras={
        <PrevNextCounter current={cycleIdx} total={examples.length} label="" />
      }
      items={examples}
      getId={(it) => it.exampleId}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No examples. Click the <span className="font-mono">(1)</span> glyph in
          the formatting toolbar to insert one.
        </div>
      }
      viewMode={viewMode}
      inTextPositions={positions}
      inTextScrollHeight={editorScrollHeight}
      scrollRef={viewMode === "in-text" ? panelScrollRef : undefined}
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(ex, { selected }) => (
        <ExampleCard
          example={ex}
          isSelected={selected}
          onSelect={() =>
            onSelect(selectedId === ex.exampleId ? null : ex.exampleId)
          }
          onJump={() => onJump(ex.exampleId)}
        />
      )}
      inTextRenderItem={(ex, { selected: _selected }) => (
        <div
          data-link-card={`example:${ex.exampleId}`}
          className={`group px-1 pr-4 py-2 border-b transition-colors cursor-pointer in-text-connector in-text-connector-${panelSide} ${
            selectedId === ex.exampleId
              ? "bg-teal-100/40 border-l-2 border-l-teal-300 border-b-edge-hover"
              : "border-b-edge-hover hover-on-light"
          }`}
          onClick={() =>
            onSelect(selectedId === ex.exampleId ? null : ex.exampleId)
          }
        >
          <div
            className={`absolute top-1 right-1 transition-opacity ${
              selectedId === ex.exampleId
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-40 hover:!opacity-100"
            }`}
          >
            <TargetIcon
              onClick={() => onJump(ex.exampleId)}
              title="Jump to example"
            />
          </div>
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center shrink-0 mt-0.5">
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-semibold"
                style={{
                  background: theme.badgeBg,
                  color: theme.badgeColor,
                  border: `1.5px solid ${theme.badgeBorder}`,
                }}
              >
                {ex.number || "?"}
              </span>
            </span>
            <p
              className="text-xs text-ink-body leading-snug line-clamp-2 min-w-0"
              style={{ fontFamily: "var(--font-serif), Georgia, serif" }}
            >
              {ex.preview || <span className="italic text-ink-muted">Empty</span>}
            </p>
          </div>
        </div>
      )}
    />
  );
}

export default memo(ExamplesPanel);
