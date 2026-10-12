// ---------------------------------------------------------------------------
// The ONE writeback for an edited figure env body (tasks 318 + 319)
//
// A `\begin{figure}` body typed by the user comes back from two surfaces — the
// tex-mode source popover (`EditorLayout.handleFigureSave`) and the NodeView's
// own `updateFromText` — and both must turn it into the same attrs, because
// whatever one of them fails to re-thread is ERASED from the model.
//
// They were hand-written twins, and they had already drifted the way twins do:
// task 263's `shortCaption` was added to one and not to the other's copy in
// `figure-save-routing.test.ts`, so the suite that claims to pin "the exact
// save contract" pinned a version of it that predates the byte it protects.
// Both are now this function, and the suite drives THIS, not a transcription.
//
// The re-extract is the whole point of the round trip: `hasCaption` (did the
// user leave a `\caption` command in the body they edited) and `label` come
// back from the SAME scan the parser uses, so the popover is a first-class way
// to add or remove a caption — not a surface that silently reinstates one.
// ---------------------------------------------------------------------------

import type { Editor } from "@tiptap/core";
import {
  extractFigureAttrs,
  extractFigureSources,
  figureNodeAttrsFromSource,
  extractGraphicsAttrs,
} from "@/lib/figures/parse-attrs";
import {
  applyLinkedAnchorBoundaries,
  parseInlineContent,
} from "@/lib/latex-parser";

/** Apply an edited `figureBlock` env body at `pos` in `editor`.
 *
 *  `pos` is validated against the doc first: the popover outlives the click, so
 *  by save time the owning editor may have re-seeded and shifted `pos` past the
 *  doc end — `nodeAt` THROWS on an out-of-range pos. Returns false when the
 *  position no longer holds the node kind it names, so a stale save is a safe
 *  no-op rather than a crash or a mis-targeted write. */
export function applyFigureEnvBodyEdit(
  editor: Editor,
  pos: number,
  newText: string,
): boolean {
  if (!editor || editor.isDestroyed) return false;
  if (pos < 0 || pos >= editor.state.doc.content.size) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "figureBlock") return false;

  const attrs = extractFigureAttrs(newText);
  // Re-tokenize the caption body: the popover is one of two surfaces that can
  // edit captions, so inline marks / citations / `$math$` must come back as
  // structured nodes rather than literal text.
  // The seed is the serializer's own bytes (task 1080), so a caption holding a
  // `linkedAnchor` range comes back with its `\vlid…\vlidend` markers — which
  // `parseInlineContent` yields as transient boundary sentinels the schema does
  // not know. Resolve them the way the full parse does (the pass is
  // fragment-safe), so the range survives rather than tripping the plain-text
  // fallback below and flattening the whole caption.
  const captionJson = {
    type: "figureCaption",
    content: parseInlineContent(attrs.caption),
  };
  applyLinkedAnchorBoundaries(captionJson);
  let captionNode;
  try {
    captionNode = editor.state.schema.nodeFromJSON(captionJson);
  } catch {
    // Schema rejection (an unknown inline node) — fall back to plain text so
    // the user's caption isn't lost on a malformed edit.
    captionNode = editor.state.schema.nodeFromJSON({
      type: "figureCaption",
      content: attrs.caption ? [{ type: "text", text: attrs.caption }] : [],
    });
  }

  // A RAW-SOURCE writeback — every attr the user typed into the env body is
  // re-threaded in ONE transaction, and `label` is one of them. It does NOT
  // enter the rename door (task 553 census): whether a source edit that
  // renames `\label{fig:a}` should ask the "Update references?" confirm and
  // carry the refs, and whether one that types a key another declaration owns
  // should REFUSE the save (the lozenge's behaviour) or accept it, is a product
  // decision about a Save-button surface — routed, not guessed. Until it is
  // taken, a rename from here orphans its refs exactly as it always has; the
  // numberer reports them as `??`.
  // label-write-exempt: raw-source writeback, product decision routed (task 553)
  const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    // EVERY source-derived attr, through the ONE mapping the parser uses
    // (task 1080). This was a hand-listed twin of the parser's — `extras`,
    // `trailingExtras` (task 379), `source`/`widthPercent`/`sources`, `label`,
    // `hasCaption` (task 319: the caption child is always rebuilt below, so it
    // cannot say whether the body still carries a `\caption` COMMAND),
    // `shortCaption` (task 263) — and the list had already missed one:
    // `numbered`, from `\caption*`, so toggling the star here was reverted on
    // the next save. Whatever this writeback fails to thread is ERASED from
    // the model; the shared mapping threads by construction.
    ...figureNodeAttrsFromSource(attrs),
  });
  // The caption child's start is `pos + 1`, inside the figureBlock node.
  const refreshed = tr.doc.nodeAt(pos);
  if (refreshed) {
    const inside = pos + 1;
    if (refreshed.firstChild?.type.name === "figureCaption") {
      tr.replaceWith(inside, inside + refreshed.firstChild.nodeSize, captionNode);
    } else {
      tr.insert(inside, captionNode);
    }
  }
  editor.view.dispatch(tr);
  return true;
}

/** Apply an edited standalone `\includegraphics` command at `pos`. Same bounds
 *  + kind guard as its figure twin. An unparseable command is stored verbatim
 *  rather than dropped — the `command` attr IS the source of truth here. */
export function applyGraphicsCommandEdit(
  editor: Editor,
  pos: number,
  newText: string,
): boolean {
  if (!editor || editor.isDestroyed) return false;
  if (pos < 0 || pos >= editor.state.doc.content.size) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "graphicsBlock") return false;
  const trimmed = newText.trim();
  const attrs = extractGraphicsAttrs(trimmed);
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      command: attrs ? attrs.command : trimmed,
      source: attrs ? attrs.source : "",
      widthPercent: attrs ? attrs.widthPercent : null,
    }),
  );
  return true;
}

/** Patch the parts of a `figureBlock` the visual chrome owns — the `extras`
 *  body and the `\includegraphics` attrs derived from it.
 *
 *  The width stepper and file picker only ever rewrite the `\includegraphics`
 *  line, which lives entirely in `extras`. They used to reach that through a
 *  full env round-trip (synthesize a body from `extras` + the caption's PLAIN
 *  TEXT + label, then re-extract), and every trip through that funnel lost
 *  something the projection couldn't carry: the `[short]` LoF bracket (the
 *  synthesizer never emitted it), every mark / citation / math atom in the
 *  caption (flattened to text and re-tokenized), and — once provenance
 *  existed — `hasCaption` itself. It also re-indented `extras` by two spaces
 *  per line on every click, so a figure's body crept rightwards each time
 *  someone nudged its width.
 *
 *  None of that is the chrome's business. It writes the one field it owns. */
export function applyFigureExtrasEdit(
  editor: Editor,
  pos: number,
  nextExtras: string,
): boolean {
  if (!editor || editor.isDestroyed) return false;
  if (pos < 0 || pos >= editor.state.doc.content.size) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "figureBlock") return false;
  // Only the graphics attrs are re-derived, straight off the new body — the
  // caption/label attrs are never named here, so they cannot be clobbered.
  const sources = extractFigureSources(nextExtras);
  const first = sources[0] ?? null;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      extras: nextExtras,
      source: first?.path ?? null,
      widthPercent: first?.widthPercent ?? null,
      sources,
    }),
  );
  return true;
}
