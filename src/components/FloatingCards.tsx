"use client";

import { useEffect, type ReactNode } from "react";
import FloatingPanel from "./FloatingPanel";

export interface CardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingCardsProps {
  poppedOutCards: string[];
  cardFloatPositions: Record<string, CardRect>;
  setCardFloatPosition: (key: string, rect: CardRect) => void;
  closeCardPopout: (key: string) => void;
  /** Per-key renderer. Receives the parsed `kind` / `id` and returns the
   *  card JSX (or null to auto-dismiss the popout for missing entities). */
  renderCard: (args: { key: string; kind: string; id: string }) => ReactNode;
}

const DEFAULT_W = 360;
const DEFAULT_H = 280;

/**
 * Mounts one `FloatingPanel` per popped-out card, parsing each `${kind}:${id}`
 * key and delegating the card body to `renderCard`. When `renderCard` returns
 * null (e.g. the underlying entity was deleted), the popout is auto-dismissed
 * on the next effect tick.
 */
export default function FloatingCards({
  poppedOutCards,
  cardFloatPositions,
  setCardFloatPosition,
  closeCardPopout,
  renderCard,
}: FloatingCardsProps) {
  return (
    <>
      {poppedOutCards.map((key, i) => {
        const sep = key.indexOf(":");
        const kind = sep > 0 ? key.slice(0, sep) : key;
        const id = sep > 0 ? key.slice(sep + 1) : "";
        const rendered = renderCard({ key, kind, id });
        return (
          <FloatingCardSlot
            key={key}
            index={i}
            cardKey={key}
            rect={cardFloatPositions[key]}
            onChange={(pos) => setCardFloatPosition(key, pos)}
            onMissing={() => closeCardPopout(key)}
            missing={rendered == null}
          >
            {rendered}
          </FloatingCardSlot>
        );
      })}
    </>
  );
}

function FloatingCardSlot({
  index,
  rect,
  onChange,
  onMissing,
  missing,
  children,
}: {
  index: number;
  cardKey: string;
  rect: CardRect | undefined;
  onChange: (pos: CardRect) => void;
  onMissing: () => void;
  missing: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (missing) onMissing();
  }, [missing, onMissing]);

  if (missing) return null;

  const initialX =
    rect?.x ??
    Math.max(
      40,
      (typeof window !== "undefined" ? window.innerWidth : 1200) / 2 -
        DEFAULT_W / 2 +
        index * 24,
    );
  const initialY =
    rect?.y ??
    Math.max(
      40,
      (typeof window !== "undefined" ? window.innerHeight : 800) / 2 -
        DEFAULT_H / 2 +
        index * 24,
    );
  const initialWidth = rect?.width ?? DEFAULT_W;
  const initialHeight = rect?.height ?? DEFAULT_H;

  return (
    <FloatingPanel
      initialX={initialX}
      initialY={initialY}
      initialWidth={initialWidth}
      initialHeight={initialHeight}
      zIndex={1200 + index}
      onChange={onChange}
    >
      <div className="flex flex-col min-h-0 flex-1 overflow-auto p-2">
        {children}
      </div>
    </FloatingPanel>
  );
}
