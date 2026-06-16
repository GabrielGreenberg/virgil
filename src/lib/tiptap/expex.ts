import { Node, Extension, mergeAttributes } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TextSelection, Selection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { generateShortId } from "@/lib/uuid";
import { UUID_ATTR_SPEC } from "./uuid-attr";
import { readDocStructure, readPendingDiff } from "@/lib/tiptap/doc-structure";

// The exampleBlock NodeView no longer hosts a grip or popout button — the
// editor-mounted TextObjectGrabHandle handles both. No per-extension
// options needed for grip/popout wiring.
export interface ExampleBlockOptions {
  /** When true, the NodeView suppresses the par-title annotation strip
   *  (the hover-revealed "+T" affordance + any title row). Card / float
   *  surfaces set this (#47): the absolutely-positioned untitled strip sits
   *  ABOVE the block top, so on a card it overlays the card header and
   *  collides with the card's own CardBodyTitle "+T". The card host owns the
   *  title affordance; the example body must not paint a second one. The
   *  "Ex." label pod is NOT gated — the example float uses it to rename the
   *  `\label{}`. main: false (the in-doc editable example keeps its +T).
   *
   *  NOTE — this suppresses any EXISTING par-title TEXT too, not just the +T
   *  add-button: with `titleAnnot` null, `renderTitle()` early-returns, so a
   *  titled example shows no title row on a card. This is an INTENTIONAL
   *  divergence from `TexBlock`'s `cardContext` (which keeps a compact static
   *  title in card context); on an example the card host's own title is the
   *  single title affordance. */
  cardContext: boolean;
}

function collectExampleIds(doc: import("@tiptap/pm/model").Node): Set<string> {
  const out = new Set<string>();
  doc.descendants((node) => {
    if (node.type.name === "exampleBlock" && node.attrs.uuid) {
      out.add(node.attrs.uuid as string);
    }
    return true;
  });
  return out;
}

// Seven nodes implement the expex package:
//
//   exampleBlock         — top-level numbered example (\ex … \xe or \pex … \xe)
//   exampleItemList      — invisible wrapper around \a items at one nesting tier
//                          (top-level inside exampleBlock, or nested inside an
//                          item to express \begin{xlist}…\end{xlist})
//   exampleItem          — one \a sub-part
//   exampleGloss         — a \begingl … \endgl interlinear gloss block
//   alignedGlossRow      — one \gla / \glb / \glc row (columnar)
//   proseGlossRow        — one \glpreamble / \glft row (prose)
//   glossCell            — a single column inside an alignedGlossRow
//
// The exampleBlock carries a `number` attr and each exampleItem carries a
// depth-aware `subLabel` ("a"/"i"/"A"/"I"); both are maintained live by the
// numbering ProseMirror plugin below, and also one-shot at parse time by a
// helper invoked from latex-parser.ts.

function toSubLabel(n: number): string {
  // 1→"a", 2→"b", … 26→"z", 27→"aa", …
  let s = "";
  let i = n;
  while (i > 0) {
    i--;
    s = String.fromCharCode(97 + (i % 26)) + s;
    i = Math.floor(i / 26);
  }
  return s || "a";
}

function toAlphaUpper(n: number): string {
  // 1→"A", 2→"B", … 26→"Z", 27→"AA", …
  let s = "";
  let i = n;
  while (i > 0) {
    i--;
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26);
  }
  return s || "A";
}

function toRomanLower(n: number): string {
  if (n <= 0) return "i";
  const arabic = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
  const roman = ["m", "cm", "d", "cd", "c", "xc", "l", "xl", "x", "ix", "v", "iv", "i"];
  let out = "";
  let v = n;
  for (let k = 0; k < arabic.length; k++) {
    while (v >= arabic[k]) {
      out += roman[k];
      v -= arabic[k];
    }
  }
  return out || "i";
}

function toRomanUpper(n: number): string {
  return toRomanLower(n).toUpperCase();
}

/** Depth-aware item marker. Mirrors the expex package counter defaults:
 *  depth 0 (items inside an exampleBlock)        → a, b, c
 *  depth 1 (items inside an item's xlist)        → i, ii, iii
 *  depth 2                                       → A, B, C
 *  depth 3                                       → I, II, III
 *  Beyond depth 3 the cycle repeats.
 */
export function markerForDepth(depth: number, n: number): string {
  const tier = ((depth % 4) + 4) % 4;
  switch (tier) {
    case 0: return toSubLabel(n);
    case 1: return toRomanLower(n);
    case 2: return toAlphaUpper(n);
    case 3: return toRomanUpper(n);
    default: return toSubLabel(n);
  }
}

// ---------------------------------------------------------------------------
// Doc-adaptive number / marker column widths (backlog #25)
// ---------------------------------------------------------------------------

/**
 * The CSS value for the example-number gutter (`.expex-block` / `.expex-item`
 * grids consume it as `--expex-num-width`). Returns `null` for the common
 * 1-digit doc, so the CSS default (`1.5em`, the tuned baseline for `(1)..(9)`)
 * stays in force and the appearance is byte-identical. For 2+ digits the gutter
 * widens to hold `(` + N digits + `)` without wrapping — shared across the whole
 * doc so every example stays aligned (option c).
 *
 * Width is `${digits + 2}ch`: 2 ch of slack covers the two parens at the 0.95em
 * serif size of `.expex-number` with comfortable margin.
 */
export function expexNumWidth(maxDigits: number): string | null {
  if (maxDigits <= 1) return null;
  return `${maxDigits + 2}ch`;
}

/**
 * The CSS value for the item-marker gutter (`--expex-marker-width`). Markers are
 * `a.`/`i.`/`viii.`/`xviii.` … `maxMarkerLen` is the longest marker STRING
 * length (letters only, the trailing "." is added in CSS via the glyph). Returns
 * `null` for short markers (≤ 2 chars, e.g. `a.`/`ii.`) so the 1.5em baseline
 * stays; widens for long romans so they don't overflow their column.
 */
export function expexMarkerWidth(maxMarkerLen: number): string | null {
  if (maxMarkerLen <= 2) return null;
  // marker glyphs + the trailing "." ≈ (len + 1) ch; +0.5 slack.
  return `${maxMarkerLen + 1.5}ch`;
}

/** The doc-adaptive column widths for the expex gutters (backlog #25). */
export interface ExpexColumnWidths {
  numWidth: string | null;
  markerWidth: string | null;
}

/**
 * Walk a doc and derive the shared `--expex-num-width` / `--expex-marker-width`
 * values from its widest displayed example number and item marker. This is a
 * full doc walk, so it must only run on structural change (the ExpexNumbering
 * appendTransaction is already gated) or once at load (plugin-state `init`) —
 * NEVER per keystroke.
 */
export function computeExpexWidths(
  doc: import("@tiptap/pm/model").Node,
): ExpexColumnWidths {
  let maxDigits = 0;
  let maxMarkerLen = 0;
  const visit = (node: import("@tiptap/pm/model").Node) => {
    if (node.type.name === "exampleBlock") {
      const num = Number(node.attrs.number) || 0;
      const digits = num > 0 ? String(num).length : 1;
      if (digits > maxDigits) maxDigits = digits;
    } else if (node.type.name === "exampleItem") {
      const marker = String(node.attrs.subLabel || "");
      if (marker.length > maxMarkerLen) maxMarkerLen = marker.length;
    }
  };
  // Inspect the root itself too — callers may pass a bare exampleBlock (the
  // float surface) where `descendants` would skip the top node.
  visit(doc);
  doc.descendants((node) => {
    visit(node);
    return true;
  });
  return {
    numWidth: expexNumWidth(maxDigits),
    markerWidth: expexMarkerWidth(maxMarkerLen),
  };
}

// ---------------------------------------------------------------------------
// Shared empty-example deletion
// ---------------------------------------------------------------------------

