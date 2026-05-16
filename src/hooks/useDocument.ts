"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { JSONContent } from "@tiptap/react";
import { readDocBundle, writeDocBundle } from "@/lib/storage";
import { isStalePipelineError } from "@/lib/multi-window/doc-pipeline";
import { useDocWriteHandle } from "@/components/editor-layout/DocPipeline";
import {
  registerPendingFlusher,
  unregisterPendingFlusher,
} from "@/lib/multi-window/pending-saves";

type SaveStatus = "idle" | "saving" | "saved";

const DEFAULT_EDITOR_STATE = { cursorPosition: 0, selection: null, lastModified: "" };

/**
 * Document load + autosave for the active doc.
 *
 * Architecturally requires a `<DocPipeline key={docId} docId={docId}>`
 * ancestor: the handle (and therefore the docId) is read from context
 * via `useDocWriteHandle()`. That ancestor's `key={docId}` forces the
 * subtree to fully remount on every doc switch — TipTap, save closures,
 * pending-edit refs, all of it. Stale content from the previous doc
 * cannot survive into the next one.
 *
 * If a future caller mounts this hook outside a DocPipeline, the
 * `useDocWriteHandle()` call throws synchronously with a directive to
 * add the wrap. That throw IS the architectural wall.
 *
 * Pending edits sit in a 1500 ms React-local debounce. We expose that
 * debounce via the per-doc pending-saves registry so external callers
 * (the doc-switch barrier in useFiles, the pagehide handler below) can
 * fire it before the pipeline ends. Without that, an edit made in the
 * debounce window before refresh/switch would be silently dropped — the
 * storage-layer `flushDoc` only drains writes that already entered the
 * queue, not the un-fired React debounce.
 */
export function useDocument() {
  const handle = useDocWriteHandle();
  const docId = handle.docId;
  const [content, setContent] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef<JSONContent | null>(null);
  const lastSavedRef = useRef<JSONContent | null>(null);

  const save = useCallback(
    async (doc: JSONContent) => {
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
          if (err.reason === "superseded") {
            // A newer pipeline took over for the same docId before our
            // write landed. Expected when reopening the same doc rapidly;
            // the newer pipeline has loaded fresh content and our stale
            // write would have corrupted it. Log so the case is visible.
            console.warn(
              `[useDocument] Stale save dropped — pipeline ${handle.pipelineId.slice(0, 8)} for "${handle.docId}" was superseded by ${err.currentPipelineId?.slice(0, 8) ?? "?"} before write landed`,
            );
          } else {
            // No replacement pipeline — registry has simply forgotten
            // about us. With the globalThis-stable registry this should
            // not occur in normal editing; if it does, the unmount-flush
            // ordering has regressed and edits are being silently lost.
            console.error(
              `[useDocument] Save dropped — pipeline ${handle.pipelineId.slice(0, 8)} for "${handle.docId}" had already ended with no replacement. This is unexpected and indicates a regression in the pipeline lifecycle.`,
            );
          }
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

  // Load the doc on mount. The `<DocPipeline key={docId}>` ancestor
  // forces a full remount when the docId changes, so this effect runs
  // exactly once per (docId, mount) — no doc-switch race to handle here.
  // The `cancelled` flag is still load-bearing for StrictMode's
  // double-invoke and for unmount-during-load.
  useEffect(() => {
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
    registerPendingFlusher(docId, flushPending);
    return () => unregisterPendingFlusher(docId, flushPending);
  }, [docId, flushPending]);

  // Flush pending edits on unmount. With the DocPipeline `key={docId}`
  // boundary, unmount IS the doc-switch event — the cleanup closes over
  // this mount's save closure (and its handle), so any pending edit
  // lands in the correct doc's files. Storage's queued task uses the
  // lenient `assertNotSuperseded` check, so a write that races the
  // pipeline-end cleanup is allowed through if no newer pipeline took
  // over.
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
  }, [save]);

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
