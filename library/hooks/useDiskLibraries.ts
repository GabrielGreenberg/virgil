"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readCatalogVersion } from "@library/lib/catalog";
import {
  deleteLibraryManifest,
  ensureLibrariesDir,
  fileExists,
  listLibraryManifests,
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
 * never throw at the call site. Eventual-consistency: another window
 * sees the change within ≤ 6 s (the catalog-version poll interval),
 * or instantly within the same window via REGISTRY_CHANGED_EVENT.
 *
 * Responsibilities:
 *  - Load every manifest on mount and on each catalog-version bump.
 *  - One-time migration from the legacy localStorage registry.
 *  - Stale-`sourceBibFile` cleanup (clear when the source `.bib` is
 *    no longer in `unsorted/`).
 *  - Cross-window / cross-instance sync via the existing
 *    `REGISTRY_CHANGED_EVENT` window event.
 *
 * `handle === null` (no FSA permission yet) means the hook is
 * dormant: `libraries` stays empty and every mutation is a no-op
 * that logs at most a debug-level warning. Once the handle becomes
 * available, the mount effect fires the initial load.
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

function fanOutChange(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(REGISTRY_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
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
  const migratedRef = useRef(false);

  const handleRef = useRef<FileSystemDirectoryHandle | null>(handle);
  handleRef.current = handle;

  // Mirror records in a ref so sync mutators can read latest state
  // without going through setState's update queue.
  const recordsRef = useRef(records);
  recordsRef.current = records;

  // ---------- Load + migrate ----------

  const loadFromDisk = useCallback(async (): Promise<Map<string, ManifestRecord>> => {
    const root = handleRef.current;
    if (!root) return new Map();
    const list = await listLibraryManifests(root);
    const next = new Map<string, ManifestRecord>();
    for (const item of list) {
      next.set(item.manifest.id, item);
    }
    return next;
  }, []);

  /** One-shot migration from `localStorage["virgil-library-registry"]`.
   *  Runs only when:
   *    - the disk has zero manifests, AND
   *    - the migration sentinel `.migrated` is not present, AND
   *    - localStorage has at least one `kind: "custom"` library.
   *  Writes a sentinel after success so the migration is idempotent. */
  const migrateFromLocalStorage = useCallback(async (): Promise<void> => {
    const root = handleRef.current;
    if (!root) return;
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
  }, []);

  /** Drop `sourceBibFile` from any manifest whose source `.bib` is no
   *  longer in `unsorted/`. */
  const cleanupStaleSourceBibFiles = useCallback(
    async (current: Map<string, ManifestRecord>): Promise<Map<string, ManifestRecord>> => {
      const root = handleRef.current;
      if (!root) return current;
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

  const reload = useCallback(async () => {
    const root = handleRef.current;
    if (!root) {
      setRecords(new Map());
      setHydrated(true);
      return;
    }
    try {
      await ensureLibrariesDir(root);
      if (!migratedRef.current) {
        migratedRef.current = true;
        const initial = await loadFromDisk();
        if (initial.size === 0) {
          await migrateFromLocalStorage();
        }
      }
      let next = await loadFromDisk();
      next = await cleanupStaleSourceBibFiles(next);
      setRecords(next);
      try {
        versionRef.current = await readCatalogVersion(root);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error("[library] useDiskLibraries: reload failed", err);
    } finally {
      setHydrated(true);
    }
  }, [cleanupStaleSourceBibFiles, loadFromDisk, migrateFromLocalStorage]);

  // Mount: initial load.
  useEffect(() => {
    void reload();
  }, [handle, reload]);

  // Catalog-version polling.
  useEffect(() => {
    if (!handle) return;
    let stopped = false;
    const tick = async () => {
      if (stopped || !handleRef.current) return;
      try {
        const v = await readCatalogVersion(handleRef.current);
        if (v !== versionRef.current) {
          versionRef.current = v;
          const next = await loadFromDisk();
          setRecords(next);
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
  }, [handle, loadFromDisk]);

  // Cross-instance / cross-window registry-changed event.
  useEffect(() => {
    const onChange = () => {
      void loadFromDisk().then(setRecords);
    };
    window.addEventListener(REGISTRY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(REGISTRY_CHANGED_EVENT, onChange);
  }, [loadFromDisk]);

  // ---------- Sync mutators ----------

  /** Local optimistic update. Returns the next records map (or null
   *  if the transform decided no change). Does NOT write to disk. */
  const applyLocal = useCallback(
    (
      id: string,
      transform: (rec: ManifestRecord) => ManifestRecord | null,
    ): ManifestRecord | null => {
      const cur = recordsRef.current.get(id);
      if (!cur) return null;
      const updated = transform(cur);
      if (!updated) return null;
      setRecords((prev) => {
        const next = new Map(prev);
        next.set(id, updated);
        return next;
      });
      return updated;
    },
    [],
  );

  const create = useCallback((label: string): Library => {
    const id = newLibraryId();
    const trimmed = (label || "").trim() || "Untitled";
    const usedSlugs = new Set(
      Array.from(recordsRef.current.values()).map((r) =>
        r.filename.replace(/\.json$/i, ""),
      ),
    );
    const slug = dedupeSlug(slugifyLibraryLabel(trimmed), usedSlugs);
    const filename = libraryManifestFilename(slug);
    const manifest = makeManifest({ id, label: trimmed, citekeys: [] });
    setRecords((prev) => {
      const next = new Map(prev);
      next.set(id, { filename, manifest });
      return next;
    });
    const root = handleRef.current;
    if (root) {
      void writeLibraryManifest(root, filename, manifest)
        .then(fanOutChange)
        .catch((err) => {
          console.error(
            `[library] create: failed to write ${filename}`,
            err,
          );
        });
    } else {
      console.warn(
        "[library] create: no FSA handle yet; library exists only in memory until handle becomes available",
      );
    }
    return manifestToLibrary(manifest);
  }, []);

  const createFromBib = useCallback(
    (args: {
      label: string;
      sourceBibFile: string;
      citekeys: readonly string[];
    }): Library => {
      const id = newLibraryId();
      const trimmed = (args.label || "").trim() || "Untitled";
      const usedSlugs = new Set(
        Array.from(recordsRef.current.values()).map((r) =>
          r.filename.replace(/\.json$/i, ""),
        ),
      );
      const slug = dedupeSlug(slugifyLibraryLabel(trimmed), usedSlugs);
      const filename = libraryManifestFilename(slug);
      const manifest = makeManifest({
        id,
        label: trimmed,
        citekeys: args.citekeys,
        sourceBibFile: args.sourceBibFile,
      });
      setRecords((prev) => {
        const next = new Map(prev);
        next.set(id, { filename, manifest });
        return next;
      });
      const root = handleRef.current;
      if (root) {
        void writeLibraryManifest(root, filename, manifest)
          .then(fanOutChange)
          .catch((err) => {
            console.error(
              `[library] createFromBib: failed to write ${filename}`,
              err,
            );
          });
      }
      return manifestToLibrary(manifest);
    },
    [],
  );

  const rename = useCallback((id: string, newLabel: string) => {
    if (isBuiltin(id) || isPaperId(id) || isProjectDocId(id)) return;
    const trimmed = (newLabel || "").trim() || "Untitled";
    const cur = recordsRef.current.get(id);
    if (!cur) return;
    if (trimmed === cur.manifest.label) return;
    const otherSlugs = new Set(
      Array.from(recordsRef.current.values())
        .filter((r) => r.manifest.id !== id)
        .map((r) => r.filename.replace(/\.json$/i, "")),
    );
    const newSlug = dedupeSlug(slugifyLibraryLabel(trimmed), otherSlugs);
    const newFilename = libraryManifestFilename(newSlug);
    const updated: LibraryManifest = {
      ...cur.manifest,
      label: trimmed,
      updatedAt: Date.now(),
    };
    const oldFilename = cur.filename;
    setRecords((prev) => {
      const next = new Map(prev);
      next.set(id, { filename: newFilename, manifest: updated });
      return next;
    });
    const root = handleRef.current;
    if (!root) return;
    void (async () => {
      try {
        await writeLibraryManifest(root, newFilename, updated);
        if (newFilename !== oldFilename) {
          await deleteLibraryManifest(root, oldFilename);
        }
        fanOutChange();
      } catch (err) {
        console.error(
          `[library] rename: failed to write ${newFilename}`,
          err,
        );
      }
    })();
  }, []);

  const remove = useCallback((id: string) => {
    if (isBuiltin(id) || isPaperId(id) || isProjectDocId(id)) return;
    const cur = recordsRef.current.get(id);
    if (!cur) return;
    const filename = cur.filename;
    setRecords((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    const root = handleRef.current;
    if (!root) return;
    void deleteLibraryManifest(root, filename)
      .then(fanOutChange)
      .catch((err) => {
        console.error(`[library] remove: failed to delete ${filename}`, err);
      });
  }, []);

  /** Internal helper: sync update + background write for any
   *  field-level mutation. */
  const mutate = useCallback(
    (
      id: string,
      transform: (m: LibraryManifest) => LibraryManifest | null,
      opName: string,
    ) => {
      if (isBuiltin(id) || isPaperId(id) || isProjectDocId(id)) return;
      const updated = applyLocal(id, (rec) => {
        const next = transform(rec.manifest);
        if (!next) return null;
        const stamped: LibraryManifest = { ...next, updatedAt: Date.now() };
        return { filename: rec.filename, manifest: stamped };
      });
      if (!updated) return;
      const root = handleRef.current;
      if (!root) return;
      void writeLibraryManifest(root, updated.filename, updated.manifest)
        .then(fanOutChange)
        .catch((err) => {
          console.error(
            `[library] ${opName}: failed to write ${updated.filename}`,
            err,
          );
        });
    },
    [applyLocal],
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

  // Derived: ordered list of `Library` objects for consumers.
  const libraries: Library[] = Array.from(records.values())
    .sort((a, b) => a.manifest.createdAt - b.manifest.createdAt)
    .map((r) => manifestToLibrary(r.manifest));

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
