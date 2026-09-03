import type { Editor } from "@tiptap/react";
import type { Node as PMNode } from "@tiptap/pm/model";
import { LABEL_DECLARING_NODE_TYPES } from "@/lib/node-attr-sets";

/**
 * Central label registry utilities.
 *
 * Labels enter the doc from several surfaces — `\label{...}` absorbed
 * into a heading's / figure's / example's `label` attr, `\label{...}` buried
 * in a raw-tex paragraph (a table, an unknown environment), or inside a
 * `displayMath` atom's `latex` source. Any UI that edits a label needs the
 * same view of "what keys are already claimed", so the walk lives here and
 * every callsite consults `collectLabelKeys` / `isLabelTaken`.
 *
 * The DECLARING kinds are read off `LABEL_DECLARING_NODE_TYPES` (task 553),
 * never listed here: pre-553 this walk named `heading` and `figureBlock` by
 * hand, so a key an example declared was invisible to every duplicate check
 * in the app — the heading strip wrote `ex:one` beside the example that
 * owned it, and the rename door's "refuse a claimed key" rung could not see
 * half the document's declarations.
 *
 * Two readers, two costs. `collectLabelKeys` is O(doc) and belongs to a
 * USER-PACED moment: the commit of a label edit, or the START of one (the
 * live "already in use" warning snapshots it once — `label-key-warning.ts`).
 * `isLabelTakenIn` is the O(1) membership test over such a snapshot; the
 * editor-taking `isLabelTaken` composes the two and is the authoritative
 * COMMIT-time answer.
 */

const LABEL_RE = /\\label\{([^}]+)\}/g;

function scanRaw(text: string, out: Set<string>): void {
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(text)) !== null) out.add(m[1]);
}

/** All distinct `\label{...}` keys currently declared in `doc`. */
export function collectLabelKeysIn(doc: PMNode): Set<string> {
  const keys = new Set<string>();
  doc.descendants((nd) => {
    if (LABEL_DECLARING_NODE_TYPES.has(nd.type.name)) {
      const label = nd.attrs.label;
      if (typeof label === "string" && label) keys.add(label);
      // A figureCaption declares nothing; an example's items and body lines
      // DO (a nested `\a \label{…}` item, a raw `\label{}` line), so only
      // the figure's subtree is skipped.
      return nd.type.name !== "figureBlock";
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

/** All distinct `\label{...}` keys currently declared in the document. */
export function collectLabelKeys(editor: Editor): Set<string> {
  return collectLabelKeysIn(editor.state.doc);
}

/**
 * Whether `candidate` is claimed by another declaration IN `keys` — the pure
 * membership half, read by the live warnings over a snapshot taken at edit
 * start. `excludeLabel` lets the editor of that label skip its own key while
 * renaming (otherwise every in-flight rename would report a collision
 * against itself).
 */
export function isLabelTakenIn(
  keys: ReadonlySet<string>,
  candidate: string,
  excludeLabel?: string | null,
): boolean {
  const key = candidate.trim();
  if (!key) return false;
  if (excludeLabel && key === excludeLabel) return false;
  return keys.has(key);
}

/**
 * Whether `candidate` is already taken by another label declaration in the
 * LIVE document — the authoritative commit-time answer (one O(doc) walk).
 */
export function isLabelTaken(
  editor: Editor,
  candidate: string,
  excludeLabel?: string | null,
): boolean {
  if (!candidate.trim()) return false;
  return isLabelTakenIn(collectLabelKeys(editor), candidate, excludeLabel);
}
