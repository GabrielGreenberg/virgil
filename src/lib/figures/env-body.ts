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
// popover's copy emitted no `[short]` list-of-figures bracket, so every rebuild
// through it DELETED task 263's byte, silently — the width stepper and file
// picker on every click (they re-synthesized the whole env and re-extracted it),
// and the source popover as soon as the user changed any other part of the body.
// Whatever the second builder forgets is not merely rendered wrong — it is
// ERASED from the model on the next round-trip. So there is one builder, and
// every rebuild goes through it.
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
 *  The source's own answer, plus one concession to editing: caption content the
 *  user has ADDED to a previously caption-less figure must reach the file.
 *  The converse deliberately does not hold — clearing the content of a figure
 *  that HAD a caption still emits `\caption{}`, so a figure cannot silently
 *  lose its LaTeX number (and every `\ref` to it) because someone emptied a
 *  caption in the editor.
 *
 *  This is also what decides whether the figure is NUMBERED: in LaTeX a float
 *  is numbered iff it has a `\caption`, so the numberers (`numberFigures` in
 *  the parser, its live twin in the section-numbering plugin, and the
 *  `FigureEntry.emitsCaption` fact the structural diff carries so those two are
 *  woken when the answer changes) read this same predicate. If they didn't,
 *  Virgil's `Figure N:` chrome — and the `\ref` display text resolved from it —
 *  would count a figure the PDF does not.
 *
 *  The second argument is a BOOLEAN, not the caption text, precisely because
 *  its callers hold the caption in different representations and an implicit
 *  projection is where they would drift: the emitter has serialized LaTeX, the
 *  numberers have a live node. Each takes the matching projection below, so
 *  "does this caption have content" is asked once per representation and
 *  answered the same way. Feeding it `node.textContent` — the obvious move —
 *  is exactly the drift: an inline atom (a `\cite`, an `$x$`) reports `""`
 *  there while serializing to real bytes, so a caption holding only a citation
 *  would be emitted by one side and uncounted by the other. */
export function figureEmitsCaption(
  hasCaption: boolean,
  captionHasContent: boolean,
): boolean {
  return hasCaption || captionHasContent;
}

/** The emit-side projection: does the SERIALIZED caption carry bytes?
 *  Module-private — the emit side is in here, and a published projection with
 *  no outside caller is the dead-export shape `AGENTS.md` legislates against. */
function captionTexHasContent(captionTex: string): boolean {
  return captionTex.trim().length > 0;
}

/** The live-node projection, structurally typed so this module keeps its
 *  zero-import leaf status (the round-trip layer imports it, and cannot take
 *  an editor-coupled dependency — the same rule `latex-markers.ts` earned).
 *
 *  "Has content" is any non-text child (every inline atom serializes to real
 *  bytes) or any text child with a non-space character — which is the same
 *  answer `captionTexHasContent` gives over those same children's bytes. */
export interface CaptionNodeLike {
  readonly childCount: number;
  child(index: number): { readonly isText: boolean; readonly text?: string | null };
}

export function captionNodeHasContent(
  caption: CaptionNodeLike | null | undefined,
): boolean {
  if (!caption) return false;
  for (let i = 0; i < caption.childCount; i++) {
    const child = caption.child(i);
    if (!child.isText) return true;
    if ((child.text ?? "").trim().length > 0) return true;
  }
  return false;
}

/** The whole question, off a live `figureBlock` node — the ONE reader for
 *  every editor-side site that needs it (the section-numbering plugin, and the
 *  `FigureEntry.emitsCaption` fact the structural diff carries so that plugin
 *  is woken when the answer changes). Structurally typed for the same
 *  zero-import reason as `CaptionNodeLike`; a ProseMirror `Node` satisfies it. */
export interface FigureNodeLike {
  readonly attrs: Record<string, unknown>;
  readonly firstChild:
    | (CaptionNodeLike & { readonly type: { readonly name: string } })
    | null;
}

export function figureNodeEmitsCaption(fig: FigureNodeLike): boolean {
  const child = fig.firstChild;
  return figureEmitsCaption(
    fig.attrs.hasCaption !== false,
    captionNodeHasContent(child?.type.name === "figureCaption" ? child : null),
  );
}

/** The emit side's own read of the shared predicate. */
function partsEmitCaption(parts: FigureEnvBodyParts): boolean {
  return figureEmitsCaption(parts.hasCaption, captionTexHasContent(parts.captionTex));
}

/** Will this figure carry a figure-level `\label{...}` in the emitted `.tex`?
 *  False when the label's declaration lives inside the caption body that is
 *  about to be emitted — those bytes are the declaration, and writing a second
 *  copy is the duplicate `\label` of task 318. */
function figureEmitsLabel(parts: FigureEnvBodyParts): boolean {
  if (!parts.label) return false;
  if (!partsEmitCaption(parts)) return true;
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
  if (partsEmitCaption(parts)) {
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
