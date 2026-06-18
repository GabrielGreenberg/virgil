"use client";

/**
 * useCitationResync — the React mount for the W2c citation add/resync policy
 * (T5 §3 Pillar C-1, PLAN D1.4 / W2c). Mounts ONCE per pane beside the single
 * bus consumer, behind `virgil:inline-atom-lifecycle` (default OFF).
 *
 * This hook does NOT open a bus subscription — that would break the +1-not-+3
 * keystroke-sanctity invariant. It registers the citation-resync policy on the
 * EXISTING single consumer (W1b) via `consumer.registerPolicy`; the policy
 * fires from the one `onAnyChange` subscription, which already bails O(1) on a
 * non-atom transaction. So no new entry on the AGENTS.md permitted-consumer
 * list, and `__virgilBusStats().emitCount` stays flat on plain typing.
 *
 * WHAT IT FIXES (C17 — the mount-only citation sidecar resync):
 *  - CI-F8-03 — a code-view-added `\cite` shows a card live (no reload).
 *  - CI-A1-01 — a `\cite` deleted in the editor prunes its dead, dashed card
 *    live (the sidecar half; W2b owns the cardStore/float half — they act in
 *    concert on the one consumer, never double-owning the reconcile).
 *
 * THE RESYNC CALLBACK. The policy needs the editor's LIVE citation set, but the
 * diff carries only the delta. So the hook wires `resyncCitations` to read
 * `getCitations()` off the editor at fire time and feed it to the citations
 * hook's `syncFromEditor` — the same idempotent reconcile the mount-only effect
 * runs, now re-driven off the structural diff. A ref keeps `getCitations` /
 * `syncFromEditor` reachable from the policy closure without re-registering the
 * policy every render.
 *
 * FLAG-OFF PARITY. With the flag off the hook is fully inert (registers
 * nothing), so the legacy mount-only `syncFromEditor` effect in `EditorPane`
 * remains the only reconcile and behavior is byte-identical to today.
 */

import { useEffect, useRef } from "react";
import { isInlineAtomLifecycleOn } from "@/lib/identity/inline-atom-lifecycle-flag";
import type { IdentityBusConsumer } from "@/lib/identity/identity-bus-consumer";
import { makeCitationResyncPolicy } from "./citation-resync-policy";

/** A live citation atom as the editor reports it (`EditorHandle.getCitations`).
 *  Only the fields `syncFromEditor` consumes are required here. */
export interface EditorCitation {
  citationId: string;
  command: string;
}

export interface UseCitationResyncArgs {
  /** True once the editor has mounted (gates the initial-population read — the
   *  structural counters are silent on load, so the hook keys registration on a
   *  reactive boolean, not a counter alone). */
  editorReady: boolean;
  /** The single W1b consumer (null when `virgil:identity-cascade` is off — then
   *  there is no consumer to register on and the hook is inert). */
  consumer: IdentityBusConsumer | null;
  /** Read the editor's live citation atoms (`EditorHandle.getCitations`). */
  getCitations: () => EditorCitation[];
  /** Re-derive the citation sidecar from those atoms (`syncFromEditor`). */
  syncFromEditor: (editorCitations: EditorCitation[]) => void;
}

export function useCitationResync({
  editorReady,
  consumer,
  getCitations,
  syncFromEditor,
}: UseCitationResyncArgs): void {
  const flagOn = isInlineAtomLifecycleOn();

  // Keep the latest editor accessors reachable from the policy closure without
  // re-registering the policy every render. Written in an effect (not during
  // render — React Compiler refs rule).
  const getCitationsRef = useRef(getCitations);
  const syncFromEditorRef = useRef(syncFromEditor);
  useEffect(() => {
    getCitationsRef.current = getCitations;
    syncFromEditorRef.current = syncFromEditor;
  });

  useEffect(() => {
    if (!flagOn || !consumer || !editorReady) return;
    const policy = makeCitationResyncPolicy({
      resyncCitations: () => {
        const cits = getCitationsRef.current();
        syncFromEditorRef.current(cits);
      },
    });
    return consumer.registerPolicy(policy);
  }, [flagOn, consumer, editorReady]);
}
