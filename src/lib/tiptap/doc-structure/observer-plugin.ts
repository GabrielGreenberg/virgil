/**
 * DocStructureObserver — TipTap extension + PM plugin
 *
 * One plugin reads every transaction synchronously. Its `apply` is
 * O(1) on selection-only edits, O(edit-size) otherwise. Whenever a
 * non-empty diff is produced, the plugin stores it on plugin state;
 * the `view.update` hook then dispatches the diff onto the editor's
 * `DocStructureBus`.
 *
 * Must be loaded **first** among extensions (after StarterKit) so that
 * downstream `appendTransaction` plugins can read the diff via
 * `tr.getMeta(docStructureKey)` if needed.
 */

import type { EditorView } from "@tiptap/pm/view";
import { Extension } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Mapping, type StepMap } from "@tiptap/pm/transform";
import { asMutable, attachBus, detachBus, type DocStructureBus } from "./bus";
import { inspectSteps } from "./step-inspector";
import { applyDiff, buildInitial } from "./structure-index";
import {
  EMPTY_DIFF,
  EMPTY_STRUCTURE,
  diffHasStructuralEntries,
  type BlockEntry,
  type DocStructure,
  type StructureDiff,
} from "./types";

/**
 * Materialize when this many StepMaps have accumulated, even if nobody has
 * read positions. Keeps `resolveTouchedBlock`'s per-uuid walk and the
 * eventual materialization bounded; typical typing bursts materialize far
 * earlier (the first consumer read — a RAF measure — resets to 0).
 */
const MAX_PENDING_MAPS = 32;

/** Dev/verification counter — surfaced via `window.__virgilBusStats()`.
 *  Typing N plain characters must leave it flat (no consumer read → no
 *  materialization); it bumps once per consumer read after edits. */
let materializeCount = 0;

interface PluginState {
  /** Base snapshot. Positions are valid AS OF the last materialization —
   *  `pendingMaps` holds the StepMaps accumulated since. The object itself
   *  is immutable; identity changes on every docChanged tx (consumer
   *  caches key off it). */
  structure: DocStructure;
  /** StepMaps accumulated since `structure` was last materialized. The
   *  keystroke-path invariant (AGENTS.md "Keystroke sanctity"): a
   *  structurally-null tx APPENDS here — O(steps), zero entity iteration,
   *  zero Map clones — and the O(entities) remap runs lazily at
   *  consumer-read time (`readDocStructure`), which is RAF/user-paced,
   *  never keystroke-paced. Mutated in place by the materialize-on-read
   *  cache (same precedent as the `pendingDiff` clear in the view hook);
   *  safe because every `apply` builds a NEW array, so materializing an
   *  old state can't corrupt a newer one. */
  pendingMaps: readonly StepMap[];
  /** Diff produced by the most recently applied transaction. Null when
   *  the most recent apply was a no-op (selection-only). The shared
   *  `EMPTY_DIFF` reference when the tx changed the doc but was
   *  structurally AND content null (attr-only steps, e.g. a uuid mint or
   *  footnote renumber) — readable by same-tx `apply` consumers via
   *  `readPendingDiff` so they can take their cheap incremental path
   *  instead of the observer-absent full-rebuild fallback; the view
   *  hook skips the bus emit for it. */
  pendingDiff: StructureDiff | null;
}

export const docStructureKey = new PluginKey<PluginState>("docStructureObserver");

/**
 * View-side hook factory. We close over `editor` so the `view.update`
 * callback can dispatch to the editor-attached bus.
 */
function makeViewSpec(editor: Editor) {
  return (view: EditorView) => {
    const bus = attachBus(editor);
    // The bus's `structure` getter delegates here: consumers always see a
    // fully-materialized snapshot, materialized AT READ TIME (RAF/user
    // cadence), never on the keystroke path.
    asMutable(bus)._setSnapshotProvider(() => readDocStructure(view.state));
    return {
      update(view: EditorView) {
        const state = docStructureKey.getState(view.state);
        if (!state || !state.pendingDiff) return;
        const diff = state.pendingDiff;
        // Clear the pending flag synchronously so a re-render doesn't
        // re-fire. Mutating plugin state outside an apply() is normally
        // a no-no, but here we're only nulling a transient field; the
        // next apply() will write a fresh PluginState anyway.
        state.pendingDiff = null;
        // EMPTY_DIFF is stored only so same-tx `apply` readers can see
        // "observer present, nothing changed" — nothing to fan out.
        if (diff === EMPTY_DIFF) return;
        if (diffHasStructuralEntries(diff)) {
          // Structural tx: apply() already materialized (applyDiff needs
          // coherent positions) — state.structure is concrete, pass it.
          asMutable(bus)._emit(diff, state.structure);
        } else {
          // Content-only tx (every plain keystroke): pass a THUNK. The
          // fan-out only reaches per-block subscribers (argless) — the
          // snapshot resolves only if an onContentChanged subscriber
          // actually exists, so plain typing materializes nothing.
          asMutable(bus)._emit(diff, () => readDocStructure(view.state));
        }
      },
      destroy() {
        asMutable(bus)._setSnapshotProvider(null);
        detachBus(editor);
      },
    };
  };
}

