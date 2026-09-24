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
 * the surface is read-only (asked through `surfaceIsEditable`, never
 * `view.editable` alone — MAIN pins that to true, task 579), or the
 * DICTIONARY FAILS TO LOAD, the plugin goes
 * inactive and the attribute goes with it — the surface is handed back to the
 * browser rather than left with no checker at all. That hand-back is the whole
 * reason `spellEngineAvailable()` is published instead of swallowed.
 *
 * ## Right-click, not click
 *
 * The suggestion menu opens on the CONTEXT MENU over a flagged word, which is
 * what every checker does and what leaves ordinary clicking alone (a plain
 * click inside a word is how you put the caret there). Suppressing the
 * browser's own menu is honest here and only here: this surface has already
 * declined the browser's checker, so its context menu carries no spelling
 * entries to lose — and over anything that is NOT flagged the event falls
 * straight through untouched.
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
import { closeSpellMenu, openSpellMenu } from "@/lib/spell/spell-menu-store";
import { viewOnly } from "@/lib/view-only-chrome";
import type { RefObject } from "react";
import { surfaceIsEditable } from "@/lib/tiptap/surface-editable";

/** The class the squiggle is painted with; `globals.css` owns the look.
 *  Stamped through `viewOnly()` at the decoration (below), because a squiggle
 *  is the EDITOR's opinion about a word and must not reach paper (task 523 —
 *  `text-decoration` is painted with the text, so unlike every other member of
 *  the class it printed with default print settings). */
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
  /**
   * The pass covered the WHOLE document: `decos` replaces the set outright
   * rather than per block (task 581). A per-prose-block removal cannot reach a
   * squiggle that a block conversion carried into a code block or a `%`
   * comment, because that block is no longer a prose block to be visited.
   */
  replaceAll?: boolean;
  /**
   * Blocks this pass painted but still OWES a re-check: they hold a word that
   * arrived after phase A asked the dictionary, so its verdict is not cached
   * yet. They stay dirty, so the next pass asks about it (task 582).
   */
  owed?: readonly number[];
}

/**
 * What a squiggle carries. The object is the decoration's IDENTITY: mapping
 * keeps it by reference, and a pass that re-flags the same word at the same
 * range REUSES it (see phase B), so a suggestion menu opened over a word can
 * find that word again at the moment it is USED, wherever edits have moved it
 * — and finds nothing once it is no longer a flagged word (task 581).
 */
export interface SpellDecoSpec {
  readonly word: string;
}

export interface SpellcheckDecoratorOptions {
  /** The live port; `null` disables the plugin entirely. */
  port: SpellcheckPortRef | null;
  /**
   * MAIN's mirror of the React `editable` prop (task 579). MAIN pins
   * `view.editable = true` whatever the user-facing state, so without this the
   * read-only gate below is always open there — the Library Reader squiggled
   * every paper and offered corrections the `readOnlyEnforcer` then dropped.
   * `null` on surfaces whose `view.editable` is honest (card bodies, floats).
   */
  editableRef: RefObject<boolean> | null;
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

/**
 * The tokens of one block position: `null` when it no longer names a
 * TEXTBLOCK, `[]` when it names one that carries no prose.
 *
 * The two answers are different claims and phase B reads the difference: a
 * textblock that STOPPED being prose (a paragraph converted to a code block or
 * a `%` comment — a `ReplaceAroundStep` whose gap carries the old squiggles in
 * with the content) is still a block this pass is answering for, and its
 * answer is "no squiggles" (task 581). Only a position that names nothing is
 * skipped.
 */
function tokensAt(doc: PMNode, pos: number): SpellToken[] | null {
  if (pos < 0 || pos >= doc.content.size) return null;
  let node: PMNode | null = null;
  try {
    node = doc.nodeAt(pos);
  } catch {
    return null;
  }
  if (!node || !node.isTextblock) return null;
  if (!blockCarriesProse(node)) return [];
  return tokenizeBlock(node, pos + 1);
}

/**
 * The live range of a squiggle identified by its spec, or `null` when that
 * word is no longer flagged anywhere in `state` (task 581).
 *
 * Read at the moment a suggestion is APPLIED, never trusted from the moment
 * the menu opened: suggestions load asynchronously, and the document can
 * change underneath the open menu (a code-pane flush, a cowork commit, a
 * collaborator). The plugin's own set is mapped through every one of those
 * transactions, so it is the one table that knows where the word went — and a
 * pass that stopped flagging it (the word was accepted, edited, or its block
 * stopped being prose) drops the spec, so the answer is honestly "gone".
 * The text is re-checked as well, defensively, so a mapping that collapsed or
 * shifted the range can never edit bytes that are not the word.
 */
export function liveSpellRange(
  state: EditorState,
  spec: SpellDecoSpec,
): { from: number; to: number } | null {
  const st = spellcheckPluginKey.getState(state);
  if (!st) return null;
  const hit = st.decos.find(undefined, undefined, (s) => s === spec)[0];
  if (!hit || hit.from >= hit.to) return null;
  if (state.doc.textBetween(hit.from, hit.to) !== spec.word) return null;
  return { from: hit.from, to: hit.to };
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
    return { port: null, editableRef: null };
  },

