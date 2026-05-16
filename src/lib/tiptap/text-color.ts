import { Mark, mergeAttributes } from "@tiptap/react";

/**
 * Inline LaTeX text color. Set/unset from the right-side selection
 * menu's color popover. Round-trips through latex-serializer.ts /
 * latex-parser.ts as `\textcolor[HTML]{<HEX>}{<inner>}`, so colors
 * survive save → reload and render in the compiled PDF (the xcolor
 * package gets injected into the preamble on serialize).
 */
export const TextColor = Mark.create<{ HTMLAttributes: Record<string, unknown> }>({
  name: "textColor",

  addAttributes() {
    return {
      color: {
        default: null as string | null,
        parseHTML: (el) => el.getAttribute("data-text-color"),
        renderHTML: (attrs) => {
          const c = attrs.color as string | null;
          if (!c) return {};
          return {
            "data-text-color": c,
            style: `color: ${c}`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-text-color]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setTextColor:
        (color: string) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}