/**
 * Delete the empty example structure the cursor currently sits in.
 *
 * Factored out of the two Shift-Tab handlers (ExampleItem promote, ExampleBlock
 * dissolve) so the Backspace/Delete handlers can reuse the *delete* half
 * without the promote/dissolve re-insert.
 *
 * Two cursor positions are handled:
 *
 *  - Cursor in an `exampleItem` (a sub-item `a.`/`i.`/…): the 3-way delete
 *    that ExampleItem Shift-Tab already computes —
 *      • only item, only list, no other block content → delete whole block;
 *      • only item in its list (block has other content) → delete the list
 *        (and flip block kind back to "single" if no list survives);
 *      • otherwise → delete just the item.
 *
 *  - Cursor at the top level of an `exampleBlock` (a preamble/trailing
 *    paragraph, not inside a sub-item) on a fully-empty block → delete the
 *    block (landing in the previous block) or, if it is the doc's only/leading
 *    content, dissolve it to a plain empty paragraph.
 *
 * Returns a ready-to-dispatch `Transaction` (with selection + scrollIntoView
 * already set) or `null` when the cursor is not in a deletable empty example
 * structure. The caller's own empty-paragraph + cursor-at-start guard decides
 * *whether* to call this; the ExpexNumbering appendTransaction re-letters /
 * renumbers whatever survives.
 */
export function deleteEmptyExampleStructure(
  state: EditorState,
): Transaction | null {
  const { $from } = state.selection;

  // Resolve the nearest exampleItem (if any) and the enclosing block.
  let itemDepth = -1,
    listDepth = -1,
    blockDepth = -1;
  for (let d = $from.depth; d >= 0; d--) {
    const name = $from.node(d).type.name;
    if (itemDepth < 0 && name === "exampleItem") itemDepth = d;
    else if (listDepth < 0 && itemDepth >= 0 && name === "exampleItemList")
      listDepth = d;
    if (name === "exampleBlock") {
      blockDepth = d;
      break;
    }
  }
  if (blockDepth < 0) return null;

  // --- Sub-item case: 3-way delete (block / list / item). ---
  if (itemDepth >= 0 && listDepth >= 0) {
    const itemNode = $from.node(itemDepth);
    const itemStart = $from.before(itemDepth);
    const itemEnd = itemStart + itemNode.nodeSize;
    // Data-loss guard: only delete the item when it is a LONE empty paragraph.
    // If the item also carries nested content (a Tab-nested exampleItemList or
    // a gloss) alongside the empty line the cursor is on, deleting the item
    // would silently destroy that content — fall through to default deletion
    // instead. (Shift-Tab gets away with the same delete because it re-inserts
    // the content as a new block; this path does not.)
    if (itemNode.childCount !== 1 || (itemNode.firstChild?.content.size ?? 0) !== 0) {
      return null;
    }
    const listNode = $from.node(listDepth);
    const listStart = $from.before(listDepth);
    const listEnd = listStart + listNode.nodeSize;
    const blockNode = $from.node(blockDepth);
    const blockStart = $from.before(blockDepth);
    const blockEnd = $from.after(blockDepth);

    const tr = state.tr;
    let deleteFrom: number;
    let originalBlockGone = false;
    if (
      listNode.childCount === 1 &&
      blockNode.childCount === 1 &&
      blockNode.firstChild?.type.name === "exampleItemList"
    ) {
      // Only item, only list, nothing else in the block → delete the block.
      tr.delete(blockStart, blockEnd);
      deleteFrom = blockStart;
      originalBlockGone = true;
    } else if (listNode.childCount === 1) {
      // Only item in its list, but block has other content → delete the list.
      tr.delete(listStart, listEnd);
      deleteFrom = listStart;
    } else {
      // One of several items → delete just this item.
      tr.delete(itemStart, itemEnd);
      deleteFrom = itemStart;
    }

    // If the block survived but no longer holds any item list, flip its kind
    // back to "single" so serialization emits \ex (mirrors Shift-Tab).
    if (!originalBlockGone) {
      const survivor = tr.doc.nodeAt(blockStart);
      if (
        survivor &&
        survivor.type.name === "exampleBlock" &&
        survivor.attrs.kind === "multi"
      ) {
        let hasList = false;
        survivor.forEach((c) => {
          if (c.type.name === "exampleItemList") hasList = true;
        });
        if (!hasList) {
          tr.setNodeMarkup(blockStart, undefined, {
            ...survivor.attrs,
            kind: "single",
          });
        }
      }
    }

    // Land the cursor at the nearest selectable position to the deletion
    // point (end of the previous sibling, or start of what shifted up).
    const landAt = Math.min(deleteFrom, tr.doc.content.size);
    tr.setSelection(Selection.near(tr.doc.resolve(landAt), -1));
    return tr.scrollIntoView();
  }

  // --- Top-level case: cursor in a block-level paragraph, not in a sub-item. ---
  const blockNode = $from.node(blockDepth);
  // Only fire on a fully-empty block — a single empty paragraph.
  const blockIsEmpty =
    blockNode.childCount === 1 &&
    blockNode.firstChild?.type.name === "paragraph" &&
    blockNode.firstChild.content.size === 0;
  if (!blockIsEmpty) return null;

  const blockStart = $from.before(blockDepth);
  const blockEnd = $from.after(blockDepth);
  const paraType = state.schema.nodes.paragraph;
  if (!paraType) return null;

  // If there is a previous block-level sibling in the doc, remove the empty
  // example entirely and land the cursor at the end of that sibling. Otherwise
  // (the example is the doc's leading/only content) dissolve it into a plain
  // empty paragraph so the document is never left empty.
  const $blockStart = state.doc.resolve(blockStart);
  const hasPrevSibling = $blockStart.nodeBefore != null;
  if (hasPrevSibling) {
    const tr = state.tr.delete(blockStart, blockEnd);
    const landAt = Math.min(blockStart, tr.doc.content.size);
    tr.setSelection(Selection.near(tr.doc.resolve(landAt), -1));
    return tr.scrollIntoView();
  }

  const tr = state.tr.replaceWith(blockStart, blockEnd, paraType.create());
  tr.setSelection(TextSelection.create(tr.doc, blockStart + 1));
  return tr.scrollIntoView();
}

// ---------------------------------------------------------------------------
// exampleBlock
// ---------------------------------------------------------------------------

