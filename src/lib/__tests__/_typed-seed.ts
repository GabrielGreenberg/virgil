import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

/**
 * Seed `text` at `pos` AS TYPING — one text insertion with the caret left at
 * its end (or at `pos + caretOffset`) — rather than as loaded content.
 *
 * Task 1562: a typed-LaTeX rule completes only an opener the user typed in the
 * current run (a `$` parsed from the file's `\$` is prose, not source). So a
 * test that fires a rule's CLOSER must type the opener first; seeding
 * `\cite{k` as document content now exercises the "file text" refusal, not
 * the rule. Use this for the opener, then fire the trigger as before.
 */
export function seedTyped(
  editor: Editor,
  pos: number,
  text: string,
  caretOffset = text.length,
): void {
  const tr = editor.state.tr;
  if (text) tr.insertText(text, pos);
  editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + caretOffset)));
}
