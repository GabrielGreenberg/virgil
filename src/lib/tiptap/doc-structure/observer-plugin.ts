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
import { Plugin, PluginKey, type StateField, type Transaction } from "@tiptap/pm/state";
import { Mapping, type StepMap } from "@tiptap/pm/transform";
import { asMutable, attachBus, detachBus, type DocStructureBus } from "./bus";
import { inspectSteps } from "./step-inspector";
import { applyDiff, buildInitial } from "./structure-index";
import {
  EMPTY_DIFF,
  EMPTY_STRUCTURE,
  diffHasStructuralEntries,
  mapStructureDiffPositions,
  mergeStructureDiffs,
  type AnchorEntry,
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

export interface PluginState {
  /** Base snapshot. Positions are valid AS OF the last materialization —
   *  `pendingMaps` holds the StepMaps accumulated since. The object itself
   *  is immutable; identity changes on every docChanged tx (consumer
   *  caches key off it). */
  structure: DocStructure;
  /** StepMaps accumulated since `structure` was last materialized. The
   *  keystroke-path invariant (docs/agents/laws/keystroke-sanctity.md "Keystroke sanctity"): a
   *  structurally-null tx APPENDS here — O(steps), zero entity iteration,
   *  zero Map clones — and the O(entities) remap runs lazily at
   *  consumer-read time (`readDocStructure`), which is RAF/user-paced,
   *  never keystroke-paced. Mutated in place by the materialize-on-read
   *  cache (same precedent as the transient-diff clear in the view hook);
   *  safe because every `apply` builds a NEW array, so materializing an
   *  old state can't corrupt a newer one. */
  pendingMaps: readonly StepMap[];
  /** ONE dispatch, TWO questions — and they have different answers (task
   *  650). ProseMirror runs the whole `appendTransaction` loop inside a single
   *  `state.applyTransaction`, so `apply` runs once per TRANSACTION while the
   *  view hook below runs once per DISPATCH.
   *
   *  The CONSUMER question — "what did the transactions I was HANDED do?" — is
   *  not answered from plugin state at all: each transaction's own diff is
   *  recorded against the transaction itself (`txDiffs`) and
   *  {@link readDiffFor} folds exactly the ones a caller names (task 1072).
   *  A single per-state slot answered "the LAST transaction's diff", which is
   *  the wrong question for an appender: ProseMirror hands it EVERY
   *  transaction it has not yet seen, so when an earlier appender
   *  (BlockUuidBackfill) appended a uuid mint, every later appender read the
   *  mint's EMPTY_DIFF and never saw the user's deletion.
   *
   *  `dispatchDiff` answers the EMIT question below. */
  /** `dispatchDiff` answers the EMIT question: "what did this whole dispatch
   *  do to the document?" It is the fold of every transaction's diff
   *  (`mergeStructureDiffs`), drained once by the view hook. A single slot here
   *  was the bug: the last transaction's diff overwrote every earlier one, so a
   *  deletion that provoked the footnote renumber applied its diff to the index
   *  and then published nothing at all. Null when nothing in the dispatch
   *  carried entries. */
  dispatchDiff: StructureDiff | null;
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
        if (!state) return;
        const diff = state.dispatchDiff;
        // The dispatch is over: drain the transient field. Mutating plugin
        // state outside an apply() is normally a no-no, but here we're only
        // nulling a transient field; the next apply() will write a fresh
        // PluginState anyway.
        state.dispatchDiff = null;
        // Null when nothing in the dispatch carried entries — EMPTY_DIFF
        // never accumulates.
        if (!diff) return;
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
    structuralVersion: prev.structuralVersion,
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
 * The observer's plugin-state spec — the SSOT for how a transaction becomes a
 * structure index plus the two transient diffs.
 *
 * Exported because headless tests need a stand-in observer (a real `Editor` +
 * view is more than they can mount), and two of them had hand-copied this
 * `apply` body out of `buildInitial` / `inspectSteps` / `applyDiff`. A copy of
 * a state machine is a copy that drifts: each carried its own `pendingDiff`
 * field, so task 650's split of that slot would have left them silently
 * answering every consumer read with `null` — a fallback path, green and
 * vacuous. Mount THIS instead:
 *
 *     new Plugin<PluginState>({ key: docStructureKey, state: docStructureStateSpec() })
 */
export function docStructureStateSpec(): StateField<PluginState> {
  return {
    init(_config, state) {
      return {
        structure: buildInitial(state.doc),
        pendingMaps: [],
        dispatchDiff: null,
      };
    },
    apply(tr, prev, _oldState, _newState) {
      if (!tr.docChanged) {
        // Selection-only / mark-only-no-doc / meta-only. Such a
        // transaction PRODUCES no diff — it does not ERASE one. Nulling
        // here was the latent half of task 650: an appended meta-only
        // transaction would wipe the structural diff of the doc-changing
        // transaction it followed, so the dispatch published nothing and
        // same-dispatch consumer read `null` and took its observer-absent
        // full-doc-walk fallback. Carrying the
        // state through unchanged is also the cheapest possible answer:
        // zero allocation on the selection path.
        return prev;
      }
      const oldDoc = tr.before;
      const newDoc = tr.doc;
      // `inspectSteps` consults prev.structure for uuid MEMBERSHIP
      // (mapping-invariant), so the un-materialized base is correct to
      // pass even with pendingMaps outstanding. The anchor/label
      // reconcilers also read prior POSITIONS (task 1128) — handed the
      // deferred maps so they can carry them to `oldDoc` themselves,
      // O(maps) per touched entry, without materializing here.
      const diff = inspectSteps(tr, oldDoc, newDoc, prev.structure, prev.pendingMaps);
      txDiffs.set(tr, diff);
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
          dispatchDiff: accumulate(prev.dispatchDiff, diff, tr.mapping),
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
      return {
        structure: next,
        pendingMaps: [],
        dispatchDiff: accumulate(prev.dispatchDiff, diff, tr.mapping),
      };
    },
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
 * plugin whose own `apply` calls `readDiffFor([tr], newState)`
 * (section-folding) would read `null` and silently take its full-doc-walk
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
        state: docStructureStateSpec(),
        view: makeViewSpec(editor),
      }),
    ];
  },
});

