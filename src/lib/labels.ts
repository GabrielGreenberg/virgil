import type { Editor } from "@tiptap/react";
import type { Fragment, Node as PMNode, NodeType } from "@tiptap/pm/model";
import { isInertCarrierMark, projectStructuralLatex } from "@/lib/latex-lexer";
import { LABEL_DECLARING_NODE_TYPES } from "@/lib/node-attr-sets";
import { forEachJsonDeep, nestedBodyOf } from "@/lib/inline-content";

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

/**
 * "Is this text LIVE LaTeX that can declare a label?" — the ONE inert-region
 * rule both label walks read (task 1374): this collector and the Duplicate
 * re-mint walk (`duplicate-slice.ts`). Before it, both scanned every text node,
 * so a `\label{…}` shown inside a `verbatim` listing or a `%` comment counted
 * as declared AND was rewritten to `\label{…-2}` in a duplicated copy —
 * changing the literal bytes of the user's listing. Same derivation as the
 * prose index (`prose-index.ts` rules 1–2), never a node-name list:
 *
 *  1. a textblock that admits NO marks (`codeBlock`, `latexComment`) is
 *     byte-literal, so nothing in it executes;
 *  2. a run wearing an INERT carrier (`isInertCarrierMark`: a comment tail,
 *     an inline `\verb`) executes nothing either. A `latexCommand` run and the
 *     refusal carrier are LIVE source — read through `forEachLiveLabel`, which
 *     blanks any comment / verbatim region INSIDE them.
 *
 * `parentType` is the text's containing node type (`null` for a top-level
 * inline slice fragment, which is live by default).
 */
export function isLabelDeclaringText(
  marks: readonly { type: string; attrs?: unknown }[] | undefined,
  parentType: NodeType | null,
): boolean {
  if (
    parentType &&
    parentType.isTextblock &&
    parentType.markSet !== null &&
    parentType.markSet.length === 0
  ) {
    return false;
  }
  return !marks?.some((m) => isInertCarrierMark(m.type, m.attrs));
}

/** The JSON-mark spelling of a live PM node's marks, for the predicate. */
function marksOf(nd: PMNode): { type: string; attrs: unknown }[] {
  return nd.marks.map((m) => ({ type: m.type.name, attrs: m.attrs }));
}

/** Is this PM text node (under `parent`) live label-declaring text? */
export function isLabelDeclaringTextNode(
  nd: PMNode,
  parent: PMNode | null | undefined,
): boolean {
  return isLabelDeclaringText(marksOf(nd), parent?.type ?? null);
}

/**
 * Does raw text BENEATH this node declare labels? A `figureBlock` owns its
 * label on the node attr and its `figureCaption` declares nothing, so its
 * subtree's raw text is skipped by both walks; an example's items and body
 * lines DO declare (a nested `\a \label{…}` item, a raw `\label{}` line).
 */
export function labelsLiveBeneath(nd: PMNode): boolean {
  return nd.type.name !== "figureBlock";
}

/**
 * Visit every LIVE `\label{key}` in raw source, with its offsets in `text`.
 * A comment, an inline `\verb`, or a verbatim-family / `comment` env body
 * INSIDE the source is blanked first (`projectStructuralLatex` — offset
 * preserving, full verbatim family, unterminated ⇒ live), so `start`/`end`
 * index the ORIGINAL string.
 */
export function forEachLiveLabel(
  text: string,
  visit: (key: string, start: number, end: number) => void,
): void {
  if (!text.includes("\\label{")) return;
  const live = projectStructuralLatex(text);
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(live)) !== null) {
    visit(m[1], m.index, m.index + m[0].length);
  }
}

/** Rewrite every LIVE `\label{key}` in raw source through `rename`; inert
 *  occurrences keep their bytes. Identity when nothing live is present. */
export function mapLiveLabels(
  text: string,
  rename: (key: string) => string,
): string {
  let out = "";
  let last = 0;
  forEachLiveLabel(text, (key, start, end) => {
    out += text.slice(last, start) + `\\label{${rename(key)}}`;
    last = end;
  });
  return last === 0 ? text : out + text.slice(last);
}

function scanRaw(text: string, out: Set<string>): void {
  forEachLiveLabel(text, (key) => out.add(key));
}

/** All distinct `\label{...}` keys currently declared in `doc` — or in a
 *  bare fragment (a slice's content), whose top-level nodes count too. Inert
 *  text (verbatim, comments) declares nothing — {@link isLabelDeclaringText}. */
