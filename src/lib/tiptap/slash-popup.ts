import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { COMMAND_MAP, VIRGIL_COMMAND_NAMES } from "./commands";
import { slashPopupStore, type SlashPopupState } from "@/lib/slash-popup-store";

const META_KEY = "slashPopup";

interface OpenState {
  open: true;
  slashPos: number;
  query: string;
  selectedIndex: number;
  filtered: string[];
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

function executeSelection(view: EditorView, state: OpenState): boolean {
  const name = state.filtered[state.selectedIndex];
  if (!name) return false;
  const cmd = COMMAND_MAP.get(name);
  if (!cmd) return false;
  const cursor = view.state.selection.from;
  const tr = view.state.tr
    .delete(state.slashPos, cursor)
    .setMeta(META_KEY, { open: false } as PluginState);
  view.dispatch(tr);
  cmd.action(view, "\\" + name);
  return true;
}

const slashPopupKey = new PluginKey<PluginState>("slashPopup");

const CLOSED: PluginState = { open: false };

/**
 * Re-derive state after any non-meta transaction while the popup is
 * open. Reads the live text between `slashPos` and the cursor in the
 * new doc, validates that it still looks like `\[a-zA-Z]*$`, updates
 * the query + filtered list. Returns CLOSED if anything is off.
 */
function reSync(value: OpenState, newDoc: any, mappedSlashPos: number, cursor: number): PluginState {
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
    return { ...value, slashPos: mappedSlashPos };
  }
  const filtered = filterByPrefix(tail);
  if (filtered.length === 0) return CLOSED;
  return {
    open: true,
    slashPos: mappedSlashPos,
    query: tail,
    selectedIndex: 0,
    filtered,
  };
}

export const SlashPopupExtension = Extension.create({
  name: "slashPopup",

  addProseMirrorPlugins() {
    return [
      new Plugin<PluginState>({
        key: slashPopupKey,
        state: {
          init(): PluginState {
            return CLOSED;
          },
          apply(tr, value): PluginState {
            const meta = tr.getMeta(META_KEY) as PluginState | undefined;
            if (meta) {
              slashPopupStore.set(meta);
              return meta;
            }
            if (!value.open) return value;
            const mappedSlashPos = tr.mapping.map(value.slashPos, -1);
            const next = reSync(value, tr.doc, mappedSlashPos, tr.selection.from);
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
            view.dispatch(
              view.state.tr.setMeta(META_KEY, {
                open: true,
                slashPos: from,
                query: "",
                selectedIndex: 0,
                filtered: filterByPrefix(""),
              } as PluginState),
            );
            return false;
          },

          handleKeyDown(view, event) {
            const cur = slashPopupKey.getState(view.state);
            if (!cur || !cur.open) return false;

            if (event.key === "ArrowDown") {
              event.preventDefault();
              const n = cur.filtered.length;
              if (n === 0) return true;
              view.dispatch(
                view.state.tr.setMeta(META_KEY, {
                  ...cur,
                  selectedIndex: (cur.selectedIndex + 1) % n,
                } as PluginState),
              );
              return true;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              const n = cur.filtered.length;
              if (n === 0) return true;
              view.dispatch(
                view.state.tr.setMeta(META_KEY, {
                  ...cur,
                  selectedIndex: (cur.selectedIndex - 1 + n) % n,
                } as PluginState),
              );
              return true;
            }

            if (event.key === "Enter" || event.key === "Tab") {
              if (cur.filtered.length === 0) return false;
              event.preventDefault();
              return executeSelection(view, cur);
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
