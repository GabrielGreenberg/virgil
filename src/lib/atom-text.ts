/**
 * Single registry for "what's the text representation of this atom node?"
 *
 * Block-atom and inline-atom nodes don't carry their payload as
 * `node.textContent` — it lives in attrs (`code`, `latex`, `text`, `src`).
 * Without this helper, consumers like clipboard-copy, archive-snippet
 * labelling, or screen-reader fallback fall back to `textContent` and
 * silently get an empty string for every atom whose handler they forgot
 * to add.
 *
 * Adding a new atom node type: add one entry below. New consumers should
 * use this helper instead of hardcoding their own per-type switch.
 */

import type { Node } from "@tiptap/pm/model";

type AtomTextExtractor = (node: Node) => string;

const extractors: Record<string, AtomTextExtractor> = {
  texBlock: (n) => (n.attrs.code as string) || "",
  displayMath: (n) => (n.attrs.latex as string) || "",
  inlineMath: (n) => (n.attrs.latex as string) || "",
  latexComment: (n) => `% ${(n.attrs.text as string) || ""}`,
  figureBlock: (n) => (n.attrs.src as string) || "",
  graphicsBlock: (n) => (n.attrs.src as string) || "",
};

export function getAtomText(node: Node): string {
  return extractors[node.type.name]?.(node) ?? node.textContent ?? "";
}
