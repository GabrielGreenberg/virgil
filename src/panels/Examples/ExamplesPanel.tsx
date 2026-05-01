"use client";

import { useCallback, useEffect, memo } from "react";
import type { ExampleInfo } from "@/components/Editor";
import {
  ItemMenu,
  PANEL,
  PrevNextCounter,
  useCycle,
  clearStaleHover,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { ExampleCard } from "./ExampleCard";

interface ExamplesPanelProps {
  examples: ExampleInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJump: (id: string, sourceEl?: HTMLElement | null) => void;
  onAdd?: () => void;
  onUpdateLatex?: (exampleId: string, latex: string) => boolean;
}

function ExamplesPanel(props: ExamplesPanelProps) {
  const {
    examples,
    selectedId,
    onSelect,
    onJump,
    onAdd,
    onUpdateLatex,
  } = props;
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
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(ex, { selected }) => (
        <ExampleCard
          example={ex}
          isSelected={selected}
          onSelect={() =>
            onSelect(selectedId === ex.exampleId ? null : ex.exampleId)
          }
          onJump={(sourceEl) => onJump(ex.exampleId, sourceEl)}
          onUpdateLatex={
            onUpdateLatex
              ? (latex) => onUpdateLatex(ex.exampleId, latex)
              : undefined
          }
        />
      )}
    />
  );
}

export default memo(ExamplesPanel);
