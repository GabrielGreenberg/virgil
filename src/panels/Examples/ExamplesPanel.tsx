"use client";

import { useCallback, useEffect, memo } from "react";
import type { ExampleInfo } from "@/components/Editor";
import {
  ItemMenu,
  PANEL,
  useCycle,
  useListNavKeys,
} from "@/components/panel-primitives";
import PanelThemePicker from "@/components/PanelThemePicker";
import { CardListPanel } from "@/panels/_shared/CardListPanel";
import { CreationHint } from "@/panels/_shared/CreationHint";
import { ExampleCard } from "./ExampleCard";

interface ExamplesPanelProps {
  examples: ExampleInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJump: (id: string, sourceEl?: HTMLElement | null) => void;
  // NOTE: no `onAdd`. It was declared here and forwarded to `CardListPanel` for
  // as long as the panel existed, and no host ever passed it — so the header
  // "+" was never rendered and the only way in an empty Examples panel named
  // was a `(1)` toolbar glyph that does not exist. Task 727 removed the prop
  // rather than wiring a button: inserting an example from a panel header is a
  // different gesture from `\ex` at the caret, and that is a feature to ask
  // for, not one to infer from a prop nobody passed.
}

function ExamplesPanel(props: ExamplesPanelProps) {
  const {
    examples,
    selectedId,
    onSelect,
    onJump,
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

  const handleNavKeys = useListNavKeys(examples.length, cycleNext, cyclePrev);

  return (
    <CardListPanel
      kind="examples"
      headerLeading={
        <ItemMenu align="left">
          <div className="px-3 py-1.5 flex items-center justify-end gap-2">
            <PanelThemePicker panelKey="example" label="Example color" />
          </div>
        </ItemMenu>
      }
      items={examples}
      getId={(it) => it.exampleId}
      selectedId={selectedId}
      onSelect={onSelect}
      emptyState={
        <div className={PANEL.empty}>
          No examples yet.
          <CreationHint action="example" />
        </div>
      }
      onKeyDown={handleNavKeys}
      scrollTabIndex={0}
      renderCard={(ex, { selected }) => (
        <ExampleCard
          example={ex}
          isSelected={selected}
          // C15: monotonic select (store is the single selection source).
          onSelect={() => onSelect(ex.exampleId)}
          onJump={(sourceEl) => onJump(ex.exampleId, sourceEl)}
        />
      )}
    />
  );
}

export default memo(ExamplesPanel);
