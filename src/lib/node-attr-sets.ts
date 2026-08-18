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
  "figureBlock",
  "graphicsBlock",
  "exampleBlock",
  "exampleItem",
  "maketitleMarker",
]);

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
  "exampleBlock",
]);

/**
 * Node types that carry a sticky `collapsed` attr, persisted in the sidecar
 * beside `parTitle`. One member today — declared as a set anyway, because the
 * one-member hand list is precisely the shape that becomes the next task-343
 * (a second collapsible kind added on the write side alone).
 */
export const COLLAPSIBLE_NODE_TYPES: ReadonlySet<string> = new Set([
  "texBlock",
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
