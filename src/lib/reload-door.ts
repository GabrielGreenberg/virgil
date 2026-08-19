/**
 * **The reload door** — task 391.
 *
 * A reload drops every mounted editor's memory at once. Virgil has exactly one
 * programmatic reload (`ServiceWorkerRegistration`'s `controllerchange`
 * handler) and one affordance that leads to it (the "Virgil update" banner),
 * and on 2026-08-19 neither consulted the documents whose only copy it was
 * about to discard: the banner's `applyUpdate()` posted `SKIP_WAITING` and the
 * page reloaded ~70 minutes of writing away.
 *
 * > **No door that drops memory may open before the work is safe.** "Safe"
 * > means one of two things, in this order: the pending write LANDED, or the
 * > emergency mirror TOOK IT. The first is the good outcome; the second is the
 * > one that must never be skipped, because the states in which a write cannot
 * > land are exactly the states in which a reload is most expensive.
 *
 * Two entry points, because the two callers can do different amounts about it:
 *
 * - {@link prepareForReload} — flush, then mirror, then REPORT what still has
 *   not landed. An affordance (the banner) calls this and decides: nothing
 *   unlanded ⇒ proceed; something unlanded ⇒ say so, name the blocking flow,
 *   and let the user choose knowing the mirror is taken.
 * - {@link reloadNow} — the same preparation, then the reload, unconditionally.
 *   For the paths with no user in the loop (a `controllerchange` Virgil did not
 *   initiate). It cannot ask, so it guarantees instead.
 *
 * ## Why the flush is verified rather than awaited
 *
 * `writeDocBundle` returns `Promise<void>` and a REFUSED write returns
 * normally (task 357 hole 4) — the incident's unload flushes all "succeeded"
 * as refusals. So awaiting the flush proves nothing; the door re-reads the
 * unsaved-work channel afterwards and believes THAT.
 */

import {
  docsWithUnlandedWork,
  type UnsavedBlockReason,
} from "@/lib/unsaved-work";
import { flushAllPendingDocs } from "@/lib/multi-window/pending-saves";
import { mirrorAllNow } from "@/lib/emergency-mirror";

export interface UnlandedDoc {
  docId: string;
  reason: UnsavedBlockReason | null;
  ageMs: number;
}

export interface ReloadReadiness {
  /** Documents whose work is still not on disk after the flush. Empty ⇒ the
   *  reload costs nothing. */
  unlanded: UnlandedDoc[];
  /** Was a mirror pass taken for them? `false` only when the pass threw
   *  outright — the affordance must not promise a net it does not have. */
  mirrored: boolean;
}

/**
 * Make a reload as cheap as it can be made, then report honestly.
 *
 * 1. Fire every document's pending debounce and await the writes.
 * 2. Re-read the channel — a refusal returns normally, so step 1's resolution
 *    is not evidence of anything.
 * 3. For whatever is still unlanded, force a mirror tick (`force`: young work
 *    is as exposed as old work once the page is going).
 */
export async function prepareForReload(): Promise<ReloadReadiness> {
  try {
    await flushAllPendingDocs();
  } catch {
    /* one doc's failed flush must not strand the others' mirroring */
  }
  const now = Date.now();
  const unlanded = docsWithUnlandedWork().map((s) => ({
    docId: s.docId,
    reason: s.reason,
    ageMs: s.dirtySince === null ? 0 : Math.max(0, now - s.dirtySince),
  }));
  if (unlanded.length === 0) return { unlanded, mirrored: true };
  let mirrored = true;
  try {
    await mirrorAllNow({ force: true });
  } catch {
    mirrored = false;
  }
  return { unlanded, mirrored };
}

/**
 * Prepare, then reload regardless. The last-resort path: a `controllerchange`
 * Virgil did not ask for has no user to consult and no way to defer, so the
 * only thing it can do is make sure the mirror is taken first.
 */
export async function reloadNow(
  reload: () => void = () => window.location.reload(),
): Promise<void> {
  await prepareForReload();
  reload();
}
