/**
 * Single registry for "what's the text representation of this atom node?"
 *
 * Block-atom and inline-atom nodes don't carry their payload as
 * `node.textContent` — it lives in attrs (`code`, `latex`, `text`, `src`).
 * Without this helper, consumers like clipboard-copy, archive-snippet
 * labelling, or screen-reader fallback fall back to `textContent` and
 * silently get an empty string for every atom whose handler they forgot
 * to add.
 *
 * The extractor table now lives in `@/lib/inline-content` (T3 / C10), which is
 * the single atom-aware inline-content reader. `getAtomText` is preserved as a
 * thin PM-Node wrapper over that registry so its existing callers
 * (`Editor.tsx`) keep working unchanged; new consumers should prefer
 * `flattenInlineText` / `atomTextOf` from `@/lib/inline-content` directly.
 */

import type { Node } from "@tiptap/pm/model";
import { atomTextOf } from "@/lib/inline-content";

export function getAtomText(node: Node): string {
  const attrText = atomTextOf(
    node.type.name,
    node.attrs as Record<string, unknown>,
  );
  return attrText ?? node.textContent ?? "";
}