export const ExampleBlock = Node.create<ExampleBlockOptions>({
  name: "exampleBlock",
  group: "block textObject",

  addOptions() {
    return { cardContext: false };
  },
  // Free-order content: paragraphs, gloss blocks, and item lists can
  // interleave in any order. The relaxed schema lets list-item Shift-Tab
  // demote a middle item out of its list (which splits the list into
  // two). The serializer walks children in document order so the .tex
  // round-trip preserves the layout.
  //
  // Feature A2 adds `graphicsBlock | displayMath` to the union so a dropped
  // picture / equation can join a SINGLE example's body directly (paragraph
  // was already valid) — the example stays one numbered example. Additive +
  // free-order `*`, so every existing example loads byte-identically.
  content:
    "(paragraph | exampleGloss | exampleItemList | bulletList | orderedList | graphicsBlock | displayMath)*",
  defining: true,
  isolating: true,

  // Top-level keyboard shortcuts:
  //   Enter — when cursor is at the end of the LAST paragraph of the
  //           block (and not inside a sub-item), or in any empty
  //           trailing paragraph anywhere in the block, escape out and
  //           create a new sibling exampleBlock — i.e. a new (n+1).
  //   Tab — in a paragraph at the top level of the block (not yet a
  //         sub-item), convert it into a sub-item (single → multi).
  //   Shift-Tab — when the cursor is in a sub-item and that's the only
  //               item in the block, demote it back to a top-level
  //               paragraph (multi → single).
  // Sub-item Enter / Tab / Shift-Tab are owned by ExampleItem (which is
  // registered after this node, so it picks up Enter/Tab in the
  // already-multi case after this handler defers).
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;

        // Find enclosing exampleBlock.
        let blockDepth = -1;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "exampleBlock") {
            blockDepth = d;
            break;
          }
        }
        if (blockDepth < 0) return false;

        // The paragraph must be at the END of the exampleBlock — every
        // wrapping level between cursor and block must be the last
        // position in its parent.
        for (let d = $from.depth; d > blockDepth; d--) {
          if ($from.indexAfter(d - 1) !== $from.node(d - 1).childCount) {
            return false;
          }
        }

        // Are we inside an exampleItem (i.e. a sub-item)?
        let inItem = false;
        for (let d = $from.depth - 1; d > blockDepth; d--) {
          if ($from.node(d).type.name === "exampleItem") {
            inItem = true;
            break;
          }
        }

        const isEmpty = $from.parent.content.size === 0;
        const cursorAtEnd = $from.pos === $from.end();

        // Decide whether to escape:
        //   - Inside a sub-item: only escape on empty trailing (let
        //     ExampleItem's Enter split a non-empty item normally).
        //   - At the block's top level (preamble/trailing paragraph):
        //     escape on cursor-at-end OR on empty paragraph — single
        //     press creates a new (n+1).
        if (inItem) {
          if (!isEmpty) return false;
        } else {
          if (!isEmpty && !cursorAtEnd) return false;
        }

        // If escaping on empty trailing, find the deepest "trailing-
        // only-child" wrapper to delete; the whole subtree is just
        // empty trailing structure and gets removed.
        let deleteDepth = -1;
        if (isEmpty) {
          deleteDepth = $from.depth;
          for (let d = $from.depth - 1; d > blockDepth; d--) {
            if ($from.node(d).childCount === 1) {
              deleteDepth = d;
            } else {
              break;
            }
          }
        }
        const blockNode = $from.node(blockDepth);
        const blockStart = $from.before(blockDepth);
        const blockEnd = $from.after(blockDepth);
        const paraType = state.schema.nodes.paragraph;
        const blockType = state.schema.nodes.exampleBlock;
        if (!blockType || !paraType) return false;

        // Special case: if the entire exampleBlock is empty (just one
        // empty paragraph), Enter escapes the block — replace the block
        // with a plain empty paragraph rather than spawning a new (n+1).
        const blockIsEmpty =
          blockNode.childCount === 1 &&
          blockNode.firstChild?.type.name === "paragraph" &&
          blockNode.firstChild.content.size === 0;
        if (blockIsEmpty) {
          const tr = state.tr.replaceWith(
            blockStart,
            blockEnd,
            paraType.create(),
          );
          tr.setSelection(TextSelection.create(tr.doc, blockStart + 1));
          view.dispatch(tr.scrollIntoView());
          return true;
        }

        // If deleting would leave the exampleBlock empty (the only
        // content was this trailing chain), keep the block intact and
        // just append a new sibling.
        const willEmptyBlock =
          deleteDepth >= 0 &&
          deleteDepth === blockDepth + 1 &&
          blockNode.childCount === 1;

        const newBlock = blockType.create(
          {
            uuid: generateShortId(collectExampleIds(state.doc)),
            kind: "single",
            tag: "",
            label: "",
            exnoOverride: null,
            suppressSpace: false,
            number: 0,
          },
          paraType.create(),
        );

        const tr = state.tr;
        if (deleteDepth >= 0 && !willEmptyBlock) {
          const deleteFrom = $from.before(deleteDepth);
          const deleteTo = $from.after(deleteDepth);
          tr.delete(deleteFrom, deleteTo);
        }
        const insertPos = tr.mapping.map(blockEnd);
        tr.insert(insertPos, newBlock);
        // Cursor inside the new block's paragraph: +1 into block, +1
        // into paragraph.
        const cursorPos = insertPos + 2;
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));
        view.dispatch(tr.scrollIntoView());
        return true;
      },

      Tab: () => {
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;

        // Find enclosing exampleBlock.
        let blockDepth = -1;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "exampleBlock") {
            blockDepth = d;
            break;
          }
        }
        if (blockDepth < 0) return false;

        // If already inside a sub-item, defer to ExampleItem's Tab
        // (which handles sink-list behavior for nested tiers).
        for (let d = $from.depth - 1; d > blockDepth; d--) {
          if ($from.node(d).type.name === "exampleItem") return false;
        }

        // Convert this top-level paragraph into a sub-item: wrap it in
        // an exampleItem inside an exampleItemList. If the block is
        // currently kind="single", flip it to "multi".
        const itemListType = state.schema.nodes.exampleItemList;
        const itemType = state.schema.nodes.exampleItem;
        if (!itemListType || !itemType) return false;

        const blockNode = $from.node(blockDepth);
        const blockPos = $from.before(blockDepth);
        const paraNode = $from.parent;
        const paraStart = $from.before($from.depth);
        const paraEnd = paraStart + paraNode.nodeSize;
        const parentOffset = $from.parentOffset;

        // Wrap the paragraph in exampleItemList → exampleItem.
        const newItem = itemType.create(
          { tag: "", label: "", subLabel: "" },
          paraNode,
        );
        const newList = itemListType.create(null, newItem);

        const tr = state.tr;
        tr.replaceWith(paraStart, paraEnd, newList);

        // Flip the block's kind to "multi" if it was "single".
        if (blockNode.attrs.kind !== "multi") {
          tr.setNodeMarkup(blockPos, undefined, {
            ...blockNode.attrs,
            kind: "multi",
          });
        }

        // The wrapped paragraph now sits 2 tokens deeper (list-open,
        // item-open) than the original; restore the cursor at the same
        // offset inside it.
        const newCursor = paraStart + 2 + 1 + parentOffset;
        tr.setSelection(TextSelection.create(tr.doc, newCursor));
        view.dispatch(tr.scrollIntoView());
        return true;
      },

      // Shift-Tab on a top-level (n) block when it has no text:
      // dissolve the block, leaving an empty paragraph in its place.
      // (The sub-item promote/lift cases are owned by ExampleItem,
      // which fires before this handler.)
      "Shift-Tab": () => {
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        // Find enclosing exampleBlock; bail if not in one or if cursor
        // is inside a sub-item (that case is handled by ExampleItem).
        let blockDepth = -1;
        for (let d = $from.depth; d >= 0; d--) {
          const name = $from.node(d).type.name;
          if (name === "exampleItem") return false;
          if (name === "exampleBlock") {
            blockDepth = d;
            break;
          }
        }
        if (blockDepth < 0) return false;

        const blockNode = $from.node(blockDepth);
        // Only fire on a fully-empty block — a single empty paragraph.
        const blockIsEmpty =
          blockNode.childCount === 1 &&
          blockNode.firstChild?.type.name === "paragraph" &&
          blockNode.firstChild.content.size === 0;
        if (!blockIsEmpty) return false;

        const blockStart = $from.before(blockDepth);
        const blockEnd = $from.after(blockDepth);
        const paraType = state.schema.nodes.paragraph;
        if (!paraType) return false;
        const tr = state.tr.replaceWith(
          blockStart,
          blockEnd,
          paraType.create(),
        );
        tr.setSelection(TextSelection.create(tr.doc, blockStart + 1));
        view.dispatch(tr.scrollIntoView());
        return true;
      },

      // Backspace at the start of an EMPTY top-level example paragraph
      // deletes the (n) example (the delete half of Shift-Tab's dissolve,
      // without leaving a stray paragraph when a previous block exists).
      // The sub-item case is owned by ExampleItem's Backspace, which fires
      // first; this handler only sees the cursor at the block's top level.
      Backspace: () => {
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        // Only at the start of an empty paragraph; else normal deletion.
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        if ($from.parentOffset !== 0) return false;

        // Bail if inside a sub-item (ExampleItem's Backspace owns that).
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "exampleItem") return false;
        }
        const tr = deleteEmptyExampleStructure(state);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },

      // forward-Delete on an EMPTY top-level example paragraph: the cursor is
      // simultaneously at the paragraph's start and end (nothing forward to
      // delete), and exampleBlock is `isolating` so the default join is a
      // no-op — so symmetrically delete the same empty example as Backspace.
      Delete: () => {
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "exampleItem") return false;
        }
        const tr = deleteEmptyExampleStructure(state);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
    };
  },

  addAttributes() {
    return {
      uuid: { default: null },
      tag: { default: "" },
      label: { default: "" },
      kind: { default: "single" }, // "single" (\ex) | "multi" (\pex)
      exnoOverride: { default: null },
      suppressSpace: { default: false }, // \ex~
      number: { default: 0 },
      /** Optional paragraph-title rendered above the block (Virgil feature —
       *  not emitted to the .tex). Same role as a regular paragraph's
       *  `parTitle`; the whole example block is treated as one unit for
       *  title/drag purposes. */
      parTitle: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="example-block"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const kind = node.attrs.kind === "multi" ? "multi" : "single";
    const number = node.attrs.number ? `(${node.attrs.number})` : "(?)";
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "example-block",
        "data-kind": kind,
        "data-number": number,
        class: `expex-block expex-block-${kind}`,
      }),
      0,
    ];
  },

  addNodeView() {
    const opts = this.options;
    return ({ node, HTMLAttributes, editor, getPos }) => {
      let currentNode = node;

      // Outer wrapper — hosts the par-title annotation strip on top, the
      // small "Ex." label-annotation pod, and the block body (drag handle
      // + number + content) below. Same structural shape as
      // ParagraphWithTitle so the editor's existing CSS and event handling
      // keep working.
      const wrapper = document.createElement("div");
      wrapper.className = "par-title-wrapper expex-par-wrapper";

      // Par-title annotation (above the example). Click to edit.
      // SUPPRESSED in card/float context (#47): the untitled strip is
      // absolutely-positioned ABOVE the block top, so on a card it overlays
      // the card header and collides with the card's own CardBodyTitle "+T".
      // The card host owns the title affordance — don't paint a second one.
      // `null` here makes the title-rendering / edit handlers below inert.
      const titleAnnot: HTMLDivElement | null = opts.cardContext
        ? null
        : document.createElement("div");
      if (titleAnnot) {
        titleAnnot.className = "par-title-annotation";
        titleAnnot.contentEditable = "false";
        wrapper.appendChild(titleAnnot);
      }

      // The label pod is created here but appended AFTER the block dom
      // below, so it sits beneath the example body — small bordered
      // chip matching the heading "Section 1.2" pod, with a hover-
      // revealed "Label +" affordance when there's no label yet. Click
      // an existing label to rename in place.
      const labelAnnot = document.createElement("div");
      labelAnnot.className = "heading-annotation expex-label-annotation";
      labelAnnot.contentEditable = "false";

      // Block body — the example itself.
      const dom = document.createElement("div");
      Object.entries(
        mergeAttributes(HTMLAttributes, {
          "data-type": "example-block",
          class: `expex-block expex-block-${node.attrs.kind === "multi" ? "multi" : "single"}`,
        }),
      ).forEach(([k, v]) => {
        if (typeof v === "string") dom.setAttribute(k, v);
      });
      dom.dataset.number = node.attrs.number ? `(${node.attrs.number})` : "(?)";
      if (node.attrs.tag) dom.dataset.tag = node.attrs.tag;
      if (node.attrs.label) dom.dataset.label = node.attrs.label;

      // The grip and the in-gutter popout button moved to the editor-
      // mounted TextObjectGrabHandle (src/text-objects/TextObjectGrabHandle.tsx).
      // The handle drives lift-to-float for exampleBlock + exampleItem
      // alike via the registry; HTML5 drag-to-reorder routes through
      // the drop-mode infrastructure (Phase D6).

      const numberEl = document.createElement("span");
      numberEl.className = "expex-number";
      numberEl.contentEditable = "false";
      // Hint to TextObjectGrabHandle + atom-block marginalia: this is
      // the visual top of the example (the `(1)` row), not the wrapper
      // top (which sits above the title annotation). Skips the chrome
      // and avoids the Range-walk fall-through that would otherwise
      // anchor to the first sub-item's first letter.
      numberEl.setAttribute("data-glyph-anchor", "");
      numberEl.textContent = node.attrs.number ? `(${node.attrs.number})` : "(?)";
      dom.appendChild(numberEl);

      const body = document.createElement("div");
      body.className = "expex-body";
      dom.appendChild(body);

      wrapper.appendChild(dom);
      // Label pod sits BELOW the block.
      wrapper.appendChild(labelAnnot);

      // --- Par-title rendering / editing ---
      // Mirror the paragraph convention: `has-text` when a title exists
      // (always visible), `has-add-btn` when empty (reveal on hover).
      const renderTitle = () => {
        // No-op when the title strip is suppressed (card/float context) —
        // skip the wrapper has-add-btn/has-text classes so the absolutely-
        // positioned untitled-strip CSS rule never matches (#47).
        if (!titleAnnot) return;
        const title = (currentNode.attrs.parTitle as string | null) || null;
        titleAnnot.innerHTML = "";
        wrapper.classList.remove("has-text", "has-add-btn");
        if (title) {
          wrapper.classList.add("has-text");
          const span = document.createElement("span");
          span.className = "par-title-text";
          span.textContent = title;
          titleAnnot.appendChild(span);
        } else {
          wrapper.classList.add("has-add-btn");
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "par-title-add-btn";
          btn.textContent = "+T";
          btn.title = "Add paragraph title";
          titleAnnot.appendChild(btn);
        }
      };
      renderTitle();

      // --- "Ex." label pod (above the marker) ---
      const renderLabelAnnot = () => {
        const label = (currentNode.attrs.label as string | null) || null;
        labelAnnot.innerHTML = "";
        const typeSpan = document.createElement("span");
        typeSpan.textContent = "Ex.";
        labelAnnot.appendChild(typeSpan);
        if (label) {
          const sep = document.createElement("span");
          sep.textContent = "  ·  label: ";
          labelAnnot.appendChild(sep);
          const labelSpan = document.createElement("span");
          labelSpan.textContent = label;
          labelSpan.className = "heading-label-text";
          labelAnnot.appendChild(labelSpan);
        } else {
          const addBtn = document.createElement("span");
          addBtn.className = "heading-label-add";
          addBtn.textContent = "Label +";
          labelAnnot.appendChild(addBtn);
        }
      };
      renderLabelAnnot();

      const commitLabel = (raw: string) => {
        const next = raw.trim();
        // Prefer getPos() (cheap and scoped to this NodeView). Fall back
        // to a doc-walk by uuid when getPos returns undefined — TipTap
        // NodeViews re-rendered during React StrictMode's double-render
        // can end up with a detached getPos.
        let pos: number | null = null;
        if (typeof getPos === "function") {
          const p = getPos();
          if (typeof p === "number") pos = p;
        }
        if (pos == null) {
          const uuid = currentNode.attrs.uuid as string | null;
          if (uuid) {
            editor.state.doc.descendants((nd, p) => {
              if (pos != null) return false;
              if (nd.type.name === "exampleBlock" && nd.attrs.uuid === uuid) {
                pos = p;
                return false;
              }
              return true;
            });
          }
        }
        if (pos == null) return;
        const nd = editor.state.doc.nodeAt(pos);
        if (!nd) return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...nd.attrs,
          label: next,
        });
        editor.view.dispatch(tr);
      };

      const beginLabelEdit = (replaceTarget: HTMLElement) => {
        if (labelAnnot.querySelector("input")) return;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "heading-label-input expex-label-input";
        input.value = (currentNode.attrs.label as string) || "";
        input.placeholder = "label key";
        replaceTarget.replaceWith(input);
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          commitLabel(input.value);
          renderLabelAnnot();
        };
        input.addEventListener("mousedown", (e) => e.stopPropagation());
        // Delay arming the blur-commit so focus transitions inside the
        // popover / editor don't swallow the intended edit — matches the
        // pattern used by the heading label input.
        let armed = false;
        input.addEventListener("blur", () => {
          if (armed) commit();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committed = true;
            renderLabelAnnot();
          }
        });
        requestAnimationFrame(() => {
          input.focus();
          if (currentNode.attrs.label) {
            input.selectionStart = input.selectionEnd = input.value.length;
          } else {
            input.select();
          }
        });
        setTimeout(() => {
          armed = true;
        }, 200);
      };

      labelAnnot.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      labelAnnot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target as HTMLElement;
        if (target.classList.contains("heading-label-text")) {
          beginLabelEdit(target);
        } else if (target.classList.contains("heading-label-add")) {
          // Swap "Label +" for an empty editable label slot.
          const sep = document.createElement("span");
          sep.textContent = "  ·  label: ";
          const labelSpan = document.createElement("span");
          labelSpan.className = "heading-label-text";
          target.replaceWith(sep);
          sep.after(labelSpan);
          beginLabelEdit(labelSpan);
        }
      });

      const commitTitle = (raw: string) => {
        const next = raw.trim() || null;
        let pos: number | null = null;
        if (typeof getPos === "function") {
          const p = getPos();
          if (typeof p === "number") pos = p;
        }
        if (pos == null) {
          const uuid = currentNode.attrs.uuid as string | null;
          if (uuid) {
            editor.state.doc.descendants((nd, p) => {
              if (pos != null) return false;
              if (nd.type.name === "exampleBlock" && nd.attrs.uuid === uuid) {
                pos = p;
                return false;
              }
              return true;
            });
          }
        }
        if (pos == null) return;
        const nd = editor.state.doc.nodeAt(pos);
        if (!nd) return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...nd.attrs,
          parTitle: next,
        });
        editor.view.dispatch(tr);
      };

      // Title-edit wiring only when the strip exists (suppressed in card
      // context, #47).
      titleAnnot?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        titleAnnot.innerHTML = "";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "par-title-input";
        input.value = (currentNode.attrs.parTitle as string) || "";
        input.placeholder = "Title…";
        titleAnnot.appendChild(input);
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          commitTitle(input.value);
          renderTitle();
        };
        let armed = false;
        input.addEventListener("blur", () => {
          if (armed) commit();
        });
        input.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            commit();
          } else if (ev.key === "Escape") {
            ev.preventDefault();
            committed = true;
            renderTitle();
          }
        });
        requestAnimationFrame(() => {
          input.focus();
          input.select();
        });
        setTimeout(() => {
          armed = true;
        }, 200);
      });

      return {
        dom: wrapper,
        contentDOM: body,
        // Keep ProseMirror out of our annotation areas (par-title +T and
        // the blue "Example" pod). Without these the input inside loses
        // focus on the very first character typed — PM reclaims selection
        // for the editable content.
        stopEvent(event) {
          const target = event.target as globalThis.Node | null;
          if (!target) return false;
          if (titleAnnot && (titleAnnot === target || titleAnnot.contains(target)))
            return true;
          if (labelAnnot === target || labelAnnot.contains(target)) return true;
          return false;
        },
        ignoreMutation(mutation) {
          const t = mutation.target as globalThis.Node;
          if (titleAnnot && titleAnnot.contains(t)) return true;
          if (labelAnnot.contains(t)) return true;
          return false;
        },
        update(updatedNode) {
          if (updatedNode.type.name !== "exampleBlock") return false;
          currentNode = updatedNode;
          const next = updatedNode.attrs.number
            ? `(${updatedNode.attrs.number})`
            : "(?)";
          if (numberEl.textContent !== next) numberEl.textContent = next;
          dom.dataset.number = next;
          dom.dataset.kind =
            updatedNode.attrs.kind === "multi" ? "multi" : "single";
          dom.className = `expex-block expex-block-${dom.dataset.kind}`;
          if (updatedNode.attrs.tag) dom.dataset.tag = updatedNode.attrs.tag;
          else delete dom.dataset.tag;
          if (updatedNode.attrs.label) dom.dataset.label = updatedNode.attrs.label;
          else delete dom.dataset.label;
          // Re-render title annot only if not currently being edited
          // (and only when the strip exists — suppressed in card context).
          if (titleAnnot && !titleAnnot.querySelector("input")) renderTitle();
          if (!labelAnnot.querySelector("input")) renderLabelAnnot();
          return true;
        },
        destroy() {},
      };
    };
  },
});

