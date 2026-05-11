"use client";

import { useEffect, useMemo, useState } from "react";
import { getLibraryHandle, queryReadWritePermission } from "@library/lib/library-folder";
import { useDiskLibraries } from "@library/hooks/useDiskLibraries";
import {
  CENTRAL_LIBRARY_ID,
  REGISTRY_CHANGED_EVENT,
  type Library,
} from "@library/lib/library-store";

const CENTRAL_LIBRARY: Library = {
  id: CENTRAL_LIBRARY_ID,
  label: "Central Library",
  createdAt: 0,
  kind: "central",
};

/**
 * Read-only subscription to the shared library registry. Used by
 * consumers OUTSIDE the library subsystem (e.g. EditorLayout's outer
 * tab strip) to look up library labels by id without owning a full
 * `useLibraryTabs` instance.
 *
 * Post disk-resident-libraries refactor (May 2026): custom libraries
 * live at `<root>/.virgil/libraries/<slug>.json`. This hook fetches
 * the FSA handle internally, then delegates to `useDiskLibraries` for
 * the actual read + cross-window sync. The result is the same
 * `Map<id, Library>` shape the previous localStorage-backed
 * implementation returned, including Central. Paper and project libs
 * are NOT included here — only callers that own panel-tab state
 * (i.e. `useLibraryTabs`) can derive those, and outside-the-library
 * consumers don't need them anyway.
 */
export function useLibraryRegistry(): Map<string, Library> {
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);

  // Fetch the stored FSA handle on mount. Re-fetch on
  // REGISTRY_CHANGED_EVENT in case the user picked a different folder
  // mid-session (the picker dispatches the event on every successful
  // pick via the disk-libraries hook's fan-out).
  useEffect(() => {
    let cancelled = false;
    const fetchHandle = async () => {
      try {
        const h = await getLibraryHandle();
        if (!h) {
          if (!cancelled) setHandle(null);
          return;
        }
        const perm = await queryReadWritePermission(h);
        if (cancelled) return;
        setHandle(perm === "granted" ? h : null);
      } catch {
        if (!cancelled) setHandle(null);
      }
    };
    void fetchHandle();
    const onChange = () => void fetchHandle();
    window.addEventListener(REGISTRY_CHANGED_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener(REGISTRY_CHANGED_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, []);

  const disk = useDiskLibraries(handle);

  return useMemo(() => {
    const m = new Map<string, Library>();
    m.set(CENTRAL_LIBRARY.id, CENTRAL_LIBRARY);
    for (const lib of disk.libraries) m.set(lib.id, lib);
    return m;
  }, [disk.libraries]);
}
