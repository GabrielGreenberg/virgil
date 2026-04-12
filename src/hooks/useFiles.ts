"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  listDocs,
  createDocFromPicker,
  pickProjectFolder,
  registerDocInFolder,
  renameDoc as renameDocStorage,
  deleteDocFromIndex,
  type FolderPickResult,
} from "@/lib/storage";
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
  const [pendingFolderPick, setPendingFolderPick] = useState<FolderPickResult | null>(null);
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

  /** Helper: register a doc and activate its tab. */
  const activateDoc = useCallback((meta: FsaDocMeta) => {
    setDocs((prev) =>
      prev.some((d) => d.id === meta.id) ? prev : [...prev, meta],
    );
    setOpenTabIds((prev) =>
      prev.includes(meta.id) ? prev : [...prev, meta.id],
    );
    setCurrentDocId(meta.id);
  }, []);

  /**
   * Open an existing paper folder. Must be called from a user gesture.
   * When the folder has multiple .tex files, sets `pendingFolderPick`
   * so the UI can show a file picker modal.
   */
  const openExistingFile = useCallback(async () => {
    try {
      const result = await pickProjectFolder();
      if (result.texFiles.length === 1) {
        const meta = await registerDocInFolder(result.handle, result.texFiles[0]);
        activateDoc(meta);
        return meta;
      }
      // Multiple .tex files — let the user choose via modal
      setPendingFolderPick(result);
      return null;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      console.error("Failed to open file:", err);
      throw err;
    }
  }, [activateDoc]);

  /** Complete a pending folder pick by choosing a specific .tex file. */
  const selectFileInFolder = useCallback(async (texFilename: string) => {
    if (!pendingFolderPick) return null;
    try {
      const meta = await registerDocInFolder(pendingFolderPick.handle, texFilename);
      activateDoc(meta);
      setPendingFolderPick(null);
      return meta;
    } catch (err) {
      console.error("Failed to open file in folder:", err);
      throw err;
    }
  }, [pendingFolderPick, activateDoc]);

  /** Cancel a pending folder pick. */
  const cancelFolderPick = useCallback(() => {
    setPendingFolderPick(null);
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
    pendingFolderPick,
    selectFileInFolder,
    cancelFolderPick,
  };
}
