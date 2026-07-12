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
import { asMutable, attachBus, detachBus, type DocStructureBus } from "./bus";
import { inspectSteps } from "./step-inspector";
import { applyDiff, buildInitial } from "./structure-index";
import { EMPTY_DIFF, EMPTY_STRUCTURE, type DocStructure, type StructureDiff } from "./types";

interface PluginState {
  structure: DocStructure;
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
  return (_view: EditorView) => {
    const bus = attachBus(editor);
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
        asMutable(bus)._emit(diff, state.structure);
      },
      destroy() {
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
              pendingDiff: null,
            };
          },
          apply(tr, prev, _oldState, _newState) {
            if (!tr.docChanged) {
              // Selection-only / mark-only-no-doc / meta-only — same state.
              if (prev.pendingDiff !== null) {
                return { structure: prev.structure, pendingDiff: null };
              }
              return prev;
            }
            const oldDoc = tr.before;
            const newDoc = tr.doc;
            const diff = inspectSteps(tr, oldDoc, newDoc, prev.structure);
            if (diff === EMPTY_DIFF) {
              // Structurally null edit — still need to map positions so
              // surviving entries don't go stale. Store EMPTY_DIFF (not
              // null) so same-tx `apply` consumers (uuid-attr) can tell
              // "observer present, nothing changed" apart from "observer
              // absent" and skip their full-rebuild fallback; the view
              // hook skips the bus emit for it.
              const mapped = mapStructurePositions(prev.structure, tr.mapping);
              return { structure: mapped, pendingDiff: EMPTY_DIFF };
            }
            // Map positions first, then fold the diff in. The diff's
            // entries are already in newDoc coordinates.
            const mapped = mapStructurePositions(prev.structure, tr.mapping);
            const next = applyDiff(mapped, diff);
            return { structure: next, pendingDiff: diff };
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
 * Read the latest structure snapshot from an editor state. Cheap.
 */
export function readDocStructure(state: {
  plugins: ReadonlyArray<unknown>;
  $? : never;
  // Loose typing — accepts EditorState from `@tiptap/pm/state`.
} & Parameters<typeof docStructureKey.getState>[0]): DocStructure {
  const s = docStructureKey.getState(state);
  return s?.structure ?? EMPTY_STRUCTURE;
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
