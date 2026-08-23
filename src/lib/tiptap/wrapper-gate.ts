/**
 * **THE list/quote WRAPPER gate** — the one predicate every surface that can
 * fire `toggleBulletList` / `toggleOrderedList` / `toggleBlockquote` reads
 * (tasks 397 → 427).
 *
 * Task 397 built the predicate and put it on the registry rows (`applies` +
 * `run`), which covers the lightning grid and the slash twins. Three surfaces
 * never enter the registry: StarterKit's `Mod-Shift-8/7/b` chords, its `- ` /
 * `1. ` / `> ` markdown input rules, and `RichTextField`'s toolbar. The chords
 * were MEASURED destroying an expex item (`toggleList` LIFTS the paragraph out
 * of the `exampleItem`, its `\vxid` goes with it and the example renumbers),
 * exactly as the grid cell did before 397. This module is the leaf those
 * surfaces can reach — `editor-extensions.ts` and a card-body toolbar cannot
 * import the editor-coupled action registry, which is precisely how the
 * predicate came to have one consumer. Same placement rule `latex-markers.ts`
 * and `node-attr-sets.ts` each earned: a facet the layer that needs it cannot
 * import will be re-copied (or, here, simply skipped).
 *
 * Two halves, and they are genuinely different questions:
 *
 *   • **identity** — `selectionIsListable`: would the wrap DESTROY the block's
 *     own identity? A `titleField` / `heading` / atom block coerced into a
 *     paragraph loses its `\title{}` / `\section{}` / opaque bytes.
 *   • **container** — `selectionHostsWrapper`: can the wrapper be placed AROUND
 *     those blocks at all, or would ProseMirror lift them out of a container
 *     that cannot host it (an expex `exampleItem`)? The third member of the
 *     container family beside `posHostsBlockInsert` / `posHostsInlineAtom`
 *     (`text-object-registry`, which re-exports it from here).
 *
 * `wrapperSafeInState` is the WHOLE question. Every surface asks it and nothing
 * else: the registry rows (affordance + commit), the three `.extend()`ed
 * factories' chords and input rules (`guardWrapperShortcuts` /
 * `guardWrapperInputRules`), and the card-body toolbar. CI
 * (`wrapper-surfaces-guard.test.ts`) censuses every production call of the
 * three toggles against this door, allowlist EMPTY.
 *
 * Cheap and gesture-only (one `blockRange` + one `findWrapping` + an O(depth)
 * ancestor walk), never per keystroke — the input-rule reader runs only on a
 * rule MATCH, i.e. after the trigger text has been typed.
 */
import type { NodeType, NodeRange, ResolvedPos } from "@tiptap/pm/model";
// VALUE import: `findWrapping` is the predicate ProseMirror's own `wrapIn` /
// `wrapInList` consult, so the wrapper AFFORDANCE and the wrapper COMMIT ask
// one question rather than two implementations of one rule (task 397).
import { findWrapping } from "@tiptap/pm/transform";
import type { EditorState } from "@tiptap/pm/state";
import { InputRule } from "@tiptap/core";
import type { KeyboardShortcutCommand } from "@tiptap/core";

/** The schema names of the three wrapper nodes, as the registry rows spell
 *  them. */
export type WrapperNodeName = "bulletList" | "orderedList" | "blockquote";

/**
 * The schema node-type names a list/quote wrapper can safely wrap WITHOUT
 * destroying structural identity. Centralized (not inlined) so the rule has one
 * home + this comment. `paragraph` is the generic prose container both wrapper
 * content models (`listItem` = "paragraph block*", `blockquote` = "block+")
 * accept and KEEP as a paragraph; `listItem` is already a list item (a list
 * toggle re-lists it losslessly). Every other block — titleField, heading,
 * codeBlock, displayMath, texBlock, figureBlock, graphicsBlock, latexComment,
 * maketitleMarker, exampleBlock, and the list/quote containers themselves — is
 * NON-listable: wrapping it loses or corrupts its identity. These are SCHEMA
 * node names (PM `node.type.name`), not `TextObjectKind`s — the caret may sit in
 * a node (maketitleMarker) that has no TextObject twin.
 */
export const LISTABLE_BLOCK_TYPES: ReadonlySet<string> = new Set(["paragraph", "listItem"]);

