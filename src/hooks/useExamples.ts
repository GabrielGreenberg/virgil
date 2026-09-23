"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { readSidecar } from "@/lib/storage";
import { writeSidecarMerged } from "@/lib/sidecar-merged-write";
import type { ExamplesState } from "@/lib/types";
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
 * timestamps).
 *
 * There is deliberately NO `syncFromEditor` here (task 570). The examples
 * panel derives its rows from the live editor (the DocStructureBus-gated
 * memos in `EditorPane`), and the editor-derived reconcile this hook used to
 * export had no caller since the keystroke-sanctity work of 2026-05 — a dead
 * load-time reconcile with no `loaded` gate is exactly the shape that, once
 * wired into a mount effect, runs over the pre-load default and writes the
 * loss (the citations defect). A reconcile that writes a sidecar from
 * editor-derived inputs belongs on `usePersistentState.updateWhenLoaded`.
 */
export function useExamples(docId: string | null) {
  const [state, setState] = useState<ExamplesState>(EMPTY);
  const stateRef = useRef(state);
  stateRef.current = state;
  // THE MERGE BASE (task 719) — what this hook last knew the file to hold (its
  // load, or its own last submitted payload). The third input the write needs
  // to stop being a rebuild: without it "absent from local" cannot be told
  // apart from "the user deleted it". Null until the read resolves, and null
  // forever on a read that threw, which degrades the merge to a union rather
  // than letting it guess at a deletion.
  const baselineRef = useRef<ExamplesState | null>(null);

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
        baselineRef.current = migrated;
        setState(migrated);
        // Self-heal write-back: persist the stamped provenance so the heuristic
        // never runs again. Resolve the handle fresh (the pipeline may register
        // after the parent's first render — see usePersistentState).
        if (changed) {
          const h = getActiveHandle(docId);
          // Base `null` deliberately (task 719): this write-back's whole job
          // is to make the NORMALIZED records durable, so they must win every
          // collision — a base equal to them would read each one as untouched
          // and adopt disk's unstamped version back, writing nothing. With no
          // base the merge degrades to a union with local winning, which is
          // exactly the rule a migration write-back wants: my records, plus
          // anything else disk holds.
          if (h) {
            void writeSidecarMerged(h, "examples.json", null, migrated).catch(
              () => {},
            );
          }
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
      // The ONE merged write door (task 719) — see `sidecar-merge.ts`.
      const base = baselineRef.current;
      try {
        await writeSidecarMerged(handle, "examples.json", base, s);
        baselineRef.current = s;
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

  return useMemo(
    () => ({
      exampleRefs: state.examples,
      updateExampleTitle,
      deleteExample,
    }),
    [state.examples, updateExampleTitle, deleteExample],
  );
}
