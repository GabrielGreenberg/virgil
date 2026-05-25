import type { Editor } from "@tiptap/react";
import { isAnchorableNode, isAnchorableAtom } from "./marginalia";

export interface AnchorableBlock {
  uuid: string;
  pos: number;
  isAtom: boolean;
}

/**
 * Walk the doc once, collecting every anchorable block's
 * `{ uuid, pos, isAtom }` at every level. Used by:
 *   - useMarginaliaRegistry — structure-change diffing + initial prime.
 *   - TextObjectGrabHandle — resolving a known UUID to its current pos.
 *   - ActiveTextObjectContext — resolving the active block by UUID.
 *
 * Walks into anchorable containers so sub-objects (`listItem`,
 * `exampleItem`) and nested kinds (`graphicsBlock` inside a list item)
 * are enumerated too — they're first-class TextObjects post-refactor.
 *
 * Drops blocks with a null UUID. TipTap allocates UUIDs lazily on first
 * interaction; until then the block isn't a sticky anchor target.
 */
export function walkAnchorableBlocks(
  editor: Editor | null | undefined,
): AnchorableBlock[] {
  const out: AnchorableBlock[] = [];
  if (!editor) return out;
  editor.state.doc.descendants((node, pos) => {
    if (isAnchorableNode(node.type)) {
      const uuid = node.attrs?.uuid as string | null | undefined;
      if (uuid) {
        out.push({ uuid, pos, isAtom: isAnchorableAtom(node.type) });
      }
    }
    return true;
  });
  return out;
}

/**
 * Find an anchorable block's DOM element by UUID. Uses the `data-uuid`
 * decoration applied by `UuidAttrDecorator` (`src/lib/tiptap/uuid-attr.ts`).
 */
export function resolveDomForUuid(
  editor: Editor | null | undefined,
  uuid: string,
): HTMLElement | null {
  if (!editor) return null;
  try {
    return editor.view.dom.querySelector(
      `[data-uuid="${cssEscape(uuid)}"]`,
    ) as HTMLElement | null;
  } catch {
    return null;
  }
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s);
  }
  return s.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
