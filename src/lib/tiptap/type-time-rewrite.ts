/**
 * "A type-time rewrite is its own undo step" (task 1098).
 *
 * Autocorrect (`teh ` → `the `), smart quotes (`"` → `“`) and the dash rules
 * (`--` → `–`) all REWRITE what the user just typed, the instant the trigger
 * character lands. Each used to do it in the input rule's one transaction —
 * trigger and rewrite together — and that transaction is adjacent to the
 * keystrokes before it and lands inside `newGroupDelay`, so prosemirror-history
 * MERGED it into the typing group. Cmd+Z then removed the whole burst (`abc teh `
 * and all), where every text system the user knows gives back the typed bytes.
 *
 * The door below lands a rewrite in TWO transactions:
 *
 *  1. the input rule's own transaction inserts the trigger exactly as the
 *     browser would have — an ordinary keystroke, joining the typing group;
 *  2. an APPENDED transaction performs the rewrite behind `closeHistory`, so it
 *     opens a history event of its own.
 *
 * Undo therefore restores the typed bytes exactly (`abc teh `), and a second
 * undo removes the typing. Backspace keeps its contract — TipTap's
 * `undoInputRule` reverts "the last input rule" from the input-rules plugin's
 * state, and the appended transaction records ITSELF there (from === to, no
 * text), so inverting it restores the same typed bytes.
 *
 * Cost: one meta read per transaction in `appendTransaction`; O(1).
 */

import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";

/** A rewrite of `[from, to)` — positions in the doc AFTER the trigger lands. */
interface PendingRewrite {
  from: number;
  to: number;
  text: string;
}

export interface TypeTimeRewriter {
  /**
   * From inside an `InputRule` handler: rewrite the run `[runFrom, end of the
   * trigger)` to `text`, where `trigger` is the character the rule fires on —
   * the tail of `match[0]`, not yet in the document. `range` is the handler's.
   */
  land(
    state: EditorState,
    range: { from: number; to: number },
    match: RegExpMatchArray,
    trigger: string,
    runFrom: number,
    text: string,
  ): void;
  /** The plugin that lands the rewrite; the extension mounts it. */
  plugin(): Plugin;
}

export function createTypeTimeRewriter(name: string): TypeTimeRewriter {
  const key = new PluginKey<null>(`typeTimeRewrite:${name}`);
  return {
    land(state, range, match, trigger, runFrom, text) {
      const tr = state.tr;
      // Where the trigger itself was typed. Normal typing sends the trigger
      // alone, over the selection; anything else (a multi-character input the
      // rule matched across) cannot be split into "the typed bytes" and "the
      // rewrite", so it falls back to the one-transaction rewrite.
      const inputFrom = range.from + match[0].length - trigger.length;
      const { selection } = state;
      if (
        inputFrom < runFrom ||
        selection.from !== inputFrom ||
        selection.to !== range.to
      ) {
        tr.insertText(text, runFrom, range.to);
        return;
      }
      tr.insertText(trigger, inputFrom, range.to);
      tr.setMeta(key, {
        from: runFrom,
        to: inputFrom + trigger.length,
        text,
      } satisfies PendingRewrite);
    },

    plugin() {
      return new Plugin({
        key,
        appendTransaction(trs, _old, newState) {
          let pending: PendingRewrite | null = null;
          let i = trs.length - 1;
          for (; i >= 0; i--) {
            pending = trs[i].getMeta(key) ?? null;
            if (pending) break;
          }
          if (!pending) return null;
          // Map through anything applied after the rule's transaction.
          let { from, to } = pending;
          for (let j = i + 1; j < trs.length; j++) {
            from = trs[j].mapping.map(from, 1);
            to = trs[j].mapping.map(to, -1);
          }
          if (to < from) return null;
          if (newState.doc.textBetween(from, to) === pending.text) return null;
          const out = closeHistory(newState.tr);
          out.insertText(pending.text, from, to);
          // Backspace's `undoInputRule` reads "the last input rule" from the
          // input-rules plugin's state — the same marker it searches by.
          const inputRules = newState.plugins.find(
            (p) => (p.spec as { isInputRules?: boolean }).isInputRules,
          );
          if (inputRules) {
            const end = from + pending.text.length;
            out.setMeta(inputRules, { transform: out, from: end, to: end, text: "" });
          }
          return out;
        },
      });
    },
  };
}
