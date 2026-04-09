"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  listDocs,
  createDocFromPicker,
  openExistingDocFromPicker,
  renameDoc as renameDocStorage,
  deleteDocFromIndex,
} from "@/lib/storage-fsa";
import { readTabs, writeTabs, type FsaDocMeta } from "@/lib/doc-index";

/**
 * Manages the workspace tabs and the doc index.
 *
 * Tab state is persisted to IndexedDB so reloads restore the same set
 * of open papers. Loading the actual document content (or prompting
 * for permission) is the responsibility of EditorLayout, not this hook.
 */
export function useFiles() {
  const [docs, setDocs] = useState<FsaDocMeta[]>([]);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);

  // Initial load: read both the doc index and the persisted tab state.
  useEffect(() => {
    (async () => {
      try {
        const [docList, tabs] = await Promise.all([listDocs(), readTabs()]);
        setDocs(docList);
        const validTabs = tabs.openTabIds.filter((id) =>
          docList.some((d) => d.id === id),
        );
        setOpenTabIds(validTabs);
        setCurrentDocId(
          tabs.currentDocId && validTabs.includes(tabs.currentDocId)
            ? tabs.currentDocId
            : (validTabs[0] ?? null),
        );
      } catch (err) {
        console.error("Failed to load files index:", err);
      } finally {
        hydratedRef.current = true;
        setLoading(false);
      }
    })();
  }, []);

  // Persist tab state on every change after initial hydration.
  useEffect(() => {
    if (!hydratedRef.current) return;
    writeTabs({ openTabIds, currentDocId }).catch(() => {});
  }, [openTabIds, currentDocId]);

  const openFile = useCallback((id: string) => {
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setCurrentDocId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setOpenTabIds((prev) => {
        const next = prev.filter((t) => t !== id);
        if (id === currentDocId) {
          const idx = prev.indexOf(id);
          const newActive = next[Math.min(idx, next.length - 1)] || null;
          setCurrentDocId(newActive);
        }
        return next;
      });
    },
    [currentDocId],
  );

  /**
   * Create a new paper. Must be called from a user gesture — the
   * directory picker requires transient activation.
   */
  const createFile = useCallback(async (name: string) => {
    try {
      const meta = await createDocFromPicker(name);
      setDocs((prev) => [...prev, meta]);
      setOpenTabIds((prev) => [...prev, meta.id]);
      setCurrentDocId(meta.id);
      return meta;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      console.error("Failed to create file:", err);
      throw err;
    }
  }, []);

  /**
   * Open an existing paper folder. Must be called from a user gesture.
   */
  const openExistingFile = useCallback(async () => {
    try {
      const meta = await openExistingDocFromPicker();
      setDocs((prev) =>
        prev.some((d) => d.id === meta.id) ? prev : [...prev, meta],
      );
      setOpenTabIds((prev) =>
        prev.includes(meta.id) ? prev : [...prev, meta.id],
      );
      setCurrentDocId(meta.id);
      return meta;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      console.error("Failed to open file:", err);
      throw err;
    }
  }, []);

  /**
   * Forget a paper from the workspace. Does NOT touch the folder on
   * disk — the user's files are theirs.
   */
  const deleteFile = useCallback(async (id: string) => {
    try {
      await deleteDocFromIndex(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setOpenTabIds((prev) => prev.filter((t) => t !== id));
      setCurrentDocId((prev) => (prev === id ? null : prev));
    } catch (err) {
      console.error("Failed to remove file from workspace:", err);
    }
  }, []);

  const renameFile = useCallback(async (id: string, name: string) => {
    try {
      await renameDocStorage(id, name);
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    } catch (err) {
      console.error("Failed to rename file:", err);
    }
  }, []);

  const currentDoc = docs.find((d) => d.id === currentDocId) || null;
  const openTabs = openTabIds
    .map((id) => docs.find((d) => d.id === id))
    .filter(Boolean) as FsaDocMeta[];

  return {
    docs,
    openTabs,
    currentDocId,
    currentDoc,
    loading,
    createFile,
    openExistingFile,
    deleteFile,
    renameFile,
    openFile,
    closeTab,
  };
}
