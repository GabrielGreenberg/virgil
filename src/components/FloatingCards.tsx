"use client";

import { type ReactNode } from "react";
import FloatingPanel from "./FloatingPanel";
import { usePoppedCards } from "@/hooks/usePoppedCards";

const DEFAULT_W = 360;
const DEFAULT_H = 280;

/**
 * Wraps a popped-out card's JSX in a draggable/resizable `FloatingPanel`,
 * positioned from the shared popped-cards context.
 *
 * Usage (inside a wrapper card, when `popped.isPopped(key)` is true):
 *   return <FloatCard cardKey={key} indexHint={i}>{cardContent}</FloatCard>;
 *
 * The card itself is rendered once — here — and it never also appears in the
 * panel's list (the wrapper's early-return handles that). `FloatingPanel`
 * portals to `document.body`, so popped cards remain visible above every
 * layout layer.
 */
export function FloatCard({
  cardKey,
  children,
}: {
  cardKey: string;
  children: ReactNode;
}) {
  const ctx = usePoppedCards();
  if (!ctx) return null;
  const rect = ctx.getFloatPosition(cardKey);
  const indexHint = Math.max(0, ctx.poppedKeys.indexOf(cardKey));
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const initialX =
    rect?.x ?? Math.max(40, vw / 2 - DEFAULT_W / 2 + indexHint * 24);
  const initialY =
    rect?.y ?? Math.max(40, vh / 2 - DEFAULT_H / 2 + indexHint * 24);
  const initialWidth = rect?.width ?? DEFAULT_W;
  const initialHeight = rect?.height ?? DEFAULT_H;
  return (
    <FloatingPanel
      initialX={initialX}
      initialY={initialY}
      initialWidth={initialWidth}
      initialHeight={initialHeight}
      zIndex={1200 + indexHint}
      onChange={(pos) => ctx.setFloatPosition(cardKey, pos)}
    >
      {children}
    </FloatingPanel>
  );
}
