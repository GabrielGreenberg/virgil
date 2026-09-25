"use client";

// The mounted library root — ONE app-level fact, held once (task 766).
//
// "Which folder is the library" is not per-surface state. The Library tab,
// every torn-out Library outer tab and every popped-out paper tab read and
// write the SAME library, so the resolved root lives here, in a module store
// every `useLibraryHandle` subscribes to — never in one component's
// `useState`. Before this, each surface resolved its own copy once on mount,
// and a Reset / re-pick in one left every other surface `ready` on the OLD
// folder, landing its drops, renames and queue writes there.
//
// The store is owned by the IndexedDB handle record (`library-folder.ts`):
// every door that changes that record — pick, reset, and a grant that turns
// the stored handle usable — publishes here AND posts a stamp to
// `localStorage`, which peer windows hear through `subscribeToStorageKey` and
// answer by re-resolving from IndexedDB (the handle itself can't cross the
// storage event; the stamp is only the signal). So every surface in every
// window agrees, immediately.
//
// Genuinely per-surface state stays in the hook: `pickerError` belongs to
// the gate whose button was clicked.

import { useEffect, useSyncExternalStore } from "react";
import {
  getLibraryHandle,
  pickLibraryFolder,
  ensureReadWritePermission,
  queryReadWritePermission,
  clearLibraryHandle,
  resolveLibraryRootPath,
} from "@library/lib/library-folder";
import { ensureLibraryStructure } from "@library/lib/library-storage";
import { syncSkillBundle, type SyncResult } from "@library/lib/skill-sync";
import { postStorageStamp, subscribeToStorageKey } from "@/lib/cross-window-storage";

export type FolderState =
  | { kind: "loading" }
  | { kind: "none" }
  | { kind: "needs-permission"; handle: FileSystemDirectoryHandle }
  | { kind: "ready"; handle: FileSystemDirectoryHandle }
  /** Reading the stored handle (IndexedDB) or its permission REJECTED. A
   *  terminal state the gate renders with a Retry — never a "Loading…" that
   *  never ends (task 764). */
  | { kind: "error"; message: string };

/** A surfaced skill-bundle sync failure for the library folder. Drives a
 *  dismissible banner in LibraryView so a failed sync is a visible, fixable
 *  event rather than a silent console.error. */
export interface SkillSyncError {
  /** True for a revoked/denied FSA permission (NotAllowedError) — the
   *  banner words it as a permission problem and Retry re-grants. */
  permission: boolean;
  message: string;
}

export interface LibraryRootSnapshot {
  state: FolderState;
  lastSync: SyncResult | null;
  syncError: SkillSyncError | null;
}

/** The localStorage key whose change tells peer windows the stored handle
 *  moved. Its VALUE is a nonce — the handle lives in IndexedDB. */
export const LIBRARY_ROOT_STAMP_KEY = "virgil:library-root-stamp";

/** Result of a picker/grant door, for the calling surface to word. */
export type RootDoorResult =
  | { kind: "ok" }
  | { kind: "cancelled" }
  | { kind: "busy" }
  | { kind: "error"; message: string };

function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

// ── Store ───────────────────────────────────────────────────────────────────

const INITIAL: LibraryRootSnapshot = { state: { kind: "loading" }, lastSync: null, syncError: null };
let snapshot: LibraryRootSnapshot = INITIAL;
const listeners = new Set<() => void>();
let subscriberCount = 0;
let offStorage: (() => void) | null = null;

// Newest-transition-wins. Every door that decides the root takes a ticket; a
// slow resolve (IndexedDB read, an 8 s structure watchdog) that finishes
// after a newer reset/pick never publishes over it.
let seq = 0;
// De-dupe skill sync across mounts, StrictMode double-invokes and re-resolves.
let syncedHandle: FileSystemDirectoryHandle | null = null;
// Chrome's "file picker already active" is per window, so the guard is too:
// a second click on ANY gate while one dialog is open would trip it.
let pickerInFlight = false;

function publish(patch: Partial<LibraryRootSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l();
}

