/**
 * Which node types DECLARE which structural attr — the schema facts the
 * TipTap-free `.tex` layers need, spelled ONCE.
 *
 * The parser and the serializer operate on plain `JSONContent` and cannot
 * import the TipTap extensions (React NodeViews, the editor, `@/lib/storage`),
 * so "does this node type carry a `parTitle`?" cannot be asked of the live
 * schema down there. It is declared HERE and every layer reads it from here —
 * the placement rule `latex-markers.ts` earned in task 255: put the SSOT where
 * the layer that needs it can reach it, in a leaf with ZERO imports. A facet
 * the layer that needs it cannot import will be re-copied, every time.
 *
 * **The bug this exists to prevent** (task 343). The sidecar WRITE walked the
 * uuid-bearing set — which includes `exampleBlock` — while the sidecar READ
 * hand-listed four types. So an example block's title was written to
 * `virgil/virgil.json` faithfully, refused on restore, and then **destroyed**:
 * the next save serialized the now-title-less doc back over the sidecar entry.
 * No warning, no undo. The two sides disagreed about exactly the kind nobody
 * remembered — and the four kinds that happened to be on the hand list made it
 * read as flaky rather than broken.
 *
 * **What is written is what can be read back.** Both directions of the sidecar
 * round trip ask these sets, so the symmetry is structural rather than a
 * coincidence that two lists happen to agree.
 *
 * These sets are hand-declared because they cannot be derived here — but they
 * are not hand-*maintained*: [node-attr-sets.test.ts](__tests__/node-attr-sets.test.ts)
 * cross-checks each one against the attrs the REAL main-editor extension list
 * declares, so a schema addition fails the build rather than silently going
 * write-only. That check is the part with teeth: the constant was never the
 * thing that could misbehave — a reader that doesn't consult it is.
 *
 * This module must stay import-free.
 */

/**
 * Node types that carry a `uuid` attr — the anchor identity every sidecar
 * record, card and marginalia marker resolves against.
 *
 * Mirrors the `textObject` schema group declared across `editor-extensions.ts`
 * and the `tiptap/` node specs. `maketitleMarker` is a member: the serializer
 * emits its `%!v:` anchor and the parser round-trips it, but its absence from
 * this set once meant `assignUuids` never minted for it, so it reached the
 * editor uuid-less and the drop-mode hit-test minted mid-drag (a full doc walk
 * plus a synchronous `.tex` flush per pointermove — the D4 drag cliff,
 * MEMO_PERF_DEEP_RESEARCH_2026_08_08.md §5).
 */
export const UUID_BEARING_NODE_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "displayMath",
  "latexComment",
  "titleField",
  "texBlock",
  "forestBlock",
  "figureBlock",
  "graphicsBlock",
  "exampleBlock",
  "exampleItem",
  "maketitleMarker",
]);

/**
 * The BLOCK-ATOM node types a CARD BODY's schema registers — the vocabulary
 * both card scopes (`"card"` and `"excerpt"`) mount, and therefore the
 * vocabulary every PROJECTION of a card body must be total over.
 *
 * A block atom keeps its content in ATTRS, not in child text, so a walker with
 * no arm for it does not degrade — it returns `""`. In a *view* that costs a
 * blank preview; in `richJsonToLatex`, which is what a `\footnote{}` body is
 * SERIALIZED with, it costs the user's bytes.
 *
 * **The bug this exists to prevent** (task 387). `forestBlock` joined both card
 * schemas with task 383 and neither projection in
 * [footnote-content.ts](footnote-content.ts) gained an arm — while its shipped
 * sibling `texBlock`, whose arm sits four lines away, kept its bytes. So a
 * forest tree dropped or pasted into a footnote/note body mounted happily,
 * rendered, and was DELETED from the `.tex` on the next save: no throw, no
 * warning, the rest of the body intact. The comment directly above the table
 * said "Keep aligned with the schema … if a new block atom is added there, add
 * a case here too" — a stated invariant with no consumer, which is the shape
 * this repo keeps re-learning.
 *
 * Declared HERE rather than in `borrowed-schema.ts` for the placement rule at
 * the top of this file: `footnote-content.ts` is on the TipTap-free `.tex` side
 * and cannot import the extension list, so a vocabulary it cannot reach is one
 * it will re-type. `borrowed-schema.ts` re-exports this as
 * `BORROWED_BLOCK_ATOM_NAMES`, whose own contract test already pins it against
 * the REAL card and main-editor extension lists in both directions — so the
 * projections are now total over a set the schema itself keeps honest.
 */