// ---------------------------------------------------------------------------
// exampleItemList — invisible wrapper around \a items at one nesting tier.
// Both the top-level (inside an exampleBlock) and any nested xlist
// (inside an exampleItem) use the same wrapper so prosemirror-schema-list's
// sink/lift/split commands operate without extra schema bookkeeping.
// ---------------------------------------------------------------------------

export const ExampleItemList = Node.create({
  name: "exampleItemList",
  content: "exampleItem+",
  defining: true,

  parseHTML() {
    return [{ tag: 'div[data-type="example-item-list"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "example-item-list",
        class: "expex-item-list",
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// exampleItem
// ---------------------------------------------------------------------------

export const ExampleItem = Node.create({
  name: "exampleItem",
  // Widened from `paragraph+ exampleItemList? exampleGloss?` to allow
  // `graphicsBlock` (an `\includegraphics` outside a figure env) and
  // `displayMath` (an `\[…\]` equation) inside an item — the three block kinds
  // (text/picture/equation) the unified expex drop welcomes (Feature A1).
  // exampleBlock itself stays UN-widened (it can't hold displayMath directly),
  // so the round-trip only routes equations through the `\a` item path. The
  // shape is built so adding another inner kind (tables, etc.) is a one-token
  // edit to the leading union. texBlock / figureBlock are intentionally NOT
  // widened — see TEXT-OBJECT-REFACTOR.md §6.
  content:
    "(paragraph | graphicsBlock | displayMath)+ exampleItemList? exampleGloss?",
  group: "textObject",
  defining: true,
  // NOTE: not isolating — prosemirror-schema-list's liftTarget breaks at
  // isolating ancestors, which would prevent Shift-Tab from un-nesting an
  // item out through its parent item. Standard listItem isn't isolating
  // either; treat exampleItem the same so list mechanics behave as
  // expected.

  // List mechanics — direct port of TipTap's `listItem` keymap so Enter /
  // Tab / Shift-Tab behave exactly the same as inside a bullet/ordered
  // list. The glossCell ancestor check defers to ExpexNumbering's
  // gloss-cell Tab/Shift-Tab when the cursor is in an interlinear gloss
  // table (where Tab navigates between cells, not nesting tiers).
  addKeyboardShortcuts() {
    const inGlossCell = (): boolean => {
      const { $from } = this.editor.state.selection;
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "glossCell") return true;
      }
      return false;
    };
    return {
      Enter: () => {
        if (inGlossCell()) return false;
        return this.editor.commands.splitListItem(this.name);
      },
      Tab: () => {
        if (inGlossCell()) return false;
        return this.editor.commands.sinkListItem(this.name);
      },
      "Shift-Tab": () => {
        if (inGlossCell()) return false;
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from } = state.selection;

        // Find nearest exampleItem, its enclosing list, and the block.
        let itemDepth = -1, listDepth = -1, blockDepth = -1;
        for (let d = $from.depth; d >= 0; d--) {
          const name = $from.node(d).type.name;
          if (itemDepth < 0 && name === "exampleItem") itemDepth = d;
          else if (
            listDepth < 0 &&
            itemDepth >= 0 &&
            name === "exampleItemList"
          )
            listDepth = d;
          if (name === "exampleBlock") {
            blockDepth = d;
            break;
          }
        }
        if (itemDepth < 0) return false;

        // Nested tier (list is inside another item): standard
        // liftListItem moves it up one tier (e.g. A → i).
        if (listDepth !== blockDepth + 1) {
          return this.editor.commands.liftListItem(this.name);
        }

        // Outermost tier (list directly inside exampleBlock): promote
        // the sub-item to a new top-level exampleBlock — i.e. a. → (n).
        const itemNode = $from.node(itemDepth);
        const itemStart = $from.before(itemDepth);
        const itemEnd = itemStart + itemNode.nodeSize;
        const listNode = $from.node(listDepth);
        const listStart = $from.before(listDepth);
        const listEnd = listStart + listNode.nodeSize;
        const blockNode = $from.node(blockDepth);
        const blockStart = $from.before(blockDepth);
        const blockEnd = $from.after(blockDepth);

        const blockType = state.schema.nodes.exampleBlock;
        const paraType = state.schema.nodes.paragraph;
        if (!blockType || !paraType) return false;

        // The promoted item's content (paragraph+ exampleItemList? exampleGloss?)
        // becomes the new block's content directly.
        const newBlockContent: import("@tiptap/pm/model").Node[] = [];
        itemNode.forEach((c) => newBlockContent.push(c));
        // Schema requires exampleBlock to have at least one child;
        // ensure a paragraph exists if the item somehow had none.
        if (newBlockContent.length === 0) {
          newBlockContent.push(paraType.create());
        }
        const newKind = newBlockContent.some(
          (c) => c.type.name === "exampleItemList",
        )
          ? "multi"
          : "single";
        const newBlock = blockType.create(
          {
            uuid: generateShortId(collectExampleIds(state.doc)),
            kind: newKind,
            tag: "",
            label: "",
            exnoOverride: null,
            suppressSpace: false,
            number: 0,
          },
          newBlockContent,
        );

        // Capture the cursor's position offset within its paragraph so
        // we can land in the same spot inside the promoted block.
        const parentOffset = $from.parentOffset;

        const tr = state.tr;
        // Decide what to delete from the original block:
        //   - If the promoted item was the only one in its list AND the
        //     block has no other content, delete the whole block.
        //   - Else if the item was the only one in its list, delete the
        //     entire (now-empty) list from the block.
        //   - Else, delete just the item.
        let originalBlockGone = false;
        if (
          listNode.childCount === 1 &&
          blockNode.childCount === 1 &&
          blockNode.firstChild?.type.name === "exampleItemList"
        ) {
          tr.delete(blockStart, blockEnd);
          originalBlockGone = true;
        } else if (listNode.childCount === 1) {
          tr.delete(listStart, listEnd);
        } else {
          tr.delete(itemStart, itemEnd);
        }

        // Insert the new block immediately after the (possibly modified)
        // original block. If the original block was deleted, the insert
        // position is just where it used to start.
        const insertPos = originalBlockGone
          ? blockStart
          : tr.mapping.map(blockEnd);
        tr.insert(insertPos, newBlock);

        // Land cursor inside the first paragraph of the new block.
        let cursorPos = insertPos + 1; // step inside new block
        for (const c of newBlockContent) {
          if (c.type.name === "paragraph") {
            cursorPos += 1 + parentOffset; // step into paragraph + offset
            break;
          }
          cursorPos += c.nodeSize;
        }
        tr.setSelection(TextSelection.create(tr.doc, cursorPos));

        // If the original block survived but no longer contains any
        // item lists, flip its kind back to "single" so serialization
        // emits \ex.
        if (!originalBlockGone) {
          const updatedBlock = tr.doc.nodeAt(blockStart);
          if (
            updatedBlock &&
            updatedBlock.type.name === "exampleBlock" &&
            updatedBlock.attrs.kind === "multi"
          ) {
            let hasList = false;
            updatedBlock.forEach((c) => {
              if (c.type.name === "exampleItemList") hasList = true;
            });
            if (!hasList) {
              tr.setNodeMarkup(blockStart, undefined, {
                ...updatedBlock.attrs,
                kind: "single",
              });
            }
          }
        }

        view.dispatch(tr.scrollIntoView());
        return true;
      },

      // Backspace at the start of an EMPTY sub-item paragraph deletes the
      // sub-item (the delete half of Shift-Tab's promote, without the
      // re-insert). The shared helper picks the 3-way branch:
      //   • one of several items   → delete just this item;
      //   • only item in its list  → delete the (now-empty) list;
      //   • only item, only list, nothing else in the block → delete the
      //     whole block (mirrors Q3 in backlog #3).
      // The numbering plugin re-letters the survivors. A non-empty item or a
      // mid-paragraph cursor falls through to normal character deletion.
      Backspace: () => {
        if (inGlossCell()) return false;
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        if ($from.parentOffset !== 0) return false;
        // Must actually be inside a sub-item (else defer to ExampleBlock).
        let inItem = false;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "exampleItem") {
            inItem = true;
            break;
          }
        }
        if (!inItem) return false;
        const tr = deleteEmptyExampleStructure(state);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },

      // forward-Delete mirrors Backspace on an empty sub-item (see the
      // ExampleBlock Delete handler for the rationale).
      Delete: () => {
        if (inGlossCell()) return false;
        const { state } = this.editor;
        const view = this.editor.view;
        const { $from, empty } = state.selection;
        if (!empty) return false;
        if ($from.parent.type.name !== "paragraph") return false;
        if ($from.parent.content.size !== 0) return false;
        let inItem = false;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "exampleItem") {
            inItem = true;
            break;
          }
        }
        if (!inItem) return false;
        const tr = deleteEmptyExampleStructure(state);
        if (!tr) return false;
        view.dispatch(tr);
        return true;
      },
    };
  },

  addAttributes() {
    return {
      uuid: UUID_ATTR_SPEC.uuid,
      tag: { default: "" },
      label: { default: "" },
      subLabel: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="example-item"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "example-item",
        "data-sublabel": node.attrs.subLabel || "",
        class: "expex-item",
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes, editor, getPos }) => {
      let currentNode = node;
      const dom = document.createElement("div");
      Object.entries(
        mergeAttributes(HTMLAttributes, {
          "data-type": "example-item",
          class: "expex-item",
        }),
      ).forEach(([k, v]) => {
        if (typeof v === "string") dom.setAttribute(k, v);
      });
      if (node.attrs.tag) dom.dataset.tag = node.attrs.tag;
      if (node.attrs.label) dom.dataset.label = node.attrs.label;
      dom.dataset.sublabel = node.attrs.subLabel || "";

      // .expex-item is a block-flow container. Inside it, an inner row
      // div hosts the marker + body grid; the label pod sits as a plain
      // block sibling beneath that row, so block-flow margins (negative
      // top, normal bottom) work the same way as in the heading pattern.
      const row = document.createElement("div");
      row.className = "expex-item-row";
      dom.appendChild(row);

      const marker = document.createElement("span");
      marker.className = "expex-item-marker";
      marker.contentEditable = "false";
      marker.textContent = `${node.attrs.subLabel || "?"}.`;
      row.appendChild(marker);

      const body = document.createElement("div");
      body.className = "expex-item-body";
      row.appendChild(body);

      // Label pod — small "ex." chip with hover-revealed "Label +"
      // affordance, identical pattern to section headings and exampleBlock.
      const labelAnnot = document.createElement("div");
      labelAnnot.className = "heading-annotation expex-item-label-annotation";
      labelAnnot.contentEditable = "false";
      dom.appendChild(labelAnnot);

      const renderLabelAnnot = () => {
        const label = (currentNode.attrs.label as string | null) || null;
        labelAnnot.innerHTML = "";
        const typeSpan = document.createElement("span");
        typeSpan.textContent = "ex.";
        labelAnnot.appendChild(typeSpan);
        if (label) {
          const sep = document.createElement("span");
          sep.textContent = "  ·  label: ";
          labelAnnot.appendChild(sep);
          const labelSpan = document.createElement("span");
          labelSpan.textContent = label;
          labelSpan.className = "heading-label-text";
          labelAnnot.appendChild(labelSpan);
        } else {
          const addBtn = document.createElement("span");
          addBtn.className = "heading-label-add";
          addBtn.textContent = "Label +";
          labelAnnot.appendChild(addBtn);
        }
      };
      renderLabelAnnot();

      const commitLabel = (raw: string) => {
        const next = raw.trim();
        let pos: number | null = null;
        if (typeof getPos === "function") {
          const p = getPos();
          if (typeof p === "number") pos = p;
        }
        if (pos == null) return;
        const nd = editor.state.doc.nodeAt(pos);
        if (!nd || nd.type.name !== "exampleItem") return;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...nd.attrs,
          label: next,
        });
        editor.view.dispatch(tr);
      };

      const beginLabelEdit = (replaceTarget: HTMLElement) => {
        if (labelAnnot.querySelector("input")) return;
        const input = document.createElement("input");
        input.type = "text";
        input.className = "heading-label-input expex-label-input";
        input.value = (currentNode.attrs.label as string) || "";
        input.placeholder = "label key";
        replaceTarget.replaceWith(input);
        let committed = false;
        const commit = () => {
          if (committed) return;
          committed = true;
          commitLabel(input.value);
          renderLabelAnnot();
        };
        input.addEventListener("mousedown", (e) => e.stopPropagation());
        let armed = false;
        input.addEventListener("blur", () => {
          if (armed) commit();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            committed = true;
            renderLabelAnnot();
          }
        });
        requestAnimationFrame(() => {
          input.focus();
          if (currentNode.attrs.label) {
            input.selectionStart = input.selectionEnd = input.value.length;
          } else {
            input.select();
          }
        });
        setTimeout(() => {
          armed = true;
        }, 200);
      };

      labelAnnot.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      labelAnnot.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target as HTMLElement;
        if (target.classList.contains("heading-label-text")) {
          beginLabelEdit(target);
        } else if (target.classList.contains("heading-label-add")) {
          const sep = document.createElement("span");
          sep.textContent = "  ·  label: ";
          const labelSpan = document.createElement("span");
          labelSpan.className = "heading-label-text";
          target.replaceWith(sep);
          sep.after(labelSpan);
          beginLabelEdit(labelSpan);
        }
      });

      return {
        dom,
        contentDOM: body,
        stopEvent(event) {
          const target = event.target as globalThis.Node | null;
          if (!target) return false;
          if (labelAnnot === target || labelAnnot.contains(target)) return true;
          return false;
        },
        ignoreMutation(mutation) {
          const t = mutation.target as globalThis.Node;
          if (labelAnnot.contains(t)) return true;
          return false;
        },
        update(updatedNode) {
          if (updatedNode.type.name !== "exampleItem") return false;
          currentNode = updatedNode;
          marker.textContent = `${updatedNode.attrs.subLabel || "?"}.`;
          dom.dataset.sublabel = updatedNode.attrs.subLabel || "";
          if (updatedNode.attrs.tag) dom.dataset.tag = updatedNode.attrs.tag;
          else delete dom.dataset.tag;
          if (updatedNode.attrs.label)
            dom.dataset.label = updatedNode.attrs.label;
          else delete dom.dataset.label;
          if (!labelAnnot.querySelector("input")) renderLabelAnnot();
          return true;
        },
      };
    };
  },
});

