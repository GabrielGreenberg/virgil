"use client";

import type { ExampleInfo } from "@/components/Editor";
import ExamplesPanel from "@/panels/Examples";
import { useEditorRefContext } from "../contexts/editor-ref";
import { useSelectionsContext } from "../contexts/selections";

export interface ExamplesHostProps {
  examples: ExampleInfo[];
}

/**
 * Docked / popped-out Examples panel host.
 *
 * Store-backed selection — the last omni-eligible panel to be migrated off a
 * private `useState`. It reads `selectedExampleId` / `setSelectedExampleId`
 * from `useSelectionsContext()` (the same store slot the Omni host and
 * `openItemInPanel("examples", …)` write), so jump-to-example highlight+scroll,
 * the Omni example halo, in-text example selection, and the collab-claim all
 * stay in sync with the docked panel — matching every sibling host
 * (`footnotes-host` / `citations-host`). See task 2026-07-12-100.
 */
export function ExamplesHost({ examples }: ExamplesHostProps) {
  const { editorRef } = useEditorRefContext();
  const { selectedExampleId, setSelectedExampleId } = useSelectionsContext();
  return (
    <ExamplesPanel
      examples={examples}
      selectedId={selectedExampleId}
      onSelect={setSelectedExampleId}
      onJump={(id, sourceEl) => {
        editorRef.current?.scrollToExample(id, sourceEl ?? null);
      }}
    />
  );
}
