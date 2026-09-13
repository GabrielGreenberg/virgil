"use client";

/**
 * Mounts the emergency mirror for one document (task 391).
 *
 * The whole of the wiring is: create the ticker once per doc, run it on a
 * wall-clock interval, also settle it at the tab-hidden edge, and register it
 * so the app-wide reload doors can force a pass. Every decision the ticker
 * makes — whether the doc is armed, whether the model changed — lives in
 * `emergency-mirror.ts`, so this hook has no policy of its own to drift.
 *
 * KEYSTROKE SANCTITY: this adds no editor subscription and no per-keystroke
 * work. `setInterval` runs at {@link MIRROR_TICK_MS}, and a quiet tick on an
 * unarmed document is one Map read plus one field compare.
 *
 * The interval runs unconditionally rather than being armed and disarmed on
 * the channel's state, deliberately: an effect that subscribed to the channel
 * would tear down and re-create a timer on the clean→dirty edge, which is the
 * edge the user's typing produces. One 5-second heartbeat per open document is
 * cheaper than the bookkeeping to avoid it, and it cannot go stale.
 */

import { useEffect, useRef } from "react";
import type { JSONContent } from "@tiptap/react";

import {
  MIRROR_TICK_MS,
  clearMirror,
  createMirrorTicker,
  registerMirrorTicker,
  unregisterMirrorTicker,
  type MirrorTicker,
} from "@/lib/emergency-mirror";
import { getWindowId } from "@/lib/multi-window/window-id";
import { onTabHidden } from "@/lib/tab-hidden";

export function useEmergencyMirror(opts: {
  docId: string;
  /** The live editor model, or `null` when the editor is gone. */
  getModel: () => JSONContent | null;
  /** Injected by the suite so a tick can be driven without a timer. */
  tickMs?: number;
}): { ticker: MirrorTicker | null } {
  const { docId, getModel } = opts;
  const tickMs = opts.tickMs ?? MIRROR_TICK_MS;
  // The model getter changes identity across renders; the ticker must not.
  const getModelRef = useRef(getModel);
  useEffect(() => {
    getModelRef.current = getModel;
  }, [getModel]);

  const tickerRef = useRef<MirrorTicker | null>(null);
  if (tickerRef.current === null) {
    tickerRef.current = createMirrorTicker({
      docId,
      getModel: () => getModelRef.current(),
      windowId: getWindowId(),
    });
  }

  useEffect(() => {
    const ticker = tickerRef.current;
    if (!ticker) return;
    registerMirrorTicker(docId, ticker);
    const id = setInterval(() => void ticker.tick(), tickMs);
    const offHidden = onTabHidden(() => void ticker.tick({ force: true }));
    // A reload / tab close does NOT fire `visibilitychange` in the same tab
    // (`tab-hidden.ts` is the app-switch edge, not the teardown edge), so the
    // teardown edge is asked for separately. An IndexedDB write started here
    // is not guaranteed to complete — which is precisely why the 5-second
    // cadence above is the real guarantee and this is only the last few
    // seconds of insurance.
    const onTeardown = () => void ticker.tick({ force: true });
    window.addEventListener("pagehide", onTeardown);
    window.addEventListener("beforeunload", onTeardown);
    return () => {
      clearInterval(id);
      offHidden();
      window.removeEventListener("pagehide", onTeardown);
      window.removeEventListener("beforeunload", onTeardown);
      unregisterMirrorTicker(docId, ticker);
    };
  }, [docId, tickMs]);

  return { ticker: tickerRef.current };
}

/**
 * Why a mirror may be dropped. The mirror is cleared by exactly TWO things,
 * and a caller states which evidence it holds (task 557) rather than borrowing
 * the other's name:
 *
 * - `landed` — the write door REPORTED that this model reached disk. The only
 *   evidence that clears a dirty state, and it may be read from nothing but a
 *   `DocWriteReceipt`.
 * - `discarded` — the user chose the DISK copy over their own (the conflict
 *   badge's Reload). No write landed; the disk simply won, and the conflict
 *   door archived their side to `virgil/.history/` before this ran. Keeping a
 *   mirror alive would offer to restore, on the next open, exactly the version
 *   they just discarded.
 *
 * The reason has a READER — the task-557 census, which lets only `save()`'s
 * receipt-landed branch say `landed`. Until 557 both callers spelled
 * `dropMirrorAfterLandedSave` and one of them was on a path where nothing had
 * landed at all, so the name was doing double duty and nothing pinned the
 * distinction.
 */
export type MirrorDropReason = "landed" | "discarded";

/**
 * This document's mirror is debris — drop it. Exported here rather than called
 * inline in `useDocument` so the ticker's fingerprint is reset in the same
 * breath: leaving it set would make the next armed tick report "unchanged"
 * against a slot that no longer exists.
 *
 * `reason` is REQUIRED. A defaulted one would be a decision nobody made, and
 * the two answers rest on opposite evidence.
 */
export function dropMirror(
  docId: string,
  ticker: MirrorTicker | null,
  reason: MirrorDropReason,
): void {
  // `reason` changes nothing at runtime — both endings drop the slot and reset
  // the fingerprint. It exists so the CALL SITE states the evidence it holds,
  // and its reader is the task-557 census, which lets only `save()`'s
  // receipt-landed branch say `landed`.
  void reason;
  ticker?.reset();
  void clearMirror(docId);
}