/** Map every position in the previous structure forward through `mapping`. */
function mapStructurePositions(
  prev: DocStructure,
  mapping: { map(pos: number, assoc?: number): number },
): DocStructure {
  // Cheap: positions are single integers, mapping is O(steps).
  const blocks = new Map(prev.blocks);
  for (const [uuid, entry] of blocks) {
    const mapped = mapping.map(entry.pos);
    if (mapped !== entry.pos) blocks.set(uuid, { ...entry, pos: mapped });
  }
  const headings = prev.headings.map((h) => {
    const mapped = mapping.map(h.pos);
    return mapped === h.pos ? h : { ...h, pos: mapped };
  });
  const footnotes = prev.footnotes.map((f) => {
    const mapped = mapping.map(f.pos);
    return mapped === f.pos ? f : { ...f, pos: mapped };
  });
  const citations = prev.citations.map((c) => {
    const mapped = mapping.map(c.pos);
    return mapped === c.pos ? c : { ...c, pos: mapped };
  });
  const anchors = new Map(prev.anchors);
  for (const [id, entry] of anchors) {
    const newFrom = mapping.map(entry.from);
    const newTo = mapping.map(entry.to);
    if (newFrom !== entry.from || newTo !== entry.to) {
      anchors.set(id, { ...entry, from: newFrom, to: newTo });
    }
  }
  const examples = prev.examples.map((e) => {
    const mapped = mapping.map(e.pos);
    return mapped === e.pos ? e : { ...e, pos: mapped };
  });
  const figures = prev.figures.map((f) => {
    const mapped = mapping.map(f.pos);
    return mapped === f.pos ? f : { ...f, pos: mapped };
  });
  const labels = new Map(prev.labels);
  for (const [id, entry] of labels) {
    const mapped = mapping.map(entry.pos);
    if (mapped !== entry.pos) labels.set(id, { ...entry, pos: mapped });
  }
  return {
    version: prev.version,
    blocks,
    headings,
    footnotes,
    citations,
    anchors,
    examples,
    figures,
    labels,
  };
}

/**
 * The TipTap extension. The `editor` instance isn't available at
 * extension-creation time, so we close over it via `Extension.create`'s
 * `addProseMirrorPlugins(this)` body — `this.editor` is set by the time
 * TipTap calls this method.
 *
 * `priority` is LOAD-BEARING: TipTap collects PM plugins in REVERSE extension
 * order (`sortExtensions([...extensions].reverse())`), so without it the
 * observer's plugin `apply` would run nearly LAST per transaction — and every
 * plugin whose own `apply` calls `readPendingDiff(newState)` (uuid-attr,
 * section-folding) would read `null` and silently take its full-doc-walk
 * fallback ON EVERY KEYSTROKE. The high priority puts this plugin FIRST in
 * the plugin array so the diff is computed before any consumer's `apply`
 * reads it. The extension-ARRAY position (index 1, pinned by the Chip-A
 * order test) is unchanged — plugin order is carried by this field, and
 * pinned by `__tests__/pending-diff-in-apply.test.ts`.
 */