export const CARD_BODY_BLOCK_ATOMS = [
  "texBlock",
  "forestBlock",
  "figureBlock",
  "figureCaption",
  "graphicsBlock",
  "latexComment",
] as const;

/** One member of {@link CARD_BODY_BLOCK_ATOMS}. A projection typed
 *  `Record<CardBodyBlockAtom, …>` fails to COMPILE when a new atom lands,
 *  which is the difference between this and the comment it replaces. */
export type CardBodyBlockAtom = (typeof CARD_BODY_BLOCK_ATOMS)[number];

/**
 * Node types that carry a `parTitle` attr — the optional user-typed title
 * rendered in a strip above the block.
 *
 * The sidecar is the SOLE carrier for every member: `parTitle` is never
 * emitted to the `.tex` (`\partitle{}` is parsed for legacy migration only and
 * nothing serializes it), so a member missing from this set loses the user's
 * typed title on the next save with nothing downstream to heal it.
 */
export const TITLED_NODE_TYPES: ReadonlySet<string> = new Set([
  "paragraph",
  "bulletList",
  "orderedList",
  "texBlock",
  "forestBlock",
  "exampleBlock",
]);

/**
 * Node types that carry a sticky `collapsed` attr, persisted in the sidecar
 * beside `parTitle`. Both members wear the SHARED source pod
 * (src/components/SourcePodNodeView.tsx), whose fold chevron writes this attr —
 * which is why the one-member spelling was declared as a set from the start:
 * that shape is precisely what becomes the next task-343 when a second
 * collapsible kind is added on the write side alone.
 */
export const COLLAPSIBLE_NODE_TYPES: ReadonlySet<string> = new Set([
  "texBlock",
  "forestBlock",
]);

/**
 * Node types whose chrome renders a FOLD CHEVRON in the left margin — the
 * outboard occupant of the margin lane (task 526).
 *
 * Two renderers, one column. `.heading-fold-chevron` is minted by the heading
 * NodeView (`editor-extensions.ts`, main editor only — a float has no
 * section-folding plugin, so no chevron); `.source-pod-fold-chevron` is minted
 * by the shared source pod (`SourcePodNodeView.tsx`), which is exactly the set
 * of kinds that carry the sticky `collapsed` attr — so the pod half is DERIVED
 * from {@link COLLAPSIBLE_NODE_TYPES} rather than re-listed, and a third
 * pod-wearing kind joins this set by declaring itself there.
 *
 * It lives here, in the import-free leaf, for the reason every other set in
 * this file does: `block-frame.ts` (which resolves the reserved column per
 * block) and the sets layer must read ONE list, and a facet the layer that
 * needs it cannot import will be re-copied.
 *
 * Membership decides only whether the column is RESERVED on a row — never
 * where the chevron is. The column's geometry is `--margin-col-chevron` +
 * `--margin-col-chevron-width`, read from CSS in `block-frame.ts`.
 */
export const FOLD_CHEVRON_NODE_TYPES: ReadonlySet<string> = new Set([
  "heading",
  ...COLLAPSIBLE_NODE_TYPES,
]);

/**
 * Container kinds whose DIRECT-child `paragraph` DEFERS its anchor identity to
 * the container — the container is the real text object, and the inner
 * paragraph must carry no uuid of its own.
 *
 * **This lived in `anchor-uuid.ts` and could not be read from here** (task
 * 346), which is the whole reason it forked. That module imports `EditorView`,
 * `@/lib/marginalia` and the text-object registry, so the TipTap-free `.tex`
 * layer cannot touch it — and `latex-serializer.ts` therefore re-typed the rule
 * as a `CONTAINER_TYPES` literal, three times over. The editor's set later
 * gained `exampleItem` and `exampleBlock`; none of the three copies did.
 *
 * The cost was not byte corruption — the `.tex` was stable — it was IDENTITY.
 * Measured over three parse cycles, a paragraph inside `\ex`/`\pex` re-minted
 * a fresh uuid on EVERY open, so `virgil/virgil.json` churned with no user
 * edit, the container and its inner paragraph carried DUPLICATE fingerprints,
 * and `needsUuidWork` — the save-path gate — never reached the `[true, false,
 * false]` fixed point every modelled container reaches. Any paper holding one
 * `\ex` paid the full copy-and-walk on every save, forever.
 *
 * Same class as this module's own reason for existing, one file over: a rule
 * single-declared on one side and hand-listed on the other agrees only about
 * the members somebody remembered.
 *
 * NOT a taxonomy of containers. Three orthogonal facts live nearby and must
 * stay apart (`anchor-resolution.ts` states this): this set answers "does MY
 * inner paragraph defer?" and is read of a paragraph's IMMEDIATE PARENT;
 * `CONTAINER_DESCEND_KINDS` answers where a walk descends; `removeOnEmptyChildren`
 * answers what dies when emptied. `bulletList`/`orderedList` are descend kinds
 * and are deliberately NOT here — a list's own child is a `listItem`, and it is
 * the ITEM that absorbs its paragraph. `figureBlock` is deliberately absent
 * too, recorded as a considered decision at
 * `text-objects/text-object-registry.ts`.
 */
