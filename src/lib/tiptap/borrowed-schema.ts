/**
 * borrowed-schema — the ONE source of truth for the inline-atom +
 * block-atom-preview sub-schema that card surfaces "borrow" from the main
 * editor (backlog #11, the A9 deferral).
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The card-context atom schema used to live in THREE hand-kept copies:
 *   1. RichTextField        (editable footnote / note card bodies)
 *   2. BorrowedMainText     (read-only borrowed card bodies)
 *   3. buildEditorExtensions (the MAIN editor + every popped-out float)
 * Adding a new inline-atom kind meant editing all three or the atom was
 * silently stripped in whichever surface was missed. This module factors out
 * the part the card surfaces genuinely SHARE — the inline atoms and the
 * block-atom *previews* — so the two card surfaces compose ONE list. The main
 * editor keeps its own ordered stack (its block atoms carry main-only config —
 * `isPoppedRef` / `docIdRef` / figure callbacks / `figureFloat` — and live in
 * a position-gated order, pinned by `EXPECTED_MAIN_ORDER` in
 * editor-extensions.test.ts — not an importable symbol), but it is held to the
 * SAME canonical atom set by a contract test (`borrowed-schema.test.ts`):
 * every name in {@link BORROWED_INLINE_ATOM_NAMES} /
 * {@link BORROWED_BLOCK_ATOM_NAMES} must also appear in the main stack. So
 * "add an atom kind in one place" now holds: add the row here, the two card
 * surfaces pick it up for free, and the contract test fails until the main
 * editor registers it too.
 *
 * WHAT THIS IS *NOT*
 * ------------------
 * This is ONLY the inline-atom + block-atom-preview sub-schema. It deliberately
 * does NOT include:
 *   - StarterKit (the card surfaces share a config, exported as
 *     {@link CARD_STARTER_KIT_CONFIG}, but each surface still constructs its own
 *     StarterKit so it can layer Placeholder / TabIndent / read-only on top);
 *   - the main editor's stateful chrome (DocStructureObserver, heading folding,
 *     paragraph-title NodeViews, grab handles, drop targets, the readOnly
 *     enforcer, the doc-wide numberers) — a read-only card body must run NONE of
 *     those, which is exactly why A9 deferred a "pure" extraction. Each surface
 *     composes this shared sub-schema with its OWN block / chrome layer.
 *
 * KEYSTROKE SANCTITY
 * ------------------
 * Nothing here subscribes to `editor.on('update'|'transaction')` or walks the
 * doc per keystroke. These are plain node/mark extensions; the card surfaces
 * that mount them are isolated editors that never touch the main editor's
 * transaction stream (see BorrowedMainText / RichTextField headers).
 *
 * BEHAVIOR-PRESERVING DEFAULTS
 * ----------------------------
 * The card surfaces historically registered InlineMath / DisplayMath /
 * LatexComment BARE, i.e. with their default `surface: "main"`. We preserve that
 * exactly (we do NOT thread a `surface` here): on RichTextField (editable) the
 * math click→edit bridge fires the same as before; on BorrowedMainText
 * (read-only) `editor.isEditable === false` keeps the bridge inert regardless.
 * Threading any other surface here would be a behavior CHANGE, not a refactor.
 */

import type { AnyExtension } from "@tiptap/core";
import {
  InlineMath,
  DisplayMath,
  Citation,
  LabelRef,
  Footnote,
  LatexCommandMark,
  LatexVerbatimMark,
  TexBlock,
  FigureBlock,
  FigureCaption,
  GraphicsBlock,
  LatexComment,
} from "@/lib/tiptap-extensions";

/**
 * The shared StarterKit config both card surfaces use. Heading / blockquote /
 * codeBlock make no sense in a footnote-or-note-sized body and would balloon
 * the surface; horizontalRule likewise. Exported so RichTextField and
 * BorrowedMainText can't drift on it — but each surface still calls
 * `StarterKit.configure(CARD_STARTER_KIT_CONFIG)` itself (read-only omits
 * Placeholder + TabIndent on top; the main editor's StarterKit config is
 * entirely different and is NOT this).
 */
export const CARD_STARTER_KIT_CONFIG = {
  heading: false as const,
  blockquote: false as const,
  codeBlock: false as const,
  horizontalRule: false as const,
};

