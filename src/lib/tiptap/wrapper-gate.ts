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
 * Two halves of the question, ONE derivation (task 1107):
 *
 *   • **identity** — would the wrap DESTROY a block's own identity? The only
 *     path that does is TipTap's `toggleList` falling back to `clearNodes()`
 *     (a `heading` / `titleField` coerced into a paragraph loses its
 *     `\section{}` / `\title{}`), and that fallback runs EXACTLY when PM's
 *     `wrapInList` cannot place the list and the toggle is not subtractive.
 *     `toggleBlockquote` is `wrapIn`, which never coerces — it wraps or fails.
 *   • **container** — can the wrapper be placed AROUND those blocks at all, or
 *     would ProseMirror lift them out of a container that cannot host it (an
 *     expex `exampleItem`)? The third member of the container family beside
 *     `posHostsBlockInsert` / `posHostsInlineAtom` (`text-object-registry`,
 *     which re-exports it from here).
 *
 * Both are answered by `selectionHostsWrapper`, which asks the COMMIT's own
 * predicate (`wrapInList` for a list, `findWrapping` for the quote) and then
 * the subtractive exemption — after one round-trip refusal the schema cannot
 * state: a PREAMBLE-RESIDENT block (`titleField`; `PREAMBLE_RESIDENT_NODE_TYPES`
 * in `node-attr-sets.ts`) has no body position, so a wrapper around it would
 * serialize empty. Until 1107 the identity half was a hand list of
 * node names (`paragraph`, `listItem`) that the schema outgrew in both
 * directions: it greyed "make this image a list item" after task 563 let a
 * `listItem` open with a `graphicsBlock`, and it applied the LIST coercion rule
 * to the QUOTE, greying `\begin{quote}` around display math, code, a comment —
 * every one of which wraps and round-trips losslessly
 * (`wrapper-gate-derived-identity.test.ts` proves the round trip per kind).
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
// …and `wrapInList` is the predicate TipTap's `toggleList` consults before it
// falls back to the identity-destroying `clearNodes()` (task 1107).
import { wrapInList } from "@tiptap/pm/schema-list";
import { PREAMBLE_RESIDENT_NODE_TYPES } from "@/lib/node-attr-sets";
import type { EditorState } from "@tiptap/pm/state";
import { InputRule } from "@tiptap/core";
import type { KeyboardShortcutCommand, Node as TiptapNode } from "@tiptap/core";

/** The schema names of the three wrapper nodes, as the registry rows spell
 *  them. */
export type WrapperNodeName = "bulletList" | "orderedList" | "blockquote";

/** The storage key {@link withWrapperGate} stamps — see its doc comment. */
export type WrapperGateStorage = { wrapperGated: true };

/**
 * The wrapper question (tasks 397, 1107): can a WRAPPER (`bulletList` /
 * `orderedList` / `blockquote`) be placed AROUND the blocks the selection spans
 * — without coercing them and without lifting them out of their container?
 *
 * Before 397 the wrapper rows had a node-name gate that asked only about the
 * BLOCK ("is it a paragraph?") and never about the CONTAINER ("can a list live
 * where that paragraph lives?"); 1107 deleted that gate, because this
 * function's layer 1 already answers the block question too (see the module
 * header). The two questions come apart the moment a
 * container's content model is narrower than `block+`: an expex `exampleItem`
 * holds `(paragraph | graphicsBlock | displayMath)+` and no list, so a bullet
 * toggle at a caret inside an item does not wrap it — ProseMirror LIFTS the
 * paragraph out of the item, destroying the item's `\vxid` identity and (because
 * expex numbers items by POSITION) silently renumbering every later item, so
 * every `\ref` into that example points at different text. Nothing throws; the
 * document stays schema-valid.
 *
 * Two layers, both read from the schema, never from a list of node names
 * (after layer 0, the preamble-resident refusal — a round-trip fact the
 * schema cannot state, read from `PREAMBLE_RESIDENT_NODE_TYPES`):
 *
 *   1. **Can the wrapper be placed here at all?** Asked with the COMMIT's own
 *      predicate: `wrapInList` (dry run, no dispatch) for a list — the exact
 *      call `toggleList` makes before deciding to `clearNodes()` — and
 *      `findWrapping` (what `wrapIn` asks) for the quote. Both search for the
 *      whole wrapper CHAIN (`bulletList > listItem`) and answer no when the
 *      container refuses the wrapper OR the wrapper refuses the content, so a
 *      `heading` (which no `listItem` may open with) refuses here and a
 *      `graphicsBlock` (which one may, task 563) does not. Asking PM's own
 *      predicate rather than restating it means the affordance and the commit
 *      can never disagree about what "wrappable" means.
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
  if (rangeEnclosesPreambleResident(range)) return false;
  if (wrapperPlaceable(state, range, wrapperType)) return true;
  return hasSameFamilyAncestor($from, range, wrapperType);
}

/**
 * Layer 0 of `selectionHostsWrapper` (task 1107): would the wrapper enclose a
 * block whose LaTeX home is the preamble? The schema admits a `titleField`
 * wherever `block` goes, but its body serialization is empty — a quote around a
 * title saves as an empty `\begin{quote}\end{quote}` and the title is re-hoisted
 * to the doc top on reload. Refused for every wrapper: a list could otherwise
 * take a title as a non-first item child in a mixed selection.
 */
