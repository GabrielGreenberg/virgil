/**
 * The main editor's "Start writing..." placeholder, at O(1) per view update.
 *
 * TipTap's stock `Placeholder` recomputes its decorations with a
 * `doc.descendants` walk over every top-level block on EVERY view update —
 * i.e. on every keystroke — to find the one empty textblock that holds the
 * caret (task 1127 found it while counting the expex renumberer's walks; a
 * keystroke-sanctity violation of the same class). With the options the main
 * editor uses (`showOnlyCurrent: true`, `includeChildren: false`) the answer
 * can only be a TOP-LEVEL textblock whose span contains the selection anchor —
 * at most two of them (the anchor can sit on a boundary) — so this resolves
 * the anchor and asks those, emitting exactly the decorations the stock plugin
 * would.
 *
 * Only the main surface mounts it (`buildEditorExtensions`); options are the
 * stock extension's, so `configure({ placeholder })` is unchanged.
 */

import { isNodeEmpty } from "@tiptap/core";
import Placeholder from "@tiptap/extension-placeholder";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const CaretPlaceholder = Placeholder.extend({
  addProseMirrorPlugins() {
    const options = this.options;
    const editor = this.editor;
    const dataAttribute = `data-${options.dataAttribute || "placeholder"}`;
    return [
      new Plugin({
        key: new PluginKey("placeholder"),
        props: {
          // [cost: O(1)/view update — one resolve + at most two top-level children]
          decorations: ({ doc, selection }) => {
            if (!editor.isEditable && options.showOnlyWhenEditable) return null;
            const { anchor } = selection;
            const $anchor = doc.resolve(anchor);
            const index = $anchor.index(0);
            const decorations: Decoration[] = [];
            for (const i of [index - 1, index]) {
              if (i < 0 || i >= doc.childCount) continue;
              const node = doc.child(i);
              if (!node.isTextblock || !isNodeEmpty(node)) continue;
              const pos = $anchor.posAtIndex(i, 0);
              if (anchor < pos || anchor > pos + node.nodeSize) continue;
              const classes = [options.emptyNodeClass];
              if (editor.isEmpty) classes.push(options.emptyEditorClass);
              decorations.push(
                Decoration.node(pos, pos + node.nodeSize, {
                  class: classes.join(" "),
                  [dataAttribute]:
                    typeof options.placeholder === "function"
                      ? options.placeholder({ editor, node, pos, hasAnchor: true })
                      : options.placeholder,
                }),
              );
            }
            return decorations.length ? DecorationSet.create(doc, decorations) : null;
          },
        },
      }),
    ];
  },
});
