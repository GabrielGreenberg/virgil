/**
 * DocStructureObserver — public surface
 *
 * One plugin reads every transaction, does cheap step inspection, and
 * publishes typed structural events on an editor-attached bus. Every
 * other reactor in the codebase should subscribe to typed events
 * instead of walking the doc themselves.
 *
 * Architecture brief: `docs/perf/keystroke-sanctity-findings.md`.
 *
 * Usage from a TipTap extension list (must be first after StarterKit):
 *
 *     import { DocStructureObserver } from "@/lib/tiptap/doc-structure";
 *     useEditor({
 *       extensions: [
 *         StarterKit.configure({...}),
 *         DocStructureObserver,
 *         // …everything else…
 *       ],
 *     });
 *
 * From a React component: per-category counters via
 * `useStructuralRevisions(editor)` (`@/hooks/useStructuralRevisions`) for
 * memo deps, or `useDocStructureBus(editor)` / `getBus(editor)` in an effect
 * for a typed subscription:
 *
 *     useEffect(() => getBus(editor)?.onHeadingsRecomputable(fn), [editor]);
 *
 * From a ProseMirror plugin's `appendTransaction`:
 *
 *     appendTransaction(transactions, oldState, newState) {
 *       const diff = readPendingDiff(newState);
 *       if (!diff) return null;
 *       // … react to diff …
 *     }
 */

// The PUBLIC surface: every name below has a production caller outside this
// module (task 924 — "a re-export is not a caller"). Test-only and
// module-internal names (`docStructureKey`, `docStructureStateSpec`,
// `applyDiff`, `EMPTY_STRUCTURE`, `inspectSteps`, `EMPTY_DIFF`, `isEmptyDiff`,
// `createDocStructureBus`, …) are imported from their defining files.
export {
  DocStructureObserver,
  readDocStructure,
  readPendingDiff,
  resolveTouchedBlock,
  resolveTouchedAnchor,
  hasLiveBlock,
  hasLiveAnchor,
  peekStructureVersion,
  getMaterializeCount,
} from "./observer-plugin";

// `attachBus` / `detachBus` stay module-internal: the observer plugin owns its
// bus's lifetime, and a public door would let outside code attach or detach a
// bus behind it (task 924).
export { getBus, type DocStructureBus } from "./bus";

export { useDocStructureBus, useExampleContentRevision } from "./hook";

export { buildInitial } from "./structure-index";

export { touchedBlockPositions } from "./diff-blocks";

export {
  diffHasStructuralEntries,
  diffTouchesNumberingInputs,
  diffExamplesRecomputable,
  type AnchorEntry,
  type BlockEntry,
  type CitationEntry,
  type DocStructure,
  type ExampleEntry,
  type FigureEntry,
  type FootnoteEntry,
  type HeadingEntry,
  type StructureDiff,
} from "./types";
