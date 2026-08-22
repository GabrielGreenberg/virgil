import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { commitSlashCommand, VIRGIL_COMMAND_NAMES } from "./commands";
import { slashPopupStore, type SlashPopupState } from "@/lib/slash-popup-store";
// Task 398 — the slash surface's applicability door. ONE resolution, read by
// the OFFER (`filtered` + `disabled` below) and by the COMMIT
// (`executeSelection`), so the popup can no longer advertise — or CONSUME the
// user's characters for — a command it is about to refuse.
import {
  firstEnabledIndex,
  slashDisabledNames,
  stepEnabledIndex,
} from "./slash-applicability";

const META_KEY = "slashPopup";

interface OpenState {
  open: true;
  slashPos: number;
  query: string;
  selectedIndex: number;
  filtered: string[];
  /** The subset of `filtered` the registry greys at this caret (task 398). */
  disabled: string[];
}
type PluginState = { open: false } | OpenState;

function filterByPrefix(query: string): string[] {
  if (!query) return [...VIRGIL_COMMAND_NAMES];
  const q = query.toLowerCase();
  return VIRGIL_COMMAND_NAMES.filter((n) => n.toLowerCase().startsWith(q));
}

/**
 * Suppress the popup if the cursor is clearly already inside LaTeX:
 *   - inside an unmatched `{` from an earlier command in the paragraph
 *   - the `\` is butted up against another `\name` (no whitespace between)
 * Plain prose anywhere in the paragraph is fair game.
 */
function isFreshPosition(view: EditorView, from: number): boolean {
  const $from = view.state.doc.resolve(from);
  const lookback = Math.min($from.parentOffset, 200);
  const textBefore = $from.parent.textBetween(
    $from.parentOffset - lookback,
    $from.parentOffset,
    undefined,
    "￼",
  );
  let depth = 0;
  for (const ch of textBefore) {
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
  }
  if (depth > 0) return false;
  if (/\\[a-zA-Z]+\*?$/.test(textBefore)) return false;
  return true;
}

/**
 * Run the popup's selected command — the ONE commit door (Enter / Tab from
 * `handleKeyDown`, and a mouse click via {@link executeSlashSelectionAt}).
 *
 * Returns `true` when the command RAN (the typed `\name` was deleted and the
 * action dispatched), `false` when it was refused. A refusal leaves the
 * document **byte-identical** and closes the popup — see the ordering note
 * below.
 *
 * ## The ordering IS the fix (task 398)
 *
 * This function used to dispatch `tr.delete(slashPos, cursor)` FIRST and call
 * `cmd.action` second; the action's own `applies()` bail (`runViewOnlyAction`,
 * or the bridge's `runAction`) then refused a command that could not run here —
 * *after* the user's characters were already gone. Seven keystrokes vanished and
 * nothing was said. Ask BEFORE you delete, and a refusal costs nothing.
 *
 * The verdict is read off the plugin state's `disabled` list, which is derived
 * from the SAME `applies()` the popup rendered its greyed rows from — so the
 * offer and the commit cannot disagree. It is re-derived on every transaction
 * while the popup is open, so it is never stale at Enter time.
 *
 * ## Residual, stated rather than implied
 *
 * The delete and the action are still TWO transactions, so a SUCCESSFUL command
 * is two undo steps (Cmd+Z removes the inserted block and leaves a document the
 * `\name` has already left). Folding them into one requires threading a
 * pre-built `tr` through every `cmd.action` — including the bridge-routed rows,
 * whose transaction is built later in React-land — which is wider than this
 * pass. The LOSSY half (a refusal that ate the text) is what mattered and is
 * closed here.
 */
function executeSelection(view: EditorView, state: OpenState): boolean {
  const name = state.filtered[state.selectedIndex];
  if (!name) return false;
  // The verdict is `state.disabled` — the popup's OWN rendered list — so the
  // row the user pressed Enter on and the row this refuses are the same row.
  // `commitSlashCommand` re-asks the live view as the second half of the same
  // question (it reads the same door), which is what covers a view that went
  // read-only between the last render and the key.
  if (state.disabled.includes(name)) {
    closePopup(view);
    return false;
  }
  const cursor = view.state.selection.from;
  const ran = commitSlashCommand(view, name, state.slashPos, cursor, (tr) =>
    tr.setMeta(META_KEY, { open: false } as PluginState),
  );
  if (!ran) closePopup(view);
  return ran;
}