/**
 * Fold one transaction's diff into the dispatch's accumulation.
 *
 * The single-transaction dispatch — every plain keystroke, every ordinary edit
 * with no appender behind it — returns the diff BY IDENTITY: no merge call, no
 * allocation, nothing added to the keystroke path. A merge happens only when a
 * dispatch genuinely carries a second doc-changing transaction, and costs
 * O(entries in the diffs), which is O(edit-size).
 *
 * `prev` is expressed in the document before `mapping` (the accumulation was
 * built by earlier transactions in this same dispatch), so it is carried
 * forward through this transaction's mapping before the two are composed.
 */
function accumulate(
  prev: StructureDiff | null,
  diff: StructureDiff,
  mapping: { map(pos: number, assoc?: number): number },
): StructureDiff | null {
  // EMPTY_DIFF carries no entries — it exists only as the same-tx "observer
  // present, nothing changed" signal, so it never joins the accumulation.
  if (diff === EMPTY_DIFF) return prev;
  if (prev === null) return diff;
  return mergeStructureDiffs(mapStructureDiffPositions(prev, mapping), diff);
}

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
 * same transient-field mutation precedent as the view hook's transient-diff
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
 * The anchor twin of {@link resolveTouchedBlock} (task 926): one `linkedAnchor`
 * entry's LIVE `[from, to)` without materializing the whole snapshot —
 * O(pendingMaps), zero allocation on the no-shift path. `undefined` when the
 * state carries no observer (a bare editor — the caller must walk), `null`
 * when the observer is present and no mark carries `anchorId` (membership is
 * invariant under the deferred maps, so absence is authoritative).
 */
