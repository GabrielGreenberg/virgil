/**
 * Generic doc-slice duplicator. Walks a ProseMirror slice and:
 *
 *   1. Remints every TextObject node's `uuid` attr (using `generateShortId`
 *      for kinds with `sourceMarker.idLength === 4`, otherwise
 *      `generateEntityId`). Driven by [TEXT_OBJECT_REGISTRY](./text-object-registry.ts).
 *
 *   2. Remints every inline-atom card's id attr (`footnoteId`,
 *      `citationId`) and clones the matching sidecar entry via
 *      [card-lifecycle-registry](../panels/card-lifecycle-registry.tsx).
 *      `INLINE_ATOM_CARDS` is the only kind-aware data here — a 2-entry
 *      lookup table; adding a new inline-atom card kind is one line.
 *
 *   3. Remints every `linkedAnchor` mark's `anchorId` + clones the
 *      sidecar entry the mark points at (`linkCard` → `cardKind:cardId`).
 *      The CardKind comes from the mark's existing `linkCard` value via
 *      `parseLinkCardKey`; the walker never enumerates linkedAnchor kinds
 *      itself.
 *
 * Zero per-kind switches. Adding a new TextObject kind = one
 * `TEXT_OBJECT_REGISTRY` entry. Adding a new sidecar-bearing card kind =
 * one `registerCardLifecycle` call (registry-side) + (for new inline-atom
 * kinds only) one entry in `INLINE_ATOM_CARDS` here.
 *
 * Limitation: cloned cards arrive with `links: []` (sidecar hooks clear
 * them for cleanliness). The in-doc mark / atom carries the binding via
 * its `linkCard` / `*Id` attrs, so editor → card jump-to works. Card →
 * editor jump-to (which reads the card's `links` array) won't find the
 * cloned mark until the cloned card's links are repopulated. A follow-up
 * pass can rewire by walking the inserted slice and calling each kind's
 * `setTextAnchorLink` / `addTextObjectLink` — deferred to a Phase 2.5
 * once the user validates the core mechanic.
 */

import { Slice, Fragment, type Node as PMNode } from "@tiptap/pm/model";
import {
  TEXT_OBJECT_REGISTRY,
  isTextObjectKind,
} from "./text-object-registry";
import type { CardLifecycleApi } from "@/panels/card-lifecycle-registry";
import type { CardKind } from "@/panels/_shared/types";
import { generateEntityId, generateShortId } from "@/lib/uuid";
import { linkCardKey, parseLinkCardKey } from "@/links/link-registry";

/** Inline-atom card lookup — node-type-name → { CardKind, id-attr-name }.
 *  Only the schema's sidecar-bearing inline atoms appear here. */
const INLINE_ATOM_CARDS: Record<string, { cardKind: CardKind; idAttr: string }> = {
  footnote: { cardKind: "footnote", idAttr: "footnoteId" },
  citation: { cardKind: "citation", idAttr: "citationId" },
};

function inlineAtomCardEntry(
  typeName: string,
): { cardKind: CardKind; idAttr: string } | null {
  return INLINE_ATOM_CARDS[typeName] ?? null;
}

/** Remint a TextObject node's identity. Short-id kinds (exampleBlock,
 *  exampleItem, etc. — anything declaring `sourceMarker.idLength === 4`)
 *  get a fresh short id; everything else gets a fresh entity id. */
function mintUuidForKind(kind: string): string {
  if (!isTextObjectKind(kind)) return generateEntityId();
  const meta = TEXT_OBJECT_REGISTRY[kind];
  return meta.sourceMarker?.idLength === 4
    ? generateShortId()
    : generateEntityId();
}

/** Public entry point: produce a deep-cloned slice with every identity
 *  reminted and every sidecar card cloned via the lifecycle registry. */
export function duplicateSlice(
  slice: Slice,
  lifecycle: CardLifecycleApi,
): Slice {
  const content = transformFragment(slice.content, lifecycle);
  return new Slice(content, slice.openStart, slice.openEnd);
}

function transformFragment(
  fragment: Fragment,
  lifecycle: CardLifecycleApi,
): Fragment {
  const out: PMNode[] = [];
  fragment.forEach((child) => out.push(transformNode(child, lifecycle)));
  return Fragment.fromArray(out);
}

function transformNode(node: PMNode, lifecycle: CardLifecycleApi): PMNode {
  // Recurse first so the rebuilt node carries rewritten children.
  const newContent = node.content.size
    ? transformFragment(node.content, lifecycle)
    : node.content;

  // Marks: remint linkedAnchor; pass others through unchanged.
  const newMarks = node.marks.length
    ? node.marks.map((mark) => {
        if (mark.type.name !== "linkedAnchor") return mark;
        const linkCard =
          typeof mark.attrs.linkCard === "string" ? mark.attrs.linkCard : "";
        const parsed = parseLinkCardKey(linkCard);
        const clonedId = parsed
          ? lifecycle.get(parsed.kind)?.clone(parsed.id) ?? null
          : null;
        const newAnchorId = generateEntityId();
        const newLinkCard =
          parsed && clonedId ? linkCardKey(parsed.kind, clonedId) : "";
        return mark.type.create({
          ...mark.attrs,
          anchorId: newAnchorId,
          linkId: newAnchorId,
          linkCard: newLinkCard,
        });
      })
    : node.marks;

  // Attrs: remint inline-atom id (if applicable) + TextObject uuid.
  const newAttrs: Record<string, unknown> = { ...node.attrs };

  const atom = inlineAtomCardEntry(node.type.name);
  if (atom) {
    const oldId =
      typeof newAttrs[atom.idAttr] === "string"
        ? (newAttrs[atom.idAttr] as string)
        : "";
    if (oldId) {
      const cloned = lifecycle.get(atom.cardKind)?.clone(oldId);
      // Fall back to a fresh short id so the duplicate is at least
      // schema-valid; the dispatcher logs a warning when this happens.
      newAttrs[atom.idAttr] = cloned ?? generateShortId();
    }
  }

  if (
    isTextObjectKind(node.type.name) &&
    typeof newAttrs.uuid === "string" &&
    newAttrs.uuid.length > 0
  ) {
    newAttrs.uuid = mintUuidForKind(node.type.name);
  }

  return node.type.create(newAttrs, newContent, newMarks);
}
