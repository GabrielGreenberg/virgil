import { Mark, mergeAttributes } from "@tiptap/react";
import { SUBSCRIPT_MARK, SUPERSCRIPT_MARK } from "@/lib/mark-composition";

/**
 * Text-mode subscript and superscript (task 1239). Round-trip as
 * `\textsubscript{…}` / `\textsuperscript{…}` through the wrapper-mark
 * vocabulary table in mark-composition.ts — the table owns the parse and emit
 * spelling; this file is only the editor's marks, rendered as `<sub>`/`<sup>`
 * and read back from the same (so pasted sub/superscript keeps it).
 *
 * Neither mark excludes the other: `\textsubscript{\textsuperscript{x}}` is
 * legal LaTeX, and a parsed mark the schema refused would drop its bytes on
 * save. Math-mode `$_2$` is NOT this mark — it stays math.
 */
function scriptMark(name: string, tag: "sub" | "sup") {
  return Mark.create({
    name,
    parseHTML() {
      return [{ tag }];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes), 0];
    },
  });
}

export const Subscript = scriptMark(SUBSCRIPT_MARK, "sub");
export const Superscript = scriptMark(SUPERSCRIPT_MARK, "sup");
