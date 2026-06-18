/**
 * useIdentityBusConsumer — the React mount for the single inline-atom bus
 * consumer (D1.2 / D1.4). Mounts ONCE per pane.
 *
 * This is the +1 (not +3) keystroke-sanctity consumer. It opens exactly ONE
 * `DocStructureBus` subscription (`onAnyChange`), owns one `IdentityBusConsumer`
 * dispatcher, and registers T1's `regenIds` policy FIRST. Wave-2 themes
 * (T2 `useInlineAtomLifecycle`, T5 citation add-resync) register their reconcile
 * logic on the returned dispatcher via `registerPolicy` — they do NOT open their
 * own subscriptions.
 *
 * KEYSTROKE SANCTITY: `onAnyChange` is `emitCount`-gated — it fires only on a
 * structural emit, never on a plain in-paragraph keystroke. The handler's first
 * act is an O(1) bail when no citation/footnote entered or left this
 * transaction, so even a structural edit unrelated to atoms (e.g. a heading
 * rename) does no atom work. Typing N plain characters leaves `emitCount` flat
 * and runs zero consumer code. See `AGENTS.md` keystroke-sanctity permitted-
 * consumer list — this hook is the single registered inline-atom bus consumer.
 *
 * FLAG: gated behind `virgil:identity-cascade`. Flag OFF → the subscription is
 * never opened and the legacy mount-gated `syncFromEditor` path is untouched, so
 * the existing suite stays green.
 */

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { getBus, type StructureDiff } from "@/lib/tiptap/doc-structure";
import { isIdentityCascadeOn } from "./identity-flag";
import type { IdentityCascade } from "./identity-cascade";
import {
  IdentityBusConsumer,
  makeRegenPolicy,
} from "./identity-bus-consumer";

/** True iff the diff carries a citation/footnote add OR remove (the only
 *  diffs the inline-atom consumer can possibly act on). The O(1) bail gate. */
function touchesInlineAtomSet(diff: StructureDiff): boolean {
  return (
    diff.addedCitations.length > 0 ||
    diff.removedCitations.length > 0 ||
    diff.addedFootnotes.length > 0 ||
    diff.removedFootnotes.length > 0
  );
}

/**
 * Mount the single inline-atom bus consumer for a pane. Returns the dispatcher
 * (stable per pane) so Wave-2 themes can `registerPolicy` against it, or `null`
 * when the flag is off (no consumer is mounted, no subscription opened).
 *
 * The dispatcher instance is created lazily and kept stable across re-renders
 * (one per pane). The subscription is (re)opened when `editor` changes; the
 * `regenIds` policy is registered exactly once and stays first in the ordered
 * list for the dispatcher's lifetime.
 */
export function useIdentityBusConsumer(
  editor: Editor | null | undefined,
  cascade: IdentityCascade,
): IdentityBusConsumer | null {
  const flagOn = isIdentityCascadeOn();
  // One dispatcher per pane, stable across renders.
  const [consumer] = useState(() => new IdentityBusConsumer());

  // Register T1's regen policy FIRST (D1.4 ordering), exactly once.
  useEffect(() => {
    if (!flagOn) return;
    const unregister = consumer.registerPolicy(makeRegenPolicy(cascade));
    return unregister;
  }, [consumer, cascade, flagOn]);

  // The single bus subscription. Opened only under the flag.
  useEffect(() => {
    if (!flagOn || !editor) return;
    const bus = getBus(editor);
    if (!bus) return;
    const unsub = bus.onAnyChange((diff) => {
      // O(1) bail: nothing for the inline-atom consumer unless an atom
      // entered or left this transaction (a markerless re-parse is the only
      // case that produces same-tx add+remove of the same atoms).
      if (!touchesInlineAtomSet(diff)) return;
      void consumer.dispatch(diff);
    });
    return unsub;
  }, [editor, consumer, flagOn]);

  return flagOn ? consumer : null;
}