/** Close the popup without touching the document. */
function closePopup(view: EditorView): void {
  const cur = slashPopupKey.getState(view.state);
  if (cur?.open) view.dispatch(view.state.tr.setMeta(META_KEY, CLOSED));
}

const slashPopupKey = new PluginKey<PluginState>("slashPopup");

const CLOSED: PluginState = { open: false };

/**
 * Re-derive state after any non-meta transaction while the popup is
 * open. Reads the live text between `slashPos` and the cursor in the
 * new doc, validates that it still looks like `\[a-zA-Z]*$`, updates
 * the query + filtered list. Returns CLOSED if anything is off.
 *
 * Task 398: it also re-derives the `disabled` verdict, from the transaction's
 * NEW state (`view.state` is still the OLD one inside `apply`) — so the greyed
 * rows describe the document the user is looking at. It is re-derived even when
 * the query is UNCHANGED, because the caret can move and the doc can change
 * under an open popup without a single character of the query changing, and a
 * stale verdict is exactly the two-tables defect this closes.
 */
function reSync(
  value: OpenState,
  newState: EditorState,
  view: EditorView | null,
  mappedSlashPos: number,
): PluginState {
  const newDoc = newState.doc;
  const cursor = newState.selection.from;
  if (mappedSlashPos < 0 || mappedSlashPos >= newDoc.content.size) return CLOSED;
  if (cursor < mappedSlashPos) return CLOSED;

  let $slash, $cur;
  try {
    $slash = newDoc.resolve(mappedSlashPos);
    $cur = newDoc.resolve(cursor);
  } catch {
    return CLOSED;
  }
  if ($slash.parent !== $cur.parent) return CLOSED;

  const text = $slash.parent.textBetween(
    $slash.parentOffset,
    $cur.parentOffset,
    undefined,
    "￼",
  );
  if (!text.startsWith("\\")) return CLOSED;
  const tail = text.slice(1);
  if (!/^[a-zA-Z]*$/.test(tail)) return CLOSED;

  if (tail === value.query) {
    const disabled = verdictFor(view, value.filtered, newState);
    if (sameNames(disabled, value.disabled)) {
      return { ...value, slashPos: mappedSlashPos };
    }
    return {
      ...value,
      slashPos: mappedSlashPos,
      disabled,
      // Keep the user's own arrow selection where it is unless the row it sits
      // on just went grey; then fall back to the first live row.
      selectedIndex: disabled.includes(value.filtered[value.selectedIndex]!)
        ? firstEnabledIndex(value.filtered, disabled)
        : value.selectedIndex,
    };
  }
  const filtered = filterByPrefix(tail);
  if (filtered.length === 0) return CLOSED;
  const disabled = verdictFor(view, filtered, newState);
  return {
    open: true,
    slashPos: mappedSlashPos,
    query: tail,
    // Land on the first row Enter can actually RUN — never on a greyed one.
    selectedIndex: firstEnabledIndex(filtered, disabled),
    filtered,
    disabled,
  };
}

/**
 * The verdict for a row list. Split out so the state-derivation sites cannot
 * each grow their own call — and so the view-less case (a state applied before
 * the plugin view exists, or after it was destroyed) has ONE answer: no verdict,
 * nothing greyed. That is the fail-open direction every container gate in
 * `action-registry.ts` takes, and it costs nothing here: `executeSelection`
 * re-asks the live view before it deletes anything.
 */
function verdictFor(
  view: EditorView | null,
  names: readonly string[],
  state?: EditorState,
): string[] {
  if (!view) return [];
  return slashDisabledNames(view, names, state);
}