export const DocStructureObserver = Extension.create({
  name: "docStructureObserver",
  priority: 10_000,

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<PluginState>({
        key: docStructureKey,
        state: {
          init(_config, state) {
            return {
              structure: buildInitial(state.doc),
              pendingMaps: [],
              pendingDiff: null,
            };
          },
          apply(tr, prev, _oldState, _newState) {
            if (!tr.docChanged) {
              // Selection-only / mark-only-no-doc / meta-only — same state.
              if (prev.pendingDiff !== null) {
                return {
                  structure: prev.structure,
                  pendingMaps: prev.pendingMaps,
                  pendingDiff: null,
                };
              }
              return prev;
            }
            const oldDoc = tr.before;
            const newDoc = tr.doc;
            // `inspectSteps` consults prev.structure for uuid MEMBERSHIP
            // only (mapping-invariant), so the un-materialized base is
            // correct to pass even with pendingMaps outstanding.
            const diff = inspectSteps(tr, oldDoc, newDoc, prev.structure);
            if (diff === EMPTY_DIFF || !diffHasStructuralEntries(diff)) {
              // Structurally-null tx (plain typing, attr-only steps):
              // the O(entities) remap is DEFERRED — just accumulate the
              // tx's StepMaps (O(steps), zero iteration, zero clones)
              // and bump snapshot identity so identity-keyed consumer
              // caches (useLivePosResolver) can't serve stale positions.
              // Version semantics preserved: content-only diffs bump
              // (applyDiff did), EMPTY_DIFF doesn't (mapStructurePositions
              // didn't). Materialization happens at consumer-read time
              // (readDocStructure) or at the MAX_PENDING_MAPS cap.
              let maps: readonly StepMap[] = [
                ...prev.pendingMaps,
                ...tr.mapping.maps,
              ];
              let base = prev.structure;
              if (maps.length > MAX_PENDING_MAPS) {
                base = materializeStructure(base, maps);
                maps = [];
              }
              const structure =
                diff === EMPTY_DIFF
                  ? { ...base }
                  : { ...base, version: base.version + 1 };
              return {
                structure,
                pendingMaps: maps,
                pendingDiff: diff === EMPTY_DIFF ? EMPTY_DIFF : diff,
              };
            }
            // Structural tx: materialize (fold any accumulated maps plus
            // this tx's), then apply the diff — its entries are already
            // in newDoc coordinates.
            const mapped = materializeStructure(prev.structure, [
              ...prev.pendingMaps,
              ...tr.mapping.maps,
            ]);
            const next = applyDiff(mapped, diff);
            return { structure: next, pendingMaps: [], pendingDiff: diff };
          },
        },
        view: makeViewSpec(editor),
        props: {
          // Expose the diff via tr.meta for any appendTransaction
          // consumers that need it synchronously (e.g. label-handler).
          // We piggyback on plugin state since meta is per-transaction;
          // consumers use `docStructureKey.getState(state).pendingDiff`.
        },
      }),
    ];
  },
});

/**
 * Fold accumulated StepMaps into a base snapshot. O(entities) — runs at
 * consumer-read time or on a structural tx, never per plain keystroke.
 */
function materializeStructure(
  base: DocStructure,
  maps: readonly StepMap[],
): DocStructure {
  if (maps.length === 0) return base;
  materializeCount++;
  return mapStructurePositions(base, new Mapping([...maps]));
}

/**
 * Read the latest structure snapshot from an editor state, materializing
 * any deferred position maps on first read (then cached in place — the
 * same transient-field mutation precedent as the view hook's pendingDiff
 * clear; safe because each apply() builds a fresh pendingMaps array, so
 * materializing an old state can't corrupt a newer one).
 */
export function readDocStructure(state: {
  plugins: ReadonlyArray<unknown>;
  $? : never;
  // Loose typing — accepts EditorState from `@tiptap/pm/state`.
} & Parameters<typeof docStructureKey.getState>[0]): DocStructure {
  const s = docStructureKey.getState(state);
  if (!s) return EMPTY_STRUCTURE;
  // `?.` tolerates hand-built test stand-ins that predate pendingMaps.
  if (s.pendingMaps?.length) {
    s.structure = materializeStructure(s.structure, s.pendingMaps);
    s.pendingMaps = [];
  }
  return s.structure;
}

/**
 * Resolve ONE block's live entry without materializing the whole snapshot —
 * the accessor for per-keystroke `appendTransaction` guards that need the
 * touched block's position (title/label/latex-comment/expex). O(pendingMaps)
 * per uuid (≤ MAX_PENDING_MAPS StepMap walks), zero allocation on the
 * no-shift path.
 */
export function resolveTouchedBlock(
  state: Parameters<typeof docStructureKey.getState>[0],
  uuid: string,
): BlockEntry | null {
  const s = docStructureKey.getState(state);
  if (!s) return null;
  const entry = s.structure.blocks.get(uuid);
  if (!entry) return null;
  if (!s.pendingMaps?.length) return entry;
  let pos = entry.pos;
  for (const m of s.pendingMaps) pos = m.map(pos);
  return pos === entry.pos ? entry : { ...entry, pos };
}

/**
 * Snapshot version WITHOUT materializing — for the dev stats probe, so a
 * console read doesn't itself count as a consumer materialization.
 */
export function peekStructureVersion(
  state: Parameters<typeof docStructureKey.getState>[0],
): number {
  return docStructureKey.getState(state)?.structure.version ?? 0;
}

/** Dev/verification: cumulative lazy materializations since load. */
export function getMaterializeCount(): number {
  return materializeCount;
}

/** @internal test-only. */
export function __resetMaterializeCountForTest(): void {
  materializeCount = 0;
}

/**
 * Read the diff produced by the most recent transaction. Only valid
 * within `appendTransaction` — `view.update` clears it post-dispatch.
 */
export function readPendingDiff(state: Parameters<typeof docStructureKey.getState>[0]): StructureDiff | null {
  const s = docStructureKey.getState(state);
  return s?.pendingDiff ?? null;
}

// Re-export the bus type so consumers can do `import { DocStructureBus } from "@/lib/tiptap/doc-structure"`.
export type { DocStructureBus };
