"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readCatalogVersion } from "@library/lib/catalog";
import {
  deleteLibraryManifest,
  ensureLibrariesDir,
  fileExists,
  listLibraryManifests,
  readLibrariesStamp,
  SUBDIRS,
  writeLibraryManifest,
  writeTextFile,
  type LibraryManifest,
} from "@library/lib/library-storage";
import {
  dedupeSlug,
  isBuiltin,
  isPaperId,
  isProjectDocId,
  libraryManifestFilename,
  loadRegistry,
  newLibraryId,
  REGISTRY_CHANGED_EVENT,
  saveRegistry,
  slugifyLibraryLabel,
  type Library,
} from "@library/lib/library-store";
import {
  announceManifestChange,
  enqueueManifestIo as enqueueIo,
  MANIFEST_CHANNEL_NAME,
  newManifestToken,
} from "@library/lib/manifest-io";

/**
 * Single source of truth for custom-library state, fed from
 * `.virgil/libraries/<slug>.json` manifests on disk.
 *
 * **API shape — sync-with-background-writes.** Every mutator
 * (`create`, `rename`, `addEntries`, …) returns synchronously after
 * updating in-memory state; the disk write fires in the background.
 * That matches the long-standing surface of `useLibraryTabs`
 * (callers like `LibrariesNavigator.handleCreate` consume the new
 * id immediately) and means failures during disk I/O are logged but
 * never throw at the call site.
 *
 * **ONE mutation door (task 762).** Every mutator is an OP — a pure
 * transform of one library's record — pushed onto a pending list. The
 * in-memory view is always `replay(base, pending)`, where `base` is the
 * last state confirmed on disk; it is recomputed SYNCHRONOUSLY inside the
 * door, so N mutators called in one handler compose (never "each starts
 * from the same render-time snapshot"). Disk I/O runs on ONE serial chain
 * (module-level, so every hook instance in the window shares it): a flush
 * RE-READS the manifests and replays the pending ops onto that fresh base
 * before writing — so another window's edit is rebased onto, never
 * clobbered, and a stale filename (renamed elsewhere) is never re-created.
 * A reload rides the same chain and only ever replaces `base`; pending ops
 * are replayed over it, so a reload can never drop an in-flight mutation.
 *
 * **Cross-window.** Every flush that wrote announces it
 * (`announceManifestChange`): the store's stamp `.virgil/libraries/.version`,
 * a `BroadcastChannel` post, and the same-window `REGISTRY_CHANGED_EVENT`.
 * Another window reloads instantly via the channel, or within ≤ 6 s via
 * the poll (which reads the stamp alongside `catalog-version.txt`).
 *
 * Responsibilities:
 *  - Load every manifest on mount and on each change signal.
 *  - One-time migration from the legacy localStorage registry.
 *  - Stale-`sourceBibFile` cleanup (clear when the source `.bib` is
 *    no longer in `unsorted/`).
 *
 * `handle === null` (no FSA permission yet) means the hook is
 * dormant: nothing is read, and mutations stay pending in memory until
 * the handle arrives (the load that follows flushes them).
 */

const POLL_MS = 6000;
const MIGRATION_SENTINEL = ".migrated";

export interface DiskLibrariesApi {
  /** Custom libraries loaded from disk, sorted by createdAt. */
  libraries: Library[];
  /** Whether the first disk read has completed. */
  hydrated: boolean;
  reload: () => Promise<void>;
  /** Create a new empty custom library. Returns synchronously; the
   *  disk write happens in the background. */
  create: (label: string) => Library;
  /** Create a custom library pre-populated from a parsed `.bib`
   *  import. Caller is responsible for having already written the
   *  source file to `unsorted/<sourceBibFile>`. */
  createFromBib: (args: {
    label: string;
    sourceBibFile: string;
    citekeys: readonly string[];
  }) => Library;
  rename: (id: string, newLabel: string) => void;
  remove: (id: string) => void;
  addEntries: (id: string, citekeys: readonly string[]) => void;
  removeEntry: (id: string, citekey: string) => void;
  setSourceBibFile: (id: string, sourceBibFile: string | null) => void;
  togglePin: (id: string) => void;
}

