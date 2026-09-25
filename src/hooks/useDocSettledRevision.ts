"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { getBus } from "@/lib/tiptap/doc-structure";
import { useViewLifetime } from "@/hooks/useViewLifetime";

/** Default quiet window: the typing pause after which a document-wide consumer
 *  may re-derive (task 759). Long enough that a burst of keystrokes costs ONE
 *  recompute, short enough that a find panel feels live. */
export const DOC_SETTLE_MS = 300;

/**
 * A revision counter that bumps once per SETTLE — `delayMs` after the last
 * document change — for consumers whose derivation is O(doc) and therefore may
 * not run per keystroke (keystroke sanctity), but must still reflect the
 * document once the user pauses (task 759: the Search panel's main-text hits
 * were frozen at query time because nothing in its memo keyed on content).
 *
 * Change sources are the DocStructureBus's two streams, both already produced
 * once per transaction from the typed diff: `onContentChanged` (a block's text
 * changed — the plain-keystroke case) and `onAnyChange` (a block/atom entered,
 * left or moved). Per event the hook does O(1) work: it re-arms one timeout.
 * The counter — and so the consumer's recompute — moves only on the settle
 * edge, never inside a burst.
 *
 * `enabled: false` subscribes to nothing (a find panel with an empty query has
 * nothing to refresh). The timer is armed through the component's ONE
 * `ViewLifetime`, so an unmount mid-window leaves no orphan.
 */
export function useDocSettledRevision(
  editor: Editor | null | undefined,
  { enabled = true, delayMs = DOC_SETTLE_MS }: { enabled?: boolean; delayMs?: number } = {},
): number {
  const lifetime = useViewLifetime();
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!enabled || !editor) return;
    const bus = getBus(editor);
    if (!bus) return;
    let pending: ReturnType<typeof lifetime.setTimeout> | null = null;
    const arm = () => {
      lifetime.clear(pending);
      pending = lifetime.setTimeout(() => {
        pending = null;
        setRev((r) => r + 1);
      }, delayMs);
    };
    const offContent = bus.onContentChanged(arm);
    const offAny = bus.onAnyChange(arm);
    return () => {
      offContent();
      offAny();
      lifetime.clear(pending);
    };
  }, [editor, enabled, delayMs, lifetime]);

  return rev;
}
