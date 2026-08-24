/**
 * `p-cmd-only` — a per-paragraph DERIVED class, stamped at write time by the
 * paragraph NodeView (task 430).
 *
 * The fact: "this PROSE paragraph renders exactly ONE element child, and it is
 * a `.latex-cmd` span" — the DOM semantics of the retired
 * `p:has(> .latex-cmd:first-child:last-child)` rhythm selector (perf Wave 0,
 * P5.1). It feeds the `.tiptap p.p-cmd-only + p.p-cmd-only` run-tightening
 * rule in globals.css.
 *
 * WHY a NodeView stamp and not a decoration (task 430): the fact used to ride
 * a `Decoration.node` over the whole paragraph. ProseMirror files a node
 * decoration in the ROOT set's `local` array (`takeSpansForNode` needs STRICT
 * containment, which `[pos, pos + nodeSize]` fails), so every `find` /
 * `remove` / `add` on the keystroke path swept an array proportional to the
 * number of command-only paragraphs in the paper — after task 400 had already
 * made the re-DERIVATION per block. The NodeView already receives exactly the
 * node that changed and nothing else, so stamping there costs O(this
 * paragraph) per keystroke in it and nothing anywhere else; the decoration set
 * then carries inline spans only, and its root `local` array is EMPTY.
 *
 * WHY not a node ATTR written from `appendTransaction`: a derived view signal
 * is never document content ("Transient state is never document content") —
 * an attr write is a history entry, a dirty/autosave trigger, and content a
 * capture would carry.
 *
 * ONE predicate, two readers: the decoration plugin's inline scanner
 * (`forEachBareCommand`) and the aggregate (`paragraphIsCmdOnly`) read the
 * same `matchCommandLength`, so "what is a command run" cannot drift between
 * the grey span and the rhythm class. The aggregate counts, over the
 * paragraph's own inline children: a `latexCommand`-marked text run = one
 * command element; a bare text run = one command element per scanner match;
 * any other-marked run or non-text inline = one OTHER element.
 *
 * Import-free of the editor (model types only) so every surface's paragraph
 * extension — the main editor's titled paragraph and the card bodies'
 * `CardParagraph` — can take it.
 */
import { Paragraph } from "@tiptap/extension-paragraph";
import type { Node as PMNode, MarkType } from "@tiptap/pm/model";

export const CMD_ONLY_CLASS = "p-cmd-only";

/** Match a full LaTeX command span: \cmd*?[opt]{arg}{arg} — same as the parser. */
export function matchCommandLength(text: string, start: number): number {
  let i = start;
  // \
  if (i >= text.length || text[i] !== "\\") return 0;
  i++;
  // command name: [a-zA-Z]+
  const nameStart = i;
  while (i < text.length && /[a-zA-Z]/.test(text[i]!)) i++;
  if (i === nameStart) return i - start; // just "\" alone
  // optional *
  if (i < text.length && text[i] === "*") i++;
  // optional [...] args
  while (i < text.length && text[i] === "[") {
    const close = text.indexOf("]", i);
    if (close === -1) break;
    i = close + 1;
  }
  // up to 2 {braced} args — include unclosed braces (user still typing)
  let braces = 0;
  while (i < text.length && text[i] === "{" && braces < 2) {
    let depth = 0;
    let closed = false;
    for (let j = i; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") {
        depth--;
        if (depth === 0) {
          i = j + 1;
          braces++;
          closed = true;
          break;
        }
      }
    }
    if (!closed) {
      i = text.length;
      break;
    } // unclosed — include to end (typing in progress)
  }
  return i - start;
}

/**
 * Every bare-text command run in `text`, in order: `fn(offset, length)`.
 * Skips `\\` (a double backslash). Returns the number of runs found.
 */
export function forEachBareCommand(
  text: string,
  fn?: (offset: number, length: number) => void,
): number {
  let found = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "\\") continue;
    // Skip \\ (double backslash)
    if (i > 0 && text[i - 1] === "\\") {
      i++;
      continue;
    }
    const len = matchCommandLength(text, i);
    if (len > 0) {
      fn?.(i, len);
      found++;
      i += len - 1; // advance past the match
    }
  }
  return found;
}

/** The `latexCommand` mark type of the node's own schema, or null where the
 *  surface does not mount it — and then nothing is ever a command run. */
export function latexCommandMarkOf(node: PMNode): MarkType | null {
  return node.type.schema.marks.latexCommand ?? null;
}

/**
 * Does this paragraph render exactly ONE element child, a `.latex-cmd` span?
 * A non-paragraph, or a surface with no `latexCommand` mark, answers false.
 */
export function paragraphIsCmdOnly(node: PMNode): boolean {
  if (node.type.name !== "paragraph") return false;
  const markType = latexCommandMarkOf(node);
  if (!markType) return false;
  let cmdElements = 0;
  let otherElements = 0;
  node.forEach((child) => {
    if (child.isText) {
      if (child.marks.some((m) => m.type === markType)) {
        cmdElements++;
      } else if (child.marks.length > 0) {
        otherElements++;
      } else {
        cmdElements += forEachBareCommand(child.text ?? "");
      }
    } else {
      otherElements++;
    }
  });
  return cmdElements === 1 && otherElements === 0;
}

/**
 * Write the class onto the NodeView's outer `dom` — the same element a
 * `Decoration.node` over the paragraph used to decorate — idempotently, so an
 * unchanged answer touches no attribute (an attribute write invalidates style
 * even when the value is the same).
 */
export function stampCmdOnly(dom: Element, node: PMNode): void {
  const want = paragraphIsCmdOnly(node);
  if (dom.classList.contains(CMD_ONLY_CLASS) !== want) {
    dom.classList.toggle(CMD_ONLY_CLASS, want);
  }
}

/**
 * The card-body paragraph: StarterKit's paragraph plus the stamp. A bare `<p>`
 * that is its own contentDOM, so the rendered DOM is byte-identical to the
 * NodeView-less paragraph it replaces; the only thing it adds is the class.
 * Every surface that mounts `LatexCommandMark` mounts a paragraph that stamps
 * — this one for card bodies, `createParagraphWithTitle` for the main editor.
 */
export const CardParagraph = Paragraph.extend({
  addNodeView() {
    return ({ node }) => {
      const p = document.createElement("p");
      stampCmdOnly(p, node);
      return {
        dom: p,
        contentDOM: p,
        update(updated) {
          if (updated.type.name !== "paragraph") return false;
          // O(this paragraph): re-derive from the node that changed; an
          // unchanged answer writes nothing.
          stampCmdOnly(p, updated);
          return true;
        },
        ignoreMutation(mutation) {
          // Our own class write; never a reason to re-read the DOM.
          return mutation.type === "attributes" && mutation.target === p;
        },
      };
    };
  },
});