/**
 * True iff EVERY block a list/quote wrapper would act on for the current
 * selection is listable — i.e. wrapping preserves each block's identity. We take
 * the SAME block range ProseMirror's `wrapInList` / `wrapIn` take (`$from.
 * blockRange($to)`): the contiguous run of sibling blocks at the shared depth
 * that the wrapper would lift into the new container. Each of those siblings
 * must be a listable node (`paragraph` / `listItem`); a single non-listable
 * block (titleField / heading / atom block) refuses.
 *
 * A collapsed caret resolves to the single containing block. If no block range
 * resolves (a degenerate selection — e.g. a NodeSelection on an opaque atom),
 * we refuse: there is nothing safely listable to wrap.
 */
export function selectionIsListable(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!range) return false; // no wrappable block range → not listable, grey it
  const parent = range.parent;
  for (let i = range.startIndex; i < range.endIndex; i += 1) {
    if (!LISTABLE_BLOCK_TYPES.has(parent.child(i).type.name)) return false;
  }
  // A zero-width range (startIndex === endIndex) means the resolved block isn't
  // a direct child of `parent` at this depth — the caret's own textblock IS the
  // affected block; check it directly.
  if (range.startIndex === range.endIndex) {
    return LISTABLE_BLOCK_TYPES.has($from.parent.type.name);
  }
  return true;
}

/**
 * The CONTAINER half (task 397): can a WRAPPER (`bulletList` / `orderedList` /
 * `blockquote`) be placed AROUND the blocks the selection spans?
 *
 * The wrapper rows had a `LISTABLE_BLOCK_TYPES` gate that asks only about the
 * BLOCK ("is it a paragraph?") and never about the CONTAINER ("can a list live
 * where that paragraph lives?"). The two questions come apart the moment a
 * container's content model is narrower than `block+`: an expex `exampleItem`
 * holds `(paragraph | graphicsBlock | displayMath)+` and no list, so a bullet
 * toggle at a caret inside an item does not wrap it — ProseMirror LIFTS the
 * paragraph out of the item, destroying the item's `\vxid` identity and (because
 * expex numbers items by POSITION) silently renumbering every later item, so
 * every `\ref` into that example points at different text. Nothing throws; the
 * document stays schema-valid.
 *
 * Two layers, both read from the schema, never from a list of node names:
 *
 *   1. **Can the wrapper be placed here at all?** `findWrapping` is the question
 *      ProseMirror's own `wrapIn` / `wrapInList` ask (it searches for the whole
 *      wrapper CHAIN — `bulletList > listItem` — and answers null when the
 *      container refuses the wrapper OR the wrapper refuses the content).
 *      Asking PM's own predicate rather than restating it means the affordance
 *      and the commit can never disagree about what "wrappable" means.
 *
 *   2. **…unless the toggle is SUBTRACTIVE**, in which case layer 1 does not
 *      apply, because nothing new is being placed. A wrapper toggle removes or
 *      converts in place exactly when the caret ALREADY sits inside a container
 *      of the wrapper's own family — one that hosts the same kind of child the
 *      wrapper hosts. That family is DERIVED (`contentMatch.matchType`), not
 *      enumerated: `bulletList` and `orderedList` are family because both host a
 *      `listItem` (so bullet→numbered converts in place, and bullet→off lifts
 *      out — both must stay enabled), a nested `blockquote` is family to the
 *      blockquote row, and an `exampleItemList` — which hosts only `exampleItem`,
 *      a child no wrapper accepts — is family to NONE. That is precisely why a
 *      list toggle inside a bullet list must stay enabled while the same toggle
 *      inside an expex ITEM must grey.
 *
 * The doc node is excluded from the ancestor walk: the document is not a
 * container anything can be lifted out of, and `block+` would make it family to
 * every wrapper.
 *
 * Failure direction is deliberate. Layer 2 is only consulted after layer 1 has
 * already said NO, so a wrongly-EXEMPT case leaves the pre-397 behaviour (the
 * cell stays enabled) while a wrongly-NON-exempt case greys a toggle that
 * ProseMirror itself reports it cannot perform — inert at worst, never a lost
 * capability. A degenerate selection with no block range (a `NodeSelection` on an
 * opaque atom) answers `false`: there is nothing safely wrappable.
 */
