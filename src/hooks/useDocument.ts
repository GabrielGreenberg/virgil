"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { JSONContent } from "@tiptap/react";
import { readDocBundle, writeDocBundle } from "@/lib/storage";
import {
  beginDocPipeline,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import {
  registerPendingFlusher,
  unregisterPendingFlusher,
} from "@/lib/multi-window/pending-saves";

type SaveStatus = "idle" | "saving" | "saved";

const DEFAULT_EDITOR_STATE = { cursorPosition: 0, selection: null, lastModified: "" };

/**
 * Document load + autosave for the active doc.
 *
 * The write handle is pinned to the docId's active pipeline. When the
 * user switches docs, the pipeline ends; any in-flight or debounced
 * write that fires after that point is rejected by the storage layer
 * with StalePipelineError and silently dropped.
 *
 * Pending edits sit in a 1500 ms React-local debounce. We expose that
 * debounce via the per-doc pending-saves registry so external callers
 * (the doc-switch barrier in useFiles, the pagehide handler below) can
 * fire it before the pipeline ends. Without that, an edit made in the
 * debounce window before refresh/switch would be silently dropped — the
 * storage-layer `flushDoc` only drains writes that already entered the
 * queue, not the un-fired React debounce.
 */
export function useDocument(docId: string | null) {
  const [content, setContent] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef<JSONContent | null>(null);
  const lastSavedRef = useRef<JSONContent | null>(null);

  // Pin the write handle to the docId's CURRENT pipeline. We call
  // `beginDocPipeline` directly during render (idempotent: returns the
  // existing pipelineId if one is active, otherwise creates one) — so
  // the handle is non-null from the very first render, before any
  // `useEffect` has had a chance to start the pipeline. Reading via
  // `getActiveHandle` here was racy: useMemo runs synchronously during
  // render, but the canonical pipeline-start effect in EditorLayout
  // runs *after* commit, so the first render's handle was always null
  // and saves silently no-op'd until a doc switch eventually happened.
  const handle = useMemo(
    () => (docId ? beginDocPipeline(docId) : null),
    [docId],
  );

  const save = useCallback(
    async (doc: JSONContent) => {
      if (!handle) return;
      setSaveStatus("saving");
      try {
        await writeDocBundle(handle, doc, DEFAULT_EDITOR_STATE);
        lastSavedRef.current = doc;
        setSaveStatus("saved");
        setTimeout(() => {
          setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
        }, 2000);
      } catch (err) {
        if (isStalePipelineError(err)) {
          // A newer pipeline took over for the same docId before our
          // write landed. Expected when reopening the same doc rapidly;
          // the newer pipeline will load fresh content and our stale
          // write would have corrupted it. Log so the case is visible.
          console.warn("Stale save dropped — pipeline superseded before write", {
            docId: handle.docId,
          });
          return;
        }
        console.error("Failed to save document:", err);
        setSaveStatus("idle");
      }
    },
    [handle],
  );

  // External flush hook: cancel the pending debounce, fire the latest
  // content immediately, return the write promise. No-op if nothing is
  // pending. Used by the unmount cleanup, pagehide listener, and the
  // doc-switch barrier in useFiles. Must close over the CURRENT save
  // (and thus current handle) so the registered flusher always writes
  // to the doc that registered it.
  const flushPending = useCallback(async (): Promise<void> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = latestContentRef.current;
    if (!pending) return;
    latestContentRef.current = null;
    await save(pending);
  }, [save]);

  // Reset and load when docId changes. The previous doc's pending edit
  // is flushed by two cooperating mechanisms outside this effect:
  //   1. `useFiles.flushOutgoing` awaits `flushPendingForDoc(prevId)`
  //      before changing the docId state — covers user-driven switches.
  //   2. The unmount-flush effect below fires the OLD `save` closure
  //      (with the OLD handle) when its `[save]` dep changes — covers
  //      programmatic switches that bypass `flushOutgoing`.
  // Don't fire a save here: by the time this effect runs, `handle` has
  // already been recomputed for the new docId, so writing the prior
  // doc's content would land in the wrong file.
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    latestContentRef.current = null;
    lastSavedRef.current = null;
    if (!docId) {
      setContent(null);
      setLoading(false);
      setSaveStatus("idle");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSaveStatus("idle");
    readDocBundle(docId)
      .then((bundle) => {
        if (cancelled) return;
        setContent(bundle.content);
        lastSavedRef.current = bundle.content;
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load document:", err);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  // Register the flusher so external callers (doc-switch barrier,
  // pagehide) can fire the pending debounce before the pipeline ends.
  useEffect(() => {
    if (!docId) return;
    registerPendingFlusher(docId, flushPending);
    return () => unregisterPendingFlusher(docId, flushPending);
  }, [docId, flushPending]);

  // Flush pending edits whenever `save` changes (i.e. on docId/handle
  // change) or on unmount. Cleanup closes over the OLD `save` — and
  // thus the OLD handle — so a pending edit for the previous doc lands
  // in the correct files. Storage's queued task uses the lenient
  // `assertNotSuperseded` check, so a write that races the pipeline-end
  // cleanup is allowed through if no newer pipeline took over.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = latestContentRef.current;
      latestContentRef.current = null;
      if (pending) void save(pending);
    };
  }, [save]);

  // Refresh / tab-close flush. `pagehide` is the modern, mobile-safe
  // counterpart to `beforeunload` for actually doing work; we use
  // `beforeunload` only to prompt the user when there are unsaved
  // edits, buying the in-flight write time to land.
  useEffect(() => {
    if (!docId) return;
    const onPageHide = () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const pending = latestContentRef.current;
      if (pending) {
        latestContentRef.current = null;
        void save(pending);
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const pending = latestContentRef.current;
      const dirty = pending && pending !== lastSavedRef.current;
      if (dirty) {
        // Kick off the save now so it has a chance to land while the
        // browser shows the prompt.
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        latestContentRef.current = null;
        void save(pending);
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [docId, save]);

  const debouncedSave = useCallback(
    (doc: JSONContent) => {
      latestContentRef.current = doc;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const pending = latestContentRef.current;
        if (pending) {
          latestContentRef.current = null;
          save(pending);
        }
      }, 1500);
    },
    [save],
  );

  const onUpdate = useCallback(
    (doc: JSONContent) => {
      setContent(doc);
      debouncedSave(doc);
    },
    [debouncedSave],
  );

  const refetch = useCallback(() => {
    if (!docId) return;
    setLoading(true);
    readDocBundle(docId)
      .then((bundle) => {
        setContent(bundle.content);
        lastSavedRef.current = bundle.content;
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [docId]);

  return { content, loading, onUpdate, saveNow: save, saveStatus, refetch };
}
