import { Extension, Mark, mergeAttributes } from "@tiptap/react";
import {
  isSmallCapsStyle,
  SMALL_CAPS_MARK,
  NEST_ATTR,
  SPELLING_ATTR,
  SPELLING_MARK_TYPES,
  WRAPPER_MARK_TYPES,
} from "@/lib/mark-composition";

/**
 * Small caps (task 808). Round-trips as `\textsc{…}` through the wrapper-mark
 * vocabulary table in mark-composition.ts — the table owns the parse and emit
 * spelling; this file is only the editor's mark. Rendered as a span with
 * `font-variant-caps: small-caps`, and read back from the same (so a paste of
 * small-caps text from the web or a word processor keeps it).
 *
 * `{\scshape …}` is NOT this mark: a declaration is not a command, and claiming
 * it would rewrite the source to `\textsc` on save. It stays raw LaTeX.
 */
export const SmallCaps = Mark.create({
  name: SMALL_CAPS_MARK,

  parseHTML() {
    return [
      { tag: "span[data-small-caps]" },
      {
        tag: "span[style]",
        getAttrs: (el) =>
          isSmallCapsStyle((el as HTMLElement).getAttribute("style")) ? null : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-small-caps": "",
        style: "font-variant-caps: small-caps",
      }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleSmallCaps:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-k": () => this.editor.commands.toggleSmallCaps(),
    };
  },
});

/**
 * The `spelling` attr on every wrapper mark with more than one LaTeX spelling
 * (today `italic`: `\emph` / `\textit`; and `textColor`, whose spelling is
 * its hex as read — task 1439), read from the vocabulary table. It
 * records which spelling a run was PARSED from so the emit writes that one back
 * — `\textit{x}` used to come back `\emph{x}`. Not rendered; default null =
 * the canonical spelling, which is what a newly typed mark gets. Registered on
 * every schema that mounts those marks (main editor + both card-body scopes).
 */
export const MarkSpellingAttrs = Extension.create({
  name: "markSpellingAttrs",
  addGlobalAttributes() {
    return [
      {
        types: [...SPELLING_MARK_TYPES],
        attributes: {
          [SPELLING_ATTR]: {
            default: null,
            rendered: false,
          },
        },
      },
      // Task 1439: a wrapper's SOURCE nesting position on a run that stacks
      // wrappers in a non-canonical order (`\textbf{\emph{x}}`) — without it
      // the schema's rank order decides the emit after a mount.
      {
        types: [...WRAPPER_MARK_TYPES],
        attributes: {
          [NEST_ATTR]: {
            default: null,
            rendered: false,
          },
        },
      },
    ];
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    smallCaps: {
      toggleSmallCaps: () => ReturnType;
    };
  }
}
