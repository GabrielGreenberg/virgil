import type { Fragment, Mark, Node as PMNode, Slice } from "prosemirror-model";
import { MEANINGFUL_BLOCK_ATOM_NODE_NAMES } from "@/text-objects/text-object-registry";
import { COMMENT_TAIL_MARK_NAME, WRAPPER_MARK_TYPES } from "@/lib/mark-composition";
import { LATEX_COMMAND_MARK, LATEX_VERBATIM_MARK } from "@/lib/latex-lexer";
import { cardAtomMetaForNodeName } from "@/lib/tiptap/atom-registry";

/**
 * **THE capture/schema-symmetry predicate for a WRAP action** (task 641).
 *
 * `AGENTS.md` → "Capture/schema symmetry — never delete what you cannot
 * restore": a destructive action must never delete content its capture
 * destination cannot represent. The card spine states that law for card bodies
 * (`canMountInCardBody`, validated BEFORE the delete is dispatched). This is the
 * same law for the three WRAP paths in the action registry, which all do
 *
 * ```ts
 * if (!empty) tr = tr.deleteSelection();
 * tr = tr.replaceSelectionWith(node);
 * ```
 *
 * after harvesting the selection into a payload their new node CAN hold. The
 * harvest is lossy by construction — `texRun` / `mathRun` keep plain TEXT
 * (`textBetween`), `exampleRun` keeps INLINE leaves
 * (`extractInlineFromSlice`) — so everything else in the selected slice is
 * deleted and never restored.
 *
 * Before 641 the rule was written TWICE and forgotten ONCE: `texRun` and
 * `mathRun` each carried a hand-rolled bail for the one shape that was
 * reported (a selection holding an inline atom and NO text), and `exampleRun`
 * carried none at all — so `\\ex` over a selected `displayMath` / `figureBlock`
 * / `graphicsBlock` replaced it with an empty example template and the block was
 * simply gone. One predicate, asked by all three, is what stops the fourth wrap
 * path forgetting it again.
 *
 * The question is asked of the SLICE, not of the harvest result, because "the
 * harvest came back empty" is a PROXY for the real question and misses every
 * MIXED selection — text plus a citation pill, prose plus a figure — which the
 * proxy waves through while the delete destroys the atom anyway.
 */

/**
 * What a wrap path's capture can carry out of a selection. Not a mode switch on
 * the question (the question is one: *does the capture represent the slice?*) —
 * it NAMES the capture, which is the only thing that differs between the
 * callers. Task 696 named the three DIALECTS of one cut (`slice-capture.ts`);
 * each vocabulary here is the capture side of one of them.
 *
 *   • `"text"` — `state.doc.textBetween(...)`: plain characters only
 *     (`mathRun`'s `latex`). An inline atom, a block atom, a text object: none
 *     survive. Nor does a MARK — see {@link TEXT_CAPTURE_DROPPED_MARKS} for the
 *     ones whose loss is declared rather than refused (task 848).
 *   • `"inline"` — `extractInlineFromSlice`: every INLINE leaf, marks and all,
 *     with block scaffolding flattened away (`exampleRun`'s `inline*` item
 *     paragraph). Text and inline atoms survive; block-level identity does not.
 *   • `"latex"` — `captureRangeLatexSource`: the span's LaTeX SOURCE (`texRun`'s
 *     `\\tex` block `code`, task 848). Formatting and id-less inline atoms are
 *     carried AS LaTeX (`\\textit{…}`, `\\cite{…}`, `$x$`); what is refused is
 *     IDENTITY a raw-TeX block cannot hold — a `linkedAnchor` (a Mode-B card's
 *     anchor) or a Card-bearing atom's id (`footnoteId` / `citationId`), whose
 *     only `.tex` spelling is a private `\\vlid` / `\\vfid` / `\\vcid` marker.
 */
export type CaptureVocabulary = "text" | "inline" | "latex";

/**
 * The CARRIER marks (`mark-composition.ts`): they say how a run's own bytes
 * are produced, not what wraps it. `latexCommand` / `latexVerbatim` runs ARE
 * their source bytes, so both the text and the LaTeX captures keep them
 * exactly; the comment tail is kept by the LaTeX serializer (`% …`) but a
 * plain-text capture would silently UN-comment it, so only `"latex"` admits it.
 */
const BYTE_CARRIER_MARKS = [LATEX_COMMAND_MARK, LATEX_VERBATIM_MARK] as const;

/**
 * The marks a `"text"` capture DROPS BY DECLARATION (task 848) — the WRAPPER
 * marks (`\\textbf` / `\\emph` / `\\textsc` / `\\sout` / `\\texttt` / colour …,
 * derived from `WRAPPER_MARK_ROWS`). Inside math source they have no meaning,
 * so `\\(` over `*x*` seeding `x` loses nothing the destination could hold —
 * a stated, tested exemption rather than a silent one. Every OTHER mark on a
 * `"text"` capture refuses (fail closed) — above all `linkedAnchor`, whose
 * loss would strand a card in the unanchored bin.
 */
