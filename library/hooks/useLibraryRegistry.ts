"use client";

import { useEffect, useMemo, useState } from "react";
import {
  loadRegistry,
  REGISTRY_CHANGED_EVENT,
  type Library,
  type Registry,
} from "@library/lib/library-store";

const REGISTRY_KEY = "virgil-library-registry";

/**
 * Read-only subscription to the shared library registry. Used by
 * consumers OUTSIDE the library subsystem (e.g. EditorLayout's outer
 * tab strip) to look up library labels by id without owning a full
 * `useLibraryTabs` instance. Picks up label renames via the `storage`
 * event so the outer bar stays in sync when the user renames a
 * library inside the inline Library tab.
 */
export function useLibraryRegistry(): Map<string, Library> {
  const [registry, setRegistry] = useState<Registry>(() => loadRegistry());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === REGISTRY_KEY) setRegistry(loadRegistry());
    };
    const onChange = () => setRegistry(loadRegistry());
    window.addEventListener("storage", onStorage);
    window.addEventListener(REGISTRY_CHANGED_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(REGISTRY_CHANGED_EVENT, onChange);
    };
  }, []);
  // The `storage` event only fires for cross-window writes. Within the
  // same window, the inline Library hook updates the registry via its
  // own setRegistry, but its localStorage write doesn't notify us. Poll
  // on a 1.5s tick so renames + new-library creations show up
  // reasonably quickly without being chatty.
  useEffect(() => {
    const id = window.setInterval(() => {
      setRegistry((prev) => {
        const next = loadRegistry();
        if (
          prev.libraries.length === next.libraries.length &&
          prev.libraries.every(
            (l, i) =>
              next.libraries[i] &&
              next.libraries[i].id === l.id &&
              next.libraries[i].label === l.label,
          )
        ) {
          return prev;
        }
        return next;
      });
    }, 1500);
    return () => window.clearInterval(id);
  }, []);
  return useMemo(() => {
    const m = new Map<string, Library>();
    for (const l of registry.libraries) m.set(l.id, l);
    return m;
  }, [registry]);
}
