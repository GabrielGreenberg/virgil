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
