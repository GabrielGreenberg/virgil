"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { readCatalog, readCatalogVersion, type Catalog } from "@library/lib/catalog";

const POLL_MS = 6000;

export function useCatalog(handle: FileSystemDirectoryHandle | null) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const versionRef = useRef<string>("");

  const reload = useCallback(async () => {
    if (!handle) return;
    try {
      const c = await readCatalog(handle);
      setCatalog(c);
      versionRef.current = await readCatalogVersion(handle);
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, [handle]);

  useEffect(() => {
    if (!handle) return;
    let stopped = false;
    void reload();

    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);

    const tick = async () => {
      if (stopped || !handle) return;
      try {
        const v = await readCatalogVersion(handle);
        if (v !== versionRef.current) {
          await reload();
        }
      } catch {
        /* ignore transient errors */
      }
    };
    const interval = window.setInterval(tick, POLL_MS);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [handle, reload]);

  return { catalog, error, reload };
}
