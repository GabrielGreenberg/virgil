/**
 * DocStructureObserver — React hooks
 *
 * The two React doors onto the editor's `DocStructureBus` that have
 * callers (task 924 pruned the uncalled ones — `useDocStructure`,
 * `useDocStructureEvent`, `useBlockContentChanged` — under "a registry earns
 * its name by being read"). Per-category structural counters for panel/card
 * memos live in `@/hooks/useStructuralRevisions`; anything else subscribes
 * through `getBus(editor)` in an effect.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { getBus, type DocStructureBus } from "./bus";

/**
 * Returns the bus associated with `editor`, or null if no observer
 * plugin is attached yet. Stable across re-renders.
 */
export function useDocStructureBus(editor: Editor | null | undefined): DocStructureBus | null {
  // `getBus` is a synchronous lookup; we want it to be re-read on every
  // render so a freshly-attached bus is picked up. The result is stable
  // by reference once the plugin is installed.
  return getBus(editor);
}

/**
 * Per-exampleBlock content-change revision counter — the example-card
 * staleness fix (backlog #39 nit 1). Subscribes to `onExampleContentChanged`
 * for the given exampleBlock `uuid` and returns a monotonic counter that
 * bumps ONLY when THIS example's interior content changed in the editor
 * (text in an item / gloss / nested atom). The Examples-panel card uses it as
 * a `useMemo`/`useEffect` dep to re-seed itself from the live block — so a
 * content-only MAIN edit to example A re-seeds card A, while example B's card
 * (subscribed under a different uuid) never fires. A structurally-null
 * keystroke in a NON-example paragraph produces no `exampleContentChangedUuids`
 * entry, so no card's counter bumps. This is the per-uuid, event-driven
 * replacement for the missing content signal — NOT an `editor.on('update')`
 * subscriber.
 */
export function useExampleContentRevision(
  editor: Editor | null | undefined,
  uuid: string | null | undefined,
): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (!editor || !uuid) return;
    const bus = getBus(editor);
    if (!bus) return;
    const unsub = bus.onExampleContentChanged(uuid, () => setRev((r) => r + 1));
    return unsub;
  }, [editor, uuid]);
  return rev;
}
