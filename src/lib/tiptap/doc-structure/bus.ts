/**
 * DocStructureObserver — typed event bus
 *
 * One instance per editor. Attached to the editor instance as
 * `editor._docStructureBus` (well, via a typed accessor) at editor-create
 * time, so React hooks don't have to thread the bus through props/context.
 *
 * Subscriber model: explicit handler lists per event kind. Each
 * `on*(fn)` returns an unsubscribe function. The bus is event-driven
 * (no React rendering on its own); React consumers use the
 * `useDocStructure*` hooks in `./hook.ts`.
 *
 * The bus also exposes the current `DocStructure` snapshot and the
 * cumulative `emitCount` for verification per the keystroke-sanctity
 * success criteria.
 */

import type { Editor } from "@tiptap/react";
import {
  type AnchorEntry,
  type BlockEntry,
  type CitationEntry,
  type DocStructure,
  EMPTY_STRUCTURE,
  type ExampleEntry,
  type FigureEntry,
  type FootnoteEntry,
  type HeadingEntry,
  type LabelEntry,
  type StructureDiff,
} from "./types";

export type Unsub = () => void;

// Typed handler signatures.
export type DiffHandler = (diff: StructureDiff, structure: DocStructure) => void;
export type BlockHandler = (blocks: readonly BlockEntry[], structure: DocStructure) => void;
export type HeadingHandler = (headings: readonly HeadingEntry[], structure: DocStructure) => void;
export type FootnoteHandler = (footnotes: readonly FootnoteEntry[], structure: DocStructure) => void;
export type CitationHandler = (citations: readonly CitationEntry[], structure: DocStructure) => void;
export type AnchorHandler = (anchors: readonly AnchorEntry[], structure: DocStructure) => void;
export type ExampleHandler = (examples: readonly ExampleEntry[], structure: DocStructure) => void;
export type FigureHandler = (figures: readonly FigureEntry[], structure: DocStructure) => void;
export type LabelHandler = (labels: readonly LabelEntry[], structure: DocStructure) => void;
export type ContentChangeHandler = (uuids: ReadonlySet<string>, structure: DocStructure) => void;

export interface DocStructureBus {
  /** Current snapshot. Updated synchronously before `emit` fires handlers. */
  readonly structure: DocStructure;
  /** Cumulative count of emits since plugin init — for verification only. */
  readonly emitCount: number;

  // ---------------------------------------------------------------------------
  // Generic any-change.
  // ---------------------------------------------------------------------------
  onAnyChange(fn: DiffHandler): Unsub;

  // ---------------------------------------------------------------------------
  // Per-kind add/remove subscriptions.
  // ---------------------------------------------------------------------------
  onBlocksAdded(fn: BlockHandler): Unsub;
  onBlocksRemoved(fn: BlockHandler): Unsub;

  onHeadingsAdded(fn: HeadingHandler): Unsub;
  onHeadingsRemoved(fn: HeadingHandler): Unsub;
  /** Same UUID, structural attrs (level/label/numbered) changed. */
  onHeadingsChanged(fn: HeadingHandler): Unsub;
  /** Fires whenever the heading set OR order OR structural attrs changed. */
  onHeadingsRecomputable(fn: DiffHandler): Unsub;

  onFootnotesAdded(fn: FootnoteHandler): Unsub;
  onFootnotesRemoved(fn: FootnoteHandler): Unsub;
  /** Fires when the document order of footnote IDs may have changed. */
  onFootnoteOrderChanged(fn: DiffHandler): Unsub;

  onCitationsAdded(fn: CitationHandler): Unsub;
  onCitationsRemoved(fn: CitationHandler): Unsub;
  /** Same citationId, command/displayText changed. */
  onCitationsChanged(fn: CitationHandler): Unsub;
  /** Fires when the document order of citation IDs may have changed. */
  onCitationOrderChanged(fn: DiffHandler): Unsub;

  onAnchorsAdded(fn: AnchorHandler): Unsub;
  onAnchorsRemoved(fn: AnchorHandler): Unsub;

  onExamplesAdded(fn: ExampleHandler): Unsub;
  onExamplesRemoved(fn: ExampleHandler): Unsub;
  onExamplesRecomputable(fn: DiffHandler): Unsub;

  onFiguresAdded(fn: FigureHandler): Unsub;
  onFiguresRemoved(fn: FigureHandler): Unsub;
  onFiguresChanged(fn: FigureHandler): Unsub;
  onFiguresRecomputable(fn: DiffHandler): Unsub;

