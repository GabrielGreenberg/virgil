import { Extension } from "@tiptap/core";

// Tab inserts a literal '\t' at the cursor in plain prose; Esc blurs the
// editor. Priority is below the default (100) so list ListItem.Tab
// (sinkListItem) and expex Tab handlers fire first and short-circuit.
// Shift-Tab is intentionally not handled so liftListItem and expex
// Shift-Tab continue to own that key.
export const TabIndent = Extension.create({
  name: "tabIndent",
  priority: 50,
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => editor.commands.insertContent("\t"),
      Escape: ({ editor }) => {
        editor.commands.blur();
        return true;
      },
    };
  },
});
