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

import { getSchema, type AnyExtension } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
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
  ExampleBlock,
  ExampleItemList,
  ExampleItem,
  ExampleGloss,
  AlignedGlossRow,
  ProseGlossRow,
  GlossCell,
  TitleField,
  MaketitleMarker,
  TextColor,
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
 * The StarterKit config for an EXCERPT surface — a card body whose content is a
 * verbatim slice of the MAIN DOCUMENT rather than prose the user typed into the
 * card (today: `archive`; see `bodySchema` on `CardMeta`).
 *
 * StarterKit's defaults already carry the full block vocabulary, so this is
 * deliberately the empty override: heading / blockquote / codeBlock /
 * horizontalRule stay ON. Named rather than inlined so the excerpt/card split is
 * a declared pair in this one SSOT, and so `{@link starterKitConfigForScope}`
 * reads as a total function over the scope union.
 *
 * WHY (task 308, DATA LOSS): {@link CARD_STARTER_KIT_CONFIG}'s rationale — those
 * four "make no sense in a footnote / note body" — is right for authored card
 * prose and WRONG for a document excerpt, whose whole purpose is holding
 * arbitrary excised document content. Archiving a section captured a faithful
 * `heading`-bearing slice, deleted the section from the doc, and then handed the
 * capture to a body schema with no `heading` node. TipTap does not throw on an
 * unknown node type — `createNodeFromContent` swallows the `RangeError` and
 * returns an EMPTY document (`enableContentCheck` is off) — so the card booted
 * blank, and the first keystroke in that blank body persisted the empty doc back
 * over the capture. Deleted from the document, unmountable in the card.
 */
export const EXCERPT_STARTER_KIT_CONFIG = {};

/**
 * Which vocabulary a card body mounts. Declared per card kind as
 * `CardMeta.bodySchema` and resolved ONCE in `EditableCard`, which threads it to
 * both body surfaces (`RichTextField` when expanded, `BorrowedMainText` when
 * compressed) — so a kind cannot render through two different schemas.
 *
 *   "card"    — authored card prose. The narrow footnote/note surface.
 *   "excerpt" — a verbatim slice of the main document. The full block
 *               vocabulary, because whatever the user can archive, the archive
 *               must be able to hold.
 */
export type CardBodySchemaScope = "card" | "excerpt";

export function starterKitConfigForScope(scope: CardBodySchemaScope) {
  return scope === "excerpt" ? EXCERPT_STARTER_KIT_CONFIG : CARD_STARTER_KIT_CONFIG;
}

/**
 * Block nodes + marks an EXCERPT surface registers ON TOP of the shared borrowed
 * atom set — the main-document vocabulary that is not "an atom a card quotes"
 * but "structure the document itself is made of".
 *
 * Each is registered in its NON-main mode (`surface` defaults to `"float"`;
 * `ExampleBlock` takes `cardContext: true` for the compact preview, matching
 * how `buildBorrowedAtomSchema` registers the other block-atom previews), so an
 * excerpt body gets the node SPEC without the main editor's doc-wide chrome —
 * no numberers, no label handler, no orphan guards. Same discipline as the
 * block-atom previews: mirror the schema, not the machinery.
 *
 * `highlight` / `textColor` are MARKS the user can apply to live document prose,
 * so any captured slice can carry them; without them the excerpt blanks exactly
 * like a missing node type (an unknown mark hits the same swallowed
 * `RangeError`). They are NOT in {@link CARD_STARTER_KIT_CONFIG}'s surface and
 * are NOT stripped by `normalizeRichContent` (which filters `DOC_ONLY_MARKS`
 * only) — task 308's cluster.
 */
function buildExcerptOnlySchema(): AnyExtension[] {
  return [
    Highlight.configure({ multicolor: true }),
    TextColor,
    // ── expex example family ────────────────────────────────────────────
    ExampleBlock.configure({ cardContext: true }),
    ExampleItemList,
    ExampleItem,
    ExampleGloss,
    AlignedGlossRow,
    ProseGlossRow,
    GlossCell,
    // ── document front matter ───────────────────────────────────────────
    // Reachable in an excerpt only via a SELECTION spanning the title block,
    // but a slice that carries one must still mount.
    TitleField,
    MaketitleMarker,
  ];
}