function getSnapshot(): LibraryRootSnapshot {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tell peer windows the stored handle changed. */
function stamp(): void {
  postStorageStamp(LIBRARY_ROOT_STAMP_KEY);
}

/** Same directory? Keeps the published handle's IDENTITY stable across
 *  re-resolves, so consumers keyed on it (queue/catalog adopters, effects)
 *  don't churn when nothing actually moved. The dev handle has no
 *  `isSameEntry`; there is exactly one dev root, so its name decides. */
async function sameRoot(a: FileSystemDirectoryHandle, b: FileSystemDirectoryHandle): Promise<boolean> {
  if (a === b) return true;
  try {
    if (typeof a.isSameEntry === "function") return await a.isSameEntry(b);
  } catch {
    return false;
  }
  return a.name === b.name;
}

async function stableHandle(handle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  const cur = snapshot.state;
  if ((cur.kind === "ready" || cur.kind === "needs-permission") && (await sameRoot(cur.handle, handle))) {
    return cur.handle;
  }
  return handle;
}

/**
 * Write the Virgil skill bundle into the library folder. Best-effort on the
 * auto path (library-open), but never silent: any failure becomes a surfaced
 * `syncError` and a successful sync clears it + records lastSync.
 *
 * `regrant` re-acquires a possibly-revoked FSA permission first (e.g. after a
 * PWA reinstall); its prompt must ride a user gesture, so it's only passed
 * from the Re-sync / Retry click, never the auto path.
 */
async function runSkillSync(
  handle: FileSystemDirectoryHandle,
  opts: { dedupe?: boolean; regrant?: boolean } = {},
): Promise<void> {
  if (opts.dedupe && syncedHandle === handle) return;
  syncedHandle = handle;
  try {
    if (opts.regrant) {
      const perm = await ensureReadWritePermission(handle);
      if (perm !== "granted") {
        publish({
          syncError: {
            permission: true,
            message:
              "Virgil couldn't get permission to write the skill bundle into your library folder. Grant access and try again.",
          },
        });
        return;
      }
    }
    // Library folder writes its own library-path.json pointing to itself. In
    // dev-storage we have the abs path via the dev API; in production FSA we
    // leave it null (handled gracefully by library_path.py's resolution chain).
    const libraryRoot = (await resolveLibraryRootPath()) ?? null;
    const result = await syncSkillBundle(handle, { libraryRoot });
    if (syncedHandle !== handle) return; // the root moved while we synced
    publish({ syncError: null, lastSync: result });
  } catch (err) {
    if (syncedHandle !== handle) return;
    const permission = err instanceof DOMException && err.name === "NotAllowedError";
    publish({
      syncError: {
        permission,
        message: permission
          ? "Virgil lost permission to write the skill bundle into your library folder (this can happen after reinstalling the app). Click Retry to re-grant access."
          : `Virgil couldn't sync the skill bundle into your library: ${describeError(err)}. Your cowork commands may be out of date — click Retry.`,
      },
    });
    console.error("[skill-sync] failed", err);
  }
}

async function becameReady(handle: FileSystemDirectoryHandle, ticket: number): Promise<void> {
  // Watchdog: if any FSA call inside ensureLibraryStructure stalls without
  // throwing or resolving (rare but observed — iCloud Drive sync, locked
  // folders, OS permission prompts that never close), Promise.race lets us
  // proceed to a usable "ready" state instead of stranding the user on the
  // "Loading…" screen forever.
  const STRUCTURE_TIMEOUT_MS = 8000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), STRUCTURE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([ensureLibraryStructure(handle).then(() => "ok" as const), timeout]);
    if (result === "timeout") {
      console.warn(
        `[library] ensureLibraryStructure did not finish within ${STRUCTURE_TIMEOUT_MS}ms — proceeding to "ready" anyway. ` +
          "This usually means a File System Access call is stuck (iCloud sync, locked folder, OS permission prompt). " +
          "The library will load in degraded mode; some bootstrap files may be missing.",
      );
    }
  } catch (err) {
    // Don't gate library load on bootstrap. The handle is permissioned; give
    // the user a usable view (degraded if seeds are missing).
    console.error("[library] ensureLibraryStructure failed; loading anyway", err);
  } finally {
    clearTimeout(timer);
  }
  if (ticket !== seq) return; // a newer reset/pick/resolve owns the root now
  const stable = await stableHandle(handle);
  if (ticket !== seq) return;
  publish({ state: { kind: "ready", handle: stable } });
  // Best-effort, deduped, and never silent — failures surface via syncError.
  void runSkillSync(stable, { dedupe: true });
}

/** Re-read the stored handle from IndexedDB and publish what it resolves to.
 *  Runs on first mount, on Retry, and whenever a peer window stamps a change. */