// ---------------------------------------------------------------------------
// exampleGloss
// ---------------------------------------------------------------------------

export const ExampleGloss = Node.create({
  name: "exampleGloss",
  group: "block",
  content: "(alignedGlossRow | proseGlossRow)+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      glossId: { default: null },
      colCount: { default: 1 },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="example-gloss"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "example-gloss",
        class: "expex-gloss",
        style: `--expex-col-count: ${Math.max(1, Number(node.attrs.colCount) || 1)}`,
      }),
      0,
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      Object.entries(
        mergeAttributes(HTMLAttributes, {
          "data-type": "example-gloss",
          class: "expex-gloss",
        }),
      ).forEach(([k, v]) => {
        if (typeof v === "string") dom.setAttribute(k, v);
      });
      const cols = Math.max(1, Number(node.attrs.colCount) || 1);
      dom.style.setProperty("--expex-col-count", String(cols));
      return {
        dom,
        contentDOM: dom,
        update(updatedNode) {
          if (updatedNode.type.name !== "exampleGloss") return false;
          const c = Math.max(1, Number(updatedNode.attrs.colCount) || 1);
          dom.style.setProperty("--expex-col-count", String(c));
          return true;
        },
      };
    };
  },
});

// ---------------------------------------------------------------------------
// alignedGlossRow — gla/glb/glc
// ---------------------------------------------------------------------------

