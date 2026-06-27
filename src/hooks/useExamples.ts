"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { ExamplesState, ExampleRef } from "@/lib/types";
import { resolveLoadedTitle, resolveTitleAuto } from "@/panels/panel-registry";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";

const EMPTY: ExamplesState = { examples: [] };

/**
 * Examples panel state.
 *
 * Examples live in the `.tex` as `\ex … \xe` / `\pex … \xe` blocks; this
 * sidecar (`examples.json`) stores only panel-side metadata that can't be
 * derived from the editor tree on its own (optional custom title, creation
 * timestamps). `syncFromEditor` reconciles the sidecar against the current
 * editor contents on every parse.
 */
export function useExamples(docId: string | null) {
  const [state, setState] = useState<ExamplesState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;

  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  useEffect(() => {
    let cancelled = false;
    if (!docId) {
      setState(EMPTY);
      return;
    }
    readSidecar<ExamplesState>(docId, "examples.json", EMPTY)
      .then((data) => {
        if (cancelled || !data.examples) return;
        // T6/C12: resolve each example's title from recorded provenance (not
        // shape), self-stamping the `titleAuto` bit so the legacy heuristic is
        // consulted at most once per record.
        let changed = false;
        const examples = data.examples.map((e) => {
          const title = resolveLoadedTitle("example", e.title, e.titleAuto);
          const titleAuto = resolveTitleAuto("example", e.title, e.titleAuto);
          if (title === e.title && titleAuto === e.titleAuto) return e;
          changed = true;
          return { ...e, title, titleAuto };
        });
        const migrated = { examples };
        stateRef.current = migrated;
        setState(migrated);
        // Self-heal write-back: persist the stamped provenance so the heuristic
        // never runs again. Resolve the handle fresh (the pipeline may register
        // after the parent's first render — see usePersistentState).
        if (changed) {
          const h = getActiveHandle(docId);
          if (h) void writeSidecar(h, "examples.json", migrated).catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const persist = useCallback(
    async (s: ExamplesState) => {
      if (!handle) return;
      try {
        await writeSidecar(handle, "examples.json", s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save examples:", err);
      }
    },
    [handle],
  );

  const updateExampleTitle = useCallback(
    (id: string, title: string) => {
      setState((prev) => {
        const next = {
          // T6/C12: user edit → user-owned title forever (clear auto-provenance).
          examples: prev.examples.map((e) =>
            e.id === id ? { ...e, title, titleAuto: false } : e,
          ),
        };
        stateRef.current = next;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const deleteExample = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = { examples: prev.examples.filter((e) => e.id !== id) };
        stateRef.current = next;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  /** Reconcile sidecar metadata against the editor's current example
   *  blocks. Adds entries for brand-new examples, drops the metadata rows
   *  for examples the user deleted in the tex, preserves title + createdAt
   *  for ones that persist across the sync. */
  const syncFromEditor = useCallback(
    (editorExamples: Array<{ id: string; tag: string; label: string }>) => {
      const current = stateRef.current;
      const byId = new Map(current.examples.map((e) => [e.id, e]));
      const next: ExampleRef[] = editorExamples.map((ee) => {
        const existing = byId.get(ee.id);
        if (existing) {
          return {
            ...existing,
            tag: ee.tag,
            label: ee.label,
          };
        }
        return {
          id: ee.id,
          tag: ee.tag,
          label: ee.label,
          // T6/C12 (FORK-1): blank title + machine-default provenance, empty
          // until the user names it (which flips `titleAuto` false).
          title: "",
          titleAuto: true,
          createdAt: new Date().toISOString(),
        };
      });
      // Only write through if the projection actually differs.
      const changed =
        next.length !== current.examples.length ||
        next.some((e, i) => {
          const c = current.examples[i];
          return (
            !c ||
            c.id !== e.id ||
            c.tag !== e.tag ||
            c.label !== e.label ||
            c.title !== e.title
          );
        });
      if (!changed) return;
      const snapshot = { examples: next };
      stateRef.current = snapshot;
      setState(snapshot);
      persist(snapshot);
    },
    [persist],
  );

  return useMemo(
    () => ({
      exampleRefs: state.examples,
      updateExampleTitle,
      deleteExample,
      syncFromEditor,
    }),
    [state.examples, updateExampleTitle, deleteExample, syncFromEditor],
  );
}