interface ManifestRecord {
  filename: string;
  manifest: LibraryManifest;
}

type Records = ReadonlyMap<string, ManifestRecord>;

const DELETE = Symbol("delete");

/** One mutation: a pure transform of library `id`'s record, given every
 *  record (for slug de-duplication). `null` = no change; `DELETE` = remove.
 *  Must be safe to replay against a different base — it is applied once to
 *  the in-memory view and again, at flush time, to a fresh disk read. */
interface PendingOp {
  id: string;
  opName: string;
  apply: (
    rec: ManifestRecord | undefined,
    all: Records,
  ) => ManifestRecord | null | typeof DELETE;
}

function replay(base: Records, ops: readonly PendingOp[]): Map<string, ManifestRecord> {
  const out = new Map(base);
  for (const op of ops) {
    const r = op.apply(out.get(op.id), out);
    if (r === DELETE) out.delete(op.id);
    else if (r) out.set(op.id, r);
  }
  return out;
}

/** Same consumer-visible content (everything but `updatedAt`, which
 *  differs between an optimistic replay and the flushed one). */
function recordsEqual(a: Records, b: Records): boolean {
  if (a.size !== b.size) return false;
  for (const [id, ra] of a) {
    const rb = b.get(id);
    if (!rb) return false;
    if (ra === rb) continue;
    const ma = ra.manifest;
    const mb = rb.manifest;
    if (
      ra.filename !== rb.filename ||
      ma.label !== mb.label ||
      ma.createdAt !== mb.createdAt ||
      ma.pinned !== mb.pinned ||
      ma.sourceBibFile !== mb.sourceBibFile ||
      ma.citekeys.length !== mb.citekeys.length ||
      ma.citekeys.some((k, i) => k !== mb.citekeys[i])
    ) {
      return false;
    }
  }
  return true;
}

function slugsExcept(all: Records, id: string): Set<string> {
  const s = new Set<string>();
  for (const r of all.values()) {
    if (r.manifest.id !== id) s.add(r.filename.replace(/\.json$/i, ""));
  }
  return s;
}

function manifestToLibrary(m: LibraryManifest): Library {
  return {
    id: m.id,
    label: m.label,
    createdAt: m.createdAt,
    kind: "custom",
    entryKeys: m.citekeys.slice(),
    pinned: m.pinned,
    sourceBibFile: m.sourceBibFile,
  };
}

function makeManifest(args: {
  id: string;
  label: string;
  citekeys: readonly string[];
  sourceBibFile?: string;
  pinned?: boolean;
  createdAt?: number;
}): LibraryManifest {
  const now = Date.now();
  const dedup: string[] = [];
  const seen = new Set<string>();
  for (const k of args.citekeys) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dedup.push(k);
  }
  return {
    schemaVersion: 1,
    id: args.id,
    label: args.label || "Untitled",
    createdAt: args.createdAt ?? now,
    updatedAt: now,
    citekeys: dedup,
    pinned: args.pinned === true ? true : undefined,
    sourceBibFile: args.sourceBibFile,
  };
}

function isCustomId(id: string): boolean {
  return !(isBuiltin(id) || isPaperId(id) || isProjectDocId(id));
}

