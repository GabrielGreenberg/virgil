"use client";

import { useState, useCallback, useEffect } from "react";
import type { DocMeta, FileIndex } from "@/lib/types";

export function useFiles() {
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [currentDocId, setCurrentDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/files");
      const data: FileIndex = await res.json();
      setDocs(data.docs || []);
      return data.docs || [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    refresh().then((docList) => {
      if (docList.length > 0) {
        const sorted = [...docList].sort(
          (a, b) => new Date(b.lastModifiedAt).getTime() - new Date(a.lastModifiedAt).getTime()
        );
        const firstId = sorted[0].id;
        setOpenTabIds([firstId]);
        setCurrentDocId(firstId);
      }
      setLoading(false);
    });
  }, [refresh]);

  const openFile = useCallback((id: string) => {
    setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setCurrentDocId(id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setOpenTabIds((prev) => {
      const next = prev.filter((t) => t !== id);
      // If closing active tab, switch to neighbor
      if (id === currentDocId) {
        const idx = prev.indexOf(id);
        const newActive = next[Math.min(idx, next.length - 1)] || null;
        setCurrentDocId(newActive);
      }
      return next;
    });
  }, [currentDocId]);

  const createFile = useCallback(async (name?: string) => {
    try {
      const res = await fetch("/api/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || "Untitled" }),
      });
      const meta: DocMeta = await res.json();
      setDocs((prev) => [...prev, meta]);
      setOpenTabIds((prev) => [...prev, meta.id]);
      setCurrentDocId(meta.id);
      return meta;
    } catch (err) {
      console.error("Failed to create file:", err);
      return null;
    }
  }, []);

  const deleteFile = useCallback(async (id: string) => {
    try {
      await fetch(`/api/files/${id}`, { method: "DELETE" });
      setDocs((prev) => prev.filter((d) => d.id !== id));
      setOpenTabIds((prev) => prev.filter((t) => t !== id));
      setCurrentDocId((prev) => (prev === id ? null : prev));
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  }, []);

  const renameFile = useCallback(async (id: string, name: string) => {
    try {
      await fetch(`/api/files/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, name } : d)));
    } catch (err) {
      console.error("Failed to rename file:", err);
    }
  }, []);

  const importFile = useCallback(async (name: string, texContent: string, sourcePath?: string) => {
    try {
      const res = await fetch("/api/files/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, texContent, sourcePath }),
      });
      const meta: DocMeta = await res.json();
      setDocs((prev) => [...prev, meta]);
      setOpenTabIds((prev) => [...prev, meta.id]);
      setCurrentDocId(meta.id);
      return meta;
    } catch (err) {
      console.error("Failed to import file:", err);
      return null;
    }
  }, []);

  const openByPath = useCallback(async (filePath: string) => {
    try {
      const res = await fetch("/api/files/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to open file");
      }
      const meta: DocMeta = await res.json();
      // Add to docs if not already there
      setDocs((prev) => prev.some((d) => d.id === meta.id) ? prev : [...prev, meta]);
      setOpenTabIds((prev) => prev.includes(meta.id) ? prev : [...prev, meta.id]);
      setCurrentDocId(meta.id);
      return meta;
    } catch (err) {
      console.error("Failed to open file by path:", err);
      throw err;
    }
  }, []);

  const currentDoc = docs.find((d) => d.id === currentDocId) || null;
  const openTabs = openTabIds.map((id) => docs.find((d) => d.id === id)).filter(Boolean) as DocMeta[];

  return {
    docs,
    openTabs,
    currentDocId,
    currentDoc,
    loading,
    createFile,
    deleteFile,
    renameFile,
    openFile,
    closeTab,
    importFile,
    openByPath,
  };
}
