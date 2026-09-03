/**
 * The doc-open scan (task 363): list `virgil/`, classify the siblings, publish
 * the report. One directory enumeration per activation, on a fire-and-forget
 * promise — the same shape and the same placement as the skill-bundle sync
 * beside it in `activateDoc`.
 *
 * Since task 542 the scan has THREE triggers, and they are all EDGES, never a
 * poll: the doc-open (via {@link watchSyncConflicts}), the user RETURNING to
 * the tab (the same watcher, on the shared `onTabReturn` edge), and the app's
 * own cleanup ({@link runSyncConflictCleanup}). The badge also offers a manual
 * "Check again" row. A poll was declined on purpose: the write-traffic doctrine
 * (tasks 363/415) wants fewer folder touches, a listing is read-only but a
 * timer would touch the folder every few seconds for a fact that changes only
 * when the user is elsewhere — and "elsewhere" is exactly what the return edge
 * observes.
 *
 * Split out of the hook so the operation is testable without React and so the
 * three pieces stay separable: the LISTING is a storage backend's, the GRAMMAR
 * is [sync-conflict.ts](sync-conflict.ts)'s, and the CHANNEL is
 * [sync-conflict-notice.ts](sync-conflict-notice.ts)'s.
 *
 * A failure is SILENT by design: this is a diagnostic about the folder, not a
 * document operation, and a paper that opens with a scary error because a
 * directory enumeration threw would be strictly worse than one that quietly
 * reports nothing.
 */

import { deleteSidecarSiblings, listSidecarNames } from "@/lib/storage";
import { scanSidecarSiblings } from "@/lib/sync-conflict";
import { recordSyncConflictReport } from "@/lib/sync-conflict-notice";
import type { SidecarCleanupReceipt } from "@/lib/sync-conflict-cleanup";
import { getActiveHandle } from "@/lib/multi-window/doc-pipeline";
import { onTabReturn } from "@/lib/tab-hidden";

export async function scanSyncConflicts(docId: string): Promise<void> {
  try {
    const names = await listSidecarNames(docId);
    recordSyncConflictReport(docId, scanSidecarSiblings(names));
  } catch {
    /* diagnostic only — never surface a scan failure as a document error */
  }
}

/**
 * Keep the report HONEST for as long as a doc is open (task 542): scan now, and
 * re-scan on every return to the tab until the returned unsubscribe runs.
 *
 * This is the door the hook enters, and it exists because the notice is
 * derived from disk state the app does not own. Task 363's one trigger was the
 * doc-open, and its own comment called a warm tab switch "a feature" — true,
 * and no help with ONE paper open: delete the forks in Finder (which is what
 * the pill's own copy tells the user to do for a content fork) and nothing
 * ever re-enumerated the folder, so the pill went on reporting ghosts until a
 * reload. The DiskWatcher solved this class for the `.tex` with "immediate on
 * tab-focus"; the folder listing takes the same edge, through the SHARED
 * channel rather than a private listener.
 *
 * One directory enumeration per return, no file reads, nothing on the
 * keystroke path. Dismissal semantics are untouched: the notice is
 * signature-keyed, so a re-scan of an UNCHANGED folder cannot re-raise a
 * dismissed report, while a folder that changed (a fork removed, another
 * minted) is judged on its new signature.
 */
export function watchSyncConflicts(docId: string): () => void {
  void scanSyncConflicts(docId);
  return onTabReturn(() => void scanSyncConflicts(docId));
}

/**
 * Run a cleanup and re-publish the report (task 411) — the OPERATION half of the
 * badge's one-click delete, kept here beside the scan for the same reason the
 * scan is not in the hook: the four pieces stay separable, and this one is
 * LISTING + PLAN + CHANNEL composed.
 *
 * The doc handle comes from `getActiveHandle`, the documented non-React door:
 * the badge lives in the topbar, OUTSIDE `<DocPipeline>`, so there is no context
 * handle to read. No open pipeline ⇒ the run REFUSES with an empty receipt
 * rather than reaching for a handle it cannot prove is live — a delete is not a
 * place to guess a destination.
 *
 * The RE-SCAN afterwards is what makes the notice converge: the report is
 * derived from a directory listing, so re-publishing after a delete drops the
 * removed names, re-derives the signature, and clears the pill by itself when
 * the folder is empty of forks. It runs even on a failed or refused cleanup —
 * whatever the folder now holds is what the badge should be saying.
 *
 * A THROW resolves to the same empty receipt rather than propagating. This is
 * called from a click handler, so an escaping rejection is an unhandled promise
 * and a button that silently does nothing — the false-affordance shape, arriving
 * as an error path. An empty receipt is a fact the caller can READ and say out
 * loud ("nothing was deleted"), which is what the report-is-the-permission rule
 * asks for; the throw is logged rather than swallowed silently.
 */
export async function runSyncConflictCleanup(
  docId: string,
  names: readonly string[],
): Promise<SidecarCleanupReceipt> {
  const empty: SidecarCleanupReceipt = { deleted: [], refused: [], failed: [] };
  const handle = getActiveHandle(docId);
  // No open pipeline: refuse rather than reach for a handle we cannot prove is
  // live. A delete is not a place to guess a destination.
  if (!handle) return empty;
  try {
    return await deleteSidecarSiblings(handle, names);
  } catch (e) {
    console.warn("[sync-conflict] cleanup failed:", e);
    return empty;
  } finally {
    await scanSyncConflicts(docId);
  }
}
