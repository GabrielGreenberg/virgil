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
