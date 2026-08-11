// ---------------------------------------------------------------------------
// The ONE emitter for a `\begin{figure}` env body (tasks 318 + 319)
//
// A figure's `.tex` body is rebuilt from the model at two moments that must
// agree byte-for-byte, because the second one's output is fed straight back
// through `extractFigureAttrs`:
//
//   • the SERIALIZER, at save time (`latex-serializer.ts`, `case "figureBlock"`);
//   • the POPOVER / chrome surface, which synthesizes a body for the user to
//     edit and re-extracts attrs from whatever comes back.
//
// They used to be two hand-written builders, and they had already drifted: the
// popover's copy emitted no `[short]` list-of-figures bracket, so opening the
// source popover on `\caption[Short]{Long}` and saving it unchanged DELETED the
// short caption (task 263's byte, silently). Whatever the second builder forgets
// is not merely rendered wrong — it is ERASED from the model on the next
// round-trip. So there is one builder, and every rebuild goes through it.
//
// It emits from DECLARED facts, never from bytes it re-reads:
//
//   • `hasCaption` — did the source carry a `\caption` COMMAND. Provenance the
//     caption child cannot express (`\caption{}` and no caption both give an
//     empty child), and provenance is the only place it can live: the parser
//     ALWAYS builds a `figureCaption` child so the lozenge has something to
//     anchor under and the user has somewhere to type. Emitting on the child's
//     presence gave every caption-less figure a `\caption{}` on first save —
//     which in LaTeX consumes a figure number and adds a blank List-of-Figures
//     row, renumbering every later `\ref` in a file Virgil merely opened
//     (task 319).
//   • `captionDeclaresLabel` — does the caption body already declare the
//     figure's `\label`. DERIVED at read time from the live caption via the
//     shared lexical scan (see its doc for why a substring test destroys data,
//     and why this one fact must not be frozen into an attr) (task 318).
// ---------------------------------------------------------------------------

import { captionDeclaresLabel } from "./parse-attrs";

export interface FigureEnvBodyParts {
  /** Env body minus the figure's own `\caption` / `\label` — raw passthrough. */
  extras: string;
  /** Serialized caption body (the `figureCaption` child's LaTeX). */
  captionTex: string;
  /** Did the SOURCE carry a `\caption` command (`FigureAttrs.hasCaption`). */
  hasCaption: boolean;
  /** Opaque `\caption[<short>]` LoF argument; null when there was no bracket. */
  shortCaption: string | null;
  /** The figure's `\label` body; "" when it has none. */
  label: string;
}

/** Will this figure carry a `\caption` in the emitted `.tex`?
 *
 *  The source's own answer, plus one concession to editing: caption text the
 *  user has TYPED into a previously caption-less figure must reach the file.
 *  The converse deliberately does not hold — clearing the text of a figure
 *  that HAD a caption still emits `\caption{}`, so a figure cannot silently
 *  lose its LaTeX number (and every `\ref` to it) because someone emptied a
 *  caption in the editor.
 *
 *  This is also what decides whether the figure is NUMBERED: in LaTeX a float
 *  is numbered iff it has a `\caption`, so both numberers (`numberFigures` in
 *  the parser, and its live twin in the section-numbering plugin) read this
 *  same predicate. If they didn't, Virgil's `Figure N:` chrome — and the `\ref`
 *  display text resolved from it — would count a figure the PDF does not. */
export function figureEmitsCaption(hasCaption: boolean, captionTex: string): boolean {
  return hasCaption || captionTex.trim().length > 0;
}

/** Will this figure carry a figure-level `\label{...}` in the emitted `.tex`?
 *  False when the label's declaration lives inside the caption body that is
 *  about to be emitted — those bytes are the declaration, and writing a second
 *  copy is the duplicate `\label` of task 318. */
export function figureEmitsLabel(parts: FigureEnvBodyParts): boolean {
  if (!parts.label) return false;
  if (!figureEmitsCaption(parts.hasCaption, parts.captionTex)) return true;
  return !captionDeclaresLabel(parts.captionTex, parts.label);
}

/** Rebuild the body between `\begin{figure}…` and `\end{figure}` from the
 *  model. Byte-compatible with the pre-318 serializer for every figure whose
 *  source had a caption and no caption-carried label — i.e. the change is
 *  confined to the two shapes that were being corrupted. */
export function buildFigureEnvBody(parts: FigureEnvBodyParts): string {
  const out: string[] = [];
  const extras = (parts.extras || "").replace(/\s+$/, "");
  if (extras) {
    out.push("\n");
    out.push(extras);
  }
  if (figureEmitsCaption(parts.hasCaption, parts.captionTex)) {
    // The `[short]` LoF argument rides through opaquely (task 263); a
    // bracket-free caption stays byte-identical.
    const shortArg =
      typeof parts.shortCaption === "string" ? `[${parts.shortCaption}]` : "";
    out.push("\n  ");
    out.push(`\\caption${shortArg}{${parts.captionTex}}`);
  }
  if (figureEmitsLabel(parts)) {
    out.push("\n  ");
    out.push(`\\label{${parts.label}}`);
  }
  out.push("\n");
  return out.join("");
}
