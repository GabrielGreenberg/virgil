"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { readSidecar, writeSidecar } from "@/lib/storage";
import type { ExamplesState, ExampleRef } from "@/lib/types";
import { isAutoTitle } from "@/panels/panel-registry";
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
        // BUG #31: strip legacy auto-generated "Example N" titles on load.
        setState({
          examples: data.examples.map((e) =>
            isAutoTitle("example", e.title) ? { ...e, title: "" } : e,
          ),
        });
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
          examples: prev.examples.map((e) =>
            e.id === id ? { ...e, title } : e,
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
          // BUG #31: never persist a generated title ("Example 2"); empty
          // until the user names it.
          title: "",
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

  return {
    exampleRefs: state.examples,
    updateExampleTitle,
    deleteExample,
    syncFromEditor,
  };
}
