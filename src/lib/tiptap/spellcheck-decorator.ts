/**
 * SPELLCHECK DECORATIONS — Virgil's own red underline (task 518).
 *
 * ## A squiggle is a VIEW, never document content
 *
 * Every rule task 120 states about a transient text-range highlight applies
 * here verbatim, and for the same reasons: a mark would put a UI-derived signal
 * into the user's document, so it would create an undo step, arm the autosaver,
 * be captured by an archive of the paragraph, and collide with a real
 * highlight. So the squiggles are a `DecorationSet`, replaced by META-ONLY
 * transactions (`!docChanged`), invisible to history, to the autosaver and to
 * `DocStructureObserver`.
 *
 * ## The rebuild is per BLOCK, and the keystroke path is empty
 *
 * `apply` does three O(small) things per transaction — map the set, map the
 * dirty-block list, and (only when the document changed) add the textblocks the
 * transaction TOUCHED, through the shared `touchedTextblocks` door that tasks
 * 400/430 built for exactly this. It never walks the document and never asks
 * the dictionary. The check itself happens in the plugin VIEW, behind a 300 ms
 * debounce (the interactive tier — a spelling squiggle at the lint tier's
 * 1.5 s would feel broken), and its ONE whole-document arm runs only when the
 * port's `version()` bumps: a preference flip, a dictionary edit, a
 * bibliography reload, a document load. Typing N characters costs N timer
 * resets and nothing else.
 *
 * ## Two phases, because positions move and the dictionary is async
 *
 * The pass never awaits with positions in hand. Phase A tokenizes the blocks it
 * owes, collects the words the client has no cached verdict for, and awaits
 * ONE warm-up. Phase B re-reads the LIVE state and builds decorations
 * synchronously from the now-warm cache. A word still unresolved after the
 * warm-up is treated as KNOWN — a missed flag is the status quo, a false
 * squiggle is the thing this feature must not be.
 *
 * ## ONE owner for "who underlines this surface"
 *
 * The browser also draws squiggles, and two underlines on one word is worse
 * than either alone. So the plugin that PAINTS is the plugin that turns the
 * browser's off: while it is active it contributes `spellcheck="false"` through
 * its own `props.attributes` — declaratively, so ProseMirror adds and removes
 * it, and so it composes with `Editor.tsx`'s read-only
 * `NEVER_SPELLCHECK_ATTRS` rather than fighting it. If the preference is off,
 * the surface is read-only, or the DICTIONARY FAILS TO LOAD, the plugin goes
 * inactive and the attribute goes with it — the surface is handed back to the
 * browser rather than left with no checker at all. That hand-back is the whole
 * reason `spellEngineAvailable()` is published instead of swallowed.
 *
 * ## The word being typed is not flagged
 *
 * A token containing the caret is skipped, which is what stops `th` from being
 * underlined on the way to `the`. The caret MOVING is then the event that
 * finishes that word, so a selection change marks both the block the caret left
 * and the block it entered — two O(depth) resolves, scheduling a pass bounded
 * by ONE block. Without it a half-typed word would stay unflagged until its
 * paragraph happened to be edited again, which is the one place this rule can
 * go wrong in the direction that matters (a missed flag rather than a false
 * one, but a permanently missed one).
 */

import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { touchedRanges, touchedTextblocks } from "@/lib/tiptap/changed-ranges";
import { blockCarriesProse } from "@/lib/prose-index";
import { VIRGIL_CHECKED_ATTRS } from "@/lib/spellcheck-policy";
import { tokenizeBlock, type SpellToken } from "@/lib/spell/prose-words";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

/** The class the squiggle is painted with; `globals.css` owns the look. */
export const SPELL_ERROR_CLASS = "spell-error";

/** Interactive tier — the same 300 ms the doc-products interactive tier uses. */
export const SPELL_DEBOUNCE_MS = 300;

export const spellcheckPluginKey = new PluginKey<SpellPluginState>("virgilSpellcheck");

/** What the plugin knows between transactions. */
interface SpellPluginState {
  decos: DecorationSet;
  /** Block positions owing a re-check, in current-document coordinates. */
  dirty: readonly number[];
  /** True while Virgil owns this surface's underline (see the header). */
  active: boolean;
  /** The textblock the caret sits in, so leaving one re-checks it. */
  caretBlock: number | null;
}

/** The meta a completed pass dispatches. */
interface SpellResultMeta {
  active: boolean;
  /** Blocks whose decorations are being replaced (positions in the doc the
   *  pass read — which is the live doc, since phase B never awaits). */
  blocks?: readonly number[];
  decos?: readonly Decoration[];
  /** Drop every decoration (the plugin is going inactive). */
  clear?: boolean;
}