export const DEFERRING_PARENTS: ReadonlySet<string> = new Set([
  "listItem",
  "blockquote",
  "codeBlock",
  "exampleItem",
  "exampleBlock",
]);

/**
 * True iff `node` is a `paragraph` whose IMMEDIATE parent defers — the one
 * predicate every layer asks, so the editor and the `.tex` layer cannot answer
 * differently.
 *
 * Immediate-parent, never an inherited "am I somewhere inside a container"
 * flag: the flag the serializer used was only an APPROXIMATION of this rule,
 * and it is the approximation that let `exampleItemList` (an unlisted
 * structural node between `exampleBlock` and `exampleItem`) reset it.
 */
export function deferringParent(parentType: string | null | undefined): boolean {
  return !!parentType && DEFERRING_PARENTS.has(parentType);
}

// ─────────────────────────────────────────────────────────────────────────────
// Content PRESENCE — "did this JSON carry anything a reader would miss?"
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **A gate written in the vocabulary of NODE TYPES and TEXT cannot see content
 * that lives in ATTRS.** Virgil's payload very often lives in attrs — an
 * `inlineMath`'s `latex`, a `texBlock`'s `code`, a `forestBlock`'s `source`, a
 * `citation`'s `command`, a `graphicsBlock`'s `command`. A walker that recurses
 * looking for a `text` node reports **empty** for every one of them.
 *
 * The bug this exists to prevent (task 401): `hasJsonContent` was exactly that
 * walker, and it backed the destructive-delete confirm for all seven
 * `bodyField: "content"` card kinds AND the footnote pristine reap. So a
 * footnote whose body was `$\lambda$` (or a pasted forest tree) stayed
 * "pristine", and the click-away watcher **deleted it** — no confirm, no orphan
 * card, no undo affordance, on a body that is by construction the only copy.
 * Four card-delete doors skipped the "This item has text" dialog on the same
 * evidence; the ARCHIVE case is the worst blast radius, because the archive
 * card IS the only surviving copy of a passage already cut from the document.
 *
 * **The inversion is the design.** An allowlist of nodes that carry nothing by
 * themselves is CLOSED and small; a denylist of atoms can only be missing the
 * tenth (this repo's own recurring lesson — task 342's env dispatcher, task
 * 343's titled-node read set, task 387's projection table). So: everything
 * carries content EXCEPT the empty structural wrappers a blank document is made
 * of — and a wrapper that carries a payload ATTR of its own is not empty
 * either, which is the same disease one level in and is why the `parTitle`
 * check below is DERIVED from {@link TITLED_NODE_TYPES} rather than re-listed.
 *
 * Cross-checked against the REAL main-editor schema by
 * [node-attr-sets.test.ts](__tests__/node-attr-sets.test.ts): every member must
 * be a node type the schema has AND one it can legally leave empty, and every
 * NON-member of the live schema must be reported as content. A census in the
 * same suite forbids a second copy of this set anywhere in production.
 */
export const EMPTY_WRAPPER_NODE_TYPES: ReadonlySet<string> = new Set([
  "doc",
  "paragraph",
]);

