"use client";

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { findEditorScrollFor } from "@/components/editor-layout/layout-scroll";

/**
 * Attach `handler` to `editor.view.dom` for `event`. The handler is
 * captured by ref so identity is stable across re-renders — the listener
 * is installed once per editor instance and torn down on unmount, never
 * re-attached because the parent re-rendered.
 *
 * Use this instead of `window.addEventListener` whenever the work is
 * editor-scoped. Window-level events fire for every pixel of mouse
 * movement anywhere on screen; scoping eliminates idle CPU cost outside
 * the editor.
 *
 * Genuinely global events — escape key, window blur, browser resize —
 * still belong on `window`. This helper is the right choice only when
 * the reactor's work is bounded to the editor itself.
 */
export function useEditorDomEvent<K extends keyof HTMLElementEventMap>(
  editor: Editor | null,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view?.dom;
    if (!dom) return;
    const listener = (e: Event) => {
      handlerRef.current(e as HTMLElementEventMap[K]);
    };
    dom.addEventListener(event, listener, options);
    return () => {
      dom.removeEventListener(event, listener, options);
    };
    // `options` is read once at install; callers should pass a stable object
    // or an inline literal — we don't track changes to its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, event]);
}

/**
 * Scroll-parent variant. Resolves the scroll container relevant to the
 * editor (the unified row scroll, or the mirror pane's own scroll for
 * split-editor) and attaches there. Use for scroll listeners that need
 * to track the editor's actual scroll source.
 *
 * Resolution is deferred to attach time, so the editor's DOM must be
 * mounted when this effect runs. If the scroll parent isn't found
 * (initial render race, no row scroll yet), the listener is skipped.
 */
export function useEditorScrollParentEvent<K extends keyof HTMLElementEventMap>(
  editor: Editor | null,
  event: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!editor) return;
    const scrollParent = findEditorScrollFor(editor.view?.dom);
    if (!scrollParent) return;
    const listener = (e: Event) => {
      handlerRef.current(e as HTMLElementEventMap[K]);
    };
    scrollParent.addEventListener(event, listener, options);
    return () => {
      scrollParent.removeEventListener(event, listener, options);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, event]);
}