export function useDiskLibraries(
  handle: FileSystemDirectoryHandle | null,
): DiskLibrariesApi {
  // Records keyed by library id (not filename) so renames don't
  // invalidate consumers' references. The filename is preserved
  // alongside so we can rename / delete the right file later.
  const [records, setRecords] = useState<Map<string, ManifestRecord>>(
    () => new Map(),
  );
  const [hydrated, setHydrated] = useState(false);
  const versionRef = useRef<string>("");
  const stampRef = useRef<string>("");
  const migratedRef = useRef(false);
  const sourceRef = useRef<string>("");
  if (!sourceRef.current) sourceRef.current = newManifestToken();

  const handleRef = useRef<FileSystemDirectoryHandle | null>(handle);
  handleRef.current = handle;

  // The door's state. `base` = last state confirmed on disk; `pending` =
  // ops not yet flushed; `view` = replay(base, pending), the authority every
  // sync mutator reads (updated in the door, never via render).
  const baseRef = useRef<Map<string, ManifestRecord>>(new Map());
  const pendingRef = useRef<PendingOp[]>([]);
  const viewRef = useRef<Map<string, ManifestRecord>>(new Map());

  const publish = useCallback(() => {
    const next = replay(baseRef.current, pendingRef.current);
    // Equality bail: a flush confirming what the optimistic view already
    // showed (or a reload that found nothing new) keeps the old identity,
    // so consumers don't re-render twice per mutation.
    if (recordsEqual(viewRef.current, next)) return;
    viewRef.current = next;
    setRecords(next);
  }, []);

  // ---------- Load + migrate ----------

  const loadFromDisk = useCallback(
    async (root: FileSystemDirectoryHandle): Promise<Map<string, ManifestRecord>> => {
      const list = await listLibraryManifests(root);
      const next = new Map<string, ManifestRecord>();
      for (const item of list) {
        next.set(item.manifest.id, item);
      }
      return next;
    },
    [],
  );

  const signalChange = useCallback(async (root: FileSystemDirectoryHandle) => {
    stampRef.current = await announceManifestChange(root, sourceRef.current);
  }, []);

  /** Drain the pending ops: re-read disk, replay the batch onto that fresh
   *  base, write exactly the records that changed. Runs on the io chain. */
  const flush = useCallback(async (): Promise<void> => {
    const root = handleRef.current;
    if (!root || pendingRef.current.length === 0) return;
    const batch = pendingRef.current.slice();
    let disk: Map<string, ManifestRecord>;
    try {
      await ensureLibrariesDir(root);
      disk = await loadFromDisk(root);
    } catch (err) {
      // Leave the ops pending; the next flush/reload retries them.
      console.error("[library] flush: failed to read manifests", err);
      return;
    }
    const result = replay(disk, batch);
    let wrote = false;
    let failed = false;
    for (const [id, rec] of result) {
      const before = disk.get(id);
      if (before === rec) continue;
      try {
        await writeLibraryManifest(root, rec.filename, rec.manifest);
        wrote = true;
        if (before && before.filename !== rec.filename) {
          await deleteLibraryManifest(root, before.filename);
        }
      } catch (err) {
        failed = true;
        console.error(`[library] failed to write ${rec.filename}`, err);
      }
    }
    for (const [id, before] of disk) {
      if (result.has(id)) continue;
      try {
        await deleteLibraryManifest(root, before.filename);
        wrote = true;
      } catch (err) {
        failed = true;
        console.error(`[library] failed to delete ${before.filename}`, err);
      }
    }
    // The batch is a prefix of `pending` (only this chain removes ops, and
    // the door only appends), so later ops survive untouched.
    pendingRef.current = pendingRef.current.slice(batch.length);
    if (failed) {
      try {
        baseRef.current = await loadFromDisk(root);
      } catch {
        baseRef.current = disk;
      }
    } else {
      baseRef.current = result;
    }
    publish();
    if (wrote) await signalChange(root);
  }, [loadFromDisk, publish, signalChange]);

  const scheduleFlush = useCallback(() => {
    void enqueueIo(flush);
  }, [flush]);

  /** THE door. Applies `op` to the view synchronously (so back-to-back
   *  calls compose) and queues its write. Returns the op's result on the
   *  view, or null when it changed nothing (nothing is queued then). */
  const commit = useCallback(
    (op: PendingOp): ManifestRecord | typeof DELETE | null => {
      const r = op.apply(viewRef.current.get(op.id), viewRef.current);
      if (r === null) return null;
      pendingRef.current = [...pendingRef.current, op];
      publish();
      scheduleFlush();
      return r;
    },
    [publish, scheduleFlush],
  );

  /** One-shot migration from `localStorage["virgil-library-registry"]`.
   *  Runs only when:
   *    - the disk has zero manifests, AND
   *    - the migration sentinel `.migrated` is not present, AND
   *    - localStorage has at least one `kind: "custom"` library.
   *  Writes a sentinel after success so the migration is idempotent. */
  const migrateFromLocalStorage = useCallback(
    async (root: FileSystemDirectoryHandle): Promise<void> => {
      const sentinelPath = `${SUBDIRS.libraries}/${MIGRATION_SENTINEL}`;
      if (await fileExists(root, sentinelPath)) return;

      const reg = loadRegistry();
      const customs = reg.libraries.filter((l) => l.kind === "custom");
      if (customs.length === 0) {
        // Still write the sentinel so we don't re-attempt forever.
        try {
          await writeTextFile(root, sentinelPath, JSON.stringify(reg));
        } catch {
          /* ignore — best effort */
        }
        return;
      }

      const usedSlugs = new Set<string>();
      let writtenCount = 0;
      for (const lib of customs) {
        const slug = dedupeSlug(slugifyLibraryLabel(lib.label), usedSlugs);
        usedSlugs.add(slug);
        const filename = libraryManifestFilename(slug);
        const manifest = makeManifest({
          id: lib.id,
          label: lib.label,
          citekeys: lib.entryKeys ?? [],
          sourceBibFile: lib.sourceBibFile,
          pinned: lib.pinned === true,
          createdAt: lib.createdAt || Date.now(),
        });
        try {
          await writeLibraryManifest(root, filename, manifest);
          writtenCount += 1;
        } catch (err) {
          console.error(
            `[library] migration: failed to write ${filename}; continuing`,
            err,
          );
        }
      }

      // Sentinel: dump the source registry so the user has a recovery
      // path if anything went wrong.
      try {
        await writeTextFile(root, sentinelPath, JSON.stringify(reg));
      } catch {
        /* ignore — best effort */
      }

      // Strip migrated custom rows out of localStorage so the legacy
      // path doesn't fight the new one. Built-in / paper / project
      // entries are left alone (the loader filters non-custom on read
      // anyway, but cleaning up here keeps storage tidy).
      try {
        saveRegistry({
          libraries: reg.libraries.filter((l) => l.kind !== "custom"),
        });
      } catch {
        /* ignore */
      }

      if (writtenCount > 0) {
        console.log(
          `[library] migrated ${writtenCount} custom librar${
            writtenCount === 1 ? "y" : "ies"
          } to .virgil/libraries/`,
        );
      }
    },
    [],
  );

  /** Drop `sourceBibFile` from any manifest whose source `.bib` is no
   *  longer in `unsorted/`. Runs inside a reload, i.e. on the io chain. */
  const cleanupStaleSourceBibFiles = useCallback(
    async (
      root: FileSystemDirectoryHandle,
      current: Map<string, ManifestRecord>,
    ): Promise<Map<string, ManifestRecord>> => {
      let next: Map<string, ManifestRecord> | null = null;
      for (const [id, rec] of current) {
        const src = rec.manifest.sourceBibFile;
        if (!src) continue;
        const exists = await fileExists(root, `${SUBDIRS.unsorted}/${src}`);
        if (exists) continue;
        const updated: LibraryManifest = {
          ...rec.manifest,
          sourceBibFile: undefined,
          updatedAt: Date.now(),
        };
        try {
          await writeLibraryManifest(root, rec.filename, updated);
          next ??= new Map(current);
          next.set(id, { filename: rec.filename, manifest: updated });
        } catch (err) {
          console.warn(
            `[library] cleanup: failed to rewrite ${rec.filename}`,
            err,
          );
        }
      }
      return next ?? current;
    },
    [],
  );

  /** Re-read disk into `base`. Ordered on the io chain behind every write
   *  enqueued before it; pending ops are replayed over the result, so a
   *  reload never drops an in-flight mutation. */
  const reload = useCallback(async () => {
    await enqueueIo(async () => {
      const root = handleRef.current;
      if (!root) {
        baseRef.current = new Map();
        publish();
        setHydrated(true);
        return;
      }
      try {
        await ensureLibrariesDir(root);
        if (!migratedRef.current) {
          migratedRef.current = true;
          const initial = await loadFromDisk(root);
          if (initial.size === 0) {
            await migrateFromLocalStorage(root);
          }
        }
        let next = await loadFromDisk(root);
        next = await cleanupStaleSourceBibFiles(root, next);
        baseRef.current = next;
        publish();
        try {
          versionRef.current = await readCatalogVersion(root);
          stampRef.current = await readLibrariesStamp(root);
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error("[library] useDiskLibraries: reload failed", err);
      } finally {
        setHydrated(true);
      }
    });
    // Ops made while dormant (no handle) or left by a failed read flush now.
    if (pendingRef.current.length > 0) scheduleFlush();
  }, [
    cleanupStaleSourceBibFiles,
    loadFromDisk,
    migrateFromLocalStorage,
    publish,
    scheduleFlush,
  ]);

  // Mount: initial load.
  useEffect(() => {
    void reload();
  }, [handle, reload]);

  // Poll: `catalog-version.txt` (Python skills) + the manifest store's own
  // stamp (another window's manifest write).
  useEffect(() => {
    if (!handle) return;
    let stopped = false;
    const tick = async () => {
      const root = handleRef.current;
      if (stopped || !root) return;
      try {
        const v = await readCatalogVersion(root);
        const s = await readLibrariesStamp(root);
        if (v !== versionRef.current || s !== stampRef.current) {
          versionRef.current = v;
          stampRef.current = s;
          await reload();
        }
      } catch {
        /* ignore */
      }
    };
    const interval = window.setInterval(tick, POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [handle, reload]);

  // Instant change signals: other hook instances in this window (window
  // event) and other windows (BroadcastChannel). Our own posts are skipped.
  useEffect(() => {
    const isOwn = (source: unknown) => source === sourceRef.current;
    const onChange = (e: Event) => {
      if (isOwn((e as CustomEvent<{ source?: string }>).detail?.source)) return;
      void reload();
    };
    window.addEventListener(REGISTRY_CHANGED_EVENT, onChange);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        channel = new BroadcastChannel(MANIFEST_CHANNEL_NAME);
        channel.onmessage = (e: MessageEvent<{ source?: string }>) => {
          if (isOwn(e.data?.source)) return;
          void reload();
        };
      } catch {
        channel = null;
      }
    }
    return () => {
      window.removeEventListener(REGISTRY_CHANGED_EVENT, onChange);
      channel?.close();
    };
  }, [reload]);

  // ---------- Sync mutators (all through `commit`) ----------

  const createWith = useCallback(
    (manifest: LibraryManifest): Library => {
      commit({
        id: manifest.id,
        opName: "create",
        apply: (rec, all) => {
          if (rec) return null;
          const slug = dedupeSlug(
            slugifyLibraryLabel(manifest.label),
            slugsExcept(all, manifest.id),
          );
          return { filename: libraryManifestFilename(slug), manifest };
        },
      });
      return manifestToLibrary(manifest);
    },
    [commit],
  );

  const create = useCallback(
    (label: string): Library =>
      createWith(
        makeManifest({
          id: newLibraryId(),
          label: (label || "").trim() || "Untitled",
          citekeys: [],
        }),
      ),
    [createWith],
  );

  const createFromBib = useCallback(
    (args: {
      label: string;
      sourceBibFile: string;
      citekeys: readonly string[];
    }): Library =>
      createWith(
        makeManifest({
          id: newLibraryId(),
          label: (args.label || "").trim() || "Untitled",
          citekeys: args.citekeys,
          sourceBibFile: args.sourceBibFile,
        }),
      ),
    [createWith],
  );

  const rename = useCallback(
    (id: string, newLabel: string) => {
      if (!isCustomId(id)) return;
      const trimmed = (newLabel || "").trim() || "Untitled";
      commit({
        id,
        opName: "rename",
        apply: (rec, all) => {
          if (!rec || rec.manifest.label === trimmed) return null;
          const slug = dedupeSlug(
            slugifyLibraryLabel(trimmed),
            slugsExcept(all, id),
          );
          return {
            filename: libraryManifestFilename(slug),
            manifest: { ...rec.manifest, label: trimmed, updatedAt: Date.now() },
          };
        },
      });
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      if (!isCustomId(id)) return;
      commit({ id, opName: "remove", apply: (rec) => (rec ? DELETE : null) });
    },
    [commit],
  );

  /** Field-level mutation: transform the manifest, keep its filename. */
  const mutate = useCallback(
    (
      id: string,
      transform: (m: LibraryManifest) => LibraryManifest | null,
      opName: string,
    ) => {
      if (!isCustomId(id)) return;
      commit({
        id,
        opName,
        apply: (rec) => {
          if (!rec) return null;
          const next = transform(rec.manifest);
          if (!next) return null;
          return {
            filename: rec.filename,
            manifest: { ...next, updatedAt: Date.now() },
          };
        },
      });
    },
    [commit],
  );

  const addEntries = useCallback(
    (id: string, citekeys: readonly string[]) => {
      if (citekeys.length === 0) return;
      mutate(
        id,
        (m) => {
          const seen = new Set(m.citekeys);
          let changed = false;
          const next = m.citekeys.slice();
          for (const k of citekeys) {
            if (!k || seen.has(k)) continue;
            seen.add(k);
            next.push(k);
            changed = true;
          }
          if (!changed) return null;
          return { ...m, citekeys: next };
        },
        "addEntries",
      );
    },
    [mutate],
  );

  const removeEntry = useCallback(
    (id: string, citekey: string) => {
      if (!citekey) return;
      mutate(
        id,
        (m) => {
          if (!m.citekeys.includes(citekey)) return null;
          return { ...m, citekeys: m.citekeys.filter((k) => k !== citekey) };
        },
        "removeEntry",
      );
    },
    [mutate],
  );

  const setSourceBibFile = useCallback(
    (id: string, sourceBibFile: string | null) => {
      mutate(
        id,
        (m) => {
          const next = sourceBibFile ?? undefined;
          if (m.sourceBibFile === next) return null;
          return { ...m, sourceBibFile: next };
        },
        "setSourceBibFile",
      );
    },
    [mutate],
  );

  const togglePin = useCallback(
    (id: string) => {
      mutate(
        id,
        (m) => ({
          ...m,
          pinned: m.pinned ? undefined : true,
        }),
        "togglePin",
      );
    },
    [mutate],
  );

  // Derived: ordered list of `Library` objects for consumers. Memoized on
  // `records` so its identity is stable across unrelated renders — a fresh
  // array every render churns `useLibraryRegistry`'s Map, which (via the
  // outer tab strip) would defeat the memoized top bar on every unrelated
  // EditorLayout tick.
  const libraries: Library[] = useMemo(
    () =>
      Array.from(records.values())
        .sort((a, b) => a.manifest.createdAt - b.manifest.createdAt)
        .map((r) => manifestToLibrary(r.manifest)),
    [records],
  );

  return {
    libraries,
    hydrated,
    reload,
    create,
    createFromBib,
    rename,
    remove,
    addEntries,
    removeEntry,
    setSourceBibFile,
    togglePin,
  };
}
