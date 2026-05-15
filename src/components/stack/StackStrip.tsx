"use client";

/**
 * StackStrip — horizontal scrollable bar of stack thumbnails. Pinned
 * to the viewport's bottom-left, just right of the StackIcon. Width is
 * proportional to the number of items captured in the last 3 days
 * (older items still render in the scrollable overflow). Hidden when
 * `open=false`.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { StackItem } from "@/lib/stack/types";
import { StackThumbnail } from "./StackThumbnail";
import { STACK_INSET_LEFT, STACK_INSET_BOTTOM } from "./StackIcon";

export interface StackStripProps {
  open: boolean;
  items: StackItem[];
  onRemove: (id: string) => void;
}

const ICON_DIAMETER = 56;
const ICON_GAP = 12;
const STRIP_HEIGHT = 116;
const THUMB_W = 160;
const ITEM_GAP = 8;
const STRIP_PADDING = 10;
const MIN_W = 240;
const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

export function StackStrip({ open, items, onRemove }: StackStripProps) {
  const [vw, setVw] = useState<number>(
    typeof window === "undefined" ? 1024 : window.innerWidth,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (typeof document === "undefined" || !open) return null;

  // Width sizes to the count of items added in the last 3 days. Older
  // items stay in the strip but only become visible via horizontal
  // scroll once they're past the recent budget.
  const now = Date.now();
  const recentCount = items.reduce((n, it) => {
    const t = new Date(it.capturedAt).getTime();
    return Number.isFinite(t) && now - t <= RECENT_WINDOW_MS ? n + 1 : n;
  }, 0);

  const left = STACK_INSET_LEFT + ICON_DIAMETER + ICON_GAP;
  const maxW = Math.max(MIN_W, vw - left - STACK_INSET_LEFT);
  const contentW =
    STRIP_PADDING * 2 +
    Math.max(0, recentCount) * (THUMB_W + ITEM_GAP) -
    (recentCount > 0 ? ITEM_GAP : 0);
  const width = Math.min(maxW, Math.max(MIN_W, contentW));

  return createPortal(
    <div
      data-stack-strip="true"
      style={{
        position: "fixed",
        left,
        bottom: STACK_INSET_BOTTOM,
        width,
        height: STRIP_HEIGHT,
        background: "rgba(28, 25, 23, 0.20)",
        borderRadius: 10,
        boxShadow:
          "0 4px 14px rgba(0,0,0,0.16), 0 1px 4px rgba(0,0,0,0.10)",
        padding: STRIP_PADDING,
        display: "flex",
        flexDirection: "row",
        gap: ITEM_GAP,
        overflowX: "auto",
        overflowY: "hidden",
        zIndex: 999,
      }}
    >
      {items.length === 0 ? (
        <div
          style={{
            color: "rgba(255,255,255,0.72)",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            paddingLeft: 8,
            fontStyle: "italic",
          }}
        >
          Drop popped paragraphs, headings, cards, or text selections here.
        </div>
      ) : (
        items.map((it) => (
          <StackThumbnail key={it.id} item={it} onRemove={onRemove} />
        ))
      )}
    </div>,
    document.body,
  );
}
