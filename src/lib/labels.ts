import type { Editor } from "@tiptap/react";

/**
 * Central label registry utilities.
 *
 * Labels enter the doc from several surfaces — `\label{...}` absorbed
 * into a heading's `label` attr, `\label{...}` buried in a raw-tex
 * paragraph (figure / table / unknown environment), or inside a
 * `displayMath` atom's `latex` source. Any UI that edits a label needs
 * the same view of "what keys are already claimed", so the walk lives
 * here and every callsite consults `collectLabelKeys` / `isLabelTaken`.
 */

const LABEL_RE = /\\label\{([^}]+)\}/g;

function scanRaw(text: string, out: Set<string>): void {
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(text)) !== null) out.add(m[1]);
}

/** All distinct `\label{...}` keys currently declared in the document. */
export function collectLabelKeys(editor: Editor): Set<string> {
  const keys = new Set<string>();
  editor.state.doc.descendants((nd) => {
    if (nd.type.name === "heading" && nd.attrs.label) {
      keys.add(nd.attrs.label as string);
      return true;
    }
    if (nd.type.name === "displayMath") {
      const src = (nd.attrs.latex as string | undefined) ?? "";
      if (src.includes("\\label{")) scanRaw(src, keys);
      return true;
    }
    if (nd.isText && nd.text && nd.text.includes("\\label{")) {
      scanRaw(nd.text, keys);
    }
    return true;
  });
  return keys;
}

/**
 * Whether `candidate` is already taken by another label declaration.
 * `excludeLabel` lets the editor of that label skip its own key while
 * renaming (otherwise every in-flight rename would report a collision
 * against itself).
 */
export function isLabelTaken(
  editor: Editor,
  candidate: string,
  excludeLabel?: string | null,
): boolean {
  const key = candidate.trim();
  if (!key) return false;
  if (excludeLabel && key === excludeLabel) return false;
  return collectLabelKeys(editor).has(key);
}
