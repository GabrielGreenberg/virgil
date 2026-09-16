"use client";

// Keep-alive visibility context. A kept-alive subtree (an editor mounted but
// hidden via display:none — see KeepAliveSlot) publishes whether it is the
// active/shown slot. Deep descendants (floats, popouts, measurement hooks that
// would otherwise prop-drill through many layers) read it via useIsVisible().
//
// Default `true`: any consumer mounted OUTSIDE a provider — i.e. every existing
// call site — reads "visible" and behaves exactly as before. Backward-compatible
// by construction. Modeled on EditorChromeProvider (chrome-context.tsx).
//
// KEYSTROKE SANCTITY: this is the signal that makes a hidden editor INERT. Its
// only consumers are early-outs in measurement/observer followers — it never
// adds per-keystroke work to the visible editor.

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

const KeepAliveVisibilityContext = createContext<boolean>(true);

export function KeepAliveVisibilityProvider({
  isVisible,
  children,
}: {
  isVisible: boolean;
  children: ReactNode;
}) {
  return (
    <KeepAliveVisibilityContext.Provider value={isVisible}>
      {children}
    </KeepAliveVisibilityContext.Provider>
  );
}

/** True when this subtree is the active/shown keep-alive slot. Default `true`
 *  (no provider ⇒ legacy always-visible behavior). */
export function useIsVisible(): boolean {
  return useContext(KeepAliveVisibilityContext);
}

/**
 * The visibility answer as a REF, for event handlers and long-lived effects.
 *
 * A warm pane is NOT remounted when it is shown or hidden, so a handler that
 * captured `useIsVisible()`'s render value would freeze at its mount-time
 * answer. Read `ref.current` at event time instead (task 598 — the rule the
 * per-doc-services law states for window listeners registered per pane).
 */
export function useIsVisibleRef(): RefObject<boolean> {
  const isVisible = useIsVisible();
  const ref = useRef(isVisible);
  useLayoutEffect(() => {
    ref.current = isVisible;
  }, [isVisible]);
  return ref;
}

type ListenerTarget = "window" | "document";
type EventMapFor<T extends ListenerTarget> = T extends "window"
  ? WindowEventMap
  : DocumentEventMap;

/**
 * A `window` / `document` listener registered by a component or hook that is
 * mounted ONCE PER PANE — answered only while THIS pane is the shown one.
 *
 * N `EditorPane`s are alive at once under multi-doc keep-alive (one visible,
 * the rest `display:none`), so an app-global event reaches every copy of the
 * listener. A pane the user cannot see cannot have been clicked, hovered or
 * typed into; letting it answer is how a click in paper A discarded a blank
 * card in paper B (task 598). The gate reads `useIsVisibleRef()` at event
 * time, and the handler is held through a ref so a caller's inline closure
 * does not re-register the listener each render.
 *
 * `enabled: false` removes the listener entirely (an "only while open" hook).
 * The per-pane listener census (`pane-scoped-listener-census.test.ts`) is
 * what makes this the door rather than a suggestion.
 */
export function usePaneScopedListener<
  T extends ListenerTarget,
  K extends keyof EventMapFor<T> & string,
>(
  target: T,
  type: K,
  handler: (event: EventMapFor<T>[K]) => void,
  options: { capture?: boolean; passive?: boolean; enabled?: boolean } = {},
): void {
  const visibleRef = useIsVisibleRef();
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  const { capture = false, passive, enabled = true } = options;
  useEffect(() => {
    if (!enabled) return;
    const node: EventTarget = target === "window" ? window : document;
    const onEvent = (event: Event) => {
      if (!visibleRef.current) return;
      handlerRef.current(event as EventMapFor<T>[K]);
    };
    node.addEventListener(type, onEvent, { capture, passive });
    return () => node.removeEventListener(type, onEvent, { capture });
  }, [target, type, capture, passive, enabled, visibleRef]);
}
