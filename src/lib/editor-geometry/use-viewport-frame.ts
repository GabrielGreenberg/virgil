"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { Editor } from "@tiptap/react";
import { getOrCreateGeometry } from "./registry";
import type { EditorGeometryService } from "./service";
import {
  EMPTY_VIEWPORT_FRAME,
  type EditorViewportFrame,
} from "./viewport-frame";

/**
 * React adapter for the EditorGeometry service's viewport frame — the
 * drop-in successor of `useEditorViewportCache` (perf Wave 2 C7), keeping
 * its exact consumer contract:
 *
 *   - `frameRef` has a STABLE identity for the component's whole lifetime
 *     (consumers key long-lived subscription effects on it), and
 *     `frameRef.current` always reads the service's LIVE frame — including
 *     from imperative handlers (mousemove, RAF passes) between renders.
 *   - `version` bumps only when a committed refresh actually CHANGED the
 *     frame (equality-bailed), so effects keyed on it re-run once per real
 *     layout change — never per RO burst frame.
 *
 * What changed underneath: the four placement consumers used to instantiate
 * the hook independently — 4 ResizeObservers × 2 observed elements + 4
 * window-resize listeners per pane, each measuring identical geometry. They
 * now share the service's ONE engine (retained here for this consumer's
 * lifetime, refcounted alongside the marginalia adapter).
 *
 * Before the engine's first refresh (or with no editor) `frameRef.current`
 * is the EMPTY frame — `editorEl: null`, zero rects — exactly the hook's
 * initial EMPTY_CACHE, which every consumer already bails on.
 */
export function useViewportFrame(editor: Editor | null): {
  frameRef: { readonly current: EditorViewportFrame };
  version: number;
} {
  // The service ref feeds the stable `frameRef` getter. Populated in the
  // retain effect (not during render — `getOrCreateGeometry` is render-safe,
  // but the ref write isn't), so the first render reads EMPTY, matching the
  // old hook's pre-effect window.
  const serviceRef = useRef<EditorGeometryService | null>(null);

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      serviceRef.current = null;
      return;
    }
    const service = getOrCreateGeometry(editor);
    serviceRef.current = service;
    const release = service.retain();
    return () => {
      release();
      if (serviceRef.current === service) serviceRef.current = null;
    };
  }, [editor]);

  // Version subscription: the service's viewport channel. The subscribe
  // closure re-resolves per `editor` so a swapped editor re-subscribes; the
  // getter tolerates the pre-retain window (0 = "no committed frame yet").
  const version = useSyncExternalStore(
    useMemo(() => {
      if (!editor || editor.isDestroyed) return () => () => {};
      const service = getOrCreateGeometry(editor);
      return (cb: () => void) => service.subscribeViewport(cb);
    }, [editor]),
    () => serviceRef.current?.viewportVersion() ?? 0,
    () => 0,
  );

  const frameRef = useMemo(
    () => ({
      get current(): EditorViewportFrame {
        return serviceRef.current?.getViewportFrame() ?? EMPTY_VIEWPORT_FRAME;
      },
    }),
    [],
  );

  return { frameRef, version };
}
