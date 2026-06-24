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

import { createContext, useContext, type ReactNode } from "react";

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
