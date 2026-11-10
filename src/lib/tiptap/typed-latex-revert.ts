import { PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { Slice } from "@tiptap/pm/model";
import { ReplaceStep, type Step } from "@tiptap/pm/transform";
import { collabReadOnly } from "./collab-read-only-gate";
import type { TypedLatexActionId, TypedSubject } from "./typed-latex-input-rules";
import { isImeComposing } from "@/lib/key-intent";

/**
 * THE typed-LaTeX revert contract (task 991) — "Backspace right after a typed
 * conversion gives back what you typed", for every rule in
 * `TYPED_LATEX_INPUT_RULES`.
 *
 * ## Why this exists
 *
 * The typed surface has two providers. StarterKit's markdown rules (`- `,
 * `> `, `1. `) are TipTap `InputRule`s, and TipTap core's Backspace runs
 * `undoInputRule()` first — so `- ` then Backspace hands back the literal
 * `- `. Virgil's five gated `handleTextInput` rules dispatched a plain
 * `replaceWith` that nothing remembered, so Backspace deleted the new atom
 * (`$5 and $` → the whole formula gone) or did nothing useful (`%` → the
 * comment dissolved and the `%` was lost). One surface, two behaviours, and no
 * "keep it literal" escape for an unwanted conversion.
 *
 * ## The contract
 *
 * Each rule spreads `typedLatexRevertSpec(id, keyName)` into its own input
 * plugin (key, state, and the two DOM handlers) and passes its conversion
 * transaction through `armTypedLatexRevert(tr, key, from, to, text)` before
 * dispatching it. Arming records the INVERSE of the conversion's first replace step (what
 * PM's own undo would apply) plus the typed trigger character, which never
 * landed. The record stays armed only while nothing else happens:
 *
 *   - any transaction that moves the caret off its post-conversion spot, or
 *     grows/shrinks the converted range (typing into a new comment), disarms;
 *     follow-up transactions that only RE-ATTRIBUTE nodes in place (uuid
 *     minting, the footnote numberer) keep it, mapped;
 *   - focus leaving the editor disarms — "immediately after" means without
 *     going anywhere. This is also what keeps the card-creating rules honest:
 *     a typed `\footnote{…}` / `\cite{…}` moves focus into its new card, so
 *     the main editor's Backspace can never revert an atom whose card the
 *     user is already looking at (no orphan card from a revert).
 *
 * Backspace (no modifiers, not composing, not collab read-only) while armed
 * applies the inverse and re-inserts the typed text, caret after it — exactly
 * the doc the user would have had if the rule had not fired. A second
 * Backspace is ordinary.
 *
 * It runs from `handleDOMEvents.keydown`, which PM consults BEFORE every
 * `handleKeyDown` prop — so the revert outranks the atom keymaps and
 * `latex-comment`'s own Backspace (which would dissolve an empty comment and
 * drop the `%`), whatever the extension order.
 *
 * KEYSTROKE SANCTITY: `apply` is O(1) per transaction (map one step + one
 * position); the blur handler dispatches only when armed.
 */

interface ArmedRevert {
  /** Inverse of the conversion's replace step, in the CURRENT doc's coords. */
  inverse: Step;
  /** Size of the converted range — a change means the user edited inside it. */
  span: number;
  /** Where the caret must still be for the revert to stay armed. */
  caret: number;
  /** Offset of the typed text's insertion point from `inverse`'s start, in the
   *  restored (pre-conversion) doc. */
  textOffset: number;
  /** Length of the selection the typed text replaced (usually 0). */
  replacedLength: number;
  /** The trigger character(s) the rule consumed instead of inserting. */
  text: string;
}

/**
 * The TYPED RUN (task 1562): the contiguous range the user has typed, as one
 * uninterrupted run of text input, ending at (or around) the caret.
 *
 * A typed-LaTeX rule reinterprets characters as SOURCE — but only characters
 * the user TYPED as source are source. Text loaded from the file is
 * already-interpreted prose: the parser turned `\$40` into the literal `$40`
 * and the serializer re-escapes it on save, so the model text holds a bare
 * `$` that the escape check (task 1368) cannot tell from a typed one. Without
 * this, typing `, discounted to $` after a parsed `\$40 per page` made
 * `40 per page, discounted to ` a math chip and the saved source lost its
 * `\$`. The run is the provenance the model text lacks: a rule's OPENER must
 * lie inside it (`matchTypedLatexRule`).
 *
 * Grows only by text-only replace steps inside (or contiguous with) it; a
 * text insertion elsewhere starts a new run; paste/drop/cut, undo/redo and a
 * typed-LaTeX revert (the user's "keep it literal") end it; any other change
 * maps it; a caret that leaves it (arrowing away, clicking) ends it. So `$x`,
 * arrow away and back, then `$` does NOT convert — the whole construct was not
 * typed in one run. O(1) per transaction (one step inspected, two positions
 * mapped).
 */
interface TypedRun {
  from: number;
  to: number;
}

/** Per-plugin state: the armed revert plus the typed run. */
interface TypedInputState {
  armed: ArmedRevert | null;
  run: TypedRun | null;
}

const DISARM = "disarm";

/** Meta every revert transaction carries, so a NORMALIZER that would
 *  re-convert the literal (`latexCommentNormalize` turns a `%` / `% …`
 *  paragraph back into a comment) can stand down for exactly that change. */
const REVERT_META = "typedLatexRevert";

/** True iff `tr` is a typed-LaTeX revert (see `REVERT_META`). */
export function isTypedLatexRevert(tr: Transaction): boolean {
  return tr.getMeta(REVERT_META) === true;
}

type RevertMeta = ArmedRevert | typeof DISARM;

/** The span the inverse step covers in the current doc. */
function stepSpan(step: Step): number | null {
  return step instanceof ReplaceStep ? step.to - step.from : null;
}

/**
 * Record `tr` (a typed-LaTeX conversion, not yet dispatched) as revertible.
 * `typedFrom`/`typedTo` are the `handleTextInput` range, `text` the typed
 * trigger. A transaction whose first step is not a plain replace is left
 * unarmed (Backspace then behaves as before) rather than guessed at.
 */
export function armTypedLatexRevert(
  tr: Transaction,
  key: PluginKey,
  typedFrom: number,
  typedTo: number,
  text: string,
): Transaction {
  const first = tr.steps[0];
  if (!(first instanceof ReplaceStep)) return tr;
  if (typedFrom < first.from || typedTo > first.to) return tr;
  let inverse: Step | null = first.invert(tr.docs[0]);
  // Rebase past the transaction's own later steps (the footnote numberer).
  inverse = inverse.map(tr.mapping.slice(1));
  const span = inverse ? stepSpan(inverse) : null;
  if (!inverse || span === null) return tr;
  const meta: RevertMeta = {
    inverse,
    span,
    caret: tr.selection.head,
    textOffset: typedFrom - first.from,
    replacedLength: typedTo - typedFrom,
    text,
  };
  return tr.setMeta(key, meta);
}

function applyRevertState(
  key: PluginKey,
  tr: Transaction,
  prev: ArmedRevert | null,
): ArmedRevert | null {
  const meta = tr.getMeta(key) as RevertMeta | undefined;
  if (meta === DISARM) return null;
  if (meta) return meta;
  if (!prev) return null;
  if (!tr.docChanged && !tr.selectionSet) return prev;
  const inverse = tr.docChanged ? prev.inverse.map(tr.mapping) : prev.inverse;
  if (!inverse || stepSpan(inverse) !== prev.span) return null;
  const caret = tr.docChanged ? tr.mapping.map(prev.caret, -1) : prev.caret;
  const sel = tr.selection;
  if (!sel.empty || sel.head !== caret) return null;
  return inverse === prev.inverse && caret === prev.caret
    ? prev
    : { ...prev, inverse, caret };
}

/** A slice of plain text (or nothing) — what a keystroke inserts. */
function isTextSlice(slice: Slice): boolean {
  if (slice.openStart !== 0 || slice.openEnd !== 0) return false;
  for (let i = 0; i < slice.content.childCount; i += 1) {
    if (!slice.content.child(i).isText) return false;
  }
  return true;
}

function applyTypedRun(tr: Transaction, prev: TypedRun | null): TypedRun | null {
  let run = prev;
  if (tr.docChanged) {
    const step = tr.steps.length === 1 ? tr.steps[0] : null;
    if (tr.getMeta("uiEvent") || tr.getMeta("history$") || isTypedLatexRevert(tr)) {
      run = null;
    } else if (step instanceof ReplaceStep && isTextSlice(step.slice)) {
      const size = step.slice.size;
      if (prev && step.from >= prev.from && step.to <= prev.to) {
        // Typing (or deleting) inside the run, its end included.
        run = { from: prev.from, to: prev.to - (step.to - step.from) + size };
      } else if (size > 0) {
        run = { from: step.from, to: step.from + size };
      } else {
        run = mapRun(tr, prev);
      }
    } else {
      run = mapRun(tr, prev);
    }
  }
  if (!run) return null;
  const sel = tr.selection;
  if (!sel.empty || sel.head < run.from || sel.head > run.to) return null;
  return prev && prev.from === run.from && prev.to === run.to ? prev : run;
}

function mapRun(tr: Transaction, prev: TypedRun | null): TypedRun | null {
  if (!prev) return null;
  const from = tr.mapping.map(prev.from, 1);
  const to = tr.mapping.map(prev.to, -1);
  return from <= to ? { from, to } : null;
}

/**
 * The subject a typed-LaTeX rule matches against: the caret's textblock text
 * in the `window` characters before `from` (inline atoms as U+FFFC, one
 * character per position), plus `text` — the trigger, for the rules whose
 * pattern includes it — and the index where the TYPED RUN begins in it. A
 * rule built from this cannot forget the provenance half of the match door.
 */
export function typedSubjectBefore(
  state: EditorState,
  key: PluginKey,
  from: number,
  window: number,
  text = "",
): TypedSubject {
  const $from = state.doc.resolve(from);
  const before = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - window),
    $from.parentOffset,
    undefined,
    "\ufffc",
  );
  const start = from - before.length;
  const run = (key.getState(state) as TypedInputState | undefined)?.run ?? null;
  const typedFrom =
    run && run.from <= from && from <= run.to
      ? Math.max(0, run.from - start)
      : before.length;
  return { text: before + text, typedFrom };
}