export function collectLabelKeysIn(doc: PMNode | Fragment): Set<string> {
  const keys = new Set<string>();
  doc.descendants((nd, _pos, parent) => {
    if (LABEL_DECLARING_NODE_TYPES.has(nd.type.name)) {
      const label = nd.attrs.label;
      if (typeof label === "string" && label) keys.add(label);
      return labelsLiveBeneath(nd);
    }
    if (nd.type.name === "displayMath") {
      const src = (nd.attrs.latex as string | undefined) ?? "";
      scanRaw(src, keys);
      return true;
    }
    if (nd.isText && nd.text && isLabelDeclaringTextNode(nd, parent)) {
      scanRaw(nd.text, keys);
    }
    // A footnote body keeps a `\label{…}` as raw command text inside its
    // `attrs.content` literal, where `descendants` never looks (task 606).
    // Its JSON text nodes carry their marks, so the inert-carrier half of the
    // rule applies there too.
    const body = nestedBodyOf(nd);
    if (body) {
      forEachJsonDeep(body, (j) => {
        if (j.type === "text" && j.text && isLabelDeclaringText(j.marks, null)) {
          scanRaw(j.text, keys);
        }
      });
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

// ── Key SAFETY (task 1435) ───────────────────────────────────────────────
//
// A label key is written VERBATIM into `\label{…}` (and every `\ref{…}`
// carried with it), and read back by `LABEL_RE` — `[^}]+` — and by TeX. So a
// key holding a character that is SYNTAX inside that brace group writes
// source the app cannot read back: `fig:a}b` → `\label{fig:a}b}` unbalances
// the environment and re-reads as `fig:a`; `%` comments out the rest of the
// line; `#` and `\` break the compile. One predicate states which characters
// a key may not hold — the label twin of task 1081's `texUnsafePathChars`
// (`figures/asset-import.ts`) — and the rename door refuses on it, so every
// label editor (heading chip, figure lozenge, expex pod, Outline) inherits
// the refusal rather than each carrying a copy.
//
// The set is the brace/comment/parameter/escape grammar plus whitespace and
// control characters (a key with a space or a newline in it is a key no
// author means). `:` `-` `_` `.` `/` and non-ASCII letters stay legal.

/** One character a label key may not hold. Global for `texUnsafeLabelChars`. */
const TEX_UNSAFE_LABEL_CHAR = /[{}%#\\\s\u0000-\u001f\u007f]/g;

/** Every TeX-unsafe character in `key`, in order, deduplicated — the
 *  refusal's evidence. Empty ⇔ the key can be written and read back. */
export function texUnsafeLabelChars(key: string): string[] {
  return [...new Set(key.match(TEX_UNSAFE_LABEL_CHAR) ?? [])];
}

/** Whether `key` can be written into `\label{…}` / `\ref{…}` and read back
 *  byte-for-byte by both Virgil's parser and TeX. */
export function isTexSafeLabelKey(key: string): boolean {
  return texUnsafeLabelChars(key).length === 0;
}

/** Why a candidate key cannot be committed: `unsafe` (TeX syntax inside it)
 *  or `taken` (another declaration claims it). */
export type LabelKeyProblem = "unsafe" | "taken";

/**
 * THE question every label field asks of a candidate — live per keystroke
 * over a snapshot (`labelKeyProblemIn`) and at commit against the live doc
 * (`labelKeyProblem`). Safety first: it is O(key) and needs no key set. An
 * empty candidate (a CLEAR) has no problem; `own` is never a collision.
 */
export function labelKeyProblemIn(
  keys: ReadonlySet<string> | null,
  candidate: string,
  own?: string | null,
): LabelKeyProblem | null {
  const key = candidate.trim();
  if (!key) return null;
  if (!isTexSafeLabelKey(key)) return "unsafe";
  return keys && isLabelTakenIn(keys, key, own) ? "taken" : null;
}

/** The commit-time answer against the LIVE document (one O(doc) walk, and
 *  only when the key is safe). */
export function labelKeyProblem(
  editor: Editor,
  candidate: string,
  own?: string | null,
): LabelKeyProblem | null {
  const key = candidate.trim();
  if (!key) return null;
  if (!isTexSafeLabelKey(key)) return "unsafe";
  return isLabelTaken(editor, key, own) ? "taken" : null;
}

/** The words a label field shows under a problem candidate — spelled ONCE,
 *  so the heading chip, figure lozenge, expex pod and Outline agree. */
export function labelKeyProblemText(problem: LabelKeyProblem, candidate: string): string {
  if (problem === "taken") return "⚠ label already in use";
  const shown = texUnsafeLabelChars(candidate.trim()).map((c) =>
    /\s/.test(c) ? "spaces" : /[\u0000-\u001f\u007f]/.test(c) ? "control characters" : c,
  );
  return `⚠ a label can't contain ${[...new Set(shown)].join(" ")}`;
}