/** Value-compare two name lists (both are built in `filtered` order). */
function sameNames(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export const SlashPopupExtension = Extension.create({
  name: "slashPopup",

  addProseMirrorPlugins() {
    // The live view for THIS editor. `addProseMirrorPlugins` runs once per
    // Editor instance, so this closure is per-editor — never a module singleton
    // that a second pane could clobber (the multi-doc keep-alive rule).
    //
    // The state field needs it for ONE thing the state cannot answer:
    // `view.editable`, the in-editor mirror of `collab.canEditMainText`, which
    // is a view PROP and not part of `EditorState`. Everything else the verdict
    // reads (doc / selection / schema) comes from the transaction's NEW state,
    // NOT from `view.state` — inside `apply` the view still holds the OLD one.
    let pluginView: EditorView | null = null;
    return [
      new Plugin<PluginState>({
        key: slashPopupKey,
        state: {
          init(): PluginState {
            return CLOSED;
          },
          apply(tr, value, _oldState, newState): PluginState {
            const meta = tr.getMeta(META_KEY) as PluginState | undefined;
            if (meta) {
              slashPopupStore.set(meta);
              return meta;
            }
            if (!value.open) return value; // closed ⇒ O(1); no verdict work while typing
            const mappedSlashPos = tr.mapping.map(value.slashPos, -1);
            const next = reSync(value, newState, pluginView, mappedSlashPos);
            slashPopupStore.set(next);
            return next;
          },
        },
        props: {
          handleTextInput(view, from, _to, text) {
            const cur = slashPopupKey.getState(view.state);
            if (cur && cur.open) return false;
            if (text !== "\\") return false;
            if (!isFreshPosition(view, from)) return false;
            const filtered = filterByPrefix("");
            // Ask the registry BEFORE the popup is ever painted, so the first
            // frame already shows which commands can run here (task 398). The
            // `\\` itself has not been inserted yet — we return false and let PM
            // insert it — but the caret's containing block is what the verdict
            // reads, and a text insert cannot change that.
            const disabled = verdictFor(view, filtered);
            view.dispatch(
              view.state.tr.setMeta(META_KEY, {
                open: true,
                slashPos: from,
                query: "",
                selectedIndex: firstEnabledIndex(filtered, disabled),
                filtered,
                disabled,
              } as PluginState),
            );
            return false;
          },

          handleKeyDown(view, event) {
            const cur = slashPopupKey.getState(view.state);
            if (!cur || !cur.open) return false;

            // Arrow navigation SKIPS greyed rows — the same visible-disabled
            // idiom `MenuActionRow` / the lightning grid already use, so the
            // roving selection can only ever sit on a command Enter can run.
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const n = cur.filtered.length;
              if (n === 0) return true;
              const next = stepEnabledIndex(
                cur.filtered,
                cur.disabled,
                cur.selectedIndex,
                event.key === "ArrowDown" ? 1 : -1,
              );
              if (next !== cur.selectedIndex) {
                view.dispatch(
                  view.state.tr.setMeta(META_KEY, {
                    ...cur,
                    selectedIndex: next,
                  } as PluginState),
                );
              }
              return true;
            }

            if (event.key === "Enter" || event.key === "Tab") {
              if (cur.filtered.length === 0) return false;
              event.preventDefault();
              // The key is CONSUMED either way, and that is a decision rather
              // than an accident: activating a disabled control does nothing —
              // the idiom both menus already use — so a refusal leaves the
              // document byte-identical instead of trading the eaten `\name`
              // for a surprise paragraph split from the editor's own Enter.
              // The popup closes on the refusal, so the user's NEXT Enter is
              // an ordinary one.
              executeSelection(view, cur);
              return true;
            }

            if (event.key === "Escape") {
              event.preventDefault();
              view.dispatch(view.state.tr.setMeta(META_KEY, CLOSED));
              return true;
            }

            return false;
          },
        },
        view(view) {
          // Publish the live view to the state field (see the closure above) —
          // it is the ONLY source of `view.editable`, and a verdict that could
          // not read it would leave the popup offering commands a read-only pane
          // will refuse.
          pluginView = view;
          const onBlur = () => {
            const cur = slashPopupKey.getState(view.state);
            if (cur && cur.open) {
              view.dispatch(view.state.tr.setMeta(META_KEY, CLOSED));
            }
          };
          view.dom.addEventListener("blur", onBlur);
          return {
            destroy() {
              view.dom.removeEventListener("blur", onBlur);
              if (pluginView === view) pluginView = null;
              const cur = slashPopupKey.getState(view.state);
              if (cur && cur.open) {
                slashPopupStore.set(CLOSED);
              }
            },
          };
        },
      }),
    ];
  },
});

export function executeSlashSelectionAt(view: EditorView, index: number): boolean {
  const cur = slashPopupKey.getState(view.state);
  if (!cur || !cur.open) return false;
  const adjusted: OpenState = { ...cur, selectedIndex: index };
  return executeSelection(view, adjusted);
}

export { slashPopupKey };
export type { SlashPopupState };
