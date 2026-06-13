/**
 * DocStructureObserver — React hooks
 *
 * Convenience hooks for consuming the editor's `DocStructureBus` from
 * React components. The bus itself is unaware of React; these hooks
 * bridge it to `useSyncExternalStore` so concurrent rendering sees a
 * consistent snapshot per commit.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { EMPTY_STRUCTURE, type DocStructure } from "./types";
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
 * Returns the current `DocStructure` snapshot. Re-renders the calling
 * component whenever the bus emits any change.
 */
export function useDocStructure(editor: Editor | null | undefined): DocStructure {
  const bus = useDocStructureBus(editor);
  const subscribe = (cb: () => void) => {
    if (!bus) return () => {};
    return bus.onAnyChange(cb);
  };
  const getSnapshot = () => bus?.structure ?? EMPTY_STRUCTURE;
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_STRUCTURE);
}

/**
 * Imperative subscription helper. The handler `fn` is captured by ref
 * so callers don't have to memoize it. Resubscribes on `editor` change.
 *
 * Usage:
 *   useDocStructureEvent(editor, "onHeadingsRecomputable", (diff, s) => {
 *     // …
 *   });
 */
type SubMethod =
  | "onAnyChange"
  | "onBlocksAdded"
  | "onBlocksRemoved"
  | "onHeadingsAdded"
  | "onHeadingsRemoved"
  | "onHeadingsChanged"
  | "onHeadingsRecomputable"
  | "onFootnotesAdded"
  | "onFootnotesRemoved"
  | "onFootnoteOrderChanged"
  | "onCitationsAdded"
  | "onCitationsRemoved"
  | "onCitationsChanged"
  | "onCitationOrderChanged"
  | "onAnchorsAdded"
  | "onAnchorsRemoved"
  | "onExamplesAdded"
  | "onExamplesRemoved"
  | "onExamplesRecomputable"
  | "onFiguresAdded"
  | "onFiguresRemoved"
  | "onFiguresChanged"
  | "onFiguresRecomputable"
  | "onLabelsAdded"
  | "onLabelsRemoved"
  | "onLabelsRecomputable"
  | "onContentChanged";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function useDocStructureEvent(
  editor: Editor | null | undefined,
  method: SubMethod,
  fn: (...args: any[]) => void,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!editor) return;
    const bus = getBus(editor);
    if (!bus) return;
    // Trampoline through the ref so callers don't need to memoize.
    const handler = (...args: any[]) => fnRef.current(...args);
    const unsub = (bus[method] as (handler: (...a: any[]) => void) => () => void)(handler);
    return unsub;
  }, [editor, method]);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Per-block content-change subscription. Used by float-mirror.
 * Resubscribes when `uuid` changes.
 */
export function useBlockContentChanged(
  editor: Editor | null | undefined,
  uuid: string | null | undefined,
  fn: () => void,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (!editor || !uuid) return;
    const bus = getBus(editor);
    if (!bus) return;
    const unsub = bus.onBlockContentChanged(uuid, () => fnRef.current());
    return unsub;
  }, [editor, uuid]);
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
