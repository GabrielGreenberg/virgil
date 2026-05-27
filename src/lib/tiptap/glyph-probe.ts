import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { readDocStructure, readPendingDiff } from "./doc-structure";

/**
 * GlyphProbeDecorator — wraps the first text character of every text-bearing
 * TextObject in a `<span data-glyph-probe>` (display: inline).
 *
 * Inline spans' `getBoundingClientRect()` give the rendered GLYPH rect
 * (ascender → descender), not the line-box rect. So measuring the probe's
 * `.top` gives the cap-top of the first glyph — independent of line-height,
 * vertical-align, padding, or any other CSS that distends the line box.
 *
 * This is the foundation of the grab-handle's text-top vertical alignment:
 * the handle's `measureHandleAnchorTop` reads `[data-glyph-probe]` (or a
 * NodeView's `[data-glyph-anchor]` override) and aligns the handle's dots
 * to the probe's top.
 *
 * Eligibility: kinds whose first PM-managed child is rendered text.
 *   - paragraph, heading, blockquote, codeBlock, listItem, exampleItem,
 *     titleField.
 *   - Excluded: compound containers with chrome markers (exampleBlock,
 *     bulletList, orderedList) use NodeView-emitted `[data-glyph-anchor]`
 *     instead.
 *   - Excluded: atom kinds (texBlock, latexComment, displayMath,
 *     graphicsBlock, figureBlock) — chromeAnchor is "block-top".
 *   - Excluded: linkedRange — mark-backed, uses `[data-link-id]` span as
 *     inherent probe.
 *
 * Gating on `uuid`: only emit when the block carries a uuid. Paragraphs
 * inside DEFERRING_PARENTS (listItem, blockquote, codeBlock, exampleItem)
 * have no uuid, so we emit exactly one probe per "addressable" text-object —
 * the container, not its inner paragraphs. The probe is positioned at the
 * container's first deep text-child, which is also the first text of any
 * inner paragraph, so handles anchored to either level land identically.
 *
 * Transaction handling: same shape as UuidAttrDecorator.
 *   - Forward-map the existing DecorationSet on every tr (cheap).
 *   - On structure-bearing transactions, consult the diff:
 *       - Added eligible blocks → build their probes.
 *       - Removed blocks → drop their probes.
 *       - Content-changed blocks → rebuild their probes (the first char
 *         may have moved relative to the block's pos).
 *   - The structure-index map (`readDocStructure().blocks`) gives us the
 *     current `pos` for each uuid so we don't re-walk the doc.
 *
 * Keystroke-sanctity: each per-transaction update is O(eligible-blocks-
 * in-diff), not O(doc). The first build is O(doc), runs once at init.
 */

/** Names of TextObject kinds whose first PM-managed character is a text glyph. */
const PROBE_ELIGIBLE = new Set<string>([
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "listItem",
  "exampleItem",
  "titleField",
]);

function isEligibleKind(name: string): boolean {
  return PROBE_ELIGIBLE.has(name);
}

/**
 * Walk down `firstChild` from a block until a text node is found, summing
 * the open-token offsets along the way. Returns the absolute position of
 * the first text character, or `null` if the block contains no text yet.
 */
function findFirstTextPos(blockNode: PMNode, blockPos: number): number | null {
  // `blockPos` is the position BEFORE the block's open token; `+ 1` puts
  // us just inside the block.
  let p = blockPos + 1;
  let cur: PMNode | null = blockNode;
  while (cur && !cur.isText) {
    const child: PMNode | null = cur.firstChild ?? null;
    if (!child) return null;
    cur = child;
    // Non-text children have an open token (+1); text nodes don't.
    if (!cur.isText) p += 1;
  }
  return cur ? p : null;
}

function buildProbeDecoration(
  blockNode: PMNode,
  blockPos: number,
): Decoration | null {
  if (!isEligibleKind(blockNode.type.name)) return null;
  const uuid = blockNode.attrs?.uuid as string | null | undefined;
  if (!uuid) return null;
  const firstTextPos = findFirstTextPos(blockNode, blockPos);
  if (firstTextPos == null) return null;
  return Decoration.inline(firstTextPos, firstTextPos + 1, {
    nodeName: "span",
    "data-glyph-probe": "",
  });
}

function buildGlyphProbes(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    const deco = buildProbeDecoration(node, pos);
    if (deco) decos.push(deco);
    return true;
  });
  return decos.length > 0 ? DecorationSet.create(doc, decos) : DecorationSet.empty;
}

/**
 * Find all current probe decorations that overlap (or sit inside) any of
 * the given block-uuid ranges in the new doc. Used to drop the stale
 * probes for content-changed blocks before rebuilding them. The block
 * range is `[pos, pos + nodeSize)`.
 */