/** True iff `v` is a string with something other than whitespace in it. */
function visibleString(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * Did this `JSONContent` model carry anything a reader would miss?
 *
 * The ONE walker for that question — the destructive-delete confirms, the
 * footnote pristine reap and orphan gates (via `cardHasContent`), and the
 * mount-preservation door (`checkKeptEverything`) all read it, so no two of
 * them can answer differently about the same body.
 *
 * Walked as PLAIN JSON, no schema: the `.tex` layers and the card layer both
 * need it and neither can reach a live `Schema`. Accepts a doc, a bare
 * fragment, or an array of nodes.
 */
export function jsonCarriesContent(json: unknown): boolean {
  let found = false;
  const walk = (n: unknown): void => {
    if (found || !n || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    const node = n as {
      type?: string;
      text?: string;
      content?: unknown;
      attrs?: Record<string, unknown> | null;
    };
    // A TEXT node's content IS its `text` field, so it is answered here and
    // never falls through to the type rule below — otherwise `{type:"text",
    // text:""}` reports content because "text" is not a wrapper NAME. That
    // shape is unreachable from a live ProseMirror doc (PM forbids empty text
    // nodes) and entirely reachable from hand-built JSON: a sidecar written by
    // an `/editor/*` skill, a legacy blob, a fixture.
    if (typeof node.type === "string" && node.type === "text") {
      found = visibleString(node.text);
      return;
    }
    if (visibleString(node.text)) {
      found = true;
      return;
    }
    if (typeof node.type === "string" && !EMPTY_WRAPPER_NODE_TYPES.has(node.type)) {
      found = true;
      return;
    }
    // A wrapper still carries content when it carries a payload attr of its
    // own. `parTitle` is the only one: `uuid` is IDENTITY (a blank paragraph
    // has one and carries nothing), `collapsed` is view state — and neither is
    // declared on a wrapper type anyway except uuid, which is why this reads
    // the titled set rather than "any attr".
    if (
      typeof node.type === "string" &&
      TITLED_NODE_TYPES.has(node.type) &&
      visibleString(node.attrs?.parTitle)
    ) {
      found = true;
      return;
    }
    walk(node.content);
  };
  walk(json);
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structural ATTRS on the StarterKit block nodes — the schema fork that lost
// nine attr names on a card-body edit (task 402)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One attribute's ProseMirror/TipTap spec, spelled structurally so this leaf
 * stays import-free. Assignable to TipTap's `Attribute` (a spec that declares
 * FEWER fields inherits the framework defaults: `rendered: true`,
 * `keepOnSplit: true`, no custom parse/render).
 */
export interface StructuralAttrSpec {
  readonly default: string | number | boolean | null;
  /** `false` = the attr exists in the schema and never touches the DOM. Source
   *  provenance (`listOptions`, `itemLabel`, `shortTitle`) and recomputed state
   *  (`numbered`, `sectionNumber`) are both invisible to the live render. */
  readonly rendered?: boolean;
  /** `false` = a split does NOT carry the attr onto the new sibling. Required
   *  for anything that NAMES the node (`itemLabel`, `shortTitle`, `listOptions`):
   *  carrying one across an Enter mints a duplicate marker the user never typed,
   *  with no re-mint net (contrast `uuid`, which `BlockUuidBackfill` re-mints). */
  readonly keepOnSplit?: boolean;
  readonly parseHTML?: (element: HTMLElement) => unknown;
  readonly renderHTML?: (
    attrs: Record<string, unknown>,
  ) => Record<string, string | undefined>;
}

/** A node type's extra attrs, keyed by attr name. */
export type StructuralAttrSpecs = Readonly<Record<string, StructuralAttrSpec>>;

/**
 * Shared spec for the `uuid` attribute used by every anchorable node type.
 *
 * The UUID lives in node attrs (ProseMirror state). It is NOT serialized to
 * HTML on copy-paste — `parseHTML` returns null so paste always produces a node
 * without a UUID, which `ensureAnchorUuid` then hydrates with a fresh one. That
 * keeps UUIDs unique within a doc.
 *
 * Declared HERE rather than in `tiptap/uuid-attr.ts` (which re-exports it, so
 * every existing importer is unchanged) because it is one of the nineteen
 * node x attr pairs {@link MAIN_STARTERKIT_NODE_ATTRS} has to state, and that
 * table cannot import a module that reaches `EditorView`. A spec spelled twice
 * is a spec that can drift.
 */
export const UUID_ATTR_SPEC: { readonly uuid: StructuralAttrSpec } = {
  uuid: {
    default: null,
    // Don't carry UUID across copy-paste — fresh node, fresh identity.
    parseHTML: () => null,
    // Cosmetic: when a node is serialized to HTML (export, devtools inspect)
    // and has no NodeView in the way, emit `data-uuid` so the representation
    // matches the live DOM. For NodeView-bearing nodes this is dead code; the
    // live attributes come from the NodeView stamp.
    renderHTML: (attrs: Record<string, unknown>) => {
      const uuid = attrs.uuid;
      return typeof uuid === "string" && uuid ? { "data-uuid": uuid } : {};
    },
  },
};

/**
 * uuid attr spec for anchorable types WITHOUT a NodeView (listItem, blockquote,
 * codeBlock): their live DOM comes from `renderHTML`, so it must emit BOTH
 * `data-uuid` and `data-text-object-kind` (the grab-handle hover resolver reads
 * the kind straight off the DOM). NodeView-bearing types use
 * {@link UUID_ATTR_SPEC} + `stampTextObjectAttrs` instead.
 */
export function makeUuidAttr(typeName: string): StructuralAttrSpec {
  return {
    default: null,
    parseHTML: () => null,
    renderHTML: (attrs: Record<string, unknown>) => {
      const uuid = attrs.uuid;
      return typeof uuid === "string" && uuid
        ? { "data-uuid": uuid, "data-text-object-kind": typeName }
        : {};
    },
  };
}

/**
 * The attrs the MAIN editor adds ON TOP of StarterKit's own, per block node —
 * the ONE declaration both the main editor and the EXCERPT card body read.
 *
 * **The bug this exists to prevent** (task 402, DATA LOSS). An archive card
 * body is an excerpt surface: it holds a verbatim slice of the document, and
 * after the capture deleted that slice it is the ONLY copy. It mounted
 * StarterKit's PLAIN nodes while the main editor turned those same nodes off
 * and registered its own with these extras — so the two schemas agreed about
 * every node TYPE and disagreed about nineteen node x attr pairs.
 *
 * ProseMirror drops an attr the mounted schema does not declare, SILENTLY:
 * `computeAttrs` iterates the TYPE's attrs, and `checkAttrs` then validates the
 * already-computed result, which by construction contains no undeclared keys.
 * So the loss had no throw, no warning and no symptom until the `.tex` came
 * back short.
 *
 * **The stripper was the card-body EDIT, not the restore.** `RichTextField`'s
 * `onUpdate` (250 ms debounce) and its `onBlur` flush both call
 * `onChange(editor.getJSON())` on the attr-poor mounted schema, and the archive
 * host writes that straight over `snippet.content`. So: archive (attrs intact)
 * -> the user edits ONE character in the card -> `archive.json` now holds an
 * attr-less heading -> restore faithfully hands back the lamed version. An
 * UNEDITED excerpt restored whole, which is exactly why it read as flaky.
 *
 * What each loss cost, on the restored `.tex`: `label` / `numbered` /
 * `shortTitle` are the heading's `\label{}`, its `*` and its `[short]`;
 * `listOptions` / `listPreamble` are `\begin{itemize}[…]` and its tuning lines;
 * `itemLabel` is `\item[…]`. `parTitle` has no `.tex` carrier at all — it lives
 * in the sidecar and was simply gone. `uuid` is IDENTITY, not bytes:
 * `BlockUuidBackfill` mints a FRESH one on restore, so every card anchored to
 * the archived block ORPHANS rather than re-anchoring.
 *
 * Read by `editor-extensions.ts` (each builder spreads its row) and by
 * `borrowed-schema.ts` (the excerpt surface adds the same rows via
 * {@link dataOnlyAttrs}). Held to the REAL main schema in BOTH directions by
 * [node-attr-sets.test.ts](__tests__/node-attr-sets.test.ts) and by the widened
 * reverse contract in
 * [excerpt-schema.test.ts](../lib/tiptap/__tests__/excerpt-schema.test.ts), so
 * the next attr added to a main node fails the build until the excerpt surface
 * admits it — which is the part with teeth. The table was never the thing that
 * could misbehave; a surface that does not read it is.
 */
export const MAIN_STARTERKIT_NODE_ATTRS = {
  paragraph: {
    parTitle: { default: null },
    ...UUID_ATTR_SPEC,
  },
  heading: {
    label: { default: null },
    ...UUID_ATTR_SPEC,
    numbered: { default: true, rendered: false },
    sectionNumber: { default: null, rendered: false },
    // Raw `\section[short]{…}` running-head / ToC title (task 376) — opaque
    // LaTeX, the heading twin of `figureBlock.shortCaption` and
    // `listItem.itemLabel`. `rendered: false` because it is source provenance,
    // not something the live DOM shows. `keepOnSplit: false` for `itemLabel`'s
    // reason: pressing Enter at the end of a heading mints a NEW heading, and
    // carrying the short title across would give it a running head the user
    // never typed, on a section it does not name. `null` = no bracket.
    shortTitle: { default: null, rendered: false, keepOnSplit: false },
  },
  bulletList: {
    parTitle: { default: null },
    ...UUID_ATTR_SPEC,
    listPreamble: { default: null, rendered: false },
    // Raw `\begin{itemize}[options]` bracket (task 376) — opaque LaTeX, the
    // list-level twin of `listItem.itemLabel`. Source provenance, so
    // `rendered: false`; `keepOnSplit: false` for the same reason a label is
    // not carried onto a freshly split sibling.
    listOptions: { default: null, rendered: false, keepOnSplit: false },
  },
  orderedList: {
    parTitle: { default: null },
    ...UUID_ATTR_SPEC,
    listPreamble: { default: null, rendered: false },
    listOptions: { default: null, rendered: false, keepOnSplit: false },
  },
  listItem: {
    // No NodeView -> renderHTML is the live DOM; emit uuid + kind (2d).
    uuid: makeUuidAttr("listItem"),
    // Raw `\item[label]` optional argument (task 340) — opaque LaTeX, the
    // per-item twin of the list's own `listPreamble`. Registered on the NODE
    // rather than re-read from the source at save time so it survives an edit
    // to the item's text; `rendered: false` because it is source provenance,
    // not something the live DOM shows (the editor draws the list's own
    // marker), which also means copy-paste cannot carry it — same fresh-node
    // reasoning as `uuid`'s `parseHTML: () => null`.
    // `null` = a bare `\item`; `""` = `\item[]`.
    //
    // `keepOnSplit: false` is load-bearing and NOT what `uuid` does: TipTap's
    // default is to carry an attr across a split, so pressing Enter at the end
    // of `\item[(b)] beta` would mint a second item ALSO labelled `(b)` — a
    // duplicate marker in the compiled PDF that the user never typed. `uuid`
    // can afford the default because `BlockUuidBackfill` re-mints the
    // collision; a label has no such net and no meaning to re-mint, so the new
    // item must simply have none.
    itemLabel: { default: null, rendered: false, keepOnSplit: false },
  },
  blockquote: {
    // No NodeView -> renderHTML is the live DOM; emit uuid + kind (2d).
    uuid: makeUuidAttr("blockquote"),
  },
  codeBlock: {
    // No NodeView -> renderHTML is the live DOM; emit uuid + kind (2d).
    uuid: makeUuidAttr("codeBlock"),
  },
} as const satisfies Readonly<Record<string, StructuralAttrSpecs>>;

/** One node type {@link MAIN_STARTERKIT_NODE_ATTRS} speaks for. */
export type MainStarterKitNodeName = keyof typeof MAIN_STARTERKIT_NODE_ATTRS;

/**
 * The same attrs, DATA ONLY — same `default` and `keepOnSplit`, never emitted
 * to or parsed from the DOM.
 *
 * The EXCERPT card body needs the attrs to EXIST (so the JSON round trip
 * carries them) and must NOT stamp them into a second DOM tree. `data-uuid` in
 * particular is a resolution key: `resolveDomForUuid`, the grab-handle hover
 * scan and the marginalia registry all key on it, and a card body running
 * inside its own editor has none of that chrome. Same discipline
 * `buildExcerptOnlySchema` already states one file over — **mirror the schema,
 * not the machinery** — arriving one level in, at the attribute.
 *
 * `rendered` is a DOM fact only: `toJSON`/`fromJSON` read `node.attrs`
 * regardless, which is why every already-`rendered: false` member of the table
 * (`listOptions`, `itemLabel`, `shortTitle`, `numbered`) round-trips through
 * the sidecar and the serializer today.
 */
export function dataOnlyAttrs(specs: StructuralAttrSpecs): StructuralAttrSpecs {
  return Object.fromEntries(
    Object.entries(specs).map(([name, spec]) => [
      name,
      {
        default: spec.default,
        keepOnSplit: spec.keepOnSplit ?? true,
        rendered: false,
      },
    ]),
  );
}
