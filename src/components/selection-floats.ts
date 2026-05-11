"use client";

import type { JSONContent } from "@tiptap/react";

/**
 * Module-level registry for in-flight selection floats. The drag handle
 * captures the selection range + content at lift time and stashes it here
 * under a short-id; the freshly mounted SelectionFloat looks it up on
 * mount to seed its editor.
 *
 * Lifecycle:
 *   1. SelectionDragHandle generates a short id, calls `registerSelectionFloat`
 *      with the captured payload, then asks the popped-cards context to
 *      pop out `selection:<id>`.
 *   2. SelectionFloat mounts, calls `getSelectionFloatData(id)` to read
 *      its seed content + source range.
 *   3. When the float closes, the entry is dropped via `disposeSelectionFloat`.
 *
 * Module-level (not React Context) because the producer (SelectionDragHandle)
 * and consumer (SelectionFloat) sit in unrelated subtrees and the producer
 * has already unmounted by the time the consumer renders.
 */

export interface SelectionFloatData {
  /** ProseMirror positions in the *main* editor at lift time. May go stale
   *  as the doc is edited — readers should re-validate before using. */
  range: { from: number; to: number };
  /** TipTap doc JSON for the captured slice — used to seed the float editor. */
  contentJson: JSONContent;
  /** UUID of the first paragraph-like block in the source range, if any.
   *  Lets panel drops file the selection under the right paragraph. */
  paragraphId: string | null;
  /** Plain text — used as the text/plain drag fallback. */
  text: string;
}

const store = new Map<string, SelectionFloatData>();

export function registerSelectionFloat(id: string, data: SelectionFloatData): void {
  store.set(id, data);
}

export function getSelectionFloatData(id: string): SelectionFloatData | undefined {
  return store.get(id);
}

export function disposeSelectionFloat(id: string): void {
  store.delete(id);
}