  addProseMirrorPlugins() {
    const portRef = this.options.port;
    const editableRef = this.options.editableRef;
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
              } else if (meta.replaceAll) {
                // [cost: O(squiggles) — a `DecorationSet.create` over the result
                // of a WHOLE-document pass, reachable only from this plugin's
                // own meta, which is dispatched only after a `version()` bump
                // (preference, dictionary, bibliography, document load). A
                // keystroke never carries it; the per-block arm below is what a
                // typing pass takes.]
                decos = DecorationSet.create(tr.doc, [...(meta.decos ?? [])]);
                dirty = mergeDirty([], meta.owed ?? []);
              } else if (meta.blocks) {
                decos = replaceBlockDecos(decos, tr.doc, meta.blocks, meta.decos ?? []);
                const done = new Set(meta.blocks);
                dirty = mergeDirty(dirty.filter((p) => !done.has(p)), meta.owed ?? []);
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
          /**
           * Open the suggestion menu over a flagged word. Falls through for
           * every other target, so the browser's own menu is untouched
           * everywhere else.
           */
          handleDOMEvents: {
            contextmenu(view, event) {
              const st = spellcheckPluginKey.getState(view.state);
              if (!st?.active) return false;
              // Asked LIVE, not only through `active`: between an editability
              // flip and the debounced pass that clears the squiggles, a
              // flagged word is still painted, and a menu opened over it would
              // offer an edit the read-only enforcer silently drops (task 579).
              if (!surfaceIsEditable(view, editableRef)) return false;
              const port = portRef.current;
              if (!port) return false;
              // Resolve from the painted SPAN, not from the pointer's
              // coordinates: `posAtDOM` is exact and needs no layout, where
              // `posAtCoords` asks the browser's hit-test and answers null
              // wherever there is none. The span is also the thing that owns
              // the rect the menu anchors to, so one lookup serves both.
              const target = (event.target as HTMLElement | null)?.closest?.(
                `.${SPELL_ERROR_CLASS}`,
              ) as HTMLElement | null;
              if (!target) return false;
              let pos: number;
              try {
                pos = view.posAtDOM(target, 0);
              } catch {
                return false;
              }
              const hit = st.decos
                .find(pos, pos)
                .find((d) => pos >= d.from && pos <= d.to);
              if (!hit) return false;
              const spec = hit.spec as SpellDecoSpec;
              if (!spec?.word) return false;
              event.preventDefault();
              openSpellMenu({
                word: spec.word,
                spec,
                from: hit.from,
                to: hit.to,
                rect: target.getBoundingClientRect(),
                anchorEl: target,
                view,
                port,
              });
              return true;
            },
          },
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
          let lastVersion: unknown = Symbol("unset");
          /**
           * A whole-document re-check is a REQUEST with a generation, not a
           * boolean (task 582). `sync` bumps `fullGen` on every version change;
           * a pass records the generation it ran for and satisfies the request
           * only if it was a whole-document pass AND no newer request arrived
           * while it awaited the dictionary. A boolean that every pass cleared
           * let a dirty-block pass, resuming from its `ensure`, erase the
           * request a version bump made during that await.
           */
          let fullGen = 1;
          let doneGen = 0;
          /** Passes are SERIAL: a debounce firing mid-pass asks for one more
           *  pass after it rather than starting a concurrent one. */
          let running = false;
          let rerun = false;
          let destroyed = false;
          const needFull = () => doneGen !== fullGen;

          const currentPort = (): SpellcheckPort | null => {
            const port = portRef.current;
            if (!port) return null;
            return port.enabled() && surfaceIsEditable(view, editableRef) ? port : null;
          };

          const schedule = () => {
            if (destroyed) return;
            if (timer !== null) clearTimeout(timer);
            timer = setTimeout(() => {
              timer = null;
              if (running) {
                rerun = true;
                return;
              }
              running = true;
              void run().finally(() => {
                running = false;
                if (rerun && !destroyed) {
                  rerun = false;
                  schedule();
                }
              });
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
              // Going inactive: whatever comes back must re-check everything.
              fullGen++;
              // A menu left open over a surface this plugin no longer owns
              // would still offer its rows (task 579).
              closeSpellMenu(view);
              if (state.active || state.decos !== DecorationSet.empty) {
                dispatchMeta({ active: false, clear: true });
              }
              return;
            }

            const gen = fullGen;
            const doWholeDoc = needFull();
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
            const owed: number[] = [];
            for (const pos of blocks) {
              const tokens = tokensAt(doc, pos);
              if (!tokens) continue;
              handled.push(pos);
              let owes = false;
              for (const tok of tokens) {
                if (port.isAccepted(tok.word)) continue;
                const verdict = port.knownSync(tok.word);
                if (verdict === undefined && !missing.has(tok.word)) {
                  // Typed while phase A awaited: nobody has asked about it
                  // yet, so this block stays owed rather than being settled
                  // as clean (the next pass asks). A word phase A DID ask
                  // about and that is still unresolved is treated as known —
                  // bounded, never a re-ask loop.
                  owes = true;
                  continue;
                }
                // Still unresolved after the one warm-up ⇒ treat as known.
                if (verdict !== false) continue;
                if (caret !== null && caret > tok.from && caret <= tok.to) continue;
                // Re-flagging the same word at the same range keeps its spec,
                // so an open menu can still find it (task 581). O(squiggles in
                // this word's range).
                const prior = live.decos
                  .find(tok.from, tok.to)
                  .find(
                    (d) =>
                      d.from === tok.from &&
                      d.to === tok.to &&
                      (d.spec as SpellDecoSpec).word === tok.word,
                  );
                const spec: SpellDecoSpec =
                  (prior?.spec as SpellDecoSpec | undefined) ?? { word: tok.word };
                decos.push(
                  Decoration.inline(
                    tok.from,
                    tok.to,
                    { class: viewOnly(SPELL_ERROR_CLASS) },
                    spec,
                  ),
                );
              }
              if (owes) owed.push(pos);
            }

            if (doWholeDoc) {
              // Satisfied only if no newer request arrived during the await.
              if (gen === fullGen) doneGen = gen;
              dispatchMeta({ active: true, replaceAll: true, decos, owed });
            } else {
              dispatchMeta({ active: true, blocks: handled, decos, owed });
            }
          }

          const sync = () => {
            const port = portRef.current;
            const version: unknown = port ? port.version() : null;
            if (!Object.is(version, lastVersion)) {
              lastVersion = version;
              fullGen++;
            }
            const state = spellcheckPluginKey.getState(view.state);
            const wantActive = currentPort() !== null;
            if (needFull() || (state && state.dirty.length > 0) || wantActive !== !!state?.active) {
              schedule();
            }
          };

          // The PUSH half of the invalidation channel (task 580): an engine
          // recovery, a preference flip or a dictionary edit with nobody typing
          // reaches `sync` without waiting for a transaction. Re-subscribed if
          // the ref ever holds a different port.
          let subscribedPort: SpellcheckPort | null = null;
          let unsubscribe: (() => void) | null = null;
          const ensureSubscribed = () => {
            const port = portRef.current;
            if (port === subscribedPort) return;
            unsubscribe?.();
            unsubscribe = null;
            subscribedPort = port;
            if (port) unsubscribe = port.onInvalidate(() => sync());
          };

          const syncAndSubscribe = () => {
            ensureSubscribed();
            sync();
          };

          syncAndSubscribe();

          return {
            // [cost: O(1) — a port identity compare, a version compare, a
            // dirty-length read and a timer reset. The check itself is the
            // debounced callback.]
            update: syncAndSubscribe,
            destroy() {
              destroyed = true;
              unsubscribe?.();
              unsubscribe = null;
              if (timer !== null) clearTimeout(timer);
              // A menu open over THIS view must not outlive it.
              closeSpellMenu(view);
            },
          };
        },
      }),
    ];
  },
});
