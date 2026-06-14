"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import {
  readSidecarIfExists,
  writeSidecar,
} from "@/lib/storage";
import {
  getActiveHandle,
  isStalePipelineError,
} from "@/lib/multi-window/doc-pipeline";
import { isAnchorableNode } from "@/lib/marginalia";
import {
  getSectionFoldingState,
  transactionTouchesFold,
} from "@/lib/section-folding";
import type { EditorStateData } from "@/lib/types";

const DEFAULT: EditorStateData = {
  lastParagraphId: null,
  foldedSections: [],
  lastModified: "",
};

const CURSOR_DEBOUNCE_MS = 400;

/**
 * Normalize whatever's on disk into the current schema. Older sidecars
 * written by the pre-rewrite stub have shape `{cursorPosition, selection,
 * lastModified}` — those legacy fields are dropped and the new fields
 * default. Anything unrecognized also falls back to defaults.
 */
function migrate(raw: unknown): EditorStateData {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT };
  const r = raw as Partial<EditorStateData>;
  return {
    lastParagraphId:
      typeof r.lastParagraphId === "string" ? r.lastParagraphId : null,
    foldedSections: Array.isArray(r.foldedSections)
      ? r.foldedSections.filter((u): u is string => typeof u === "string")
      : [],
    lastModified: typeof r.lastModified === "string" ? r.lastModified : "",
  };
}

/** Walk up from the selection to the nearest ancestor with a UUID attr. */
function paragraphUuidAtSelection(editor: Editor): string | null {
  const $from = editor.state.selection.$from;
  for (let depth = $from.depth; depth >= 0; depth--) {
    const node = $from.node(depth);
    if (isAnchorableNode(node.type) && node.attrs?.uuid) {
      return node.attrs.uuid as string;
    }
  }
  return null;
}

export interface UseEditorUIStateApi {
  /** Latest known state. */
  state: EditorStateData;
  /** Synchronous mirror of `state`, for the restore effect to peek without re-rendering. */
  stateRef: React.MutableRefObject<EditorStateData>;
  /** True after the sidecar has been read (or determined absent) for this docId.
   *  The restore effect must wait for this — otherwise it would read the
   *  pre-load default and skip restoration. */
  loaded: boolean;
}

/**
 * Per-document editor UI state — the paragraph the cursor was last in
 * and which sections are folded — persisted to `editor-state.json`.
 *
 * Cursor moves write debounced (400 ms — high frequency, low value if
 * lost). Fold changes write immediately (low frequency, high value).
 * The capture listener is gated on `loaded` so it can't clobber the
 * sidecar before the initial read lands.
 */
export function useEditorUIState(
  docId: string | null,
  editor: Editor | null,
): UseEditorUIStateApi {
  const [state, setState] = useState<EditorStateData>(DEFAULT);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [loaded, setLoaded] = useState(false);
  const loadedRef = useRef(false);
  loadedRef.current = loaded;

  const handle = useMemo(
    () => (docId ? getActiveHandle(docId) : null),
    [docId],
  );

  // Initial read. Each docId change resets the load flag and re-reads.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    if (!docId) {
      setState({ ...DEFAULT });
      setLoaded(true);
      return;
    }
    readSidecarIfExists<unknown>(docId, "editor-state.json")
      .then((raw) => {
        if (cancelled) return;
        const migrated = raw === null ? { ...DEFAULT } : migrate(raw);
        setState(migrated);
        setLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const persist = useCallback(
    async (s: EditorStateData) => {
      if (!handle) return;
      try {
        await writeSidecar(handle, "editor-state.json", s);
      } catch (err) {
        if (isStalePipelineError(err)) return;
        console.error("Failed to save editor-state:", err);
      }
    },
    [handle],
  );

  const writeCursor = useCallback(
    (uuid: string | null) => {
      if (!loadedRef.current) return;
      if (stateRef.current.lastParagraphId === uuid) return;
      const next: EditorStateData = {
        ...stateRef.current,
        lastParagraphId: uuid,
        lastModified: new Date().toISOString(),
      };
      setState(next);
      void persist(next);
    },
    [persist],
  );

  const writeFolds = useCallback(
    (uuids: string[]) => {
      if (!loadedRef.current) return;
      const prev = stateRef.current.foldedSections;
      if (
        prev.length === uuids.length &&
        prev.every((u, i) => u === uuids[i])
      ) {
        return;
      }
      const next: EditorStateData = {
        ...stateRef.current,
        foldedSections: uuids,
        lastModified: new Date().toISOString(),
      };
      setState(next);
      void persist(next);
    },
    [persist],
  );

  useEffect(() => {
    if (!editor) return;
    let cursorTimer: ReturnType<typeof setTimeout> | null = null;

    const onSelection = () => {
      if (cursorTimer) clearTimeout(cursorTimer);
      cursorTimer = setTimeout(() => {
        if (editor.isDestroyed) return;
        writeCursor(paragraphUuidAtSelection(editor));
      }, CURSOR_DEBOUNCE_MS);
    };

    const onTransaction = (props: { transaction: Transaction }) => {
      if (editor.isDestroyed) return;
      // Folds can change via an explicit toggle/setFolded meta OR via
      // implicit pruning when a folded heading is deleted (apply reducer
      // drops dead UUIDs on docChanged). Reading on every transaction would
      // be overkill; gate on either signal. `transactionTouchesFold` now gates
      // ONLY this fold persister — the fold-chevron resync moved to the shared
      // sectionFoldingPlugin `view()` (#29 nit-3) with its own O(1) reference
      // bail, so it no longer rides this predicate.
      if (!transactionTouchesFold(props.transaction)) return;
      const folded = [...getSectionFoldingState(editor.state).folded];
      writeFolds(folded);
    };

    editor.on("selectionUpdate", onSelection);
    editor.on("transaction", onTransaction);
    return () => {
      if (cursorTimer) clearTimeout(cursorTimer);
      editor.off("selectionUpdate", onSelection);
      editor.off("transaction", onTransaction);
    };
  }, [editor, writeCursor, writeFolds]);

  return { state, stateRef, loaded };
}
