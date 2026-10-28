/**
 * DocStructureObserver — React hooks
 *
 * The React door onto the editor's `DocStructureBus` that has callers
 * (task 924 pruned the uncalled ones — `useDocStructure`,
 * `useDocStructureEvent`, `useBlockContentChanged` — and task 1331 retired
 * `useDocStructureBus`, a bare `getBus` alias whose last caller went away,
 * under "a registry earns its name by being read"). Per-category structural
 * counters for panel/card memos live in `@/hooks/useStructuralRevisions`;
 * anything else subscribes through `getBus(editor)` in an effect.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { getBus } from "./bus";

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
