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
 * From a React component:
 *
 *     const structure = useDocStructure(editor);
 *     useDocStructureEvent(editor, "onHeadingsRecomputable", (diff, structure) => {
 *       // …
 *     });
 *
 * From a ProseMirror plugin's `appendTransaction`:
 *
 *     appendTransaction(transactions, oldState, newState) {
 *       const diff = readPendingDiff(newState);
 *       if (!diff) return null;
 *       // … react to diff …
 *     }
 */

export {
  DocStructureObserver,
  docStructureKey,
  readDocStructure,
  readPendingDiff,
  resolveTouchedBlock,
  peekStructureVersion,
  getMaterializeCount,
} from "./observer-plugin";

export {
  attachBus,
  getBus,
  detachBus,
  createDocStructureBus,
  type DocStructureBus,
  type Unsub,
} from "./bus";

export {
  useDocStructure,
  useDocStructureBus,
  useDocStructureEvent,
  useBlockContentChanged,
  useExampleContentRevision,
} from "./hook";

export {
  buildInitial,
  applyDiff,
  EMPTY_STRUCTURE,
} from "./structure-index";

export { inspectSteps } from "./step-inspector";

export { touchedBlockPositions } from "./diff-blocks";

export {
  EMPTY_DIFF,
  isEmptyDiff,
  diffHasStructuralEntries,
  type AnchorEntry,
  type BlockEntry,
  type CitationEntry,
  type DocStructure,
  type ExampleEntry,
  type FigureEntry,
  type FootnoteEntry,
  type HeadingEntry,
  type LabelEntry,
  type StructureDiff,
} from "./types";
