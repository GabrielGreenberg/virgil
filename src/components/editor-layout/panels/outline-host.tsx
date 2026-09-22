"use client";

import type { JSONContent } from "@tiptap/react";
import OutlinePanel, { type SectionPathEntry } from "@/panels/Outline";
import type { FocusBand } from "@/lib/focus-view";
import type { BlockAddress, BlockSpanAddress } from "@/lib/tiptap/block-address";
import { useCollabContext } from "@/hooks/useCollab";
import { useEditorChrome } from "../chrome-context";
import { mainTextEditable } from "../chrome-config";

/**
 * What the Outline may OFFER on this host (task 710). `OutlinePanel` renders
 * each mutation control only when its handler is present, so THIS is where a
 * capability becomes presence: a withheld handler is an absent control.
 *
 * - `structure` — Edit (reorder / rename pods) and the heading label `+`.
 *   These write the main text, so they need an editable host AND the pen
 *   (`collab.canEditMainText`: false while a collaborator or cowork agent
 *   holds it — the write would be refused by the read-only enforcer).
 * - `focus` — the Focus band controls. View state, not a text write, so the
 *   pen does not gate it; but a non-editable host (the Library Reader) mounts
 *   no focus mode — its handlers are no-ops — so it is withheld there.
 *
 * Never inferred from the handlers themselves: the Reader supplies the full
 * `EditorMutationHandlers` set as no-ops, so every one of them is "present".
 */
export function outlineCapabilities(
  editable: boolean,
  canEditMainText: boolean,
): { structure: boolean; focus: boolean } {
  return { structure: editable && canEditMainText, focus: editable };
}

export interface OutlineHostProps {
  content: JSONContent | null;
  /** Scopes the persisted fold set to this document (task 111). */
  docId: string;
  // Task 285: the Outline's write/navigate boundary speaks durable block
  // addresses, never snapshot indices. `null` = the Document-start row.
  onScrollTo: (target: BlockAddress | null) => void;
  onReorderBlocks: (
    source: BlockSpanAddress,
    target: BlockSpanAddress,
    side: "above" | "below",
  ) => void;
  // T3 (W3a): rename/label address by durable block uuid, not integer index.
  onRenameHeading: (uuid: string, newText: string) => void;
  onRenameParTitle: (uuid: string, newTitle: string) => void;
  onUpdateLabel: (uuid: string, newLabel: string | null) => void;
  isLabelTaken: (candidate: string, excludeLabel: string | null) => boolean;
  activeSectionPath: SectionPathEntry[];
  activeParTitleIndex: number | null;
  /** UUID-anchored focus band; OutlinePanel resolves it to index boundaries
   *  against its own snapshot (task 307). */
  focusBand: FocusBand | null;
  onFocusActivate: () => void;
  onFocusDeactivate: () => void;
  onFocusToggleLock: () => void;
  onFocusMoveTo: (target: BlockAddress) => void;
  onFocusExpandTo: (target: BlockAddress) => void;
  onFocusSnapBoundary: (edge: "top" | "bottom", target: BlockAddress) => void;
}

export function OutlineHost(p: OutlineHostProps) {
  const chrome = useEditorChrome();
  const { canEditMainText } = useCollabContext();
  const can = outlineCapabilities(mainTextEditable(chrome), canEditMainText);
  return (
    <OutlinePanel
      content={p.content}
      docId={p.docId}
      onScrollTo={p.onScrollTo}
      onReorderBlocks={can.structure ? p.onReorderBlocks : undefined}
      onRenameHeading={can.structure ? p.onRenameHeading : undefined}
      onRenameParTitle={can.structure ? p.onRenameParTitle : undefined}
      onUpdateLabel={can.structure ? p.onUpdateLabel : undefined}
      isLabelTaken={p.isLabelTaken}
      activeSectionPath={p.activeSectionPath}
      activeParTitleIndex={p.activeParTitleIndex}
      // A focus band only exists once Focus is activated, so withholding the
      // band too keeps a non-focus host from drawing one it cannot edit.
      focusBand={can.focus ? p.focusBand : null}
      onFocusActivate={can.focus ? p.onFocusActivate : undefined}
      onFocusDeactivate={can.focus ? p.onFocusDeactivate : undefined}
      onFocusToggleLock={can.focus ? p.onFocusToggleLock : undefined}
      onFocusMoveTo={can.focus ? p.onFocusMoveTo : undefined}
      onFocusExpandTo={can.focus ? p.onFocusExpandTo : undefined}
      onFocusSnapBoundary={can.focus ? p.onFocusSnapBoundary : undefined}
    />
  );
}
