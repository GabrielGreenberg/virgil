"use client";

/**
 * React surface for the DocProducts pipeline (perf plan Wave 1 / P2).
 *
 * `useDocProductsHost` — mounted ONCE per doc in EditorPane; owns the
 * pipeline instance's lifecycle and returns the live snapshot.
 *
 * `useDocJson(editor)` — subscribe to the shared docJson from anywhere that
 * has the editor instance (EditorLayout's latestDoc replacement).
 *
 * Flag: `docProductsEnabled` — localStorage `virgil:doc-products`, default
 * ON with `"off"` as the kill-switch (the print-gate pattern; flipped from
 * default-OFF at the end of Wave 1 with the legacy hooks kept intact as
 * the soak safety net — their deletion is the post-soak S6 follow-up).
 * Read once at module load: toggling requires a reload, which is exactly
 * the A/B discipline the rollout wants.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import type { BibFamily } from "@/lib/bib-family";
import {
  createDocProducts,
  getDocProducts,
  type DocProducts,
  type ProductsSnapshot,
} from "./pipeline";
// Side-effect: installs window.__docProductsStats.
import "./probe";

export const docProductsEnabled: boolean = (() => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("virgil:doc-products") !== "off";
  } catch {
    return true;
  }
})();

const EMPTY_SNAPSHOT: ProductsSnapshot = {
  generation: 0,
  docJson: null,
  sourceText: null,
  wordCounts: null,
};

export interface UseDocProductsHostOptions {
  editor: Editor | null;
  docId: string;
  /** True while the code view owns the sourceText feed. */
  codeViewActive: boolean;
  /** Serialize input — a VALUE, not a getter, because the pipeline's idle
   *  tier has to be re-armed when it changes and a package switch fires no
   *  editor transaction (task 592). Declared here, watched by the one effect
   *  below, read through a ref at serialize time. */
  bibFamily: BibFamily | null;
  /** Keep-alive visibility — hidden panes stay stale but schedule nothing;
   *  the false→true edge re-arms them through the same door. */
  isVisible: boolean;
  /** Master gate — when false (flag off / legacy path) no pipeline mounts. */
  enabled: boolean;
}

export interface UseDocProductsHost {
  snapshot: ProductsSnapshot;
  /** Code-view feed passthrough (null when no pipeline is mounted). */
  setExternalSourceFeed: ((text: string) => void) | null;
  ensureFresh: (() => ProductsSnapshot) | null;
}

export function useDocProductsHost({
  editor,
  docId,
  codeViewActive,
  bibFamily,
  isVisible,
  enabled,
}: UseDocProductsHostOptions): UseDocProductsHost {
  const productsRef = useRef<DocProducts | null>(null);

  // Live-read refs so config getters never force a pipeline re-create.
  const codeViewActiveRef = useRef(codeViewActive);
  codeViewActiveRef.current = codeViewActive;
  const bibFamilyRef = useRef(bibFamily);
  bibFamilyRef.current = bibFamily;
  const isVisibleRef = useRef(isVisible);
  isVisibleRef.current = isVisible;

  useEffect(() => {
    if (!enabled || !editor) return;
    const products = createDocProducts(editor, {
      docId,
      getBibFamily: () => bibFamilyRef.current,
      isSuppressed: () => codeViewActiveRef.current,
      isVisible: () => isVisibleRef.current,
    });
    productsRef.current = products;
    return () => {
      productsRef.current = null;
      products.destroy();
    };
  }, [enabled, editor, docId]);

  // THE INPUT-CHANGE DOOR (task 592). Every tier input that can move without
  // an editor transaction is a dependency here: the bib family (a user control
  // that fires no edit yet can inject a \usepackage line and shift every body
  // line), the keep-alive visibility edge (a pane edited while hidden had
  // nothing watching for it to come back), and the code view handing the
  // sourceText feed back. The pipeline decides what that made stale.
  useEffect(() => {
    productsRef.current?.revalidate();
  }, [bibFamily, isVisible, codeViewActive, enabled, editor, docId]);

  const snapshot = useSyncExternalStore(
    (fn) => productsRef.current?.subscribe(fn) ?? (() => {}),
    () => productsRef.current?.snapshot() ?? EMPTY_SNAPSHOT,
    () => EMPTY_SNAPSHOT,
  );

  return {
    snapshot,
    setExternalSourceFeed: productsRef.current
      ? (text) => productsRef.current?.setExternalSourceFeed(text)
      : null,
    ensureFresh: productsRef.current
      ? () => productsRef.current!.ensureFresh()
      : null,
  };
}

const NOOP_UNSUB = () => {};

/** Subscribe to the shared docJson product for `editor` (null when no
 *  pipeline is mounted — callers fall back to their legacy source). */
export function useDocJson(editor: Editor | null) {
  return useSyncExternalStore(
    (fn) => getDocProducts(editor)?.subscribe(fn) ?? NOOP_UNSUB,
    () => getDocProducts(editor)?.snapshot().docJson ?? null,
    () => null,
  );
}

/** Subscribe to the shared word counts for `editor` (null → no pipeline). */
export function useWordCountsProduct(editor: Editor | null) {
  return useSyncExternalStore(
    (fn) => getDocProducts(editor)?.subscribe(fn) ?? NOOP_UNSUB,
    () => getDocProducts(editor)?.snapshot().wordCounts ?? null,
    () => null,
  );
}
