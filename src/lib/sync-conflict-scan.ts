/**
 * The doc-open scan (task 363): list `virgil/`, classify the siblings, publish
 * the report. One directory enumeration per activation, on a fire-and-forget
 * promise — the same shape and the same placement as the skill-bundle sync
 * beside it in `activateDoc`.
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

import { listSidecarNames } from "@/lib/storage";
import { scanSidecarSiblings } from "@/lib/sync-conflict";
import { recordSyncConflictReport } from "@/lib/sync-conflict-notice";

export async function scanSyncConflicts(docId: string): Promise<void> {
  try {
    const names = await listSidecarNames(docId);
    recordSyncConflictReport(docId, scanSidecarSiblings(names));
  } catch {
    /* diagnostic only — never surface a scan failure as a document error */
  }
}