/**
 * The atom + block sub-schema for a card body at the given scope — the single
 * composition point both card surfaces call.
 *
 * `"card"` is exactly the historical {@link buildBorrowedAtomSchema} behavior.
 * `"excerpt"` additionally forces `includeLabelRefFootnote` (a captured
 * paragraph routinely carries a `\footnote` marker and a `\ref`; omitting the
 * marker was a SURFACE-ASYMMETRIC bug — `BorrowedMainText` registers `footnote`
 * and `RichTextField` does not, so an archived paragraph holding a footnote
 * rendered fine collapsed and went blank on expand) and layers
 * {@link buildExcerptOnlySchema} on top.
 */
export function buildCardBodySchema(
  scope: CardBodySchemaScope,
  opts: BorrowedSchemaOptions = {},
): AnyExtension[] {
  if (scope !== "excerpt") return buildBorrowedAtomSchema(opts);
  return [
    ...buildBorrowedAtomSchema({ ...opts, includeLabelRefFootnote: true }),
    ...buildExcerptOnlySchema(),
  ];
}

// ---------------------------------------------------------------------------
// The never-destroy invariant (task 308)
// ---------------------------------------------------------------------------

/**
 * Resolved ProseMirror `Schema` per scope, built once and cached. `getSchema` is
 * pure over the extension list, and neither surface's extra layers (Placeholder
 * / TabIndent / read-only) contribute nodes or marks — so this schema is exactly
 * what the mounted body will accept.
 */
const SCHEMA_CACHE = new Map<CardBodySchemaScope, Schema>();

function schemaForScope(scope: CardBodySchemaScope): Schema {
  let cached = SCHEMA_CACHE.get(scope);
  if (!cached) {
    cached = getSchema([
      StarterKit.configure({ ...starterKitConfigForScope(scope) }),
      // The widest option set a surface at this scope can mount. A body that
      // registers FEWER atoms (RichTextField omits the nested `footnote`
      // marker at "card" scope) is not the concern here: this predicate gates a
      // DESTRUCTIVE capture, so it must model the destination generously enough
      // to not refuse content that will in fact mount, and the excerpt scope —
      // the only scope a destructive capture writes to — registers everything.
      ...buildCardBodySchema(scope, { includeLabelRefFootnote: true }),
    ]);
    SCHEMA_CACHE.set(scope, cached);
  }
  return cached;
}

/** Result of {@link canMountInCardBody}. */
export type CardBodyMountCheck =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Can this captured JSONContent actually be REPRESENTED by a card body at
 * `scope`? The enforcement point for the invariant:
 *
 * > **A destructive lifecycle action never deletes content its capture cannot
 * > hold.**
 *
 * Call this BEFORE dispatching the delete. On `ok: false` the caller must abort
 * the deletion and notify — never destroy content that will come back blank.
 *
 * This exists because the failure it guards is SILENT in both directions: the
 * capture is faithful (so nothing looks wrong at write time) and TipTap swallows
 * the schema mismatch into an empty document (so nothing looks wrong at read
 * time either) — the user just finds their section gone. Validating the capture
 * against the destination's real schema is the one check that cannot drift from
 * what the body will actually do, because it asks the schema itself.
 *
 * Cheap: one `Schema.nodeFromJSON` over the captured slice (edit-sized, not
 * doc-sized) on a cached schema, on a discrete user action — never on a
 * keystroke path.
 */
export function canMountInCardBody(
  json: unknown,
  scope: CardBodySchemaScope,
): CardBodyMountCheck {
  if (json == null) return { ok: true };
  try {
    schemaForScope(scope).nodeFromJSON(json as never);
    return { ok: true };
  } catch (err) {
    // ProseMirror's messages are already precise and user-legible enough to act
    // on ("Unknown node type: heading"); surface it rather than flattening every
    // cause to one opaque string.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

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