  onLabelsAdded(fn: LabelHandler): Unsub;
  onLabelsRemoved(fn: LabelHandler): Unsub;
  onLabelsRecomputable(fn: DiffHandler): Unsub;

  /** Fires whenever any tracked block's interior content changed. */
  onContentChanged(fn: ContentChangeHandler): Unsub;
  /** Fires only when the given UUID's content changed. Used by float-mirror. */
  onBlockContentChanged(uuid: string, fn: () => void): Unsub;
  /** Fires only when the given exampleBlock uuid's interior content changed
   *  (text in an item / gloss / nested atom). Keyed by the enclosing
   *  exampleBlock, so the Examples-panel card can re-seed on a content-only
   *  MAIN edit without owning a per-transaction subscriber. Content-only —
   *  never counted against `emitCount`. */
  onExampleContentChanged(uuid: string, fn: () => void): Unsub;
}

// ---------------------------------------------------------------------------
// Implementation.
// ---------------------------------------------------------------------------

interface MutableBus extends DocStructureBus {
  _emit(diff: StructureDiff, structure: DocStructure): void;
  _setStructure(structure: DocStructure): void;
}

function makeList<T>(): { add(fn: T): Unsub; emit(call: (fn: T) => void): void } {
  const set = new Set<T>();
  return {
    add(fn) {
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    emit(call) {
      for (const fn of set) {
        try {
          call(fn);
        } catch (err) {
          // Don't let one bad subscriber kill the rest.
          // eslint-disable-next-line no-console
          console.error("[DocStructureBus] subscriber threw:", err);
        }
      }
    },
  };
}

export function createDocStructureBus(): DocStructureBus {
  let structure: DocStructure = EMPTY_STRUCTURE;
  let emitCount = 0;

  const anyChange = makeList<DiffHandler>();

  const blocksAdded = makeList<BlockHandler>();
  const blocksRemoved = makeList<BlockHandler>();

  const headingsAdded = makeList<HeadingHandler>();
  const headingsRemoved = makeList<HeadingHandler>();
  const headingsChanged = makeList<HeadingHandler>();
  const headingsRecomputable = makeList<DiffHandler>();

  const footnotesAdded = makeList<FootnoteHandler>();
  const footnotesRemoved = makeList<FootnoteHandler>();
  const footnoteOrderChanged = makeList<DiffHandler>();

  const citationsAdded = makeList<CitationHandler>();
  const citationsRemoved = makeList<CitationHandler>();
  const citationsChanged = makeList<CitationHandler>();
  const citationOrderChanged = makeList<DiffHandler>();

  const anchorsAdded = makeList<AnchorHandler>();
  const anchorsRemoved = makeList<AnchorHandler>();

  const examplesAdded = makeList<ExampleHandler>();
  const examplesRemoved = makeList<ExampleHandler>();
  const examplesRecomputable = makeList<DiffHandler>();

  const figuresAdded = makeList<FigureHandler>();
  const figuresRemoved = makeList<FigureHandler>();
  const figuresChanged = makeList<FigureHandler>();
  const figuresRecomputable = makeList<DiffHandler>();

  const labelsAdded = makeList<LabelHandler>();
  const labelsRemoved = makeList<LabelHandler>();
  const labelsRecomputable = makeList<DiffHandler>();

  const contentChanged = makeList<ContentChangeHandler>();
  const perBlockContent = new Map<string, Set<() => void>>();
  const perExampleContent = new Map<string, Set<() => void>>();

  const bus: MutableBus = {
    get structure() {
      return structure;
    },
    get emitCount() {
      return emitCount;
    },
    _setStructure(s) {
      structure = s;
    },
    _emit(diff, s) {
      structure = s;

      // `emitCount` and `onAnyChange` count only **structural** emits —
      // changes that affect any sub-view other than `contentChangedUuids`.
      // Content-only diffs (the typing-in-a-paragraph case) still fan
      // out to per-block content subscribers (the only consumers that
      // care), but don't wake up the structural watchers and don't
      // count against the keystroke-sanctity success criterion.
      const hasStructuralChange =
        diff.addedBlocks.length > 0 ||
        diff.removedBlocks.length > 0 ||
        diff.addedHeadings.length > 0 ||
        diff.removedHeadings.length > 0 ||
        diff.changedHeadings.length > 0 ||
        diff.addedFootnotes.length > 0 ||
        diff.removedFootnotes.length > 0 ||
        diff.footnoteOrderChanged ||
        diff.addedCitations.length > 0 ||
        diff.removedCitations.length > 0 ||
        diff.changedCitations.length > 0 ||
        diff.citationOrderChanged ||
        diff.addedAnchors.length > 0 ||
        diff.removedAnchors.length > 0 ||
        diff.addedExamples.length > 0 ||
        diff.removedExamples.length > 0 ||
        diff.exampleStructureChanged ||
        diff.addedFigures.length > 0 ||
        diff.removedFigures.length > 0 ||
        diff.changedFigures.length > 0 ||
        diff.addedLabels.length > 0 ||
        diff.removedLabels.length > 0;

      if (hasStructuralChange) {
        emitCount++;
        anyChange.emit((fn) => fn(diff, s));
      }

      if (diff.addedBlocks.length > 0) blocksAdded.emit((fn) => fn(diff.addedBlocks, s));
      if (diff.removedBlocks.length > 0) blocksRemoved.emit((fn) => fn(diff.removedBlocks, s));

      if (diff.addedHeadings.length > 0) headingsAdded.emit((fn) => fn(diff.addedHeadings, s));
      if (diff.removedHeadings.length > 0) headingsRemoved.emit((fn) => fn(diff.removedHeadings, s));
      if (diff.changedHeadings.length > 0) headingsChanged.emit((fn) => fn(diff.changedHeadings, s));
      if (
        diff.addedHeadings.length > 0 ||
        diff.removedHeadings.length > 0 ||
        diff.changedHeadings.length > 0
      ) {
        headingsRecomputable.emit((fn) => fn(diff, s));
      }

      if (diff.addedFootnotes.length > 0) footnotesAdded.emit((fn) => fn(diff.addedFootnotes, s));
      if (diff.removedFootnotes.length > 0) footnotesRemoved.emit((fn) => fn(diff.removedFootnotes, s));
      if (diff.footnoteOrderChanged) footnoteOrderChanged.emit((fn) => fn(diff, s));

      if (diff.addedCitations.length > 0) citationsAdded.emit((fn) => fn(diff.addedCitations, s));
      if (diff.removedCitations.length > 0) citationsRemoved.emit((fn) => fn(diff.removedCitations, s));
      if (diff.changedCitations.length > 0) citationsChanged.emit((fn) => fn(diff.changedCitations, s));
      if (diff.citationOrderChanged) citationOrderChanged.emit((fn) => fn(diff, s));

      if (diff.addedAnchors.length > 0) anchorsAdded.emit((fn) => fn(diff.addedAnchors, s));
      if (diff.removedAnchors.length > 0) anchorsRemoved.emit((fn) => fn(diff.removedAnchors, s));

      if (diff.addedExamples.length > 0) examplesAdded.emit((fn) => fn(diff.addedExamples, s));
      if (diff.removedExamples.length > 0) examplesRemoved.emit((fn) => fn(diff.removedExamples, s));
      if (diff.exampleStructureChanged) examplesRecomputable.emit((fn) => fn(diff, s));

      if (diff.addedFigures.length > 0) figuresAdded.emit((fn) => fn(diff.addedFigures, s));
      if (diff.removedFigures.length > 0) figuresRemoved.emit((fn) => fn(diff.removedFigures, s));
      if (diff.changedFigures.length > 0) figuresChanged.emit((fn) => fn(diff.changedFigures, s));
      if (
        diff.addedFigures.length > 0 ||
        diff.removedFigures.length > 0 ||
        diff.changedFigures.length > 0
      ) {
        figuresRecomputable.emit((fn) => fn(diff, s));
      }

      if (diff.addedLabels.length > 0) labelsAdded.emit((fn) => fn(diff.addedLabels, s));
      if (diff.removedLabels.length > 0) labelsRemoved.emit((fn) => fn(diff.removedLabels, s));
      if (diff.addedLabels.length > 0 || diff.removedLabels.length > 0) {
        labelsRecomputable.emit((fn) => fn(diff, s));
      }

      if (diff.contentChangedUuids.size > 0) {
        contentChanged.emit((fn) => fn(diff.contentChangedUuids, s));
        for (const uuid of diff.contentChangedUuids) {
          const handlers = perBlockContent.get(uuid);
          if (handlers) {
            for (const fn of handlers) {
              try {
                fn();
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[DocStructureBus] per-block subscriber threw:", err);
              }
            }
          }
        }
      }

      // Per-exampleBlock content fan-out. Content-only (does NOT bump
      // `emitCount` or wake the structural watchers) — only the example
      // cards that subscribed to THIS uuid are notified, so a content edit
      // to example A re-seeds card A and never touches card B.
      if (diff.exampleContentChangedUuids.size > 0) {
        for (const uuid of diff.exampleContentChangedUuids) {
          const handlers = perExampleContent.get(uuid);
          if (handlers) {
            for (const fn of handlers) {
              try {
                fn();
              } catch (err) {
                // eslint-disable-next-line no-console
                console.error("[DocStructureBus] per-example subscriber threw:", err);
              }
            }
          }
        }
      }
    },

    onAnyChange: anyChange.add,
    onBlocksAdded: blocksAdded.add,
    onBlocksRemoved: blocksRemoved.add,
    onHeadingsAdded: headingsAdded.add,
    onHeadingsRemoved: headingsRemoved.add,
    onHeadingsChanged: headingsChanged.add,
    onHeadingsRecomputable: headingsRecomputable.add,
    onFootnotesAdded: footnotesAdded.add,
    onFootnotesRemoved: footnotesRemoved.add,
    onFootnoteOrderChanged: footnoteOrderChanged.add,
    onCitationsAdded: citationsAdded.add,
    onCitationsRemoved: citationsRemoved.add,
    onCitationsChanged: citationsChanged.add,
    onCitationOrderChanged: citationOrderChanged.add,
    onAnchorsAdded: anchorsAdded.add,
    onAnchorsRemoved: anchorsRemoved.add,
    onExamplesAdded: examplesAdded.add,
    onExamplesRemoved: examplesRemoved.add,
    onExamplesRecomputable: examplesRecomputable.add,
    onFiguresAdded: figuresAdded.add,
    onFiguresRemoved: figuresRemoved.add,
    onFiguresChanged: figuresChanged.add,
    onFiguresRecomputable: figuresRecomputable.add,
    onLabelsAdded: labelsAdded.add,
    onLabelsRemoved: labelsRemoved.add,
    onLabelsRecomputable: labelsRecomputable.add,
    onContentChanged: contentChanged.add,
    onBlockContentChanged(uuid, fn) {
      let handlers = perBlockContent.get(uuid);
      if (!handlers) {
        handlers = new Set();
        perBlockContent.set(uuid, handlers);
      }
      handlers.add(fn);
      return () => {
        const set = perBlockContent.get(uuid);
        if (!set) return;
        set.delete(fn);
        if (set.size === 0) perBlockContent.delete(uuid);
      };
    },
    onExampleContentChanged(uuid, fn) {
      let handlers = perExampleContent.get(uuid);
      if (!handlers) {
        handlers = new Set();
        perExampleContent.set(uuid, handlers);
      }
      handlers.add(fn);
      return () => {
        const set = perExampleContent.get(uuid);
        if (!set) return;
        set.delete(fn);
        if (set.size === 0) perExampleContent.delete(uuid);
      };
    },
  };

  return bus;
}

// ---------------------------------------------------------------------------
// Editor-instance association — survives hot reloads since the bus is
// tied to the editor instance, not a module-level singleton.
// ---------------------------------------------------------------------------

const BUS_KEY = Symbol.for("virgil.docStructureBus");

interface EditorWithBus {
  [BUS_KEY]?: DocStructureBus & MutableBus;
}

export function attachBus(editor: Editor): DocStructureBus & MutableBus {
  const ed = editor as unknown as EditorWithBus;
  if (ed[BUS_KEY]) return ed[BUS_KEY];
  const bus = createDocStructureBus() as DocStructureBus & MutableBus;
  ed[BUS_KEY] = bus;
  return bus;
}

export function getBus(editor: Editor | null | undefined): DocStructureBus | null {
  if (!editor) return null;
  const ed = editor as unknown as EditorWithBus;
  return ed[BUS_KEY] ?? null;
}

export function detachBus(editor: Editor): void {
  const ed = editor as unknown as EditorWithBus;
  delete ed[BUS_KEY];
}

// Cast helper for tests / advanced callers — exposes `_emit` and `_setStructure`.
export function asMutable(bus: DocStructureBus): MutableBus {
  return bus as MutableBus;
}