export const TEXT_CAPTURE_DROPPED_MARKS: ReadonlySet<string> = new Set<string>(
  WRAPPER_MARK_TYPES,
);

const TEXT_CAPTURE_MARKS: ReadonlySet<string> = new Set<string>([
  ...TEXT_CAPTURE_DROPPED_MARKS,
  ...BYTE_CARRIER_MARKS,
]);

/** The marks the LaTeX serializer writes as real LaTeX — every wrapper and
 *  every carrier. `linkedAnchor` is absent: its only spelling is `\\vlid`. */
const LATEX_CAPTURE_MARKS: ReadonlySet<string> = new Set<string>([
  ...WRAPPER_MARK_TYPES,
  ...BYTE_CARRIER_MARKS,
  COMMENT_TAIL_MARK_NAME,
]);

function markKept(capture: CaptureVocabulary, mark: Mark): boolean {
  if (capture === "inline") return true; // the inline leaf travels with its marks
  const name = mark.type.name;
  return capture === "latex" ? LATEX_CAPTURE_MARKS.has(name) : TEXT_CAPTURE_MARKS.has(name);
}

/** Is this INLINE node itself (marks aside) something `capture` carries? */
function inlineNodeKept(capture: CaptureVocabulary, node: PMNode): boolean {
  if (capture === "inline") return true;
  if (node.isText || node.type.name === "hardBreak") return true;
  if (capture === "text") return false;
  // "latex": an inline atom is carried as its LaTeX — unless it owns a Card,
  // whose id the raw-TeX block has no way to hold (the id's only spelling is a
  // private marker). An id-less one (not yet minted) carries nothing to lose.
  const card = cardAtomMetaForNodeName(node.type.name);
  return !(card && node.attrs[card.idAttr]);
}

/**
 * Does `capture`'s vocabulary represent EVERYTHING `slice` holds — i.e. is it
 * safe to `deleteSelection()` over it?
 *
 * Fails CLOSED (the same direction as `blockRangeHostsBlockInsert` and
 * `inlineRangeAllowsAtom`): the first node the capture has no vocabulary for
 * answers `false`, and the caller must REFUSE rather than delete. A slice that
 * holds nothing (`content.size === 0`) is trivially captured.
 *
 * The walk mirrors each capture exactly:
 *   • an INLINE node is captured when the vocabulary admits it — `"inline"`
 *     takes every one, `"text"` only real text (plus `hardBreak`, which both
 *     `textBetween` forms flatten to a line break / nothing rather than losing
 *     content), `"latex"` text and every atom that owns no Card id — AND when
 *     the vocabulary admits every MARK it wears (task 848: before, the walk
 *     read nodes only, so `\\tex` over `see *this*` answered "fully captured"
 *     and deleted the italic);
 *   • a non-inline node is DESCENDED into, because flattening plain
 *     scaffolding (a paragraph, a list item, a blockquote) into its inline
 *     leaves is the harvest's intended behaviour and loses no content;
 *   • …UNLESS it is a block ATOM (nothing to descend into — `displayMath`,
 *     `graphicsBlock`, `texBlock`, `forestBlock`) or one of the
 *     `MEANINGFUL_BLOCK_ATOM_NODE_NAMES` — the registry-derived "non-trivial to
 *     lose" set the destructive-confirm probe already reads, which adds
 *     `figureBlock`, whose `src` / `extras` / `label` the flattening drops while
 *     keeping its caption's characters. Those are the loss. A `paragraph` /
 *     `heading` / `listItem` / `blockquote` is in neither set, so ordinary prose
 *     scaffolding flattens exactly as it always did. (The schema `group` is NOT
 *     the distinguisher it looks like: `paragraph` is `"block textObject"` too.)
 *
 * Pure (no React/DOM, no editor), bounded by the selection slice — never a
 * whole-document walk — and run on a user gesture, never per keystroke.
 */
export function sliceIsFullyCapturedBy(
  slice: Slice,
  capture: CaptureVocabulary,
): boolean {
  let complete = true;
  const walk = (fragment: Fragment) => {
    fragment.forEach((child: PMNode) => {
      if (!complete) return;
      if (child.isInline) {
        if (!inlineNodeKept(capture, child) || !child.marks.every((m) => markKept(capture, m))) {
          complete = false;
        }
        return;
      }
      if (child.isAtom || MEANINGFUL_BLOCK_ATOM_NODE_NAMES.has(child.type.name)) {
        complete = false;
        return;
      }
      walk(child.content);
    });
  };
  walk(slice.content);
  return complete;
}
