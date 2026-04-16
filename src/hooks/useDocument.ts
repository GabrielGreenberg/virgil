"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { JSONContent } from "@tiptap/react";
import { readDocBundle, writeDocBundle } from "@/lib/storage";

type SaveStatus = "idle" | "saving" | "saved";

const DEFAULT_EDITOR_STATE = { cursorPosition: 0, selection: null, lastModified: "" };

export function useDocument(docId: string | null) {
  const [content, setContent] = useState<JSONContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef<JSONContent | null>(null);
  const currentDocIdRef = useRef(docId);

  // Reset when docId changes
  useEffect(() => {
    currentDocIdRef.current = docId;
    if (!docId) {
      setContent(null);
      setLoading(false);
      setSaveStatus("idle");
      return;
    }

    setLoading(true);
    setSaveStatus("idle");
    readDocBundle(docId)
      .then((bundle) => {
        if (currentDocIdRef.current === docId) {
          setContent(bundle.content);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load document:", err);
        if (currentDocIdRef.current === docId) {
          setLoading(false);
        }
      });
  }, [docId]);

  const save = useCallback(async (doc: JSONContent) => {
    const id = currentDocIdRef.current;
    if (!id) return;
    setSaveStatus("saving");
    try {
      await writeDocBundle(id, doc, DEFAULT_EDITOR_STATE);
      if (currentDocIdRef.current === id) {
        setSaveStatus("saved");
        setTimeout(() => {
          setSaveStatus((prev) => (prev === "saved" ? "idle" : prev));
        }, 2000);
      }
    } catch (err) {
      console.error("Failed to save document:", err);
      setSaveStatus("idle");
    }
  }, []);

  const debouncedSave = useCallback(
    (doc: JSONContent) => {
      latestContentRef.current = doc;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        if (latestContentRef.current) {
          save(latestContentRef.current);
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
    const id = currentDocIdRef.current;
    if (!id) return;
    setLoading(true);
    readDocBundle(id)
      .then((bundle) => {
        if (currentDocIdRef.current === id) {
          setContent(bundle.content);
          setLoading(false);
        }
      })
      .catch(() => {
        if (currentDocIdRef.current === id) setLoading(false);
      });
  }, []);

  return { content, loading, onUpdate, saveNow: save, saveStatus, refetch };
}