export interface SpellcheckDecoratorOptions {
  /** The live port; `null` disables the plugin entirely. */
  port: SpellcheckPortRef | null;
}

/** The textblock the caret is in, or null. O(depth). */
function caretBlockPos(state: EditorState): number | null {
  const $from = state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).isTextblock) return $from.before(d);
  }
  return null;
}

/** Ascending, deduped. */
function mergeDirty(a: readonly number[], b: Iterable<number>): number[] {
  const set = new Set(a);
  for (const p of b) set.add(p);
  return [...set].sort((x, y) => x - y);
}

/**
 * Every prose textblock in the document.
 *
 * [cost: O(doc), and it is the ONE whole-document arm — reachable only from a
 * `version()` bump (preference flip, dictionary edit, bibliography reload,
 * document load), never from a keystroke. It lives in the plugin VIEW, behind
 * the debounce; `apply` takes the `touchedTextblocks` door and walks nothing.]
 */
function allProseBlocks(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    if (blockCarriesProse(node)) out.push(pos);
    return false;
  });
  return out;
}

/** The tokens of one block position, or `null` when it no longer names one. */
function tokensAt(doc: PMNode, pos: number): SpellToken[] | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  let node: PMNode | null = null;
  try {
    node = doc.nodeAt(pos);
  } catch {
    return null;
  }
  if (!node || !blockCarriesProse(node)) return null;
  return tokenizeBlock(node, pos + 1);
}

/**
 * Replace the decorations inside `blocks` with `next`.
 *
 * The removal window is "reaches INTO the block" made exact by CONTAINMENT:
 * `DecorationSet.find` is inclusive at both ends, so a neighbour's decoration
 * abutting the boundary comes back from the query and must not be dropped.
 * Every decoration this plugin paints lies strictly inside one textblock, so
 * containment is the precise test (task 400 had to reason about straddling
 * because its decorations could span a split; a word cannot).
 */
function replaceBlockDecos(
  set: DecorationSet,
  doc: PMNode,
  blocks: readonly number[],
  next: readonly Decoration[],
): DecorationSet {
  let out = set;
  for (const pos of blocks) {
    const node = pos >= 0 && pos < doc.content.size ? doc.nodeAt(pos) : null;
    if (!node) continue;
    const end = pos + node.nodeSize;
    const inside = out.find(pos, end).filter((d) => d.from >= pos && d.to <= end);
    if (inside.length > 0) out = out.remove(inside);
  }
  return next.length > 0 ? out.add(doc, [...next]) : out;
}

