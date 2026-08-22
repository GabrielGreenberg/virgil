/**
 * The SLASH surface's applicability door — ONE resolution, read by both the
 * OFFER (the popup's row list) and the COMMIT (`executeSelection`).
 *
 * ## Why this module exists (task 398)
 *
 * Of Virgil's four action surfaces, three asked whether an action applies before
 * they offered it — grab asks per row (`DragHandleMenu`), lightning asks per row
 * (`ActionsMenuPanel`, task 397), typed asks at its input rule (`math.ts`) — and
 * the slash popup asked **nothing**. `filterByPrefix` filtered
 * `VIRGIL_COMMAND_NAMES` by typed prefix and rendered the result; the refusal
 * lived downstream, in `runViewOnlyAction`'s / the bridge's `applies()` bail,
 * which runs AFTER `executeSelection` has already dispatched
 * `tr.delete(slashPos, cursor)` as its own transaction.
 *
 * So the refusal was **lossy**: caret in a `latexComment` / `codeBlock` /
 * `titleField`, type `\forest`, press Enter — seven characters vanish, nothing
 * is inserted, nothing is said. The lightning grid's forest cell is correctly
 * greyed at the same caret, so two surfaces routing to ONE `run()` disagreed
 * about ONE gate. That is the "what the hover OFFERS is what the commit
 * ACCEPTS" law (tasks 083 / 258 / 321) with the extra cost that this surface
 * consumed the user's keystrokes on its way to saying no.
 *
 * ## The rule
 *
 * > **A surface that can refuse asks BEFORE it offers, and asks the SAME
 * > question it will ask at the commit.** The verdict is the registry row's own
 * > `applies()`, resolved through `SLASH_NAME_TO_ACTION_ID` — the one place the
 * > slash vocabulary is reconciled with the action vocabulary (and reconciled in
 * > all three directions by `assertActionCoverage`). A refusal costs the user
 * > NOTHING: the typed `\name` stays in the document.
 *
 * Two properties make "the same question" true rather than hopeful:
 *
 *   1. **One CONTEXT constructor.** {@link buildSlashActionContext} is what
 *      `commands.ts`'s `runViewOnlyAction` builds its ctx with too, so the
 *      OFFER's ctx and the view-only COMMIT's ctx are the same object shape from
 *      the same code. (The bridge-routed rows re-ask through
 *      `EditorPane`'s `runAction`, which builds a richer ctx off the live TipTap
 *      editor — every field `applies()` reads is the same one.)
 *   2. **One POSITION.** The offer is asked at the caret with the typed `\name`
 *      still present; the commit is asked after the delete, at `slashPos`. Both
 *      resolve inside the SAME textblock — deleting text never changes a block's
 *      type or its container — so the two positions cannot disagree.
 *
 * ## What the verdict does NOT cover, stated
 *
 * `\cite` and `\footnote` carry bespoke pre-gates in `commands.ts`
 * (`blockKindAllowsAction`, `posHostsInlineAtom`). Those are defence-in-depth
 * for a caller that reaches `action` without consulting a verdict; today they
 * cannot diverge from `applies()` for the containers in play — the card rows'
 * `cardApplies` routes a cursor ref through the SAME `blockRangeAllowsAction`,
 * and `posHostsInlineAtom` only refuses the MARKLESS verbatim blocks, whose
 * curated sets (`MARKLESS_BLOCK_ACTIONS`) already subtract every
 * `INLINE_INSERT_ACTIONS` member. If that coincidence ever breaks, the schema
 * half must move INTO the row's `applies()` (where task 396 put its siblings),
 * not be re-forked here: a second table is what this module deletes.
 */

import type { EditorView } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import {
  SLASH_NAME_TO_ACTION_ID,
  VIRGIL_ACTION_REGISTRY,
  type ActionContext,
} from "@/lib/actions/action-registry";
import { paragraphUuidAt } from "@/links/links";

/**
 * The slash surface's `ActionContext`, built ONCE here so the OFFER and the
 * view-only COMMIT cannot build two.
 *
 * `state` defaults to `view.state`. It is threaded explicitly by the popup
 * plugin's `apply`, which derives the row list from the transaction's NEW state
 * while `view.state` is still the OLD one — a verdict about the doc the user is
 * looking at, not the doc they just left. Only `state.doc` / `state.selection` /
 * `state.schema` are read by any `applies()`, so the synthesized view-like
 * object below is complete for the question; `editable` comes off the real view
 * (it is a view PROP, not state — the in-editor mirror of
 * `collab.canEditMainText`).
 */
