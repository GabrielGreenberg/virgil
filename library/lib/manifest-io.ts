/**
 * The custom-library manifest store's I/O discipline (task 762) — shared by
 * `useDiskLibraries` (the store's mutation door) and the one writer outside
 * it, `addEntryToLibraryGlobal` (the Virgil-bar drop).
 *
 *  - `enqueueManifestIo`: every manifest read-modify-write in this window
 *    runs on ONE serial chain, so no two writers interleave and a reload is
 *    ordered behind every write enqueued before it.
 *  - `announceManifestChange`: after a write lands, tell everyone — the
 *    on-disk stamp (other windows' poll), a BroadcastChannel (other windows,
 *    instantly) and the same-window `REGISTRY_CHANGED_EVENT`.
 */

import { writeLibrariesStamp } from "./library-storage";
import { REGISTRY_CHANGED_EVENT } from "./library-store";

export const MANIFEST_CHANNEL_NAME = "virgil-library-manifests";

let ioChain: Promise<unknown> = Promise.resolve();

export function enqueueManifestIo<T>(task: () => Promise<T>): Promise<T> {
  const run = ioChain.then(task, task);
  ioChain = run.catch(() => undefined);
  return run;
}

export function newManifestToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Signal a manifest write/delete/rename. `source` identifies the
 *  announcing hook instance so it can skip its own echo (omit it from a
 *  writer that is not a hook — every instance then reloads). Returns the
 *  stamp token written. Never throws. */
export async function announceManifestChange(
  root: FileSystemDirectoryHandle,
  source?: string,
): Promise<string> {
  const token = newManifestToken();
  try {
    await writeLibrariesStamp(root, token);
  } catch (err) {
    console.warn("[library] failed to write the libraries change stamp", err);
  }
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const ch = new BroadcastChannel(MANIFEST_CHANNEL_NAME);
      ch.postMessage({ source });
      ch.close();
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(REGISTRY_CHANGED_EVENT, { detail: { source } }),
      );
    } catch {
      /* ignore */
    }
  }
  return token;
}