export function resolveTouchedAnchor(
  state: Parameters<typeof docStructureKey.getState>[0],
  anchorId: string,
): AnchorEntry | null | undefined {
  const s = docStructureKey.getState(state);
  if (!s) return undefined;
  const entry = s.structure.anchors.get(anchorId);
  if (!entry) return null;
  if (!s.pendingMaps?.length) return entry;
  let from = entry.from;
  let to = entry.to;
  for (const m of s.pendingMaps) {
    from = m.map(from);
    to = m.map(to);
  }
  return from === entry.from && to === entry.to ? entry : { ...entry, from, to };
}

/**
 * THE block-liveness answer (task 878): does `uuid` name a live block identity
 * in `state`'s document? O(1), and it never materializes the snapshot —
 * membership is invariant under the deferred position maps, which only move
 * entries. The index holds exactly the uuids `mayCarryBlockUuid` admits, so a
 * stale id on a deferred inner paragraph is correctly NOT live.
 */
export function hasLiveBlock(
  state: Parameters<typeof docStructureKey.getState>[0],
  uuid: string,
): boolean {
  return docStructureKey.getState(state)?.structure.blocks.has(uuid) ?? false;
}

/** The mark twin of {@link hasLiveBlock}: does a `linkedAnchor` mark with this
 *  `anchorId` survive in `state`'s document? O(1), never materializes. */
export function hasLiveAnchor(
  state: Parameters<typeof docStructureKey.getState>[0],
  anchorId: string,
): boolean {
  return docStructureKey.getState(state)?.structure.anchors.has(anchorId) ?? false;
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
 * Each doc-changing transaction's own diff, keyed by the transaction (task
 * 1072). A WeakMap keyed by its owner, never a slot: a transaction is a unique
 * object, so N mounted panes can never read each other's entries, and an entry
 * dies with its transaction. One O(1) `set` per doc-changing transaction —
 * nothing else added to the keystroke path.
 */
const txDiffs = new WeakMap<Transaction, StructureDiff>();

/**
 * THE consumer door: the structural diff of EXACTLY the transactions the
 * caller was handed — an `appendTransaction`'s `transactions`, or `[tr]` from a
 * plugin `apply`.
 *
 * ProseMirror calls each appender with every transaction it has not yet SEEN
 * (`trs.slice(n)`), so folding precisely those is both complete (an earlier
 * appender's append cannot hide the user's transaction behind it) and
 * non-repeating (round 2 of the append loop is handed only round 1's appends,
 * so it is never re-told round 1's removals and cannot append forever — task
 * 650's invariant, kept by construction rather than by a per-state slot).
 *
 *   - `null`        — no observer installed in `state`: the caller takes its
 *                     observer-absent full-doc-walk fallback. Also returned if
 *                     a doc-changing transaction carries no recorded diff (it
 *                     was never applied through this observer), so a caller is
 *                     never told "nothing changed" about work it cannot see.
 *   - `EMPTY_DIFF`  — observer present, nothing structural or content-level
 *                     changed (no doc change, or attr-only steps).
 *   - otherwise     — the fold: added/changed positions in `state.doc`; each
 *                     removed entry recorded in the doc before ITS transaction
 *                     (a removed footnote carries its body, so no consumer has
 *                     to re-resolve that position).
 *
 * The single-transaction case — every keystroke — returns that transaction's
 * diff BY IDENTITY: no merge, no allocation.
 */
export function readDiffFor(
  transactions: readonly Transaction[],
  state: Parameters<typeof docStructureKey.getState>[0],
): StructureDiff | null {
  if (!docStructureKey.getState(state)) return null;
  let acc: StructureDiff | null = null;
  for (const tr of transactions) {
    if (!tr.docChanged) continue;
    const diff = txDiffs.get(tr);
    if (diff === undefined) return null;
    acc = accumulate(acc, diff, tr.mapping);
  }
  return acc ?? EMPTY_DIFF;
}

// Re-export the bus type so consumers can do `import { DocStructureBus } from "@/lib/tiptap/doc-structure"`.
export type { DocStructureBus };