export function selectionHostsWrapper(
  state: EditorState,
  wrapperType: NodeType | undefined,
): boolean {
  if (!wrapperType) return true; // wrapper absent from this schema → historic allow
  const { $from, $to } = state.selection;
  const range = $from.blockRange($to);
  if (!range) return false;
  if (findWrapping(range, wrapperType) !== null) return true;
  return hasSameFamilyAncestor($from, range, wrapperType);
}

/**
 * Layer 2 of `selectionHostsWrapper`: does the affected block range sit inside a
 * container of `wrapperType`'s own family — i.e. an ancestor whose content model
 * accepts the SAME child type the wrapper accepts (`range.parent.type`)? Such an
 * ancestor is the container this toggle removes or replaces, so the toggle is
 * subtractive and needs no home for a new wrapper.
 */
function hasSameFamilyAncestor(
  $from: ResolvedPos,
  range: NodeRange,
  wrapperType: NodeType,
): boolean {
  const childType = range.parent.type;
  // The wrapper must be able to host the affected container's own type, or it is
  // not a peer of whatever hosts it now.
  if (wrapperType.contentMatch.matchType(childType) == null) return false;
  for (let depth = range.depth; depth >= 1; depth -= 1) {
    if ($from.node(depth).type.contentMatch.matchType(childType) != null) return true;
  }
  return false;
}

/**
 * **THE WHOLE wrapper safety question**, in one place, so no two surfaces can
 * answer it from two tables — the shape task 258 states for placements and
 * task 321 for drop decisions. Identity first, then container.
 *
 * A state with no selection, or a stubbed state (the minimal menu-decoration
 * ctx, a unit-test double — no real schema, no resolvable doc) answers `true`
 * for the half it cannot ask — the historic "allow" fallback every other
 * container gate takes: a verdict is only issued when the question can actually
 * be asked.
 */
export function wrapperSafeInState(
  state: EditorState | undefined,
  wrapperNodeName: WrapperNodeName | string,
): boolean {
  if (!state?.selection) return true; // no live state → allow (historic)
  if (!selectionIsListable(state)) return false;
  if (!state.schema || typeof state.doc?.resolve !== "function") return true;
  return selectionHostsWrapper(state, state.schema.nodes[wrapperNodeName]);
}

/**
 * Gate a StarterKit keymap (`{ 'Mod-Shift-8': () => toggleBulletList() }`) on
 * the wrapper question. A refused chord is CONSUMED (`true`) rather than passed
 * on: activating a disabled control does nothing — the same answer the grid
 * cell and the slash popup give — and letting it fall through would hand the
 * key to whatever else happens to bind it.
 *
 * `getState` is read at PRESS time, never captured: an extension's `this.editor`
 * is not available when `addKeyboardShortcuts()` runs.
 */
export function guardWrapperShortcuts(
  shortcuts: Record<string, KeyboardShortcutCommand>,
  wrapperNodeName: WrapperNodeName,
  getState: () => EditorState | undefined,
): Record<string, KeyboardShortcutCommand> {
  const out: Record<string, KeyboardShortcutCommand> = {};
  for (const [key, cmd] of Object.entries(shortcuts)) {
    out[key] = (props) => (wrapperSafeInState(getState(), wrapperNodeName) ? cmd(props) : true);
  }
  return out;
}

/**
 * Gate StarterKit's markdown input rules (`- `, `1. `, `> `) on the wrapper
 * question. Each rule keeps its own `find` (so nothing about WHAT triggers a
 * wrap is restated here) and gets a handler that asks the gate against the
 * rule's own `state` before delegating; a refused match answers `null`, which
 * the input-rule plugin reads as "no rule fired" — the typed characters stay
 * text.
 *
 * Measured (task 427): upstream's `wrappingInputRule` already declines where
 * `findWrapping` fails, so on the CONTAINER half this is a no-op today. It is
 * wired anyway because the surface must answer from the ONE table — the
 * identity half (a heading, a title field) and any future rung land here
 * without anyone remembering the input rules exist.
 */
export function guardWrapperInputRules(
  rules: InputRule[],
  wrapperNodeName: WrapperNodeName,
): InputRule[] {
  return rules.map(
    (rule) =>
      new InputRule({
        find: rule.find,
        handler: (props) =>
          wrapperSafeInState(props.state, wrapperNodeName) ? rule.handler(props) : null,
      }),
  );
}