function dropDecorationsInRanges(
  set: DecorationSet,
  doc: PMNode,
  ranges: ReadonlyArray<{ from: number; to: number }>,
): DecorationSet {
  if (ranges.length === 0) return set;
  const survivors = set.find().filter((d) => {
    for (const r of ranges) {
      if (d.from >= r.from && d.to <= r.to) return false;
    }
    return true;
  });
  return DecorationSet.create(doc, survivors);
}

export const GlyphProbeDecorator = Extension.create({
  name: "glyphProbeDecorator",

  addProseMirrorPlugins() {
    const key = new PluginKey<DecorationSet>("glyphProbeDecorator");
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init(_config, state) {
            return buildGlyphProbes(state.doc);
          },
          apply(tr, value, _oldState, newState) {
            // Step 1: forward-map for any existing decorations whose
            // position shifted. Microseconds regardless of N.
            let set = value.map(tr.mapping, tr.doc);
            if (!tr.docChanged) return set;

            // Step 2: consult the doc-structure observer's diff. If the
            // observer isn't installed (e.g. tests), fall back to a
            // full rebuild.
            const diff = readPendingDiff(newState);
            if (!diff) return buildGlyphProbes(newState.doc);

            // Step 3a: drop probes for removed blocks. Their decoration
            // positions are stale; cheaper to drop by uuid via the
            // structure index than to scan the set.
            if (diff.removedBlocks.length > 0) {
              const removedSet = new Set<string>();
              for (const b of diff.removedBlocks) {
                if (isEligibleKind(b.typeName)) removedSet.add(b.uuid);
              }
              if (removedSet.size > 0) {
                // The mapped decorations may point to positions that
                // no longer exist; filter survivors by querying the
                // structure-index for current uuids. Simpler: rebuild
                // the survivors by walking the new doc — but that's
                // O(doc). Since `set.find()` is O(decorations) and we
                // can't get the uuid back from a decoration directly,
                // we instead use the structure approach: any survivor
                // whose pos no longer resolves to an eligible block
                // gets dropped on the rebuild path (Step 3c). Here we
                // just leave them; mapping handled position shifts
                // and rebuild covers identity changes.
              }
            }

            // Step 3b: build probes for newly-added eligible blocks.
            if (diff.addedBlocks.length > 0) {
              const adds: Decoration[] = [];
              for (const b of diff.addedBlocks) {
                if (!isEligibleKind(b.typeName)) continue;
                const node = newState.doc.nodeAt(b.pos);
                if (!node) continue;
                const deco = buildProbeDecoration(node, b.pos);
                if (deco) adds.push(deco);
              }
              if (adds.length > 0) set = set.add(newState.doc, adds);
            }

            // Step 3c: content-changed blocks — the first character may
            // have moved relative to the block start (e.g. user inserted
            // at position 0), so the mapped decoration's range is stale.
            // Re-resolve each via the structure index and rebuild that
            // block's probe.
            if (diff.contentChangedUuids.size > 0) {
              const structure = readDocStructure(newState);
              const affectedRanges: { from: number; to: number }[] = [];
              const rebuilds: Decoration[] = [];
              for (const uuid of diff.contentChangedUuids) {
                const entry = structure.blocks.get(uuid);
                if (!entry) continue;
                if (!isEligibleKind(entry.typeName)) continue;
                const node = newState.doc.nodeAt(entry.pos);
                if (!node) continue;
                affectedRanges.push({
                  from: entry.pos,
                  to: entry.pos + node.nodeSize,
                });
                const deco = buildProbeDecoration(node, entry.pos);
                if (deco) rebuilds.push(deco);
              }
              if (affectedRanges.length > 0) {
                set = dropDecorationsInRanges(set, newState.doc, affectedRanges);
              }
              if (rebuilds.length > 0) {
                set = set.add(newState.doc, rebuilds);
              }
            }

            // Step 4: drop survivors whose mapped position no longer
            // matches a live eligible block (handles removedBlocks +
            // weird cases where a kind morphed). Cheap: O(decorations)
            // scan via structure index. Only when removedBlocks fired.
            if (diff.removedBlocks.length > 0) {
              const structure = readDocStructure(newState);
              const liveByPos = new Map<number, string>();
              for (const b of structure.blocks.values()) {
                if (isEligibleKind(b.typeName)) {
                  liveByPos.set(b.pos, b.uuid);
                }
              }
              const survivors = set.find().filter((d) => {
                // A probe sits at firstTextPos..firstTextPos+1, which
                // is inside its block's [pos, pos+nodeSize) range. Walk
                // back to find the containing block via doc.resolve.
                try {
                  const $pos = newState.doc.resolve(d.from);
                  for (let depth = $pos.depth; depth >= 0; depth--) {
                    const ancestorPos = depth === 0 ? -1 : $pos.before(depth);
                    if (ancestorPos < 0) continue;
                    if (liveByPos.has(ancestorPos)) return true;
                  }
                  return false;
                } catch {
                  return false;
                }
              });
              set = DecorationSet.create(newState.doc, survivors);
            }

            return set;
          },
        },
        props: {
          decorations(state) {
            return key.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