/** Build the revert transaction for `state`, or null when nothing is armed. */
export function typedLatexRevertTr(state: EditorState, key: PluginKey): Transaction | null {
  const armed = (key.getState(state) as TypedInputState | undefined)?.armed;
  if (!armed) return null;
  const tr = state.tr;
  if (tr.maybeStep(armed.inverse).failed) return null;
  const start = (armed.inverse as ReplaceStep).from;
  const at = start + armed.textOffset;
  tr.insertText(armed.text, at, at + armed.replacedLength);
  tr.setSelection(TextSelection.create(tr.doc, at + armed.text.length));
  tr.setMeta(key, DISARM);
  tr.setMeta(REVERT_META, true);
  tr.scrollIntoView();
  return tr;
}

function isPlainBackspace(event: KeyboardEvent): boolean {
  return (
    event.key === "Backspace" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !isImeComposing(event)
  );
}

/**
 * The plugin-spec half every typed-LaTeX input plugin spreads in: its `key`
 * (named `keyName`, the plugin's existing name), the one-transaction revert
 * `state`, and the Backspace / blur `handleDOMEvents`. `id` is the census
 * entry the plugin implements — `typed-latex-census.test.ts` asserts every
 * censused rule calls this with its own id, so a sixth rule cannot ship
 * without a revert.
 *
 * The same state also tracks the rule's TYPED RUN (task 1562, `TypedRun`
 * above), which `typedSubjectBefore` hands to the match door — so a rule that
 * installs its revert has, by the same spread, the provenance half of the door.
 */
export function typedLatexRevertSpec(id: TypedLatexActionId, keyName: string) {
  void id;
  const key = new PluginKey<TypedInputState>(keyName);
  return {
    key,
    state: {
      init: (): TypedInputState => ({ armed: null, run: null }),
      apply: (tr: Transaction, prev: TypedInputState): TypedInputState => {
        const armed = applyRevertState(key, tr, prev.armed);
        const run = applyTypedRun(tr, prev.run);
        return armed === prev.armed && run === prev.run ? prev : { armed, run };
      },
    },
    handleDOMEvents: {
      keydown(view: EditorView, event: KeyboardEvent): boolean {
        if (!isPlainBackspace(event) || view.composing) return false;
        if (collabReadOnly(view)) return false;
        const tr = typedLatexRevertTr(view.state, key);
        if (!tr) return false;
        view.dispatch(tr);
        event.preventDefault();
        return true;
      },
      blur(view: EditorView): boolean {
        if (key.getState(view.state)?.armed) {
          view.dispatch(view.state.tr.setMeta(key, DISARM).setMeta("addToHistory", false));
        }
        return false;
      },
    },
  };
}
