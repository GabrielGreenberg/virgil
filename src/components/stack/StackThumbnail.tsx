"use client";

/**
 * StackThumbnail — one compressed card in the strip. Renders a per-kind
 * preview, a tiny X (remove), and a small date stamp.
 *
 * Mousedown initiates a pull: `beginDropSession({ cardKey: 'stack-pull:<id>' })`
 * — the controller mounts the placement indicator and our stack-pull
 * DropSpec runs `applyDrop` on release.
 */

import { useMemo } from "react";
import { isPrimaryDragStart } from "@/lib/pane-resize/pointer-invariants";
import type { StackItem } from "@/lib/stack/types";
import { STACK_PULL_PREFIX } from "@/lib/stack/types";
import { beginDropSession } from "@/components/drop-mode/controller";
import { shortRelativeTime, summarizeStackItem } from "@/lib/stack/snapshot";

export interface StackThumbnailProps {
  item: StackItem;
  onRemove: (id: string) => void;
}

export function StackThumbnail({ item, onRemove }: StackThumbnailProps) {
  const summary = useMemo(() => summarizeStackItem(item, 240), [item]);
  const time = useMemo(() => shortRelativeTime(item.capturedAt), [item.capturedAt]);
  const kindLabel = kindLabelFor(item);

  const onMouseDown = (e: React.MouseEvent) => {
    // Suppress when the click was on the X — its own handler fires.
    const target = e.target as HTMLElement;
    if (target.closest("[data-stack-thumb-x]")) return;
    // Only left button — the engine's start gate (SSOT, never re-derived).
    if (!isPrimaryDragStart(e)) return;
    e.preventDefault();
    e.stopPropagation();
    beginDropSession({
      cardKey: `${STACK_PULL_PREFIX}:${item.id}`,
      origin: { x: e.clientX, y: e.clientY },
    });
  };

  return (
    <div
      data-stack-thumb-id={item.id}
      data-stack-thumb-kind={kindLabel}
      onMouseDown={onMouseDown}
      data-hint={`${kindLabel} · ${time}`}
      style={{
        position: "relative",
        flex: "0 0 auto",
        width: 160,
        height: 96,
        background: "var(--surface, #ffffff)",
        border: "1px solid var(--border-light, #c9c5c5)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))",
        padding: "6px 8px 18px 8px",
        overflow: "hidden",
        cursor: "grab",
        color: "var(--ink-body, #1c1917)",
        userSelect: "none",
      }} aria-label={`${kindLabel} · ${time}`}
    >
      <div
        style={{
          fontSize: 9,
          lineHeight: 1,
          letterSpacing: 0.4,
          color: "var(--muted, #8a8580)",
          textTransform: "uppercase",
          marginBottom: 3,
          fontWeight: 600,
        }}
      >
        {kindLabel}
      </div>
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.32,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 5,
          overflow: "hidden",
          color: "var(--ink-body, #1c1917)",
        }}
      >
        {summary || "(empty)"}
      </div>
      <button
        className="focus-ring"
        type="button"
        data-stack-thumb-x="true"
        aria-label="Remove from stack"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(item.id);
        }}
        onMouseDown={(e) => {
          // Don't let the parent's mousedown fire a drop session.
          e.stopPropagation();
        }}
        style={{
          position: "absolute",
          top: 2,
          right: 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "transparent",
          color: "var(--muted-light, #b5b0aa)",
          fontSize: 12,
          lineHeight: 1,
          border: "none",
          cursor: "pointer",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ×
      </button>
      <div
        style={{
          position: "absolute",
          left: 8,
          right: 22,
          bottom: 4,
          fontSize: 9,
          color: "var(--muted-light, #b5b0aa)",
          letterSpacing: 0.2,
          pointerEvents: "none",
        }}
      >
        {time}
      </div>
    </div>
  );
}

function kindLabelFor(item: StackItem): string {
  const p = item.payload;
  switch (p.kind) {
    case "text":
      return "TEXT";
    case "paragraph":
      return "PARAGRAPH";
    case "heading":
      return "HEADING";
    case "card":
      return p.card.cardKind.toUpperCase();
  }
}