function rangeEnclosesPreambleResident(range: NodeRange): boolean {
  for (let i = range.startIndex; i < range.endIndex; i += 1) {
    if (PREAMBLE_RESIDENT_NODE_TYPES.has(range.parent.child(i).type.name)) return true;
  }
  return false;
}

/**
 * Layer 1 of `selectionHostsWrapper`, asked with the predicate the wrapper's
 * own COMMIT asks. A list is recognised by its schema group (`"list"`), the same
 * derivation TipTap's `isList` makes when `toggleList` picks its branch.
 */
function wrapperPlaceable(state: EditorState, range: NodeRange, wrapperType: NodeType): boolean {
  if (wrapperType.isInGroup("list")) return wrapInList(wrapperType)(state);
  return findWrapping(range, wrapperType) !== null;
}

/**
 * Layer 2 of `selectionHostsWrapper`: does the affected block range sit inside a
 * container of `wrapperType`'s own family — i.e. an ancestor whose content model
 * accepts the SAME child type the wrapper accepts (`range.parent.type`)? Such an
 * ancestor is the container this toggle removes or replaces, so the toggle is
 * subtractive and needs no home for a new wrapper.
 *
 * Why this exemption cannot let `toggleList` reach `clearNodes()` (task 1107):
 * for a LIST wrapper it passes only when `range.parent` is a `listItem` (the one
 * child a list hosts), so the range's depth is one below a list — exactly the
 * `range.depth - parentList.depth <= 1` condition under which `toggleList` takes
 * its lift / change-type branch and never its wrap-or-clear branch.
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
 * task 321 for drop decisions. Identity and container are one derivation since
 * task 1107 (`selectionHostsWrapper`).
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
 * list-coercion refusal (a heading, a title field) and any future rung land here
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

/**
 * **THE door a wrapper node enters the schema through** (task 731). Takes one
 * of the three wrapper extensions and returns it with BOTH of its ungated
 * surfaces — the `Mod-Shift-8/7/b` chord and the `- ` / `1. ` / `> ` markdown
 * rule — routed through {@link wrapperSafeInState}, and nothing else changed.
 *
 * Task 427 landed the two hooks by hand inside `editor-extensions.ts`'s three
 * `.extend()`ed factories, which made "is this wrapper gated?" a property of
 * WHICH STACK you happen to be on. The card bodies (`RichTextField`,
 * `BorrowedMainText`, `renderBorrowed`) mount their wrappers by INHERITANCE —
 * `StarterKit.configure(...)` with the keys left on — so they reached the same
 * commands with the stock, ungated bindings: the card-body toolbar greyed its
 * bullet button on a `codeBlock` while `Mod-Shift-8` coerced that same block
 * into a list item. Two halves of one surface disagreeing is exactly the
 * block-identity loss 397/427 exist to prevent.
 *
 * So the gating moves OFF the stack and ONTO the node: every surface turns the
 * three StarterKit keys OFF and registers `withWrapperGate(X, "x")` instead,
 * and the census in `wrapper-surfaces-guard.test.ts` MOUNTS each stack and
 * presses the chord rather than grepping for a call site it can only see when
 * the call is spelled out (the inherited mount was invisible to the needle, so
 * the guard passed vacuously).
 *
 * Wrapping is composable: a caller may `.extend()` the result further (the main
 * editor adds its attrs / NodeView on top) — the gate's `this.parent?.()` still
 * resolves to the BASE extension's own bindings.
 */
export function withWrapperGate<O, S>(
  node: TiptapNode<O, S>,
  wrapperNodeName: WrapperNodeName,
): TiptapNode<O, S & WrapperGateStorage> {
  return node.extend<O, S & WrapperGateStorage>({
    addKeyboardShortcuts() {
      return guardWrapperShortcuts(this.parent?.() ?? {}, wrapperNodeName, () => this.editor?.state);
    },
    addInputRules() {
      return guardWrapperInputRules(this.parent?.() ?? [], wrapperNodeName);
    },
    // The census MARK. `wrapper-surfaces-guard.test.ts` mounts every declared
    // stack and reads `editor.storage[name].wrapperGated` for each of the three
    // wrapper nodes the stack's schema actually has — a source-regex census
    // could not see a wrapper mounted by INHERITANCE (`StarterKit.configure`
    // with the key left on) and so passed vacuously while the card bodies ran
    // ungated for two tasks. It is set HERE, in the same three lines that do
    // the gating, so the mark cannot be present without the gate; that the mark
    // MEANS refusal is proven behaviourally by the chord/input-rule legs.
    addStorage() {
      return { ...(this.parent?.() as S), wrapperGated: true as const };
    },
  });
}
