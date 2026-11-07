"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { getOrCreateGeometry } from "@/lib/editor-geometry";
import { marginLabelsFit } from "@/lib/marginalia";

/** Where block labels sit: a column in the left margin, or a pill on hover. */
export type MarginLabelMode = "side" | "hover";

/**
 * The prose pod's block-label mode, stamped as `data-margin-labels`. Reads the
 * geometry service's viewport channel with a primitive snapshot, like
 * `Marginalia`'s `useLaneCols`: no new observer, and React bails every refresh
 * that leaves the answer unchanged, which is every refresh a keystroke causes.
 *
 * `leftLaneFree` is false when left-side markers may occupy the margin (the
 * cards-right layout switched off).
 */
export function useMarginLabelMode(editor: Editor | null, leftLaneFree: boolean): MarginLabelMode {
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    return getOrCreateGeometry(editor).retain();
  }, [editor]);

  const subscribe = useCallback(
    (cb: () => void) => {
      if (!editor || editor.isDestroyed) return () => {};
      return getOrCreateGeometry(editor).subscribeViewport(cb);
    },
    [editor],
  );

  const getSnapshot = useCallback(() => {
    if (!editor || editor.isDestroyed) return true;
    const frame = getOrCreateGeometry(editor).getViewportFrame();
    if (!frame || !frame.editorEl) return true;
    return marginLabelsFit(frame.contentLeft - frame.podLeft);
  }, [editor]);

  const fits = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return fits && leftLaneFree ? "side" : "hover";
}