export const SpellcheckDecorator = Extension.create<SpellcheckDecoratorOptions>({
  name: "spellcheckDecorator",

  addOptions() {
    return { port: null };
  },

  addProseMirrorPlugins() {
    const portRef = this.options.port;
    if (!portRef) return [];

    return [
      new Plugin<SpellPluginState>({
        key: spellcheckPluginKey,

        state: {
          init(_config, state) {
            return {
              decos: DecorationSet.empty,
              dirty: [],
              active: false,
              caretBlock: caretBlockPos(state),
            };
          },

          // [cost: O(steps + dirty) per transaction — map the set, map the
          // dirty list, and on a doc change add the touched textblocks through
          // the shared door. No document walk and no dictionary lookup; the
          // check runs in the plugin view behind a 300 ms debounce.]
          apply(tr: Transaction, prev, _oldState, newState) {
            const meta = tr.getMeta(spellcheckPluginKey) as SpellResultMeta | undefined;
            let decos = prev.decos.map(tr.mapping, tr.doc);
            let dirty = prev.dirty
              .map((p) => tr.mapping.map(p, -1))
              .filter((p) => p >= 0);
            let active = prev.active;

            if (meta) {
              active = meta.active;
              if (meta.clear) {
                decos = DecorationSet.empty;
                dirty = [];
              } else if (meta.blocks) {
                decos = replaceBlockDecos(decos, tr.doc, meta.blocks, meta.decos ?? []);
                const done = new Set(meta.blocks);
                dirty = dirty.filter((p) => !done.has(p));
              }
            }

            if (tr.docChanged) {
              dirty = mergeDirty(dirty, touchedTextblocks(tr.doc, touchedRanges([tr])).keys());
            }

            let caretBlock = prev.caretBlock;
            if (tr.selectionSet || tr.docChanged) {
              caretBlock = caretBlockPos(newState);
              if (tr.selectionSet) {
                // The caret MOVING is what finishes a word: the token it was
                // inside was exempt, and now it is not. So both the block being
                // left and the one being entered owe a re-check — two O(depth)
                // resolves and a small set merge per selection change, and the
                // pass they schedule is bounded by ONE block, never the
                // document. (An arrow key held down therefore costs one
                // block's re-tokenize per 300 ms debounce window.)
                const both: number[] = [];
                if (prev.caretBlock !== null) {
                  const mapped = tr.mapping.map(prev.caretBlock, -1);
                  if (mapped >= 0) both.push(mapped);
                }
                if (caretBlock !== null) both.push(caretBlock);
                dirty = mergeDirty(dirty, both);
              }
            }

            return { decos, dirty, active, caretBlock };
          },
        },

        props: {
          decorations(state) {
            return spellcheckPluginKey.getState(state)?.decos ?? DecorationSet.empty;
          },
          /**
           * The hand-off with the browser's checker, declared rather than
           * written onto the DOM by hand: ProseMirror merges plugin attributes
           * with `editorProps.attributes` and removes ours the moment the
           * plugin goes inactive.
           */
          attributes(state): Record<string, string> {
            return spellcheckPluginKey.getState(state)?.active
              ? { ...VIRGIL_CHECKED_ATTRS }
              : {};
          },
        },

        view(view) {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let lastVersion = Number.NaN;
          let needFull = true;
          let destroyed = false;

          const currentPort = (): SpellcheckPort | null => {
            const port = portRef.current;
            if (!port) return null;
            return port.enabled() && view.editable ? port : null;
          };

          const schedule = () => {
            if (destroyed) return;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              void run();
            }, SPELL_DEBOUNCE_MS);
          };

          const dispatchMeta = (meta: SpellResultMeta) => {
            if (destroyed) return;
            const tr = view.state.tr.setMeta(spellcheckPluginKey, meta);
            tr.setMeta("addToHistory", false);
            view.dispatch(tr);
          };

          async function run(): Promise<void> {
            if (destroyed) return;
            const port = currentPort();
            const state = spellcheckPluginKey.getState(view.state);
            if (!state) return;

            if (!port) {
              needFull = true;
              if (state.active || state.decos !== DecorationSet.empty) {
                dispatchMeta({ active: false, clear: true });
              }
              return;
            }

            const doWholeDoc = needFull;
            const blocksOf = (s: SpellPluginState, doc: PMNode) =>
              doWholeDoc ? allProseBlocks(doc) : [...s.dirty];

            // ── Phase A: which words has nobody asked the dictionary about? ──
            const phaseABlocks = blocksOf(state, view.state.doc);
            const missing = new Set<string>();
            for (const pos of phaseABlocks) {
              for (const tok of tokensAt(view.state.doc, pos) ?? []) {
                if (port.isAccepted(tok.word)) continue;
                if (port.knownSync(tok.word) === undefined) missing.add(tok.word);
              }
            }
            if (missing.size > 0) {
              await port.ensure([...missing]);
              if (destroyed) return;
            }

            // ── Phase B: build from the LIVE document, synchronously ──
            const live = spellcheckPluginKey.getState(view.state);
            if (!live) return;
            const doc = view.state.doc;
            const blocks = blocksOf(live, doc);
            const sel = view.state.selection;
            const caret = sel.empty ? sel.from : null;

            const decos: Decoration[] = [];
            const handled: number[] = [];
            for (const pos of blocks) {
              const tokens = tokensAt(doc, pos);
              if (!tokens) continue;
              handled.push(pos);
              for (const tok of tokens) {
                if (port.isAccepted(tok.word)) continue;
                // Still unresolved after the one warm-up ⇒ treat as known.
                if (port.knownSync(tok.word) !== false) continue;
                if (caret !== null && caret > tok.from && caret <= tok.to) continue;
                decos.push(
                  Decoration.inline(
                    tok.from,
                    tok.to,
                    { class: SPELL_ERROR_CLASS },
                    { word: tok.word },
                  ),
                );
              }
            }

            needFull = false;
            dispatchMeta({ active: true, blocks: handled, decos });
          }

          const sync = () => {
            const port = portRef.current;
            const version = port ? port.version() : Number.NaN;
            if (!Object.is(version, lastVersion)) {
              lastVersion = version;
              needFull = true;
            }
            const state = spellcheckPluginKey.getState(view.state);
            const wantActive = currentPort() !== null;
            if (needFull || (state && state.dirty.length > 0) || wantActive !== !!state?.active) {
              schedule();
            }
          };

          sync();

          return {
            // [cost: O(1) — a version compare, a dirty-length read and a timer
            // reset. The check itself is the debounced callback.]
            update: sync,
            destroy() {
              destroyed = true;
              if (timer !== null) clearTimeout(timer);
            },
          };
        },
      }),
    ];
  },
});