export function buildSlashActionContext(
  view: EditorView,
  state?: EditorState,
): ActionContext {
  const target = state ?? view.state;
  // Same view when no override — so the common path passes the REAL view
  // through untouched and nothing is synthesized.
  const viewLike =
    target === view.state
      ? view
      : ({ state: target, editable: view.editable } as unknown as EditorView);
  const pos = target.selection.head;
  return {
    // For a TipTap editor `view === editor.view`; the slash plugin has only the
    // view, so `editor` is filled with the same view-bearing object the registry
    // rows read `state.schema` / `selection` off of.
    editor: {
      view: viewLike,
      state: target,
    } as unknown as ActionContext["editor"],
    view: viewLike,
    ref: {
      kind: "cursor",
      pos,
      paragraphId: paragraphUuidAt(target.doc, pos) ?? "",
    },
    surface: "slash",
    // CHIP 7b's uniform collab read-only gate: `view.editable` is the in-editor
    // mirror of `collab.canEditMainText`. `gateApplies` turns `canEdit === false`
    // into `"disabled"` for EVERY row, so a read-only pane greys the whole popup
    // rather than eating characters on a document it cannot write.
    canEdit: view.editable,
  };
}

/**
 * The verdict for ONE slash command name at this caret — the registry row's own
 * `applies()`.
 *
 * An unmapped name answers `"ok"` (fail OPEN). `SLASH_NAME_TO_ACTION_ID` is
 * total over `VIRGIL_COMMAND_NAMES` and `assertActionCoverage` pins that in all
 * three directions, so this branch is unreachable in a shipped build; failing
 * open keeps a hypothetical unmapped command WORKING rather than silently dead,
 * which is the direction a missing verdict should degrade in — a verdict is only
 * issued when the question can actually be asked (the same fallback every
 * container gate in `action-registry.ts` takes).
 */
export function slashCommandVerdict(
  view: EditorView,
  name: string,
  state?: EditorState,
): "ok" | "disabled" | "absent" {
  const id = SLASH_NAME_TO_ACTION_ID[name];
  if (!id) return "ok";
  const spec = VIRGIL_ACTION_REGISTRY[id];
  if (!spec) return "ok";
  try {
    return spec.applies(buildSlashActionContext(view, state));
  } catch {
    // A gate that throws must never be able to break typing. Fail OPEN — the
    // pre-398 behaviour — rather than greying a whole popup on a defect in one
    // row's predicate.
    return "ok";
  }
}

/**
 * May this command RUN here? `"absent"` is treated as a refusal alongside
 * `"disabled"`: both mean "not applicable at this caret", and the slash surface
 * has only one way to say no. (No row returns `"absent"` for a cursor ref
 * today — `gateApplies` only ever passes an `"absent"` base through, and none of
 * the slash-reachable rows produces one.)
 */
export function slashCommandEnabled(
  view: EditorView,
  name: string,
  state?: EditorState,
): boolean {
  return slashCommandVerdict(view, name, state) === "ok";
}

/**
 * The names among `names` that must render GREYED — the popup's whole verdict,
 * in one call, so the row list and the executor read one array.
 *
 * Greying beats hiding, which is the same choice both menus already made: a
 * command that VANISHES reads as "Virgil doesn't have `\section`", where a greyed
 * one reads as "not here". Returned as a sorted array rather than a Set so the
 * popup store can compare two snapshots by value (`statesEqual`) and skip the
 * re-render that a fresh Set identity would force on every transaction.
 */
export function slashDisabledNames(
  view: EditorView,
  names: readonly string[],
  state?: EditorState,
): string[] {
  const out: string[] = [];
  for (const name of names) {
    if (!slashCommandEnabled(view, name, state)) out.push(name);
  }
  return out;
}

/**
 * The index the popup should SELECT among `names`: the first row that is not
 * greyed, or `0` when every row is greyed.
 *
 * The fallback matters — with every command refused (a caret in a markless
 * verbatim block) the popup still opens and still has a selected row, and Enter
 * on it falls through to the editor's own handler rather than becoming a dead
 * key. See `slash-popup.ts`'s Enter branch.
 */
export function firstEnabledIndex(
  names: readonly string[],
  disabled: readonly string[],
): number {
  const off = new Set(disabled);
  for (let i = 0; i < names.length; i += 1) {
    if (!off.has(names[i]!)) return i;
  }
  return 0;
}

/**
 * The next index in `dir` that is not greyed, starting from `from` and wrapping.
 * Returns `from` when nothing else is selectable (every row greyed, or a
 * single-row list), so arrow keys are inert rather than looping forever.
 */
export function stepEnabledIndex(
  names: readonly string[],
  disabled: readonly string[],
  from: number,
  dir: 1 | -1,
): number {
  const n = names.length;
  if (n === 0) return from;
  const off = new Set(disabled);
  for (let step = 1; step <= n; step += 1) {
    const i = (((from + dir * step) % n) + n) % n;
    if (!off.has(names[i]!)) return i;
  }
  return from;
}