/**
 * The inline-atom node/mark names this module registers, in registration
 * order. The contract test asserts the MAIN editor registers every one of
 * these — that's the cross-surface invariant. `labelRef` / `footnote` are
 * included only when {@link BorrowedSchemaOptions.includeLabelRefFootnote} is
 * set (BorrowedMainText needs read-only `\ref` + nested footnote markers;
 * RichTextField's cards never edit them).
 */
export const BORROWED_INLINE_ATOM_NAMES = [
  "inlineMath",
  "citation",
  "labelRef",
  "footnote",
  "latexCommand",
  "latexVerbatim",
  "displayMath",
] as const;

/**
 * The block-atom *preview* node names this module registers (each in
 * `cardContext: true` mode — a compact static preview, not the main editor's
 * full chrome). The contract test asserts the MAIN editor registers every one.
 */
export const BORROWED_BLOCK_ATOM_NAMES = [
  "texBlock",
  "figureBlock",
  "figureCaption",
  "graphicsBlock",
  "latexComment",
] as const;

export interface BorrowedSchemaOptions {
  /**
   * Include BOTH the `labelRef` (\ref) AND `footnote` (nested footnote marker)
   * atoms. BorrowedMainText sets this so borrowed prose renders refs and nested
   * footnote markers in read-only display. Equivalent to
   * `{ includeLabelRef: true, includeFootnote: true }`. Default `false`.
   */
  includeLabelRefFootnote?: boolean;
  /**
   * Include the `labelRef` (\ref) atom only. RichTextField (the editable
   * footnote/note body) sets this so a `\ref` CREATED inside a footnote (CHIP 5)
   * has a node type to insert into and round-trips — WITHOUT pulling in the
   * nested-`footnote` marker (footnotes can't nest). Implied by
   * `includeLabelRefFootnote`. Default `false`.
   */
  includeLabelRef?: boolean;
  /**
   * Include the nested `footnote` marker atom only. Implied by
   * `includeLabelRefFootnote`. Default `false`.
   */
  includeFootnote?: boolean;
}

/**
 * Build the shared card-context inline-atom + block-atom-preview extension
 * array. Both card surfaces compose this on top of their own StarterKit (+
 * Placeholder / TabIndent / read-only) layer.
 *
 * Order note: the relative order here is NOT load-bearing for behavior — none of
 * these are decoration plugins keyed on position (unlike the main editor's
 * DocStructureObserver), and every atom uses a distinct `data-type` parseDOM
 * selector so parse-rule priority is unaffected by ordering. The order was
 * NORMALIZED during extraction (notably DisplayMath now sits mid-list rather
 * than last) and is therefore NOT byte-identical to the pre-extraction surface
 * stacks — that reorder is schema-inert for the reasons above.
 */
export function buildBorrowedAtomSchema(
  opts: BorrowedSchemaOptions = {},
): AnyExtension[] {
  const { includeLabelRefFootnote = false, includeLabelRef = false, includeFootnote = false } = opts;
  // `includeLabelRefFootnote` is the combined alias (both); the granular flags
  // let a surface opt into just one (RichTextField wants `labelRef` for a
  // footnote-nested `\ref` but NOT the nested-`footnote` marker — footnotes
  // can't nest). CHIP 5.
  const wantLabelRef = includeLabelRefFootnote || includeLabelRef;
  const wantFootnote = includeLabelRefFootnote || includeFootnote;
  return [
    // ── Inline atoms ────────────────────────────────────────────────────
    // Registered BARE (default `surface: "main"`) to preserve the card
    // surfaces' historical behavior exactly — see the module header.
    InlineMath,
    Citation,
    ...(wantLabelRef ? [LabelRef] : []),
    ...(wantFootnote ? [Footnote] : []),
    LatexCommandMark,
    LatexVerbatimMark,
    DisplayMath,
    // ── Block-atom previews (cardContext: compact static preview) ────────
    // These mirror the main editor's schema so JSONContent carrying a block
    // atom (texBlock / figure / graphics / comment / displayMath) round-trips
    // into and out of cards without being silently stripped on load. Adding a
    // new block-atom kind = add it HERE and to the main editor; the contract
    // test (borrowed-schema.test.ts) fails until both surfaces carry it.
    TexBlock.configure({ cardContext: true }),
    FigureBlock.configure({ cardContext: true }),
    FigureCaption,
    GraphicsBlock.configure({ cardContext: true }),
    LatexComment.configure({ cardContext: true }),
  ];
}
