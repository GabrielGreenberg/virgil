"use client";

import { useCallback, useEffect, useState } from "react";
import {
  STYLE_LIBRARY_KEY,
  STYLE_LIBRARY_EVENT,
  getStyleLibrarySync,
  setStyleLibrarySync,
  type StyleLibraryBlob,
} from "@/lib/style-library";
import type { StyleEntry } from "@/lib/document-styles";
import { generateEntityId } from "@/lib/uuid";

/**
 * Reactive view onto the global Style library (localStorage-backed).
 * Mirrors the shape of `usePreferences` — sync seed via localStorage,
 * cross-tab sync via the browser's `storage` event.
 *
 * Same-tab mutators (addStyle / updateStyle / …) update React state
 * directly; the storage listener only catches cross-tab writes.
 */
export function useStyleLibrary() {
  const [lib, setLib] = useState<StyleLibraryBlob>(() => getStyleLibrarySync());

  useEffect(() => {
    setLib(getStyleLibrarySync());
    const refresh = () => setLib(getStyleLibrarySync());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STYLE_LIBRARY_KEY) return;
      refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(STYLE_LIBRARY_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(STYLE_LIBRARY_EVENT, refresh);
    };
  }, []);

  const persist = useCallback((next: StyleLibraryBlob) => {
    setLib(next);
    setStyleLibrarySync(next);
  }, []);

  const addStyle = useCallback(
    (input: { name: string; preamble: string }): string => {
      const now = new Date().toISOString();
      const id = `style_${generateEntityId().slice(0, 8)}`;
      const entry: StyleEntry = {
        id,
        name: input.name.trim(),
        preamble: input.preamble,
        origin: "user",
        createdAt: now,
        updatedAt: now,
      };
      setLib((prev) => {
        const next: StyleLibraryBlob = {
          ...prev,
          styles: [...prev.styles, entry],
        };
        setStyleLibrarySync(next);
        return next;
      });
      return id;
    },
    [],
  );

  const updateStyle = useCallback(
    (
      id: string,
      patch: Partial<Pick<StyleEntry, "name" | "preamble">>,
    ): void => {
      setLib((prev) => {
        const now = new Date().toISOString();
        const next: StyleLibraryBlob = {
          ...prev,
          styles: prev.styles.map((s) =>
            s.id === id
              ? {
                  ...s,
                  ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
                  ...(patch.preamble !== undefined
                    ? { preamble: patch.preamble }
                    : {}),
                  updatedAt: now,
                }
              : s,
          ),
        };
        setStyleLibrarySync(next);
        return next;
      });
    },
    [],
  );

  const deleteStyle = useCallback((id: string): void => {
    setLib((prev) => {
      if (prev.styles.length <= 1) return prev; // never let the library go empty
      const remaining = prev.styles.filter((s) => s.id !== id);
      const nextDefault =
        prev.defaultStyleId === id ? remaining[0].id : prev.defaultStyleId;
      const next: StyleLibraryBlob = {
        ...prev,
        styles: remaining,
        defaultStyleId: nextDefault,
      };
      setStyleLibrarySync(next);
      return next;
    });
  }, []);

  const setDefaultStyleId = useCallback((id: string): void => {
    setLib((prev) => {
      if (!prev.styles.some((s) => s.id === id)) return prev;
      const next: StyleLibraryBlob = { ...prev, defaultStyleId: id };
      setStyleLibrarySync(next);
      return next;
    });
  }, []);

  const duplicateStyle = useCallback(
    (id: string): string | undefined => {
      const src = lib.styles.find((s) => s.id === id);
      if (!src) return undefined;
      return addStyle({ name: `${src.name} (copy)`, preamble: src.preamble });
    },
    [lib.styles, addStyle],
  );

  // Sorted view — alphabetical by name. Stable for UI lists.
  const sortedStyles = [...lib.styles].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  return {
    library: lib,
    styles: sortedStyles,
    defaultStyleId: lib.defaultStyleId,
    addStyle,
    updateStyle,
    deleteStyle,
    setDefaultStyleId,
    duplicateStyle,
    persist,
  };
}