export async function resolveLibraryRoot(): Promise<void> {
  const ticket = ++seq;
  let handle: FileSystemDirectoryHandle | null | undefined;
  let perm: PermissionState;
  try {
    handle = await getLibraryHandle();
    if (ticket !== seq) return;
    if (!handle) {
      syncedHandle = null;
      publish({ state: { kind: "none" }, lastSync: null, syncError: null });
      return;
    }
    perm = await queryReadWritePermission(handle);
  } catch (err) {
    if (ticket !== seq) return;
    // An IndexedDB / permission-query rejection is a terminal state with a
    // voice, not a pane stuck on "Loading…" (task 764).
    console.error("[library] refresh failed", err);
    publish({ state: { kind: "error", message: `Virgil couldn't read your saved library folder: ${describeError(err)}.` } });
    return;
  }
  if (ticket !== seq) return;
  if (perm === "granted") {
    await becameReady(handle, ticket);
  } else {
    const stable = await stableHandle(handle);
    if (ticket !== seq) return;
    publish({ state: { kind: "needs-permission", handle: stable } });
  }
}

/** Retry from the error state: back to "loading", then re-read. */
export async function retryLibraryRoot(): Promise<void> {
  publish({ state: { kind: "loading" } });
  await resolveLibraryRoot();
}

/** Pick a (new) library folder. Must run inside a user gesture. */
export async function pickLibraryRoot(): Promise<RootDoorResult> {
  if (pickerInFlight) return { kind: "busy" };
  pickerInFlight = true;
  let result;
  try {
    result = await pickLibraryFolder();
  } catch (err) {
    return { kind: "error", message: `Virgil couldn't open the folder picker: ${describeError(err)}.` };
  } finally {
    pickerInFlight = false;
  }
  if (result.kind === "cancelled") return { kind: "cancelled" };
  if (result.kind !== "ok") return { kind: "error", message: result.message };
  const ticket = ++seq;
  stamp();
  await becameReady(result.handle, ticket);
  return { kind: "ok" };
}

/** Grant read/write on the stored handle. Must run inside a user gesture. */
export async function grantLibraryRoot(): Promise<RootDoorResult | { kind: "not-granted"; perm: PermissionState }> {
  const cur = snapshot.state;
  if (cur.kind !== "needs-permission") return { kind: "cancelled" };
  if (pickerInFlight) return { kind: "busy" };
  pickerInFlight = true;
  let perm: PermissionState;
  try {
    perm = await ensureReadWritePermission(cur.handle);
  } catch (err) {
    const name = (err as DOMException)?.name;
    // Chrome's "file picker already active" can fire from requestPermission
    // too. Don't crash — let the user retry.
    if (name === "AbortError") return { kind: "cancelled" };
    if (name === "NotAllowedError") return { kind: "busy" };
    return { kind: "error", message: `Virgil couldn't get access to your library folder: ${describeError(err)}.` };
  } finally {
    pickerInFlight = false;
  }
  if (perm !== "granted") return { kind: "not-granted", perm };
  const ticket = ++seq;
  stamp();
  await becameReady(cur.handle, ticket);
  return { kind: "ok" };
}

/** Forget the library folder — in this surface, every surface, every window. */
export async function resetLibraryRoot(): Promise<void> {
  const ticket = ++seq;
  await clearLibraryHandle();
  if (ticket === seq) {
    syncedHandle = null;
    publish({ state: { kind: "none" }, lastSync: null, syncError: null });
  }
  stamp();
}

/** Manually re-run the skill sync. Clears the dedup so the write happens even
 *  if this folder already synced, and re-grants permission from the click. */
export async function resyncLibrarySkills(): Promise<void> {
  const cur = snapshot.state;
  if (cur.kind !== "ready") return;
  syncedHandle = null;
  await runSkillSync(cur.handle, { regrant: true });
}

export function dismissLibrarySyncError(): void {
  publish({ syncError: null });
}

// ── Lifetime: first subscriber resolves + listens; last one lets go ─────────

function retain(): () => void {
  subscriberCount += 1;
  if (subscriberCount === 1) {
    offStorage = subscribeToStorageKey(LIBRARY_ROOT_STAMP_KEY, () => {
      void resolveLibraryRoot();
    });
    // Every surface having gone means nobody watched the record; re-read it
    // rather than trust a snapshot that may have gone stale meanwhile.
    void resolveLibraryRoot();
  }
  return () => {
    subscriberCount -= 1;
    if (subscriberCount === 0) {
      offStorage?.();
      offStorage = null;
    }
  };
}

/** Subscribe to the one library root. */
export function useLibraryRoot(): LibraryRootSnapshot {
  useEffect(() => retain(), []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test seam: back to a fresh, unresolved store. */
export function __resetLibraryRootStoreForTests(): void {
  offStorage?.();
  offStorage = null;
  snapshot = INITIAL;
  subscriberCount = 0;
  seq += 1;
  syncedHandle = null;
  pickerInFlight = false;
  listeners.clear();
}