export const AlignedGlossRow = Node.create({
  name: "alignedGlossRow",
  content: "glossCell*",

  addAttributes() {
    return {
      tier: { default: "gla" }, // "gla" | "glb" | "glc"
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="gloss-row-aligned"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "gloss-row-aligned",
        "data-tier": node.attrs.tier || "gla",
        class: `expex-gloss-row expex-gloss-row-${node.attrs.tier || "gla"}`,
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// proseGlossRow — glpreamble / glft
// ---------------------------------------------------------------------------

export const ProseGlossRow = Node.create({
  name: "proseGlossRow",
  content: "inline*",

  addAttributes() {
    return {
      tier: { default: "glft" }, // "glpreamble" | "glft"
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="gloss-row-prose"]' }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "gloss-row-prose",
        "data-tier": node.attrs.tier || "glft",
        class: `expex-gloss-row expex-gloss-row-prose expex-gloss-row-${node.attrs.tier || "glft"}`,
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// glossCell — one column at one tier
// ---------------------------------------------------------------------------

export const GlossCell = Node.create({
  name: "glossCell",
  content: "inline*",
  isolating: true,

  parseHTML() {
    return [{ tag: 'span[data-type="gloss-cell"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-type": "gloss-cell",
        class: "expex-gloss-cell",
      }),
      0,
    ];
  },
});

// ---------------------------------------------------------------------------
// Numbering + column-count maintenance plugin
// ---------------------------------------------------------------------------

export const ExpexNumbering = Extension.create({
  name: "expexNumbering",

  addProseMirrorPlugins() {
    // Plugin-state shape: the doc-adaptive column widths (backlog #25). Held in
    // plugin state so the `view()` lifecycle is the SINGLE writer to view.dom,
    // and so the var is applied at most once per width *change* — never on a
    // structurally-null keystroke (appendTransaction is gated below, and the
    // meta is only attached when a width actually differs).
    type WidthState = ExpexColumnWidths;
    const expexKey = new PluginKey<WidthState>("expexNumbering");
    const WIDTH_META = "expexColumnWidths";

    return [
      new Plugin<WidthState>({
        key: expexKey,
        state: {
          // One doc walk at load time so multi-digit examples already in the
          // .tex render un-wrapped before the first edit (the appendTransaction
          // gate is silent on the load transaction).
          init: (_config, instance) => computeExpexWidths(instance.doc),
          apply(tr, prev) {
            const meta = tr.getMeta(WIDTH_META) as WidthState | undefined;
            return meta ?? prev;
          },
        },
        view(view) {
          const apply = (s: WidthState) => {
            const dom = view.dom as HTMLElement;
            if (s.numWidth)
              dom.style.setProperty("--expex-num-width", s.numWidth);
            else dom.style.removeProperty("--expex-num-width");
            if (s.markerWidth)
              dom.style.setProperty("--expex-marker-width", s.markerWidth);
            else dom.style.removeProperty("--expex-marker-width");
          };
          // Apply the initial (load-time) widths once.
          apply(expexKey.getState(view.state) ?? { numWidth: null, markerWidth: null });
          return {
            update(v, prevState) {
              const next = expexKey.getState(v.state);
              const prev = expexKey.getState(prevState);
              if (!next) return;
              // O(1): only touch the DOM when a width string changed.
              if (
                prev &&
                prev.numWidth === next.numWidth &&
                prev.markerWidth === next.markerWidth
              )
                return;
              apply(next);
            },
          };
        },
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;

          // Gate: only run when the observer says the example set or
          // its nesting actually changed (or some content inside an
          // example block was touched — covers gloss-cell column
          // adjustments). Typing in a paragraph outside any example
          // bails immediately.
          const pending = readPendingDiff(newState);
          if (pending) {
            const exampleAffected =
              pending.addedExamples.length > 0 ||
              pending.removedExamples.length > 0 ||
              pending.exampleStructureChanged;
            // Content-change inside an example block (gloss cells, items)
            // may shift the column count or item ordering.
            let exampleContentTouched = false;
            if (!exampleAffected && pending.contentChangedUuids.size > 0) {
              for (const uuid of pending.contentChangedUuids) {
                const block = pending.addedBlocks.find((b) => b.uuid === uuid);
                if (block?.typeName === "exampleBlock") {
                  exampleContentTouched = true;
                  break;
                }
                // Also check the existing structure for the typeName.
                // We don't have prev here; rely on `readDocStructure`
                // when needed — but that requires importing it. For
                // now, conservatively run if any contentChange could
                // be in an example. A second-pass optimization would
                // check the index.
              }
              // Conservative: if there are content changes and no
              // structural diff says it's NOT an example, fall through
              // to run the numberer. The cost is a doc walk in those
              // cases, but those are still rarer than pure-text edits.
              if (!exampleContentTouched && pending.contentChangedUuids.size > 0) {
                // Re-check by reading the structure-index.
                const structure = readDocStructure(newState);
                for (const uuid of pending.contentChangedUuids) {
                  const block = structure.blocks.get(uuid);
                  if (block?.typeName === "exampleBlock") {
                    exampleContentTouched = true;
                    break;
                  }
                }
              }
            }
            if (!exampleAffected && !exampleContentTouched) return null;
          }

          const tr = newState.tr;
          let changed = false;

          // Recursively re-letter exampleItems within exampleItemLists.
          // The counter is passed by reference so MULTIPLE lists at the
          // same depth (e.g. inside one exampleBlock with paragraphs
          // splitting the lists) continue numbering across them — top-
          // level items are a, b, c, d... regardless of how the lists
          // are split. Depth-aware markers cycle a/b/c → i/ii/iii →
          // A/B/C → I/II/III.
          // Doc-adaptive gutter widths (backlog #25): accumulate the widest
          // displayed number / marker as we renumber, so no SEPARATE doc walk
          // is needed. These use the *target* values, i.e. the post-edit truth.
          let maxNumDigits = 0;
          let maxMarkerLen = 0;

          const walkList = (
            list: import("@tiptap/pm/model").Node,
            listAbsPos: number,
            depth: number,
            counter: { n: number },
          ) => {
            list.forEach((item, offsetIntoList) => {
              if (item.type.name !== "exampleItem") return;
              counter.n++;
              const target = markerForDepth(depth, counter.n);
              if (target.length > maxMarkerLen) maxMarkerLen = target.length;
              const itemAbsPos = listAbsPos + 1 + offsetIntoList;
              if (item.attrs.subLabel !== target) {
                tr.setNodeMarkup(itemAbsPos, undefined, {
                  ...item.attrs,
                  subLabel: target,
                });
                changed = true;
              }
              // Each item starts a fresh nested counter for its child
              // xlist (nested items are i, ii, iii… regardless of the
              // parent counter).
              item.forEach((childNode, offsetIntoItem) => {
                if (childNode.type.name === "exampleItemList") {
                  walkList(
                    childNode,
                    itemAbsPos + 1 + offsetIntoItem,
                    depth + 1,
                    { n: 0 },
                  );
                }
              });
            });
          };

          let exampleCounter = 0;
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "exampleBlock") {
              exampleCounter++;
              const targetNumber = node.attrs.exnoOverride
                ? node.attrs.exnoOverride
                : exampleCounter;
              const numDigits =
                Number(targetNumber) > 0 ? String(targetNumber).length : 1;
              if (numDigits > maxNumDigits) maxNumDigits = numDigits;
              if (node.attrs.number !== targetNumber) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  number: targetNumber,
                });
                changed = true;
              }
              // Walk every exampleItemList at the top level of the
              // block; counter persists across them so top-level items
              // are numbered consecutively even when split into pieces.
              const topCounter = { n: 0 };
              node.forEach((child, offsetIntoBlock) => {
                if (child.type.name === "exampleItemList") {
                  walkList(child, pos + 1 + offsetIntoBlock, 0, topCounter);
                }
              });
              return false; // don't recurse; we've handled items ourselves
            }
            return true;
          });

          // Maintain colCount on every exampleGloss — the max number of
          // cells across its aligned rows.
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "exampleGloss") {
              let max = 0;
              node.forEach((row) => {
                if (row.type.name === "alignedGlossRow") {
                  if (row.childCount > max) max = row.childCount;
                }
              });
              const target = Math.max(1, max);
              if (node.attrs.colCount !== target) {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  colCount: target,
                });
                changed = true;
              }
            }
            return true;
          });

          // Maintain the doc-adaptive gutter-width vars (backlog #25). Only
          // attach the meta when a width string actually CHANGED vs current
          // plugin state, so the var is written at most once per digit-count
          // change — zero cost on every other (already-gated) run, and the
          // `view()` is the single DOM writer. (We carry the meta on the
          // appended tr even if `changed` is false, so a delete that drops the
          // max digit count narrows the gutter back down.)
          const nextWidths: WidthState = {
            numWidth: expexNumWidth(maxNumDigits),
            markerWidth: expexMarkerWidth(maxMarkerLen),
          };
          const prevWidths = expexKey.getState(newState);
          const widthsChanged =
            !prevWidths ||
            prevWidths.numWidth !== nextWidths.numWidth ||
            prevWidths.markerWidth !== nextWidths.markerWidth;
          if (widthsChanged) {
            tr.setMeta(WIDTH_META, nextWidths);
            return tr;
          }

          return changed ? tr : null;
        },
      }),
    ];
  },

  // Gloss-cell-only Tab / Shift-Tab navigation. List-style Enter / Tab /
  // Shift-Tab live on the ExampleItem node itself (same pattern as
  // listItem) and bail out when the cursor is inside a glossCell so this
  // handler can take over.
  addKeyboardShortcuts() {
    const glossCellDepth = (
      $from: import("@tiptap/pm/model").ResolvedPos,
    ): number => {
      for (let d = $from.depth; d >= 0; d--) {
        if ($from.node(d).type.name === "glossCell") return d;
      }
      return -1;
    };

    return {
      Tab: ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        const cellDepth = glossCellDepth($from);
        if (cellDepth < 0) return false;
        const rowDepth = cellDepth - 1;
        const row = $from.node(rowDepth);
        if (row.type.name !== "alignedGlossRow") return false;
        const cellIndex = $from.index(rowDepth);
        const rowStart = $from.before(rowDepth);
        if (cellIndex < row.childCount - 1) {
          const nextCellStart =
            rowStart + 1 + row.child(cellIndex).nodeSize;
          const pos = nextCellStart + 1;
          editor.view.dispatch(
            state.tr.setSelection(TextSelection.create(state.doc, pos)),
          );
          return true;
        }
        const endOfRow = rowStart + row.nodeSize - 1;
        const cellType = state.schema.nodes.glossCell;
        if (!cellType) return false;
        const tr = state.tr.insert(endOfRow, cellType.create());
        const pos = endOfRow + 2;
        tr.setSelection(TextSelection.create(tr.doc, pos));
        editor.view.dispatch(tr);
        return true;
      },
      "Shift-Tab": ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        const cellDepth = glossCellDepth($from);
        if (cellDepth < 0) return false;
        const rowDepth = cellDepth - 1;
        const row = $from.node(rowDepth);
        if (row.type.name !== "alignedGlossRow") return false;
        const cellIndex = $from.index(rowDepth);
        if (cellIndex === 0) return true;
        const rowStart = $from.before(rowDepth);
        let prevStart = rowStart + 1;
        for (let i = 0; i < cellIndex - 1; i++) {
          prevStart += row.child(i).nodeSize;
        }
        const prevCell = row.child(cellIndex - 1);
        const pos = prevStart + 1 + prevCell.content.size;
        editor.view.dispatch(
          state.tr.setSelection(TextSelection.create(state.doc, pos)),
        );
        return true;
      },
    };
  },
});
