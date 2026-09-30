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
import { CARD_REGISTRY } from "@/cards/card-registry";
import { CARD_KIND_BY_STACK_CARD_KIND } from "@/lib/stack/card-kinds";
import { TEXT_OBJECT_REGISTRY } from "@/text-objects/text-object-registry";

/** One thumbnail's box. The strip's width formula reads the same width, so the
 *  budget it sizes for and the cards it lays out cannot drift apart. */
export const STACK_THUMB_W = 160;
export const STACK_THUMB_H = 96;

export interface StackThumbnailProps {
  item: StackItem;
  onRemove: (id: string) => void;
}

export function StackThumbnail({ item, onRemove }: StackThumbnailProps) {
  const summary = useMemo(() => summarizeStackItem(item, 240), [item]);
  const time = useMemo(() => shortRelativeTime(item.capturedAt), [item.capturedAt]);
  const kindLabel = stackItemKindLabel(item);

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
        width: STACK_THUMB_W,
        height: STACK_THUMB_H,
        background: "var(--surface, #ffffff)",
        border: "1px solid var(--border-light, #c9c5c5)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))",
        padding: "6px 8px 18px 8px",
        overflow: "hidden",
        cursor: "grab",
        color: "var(--ink-body, #1c1917)",
        userSelect: "none",
      }} aria-description={`${kindLabel} · ${time}`}
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
        data-iconbtn-exempt="remove badge on a stack thumbnail: inline-styled overlay geometry"
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

/**
 * The name a thumbnail shows for its item — READ from the registries every
 * other surface names these kinds from (task 861), never the internal id: a
 * card is `CARD_REGISTRY[kind].label` (todo → "Task", bib → "Bibliography",
 * the cutter/revision twins → "Request" / "Revision", as their panels say), a
 * block is its `TEXT_OBJECT_REGISTRY` label. The header uppercases via CSS
 * `text-transform`, so the string passes through unchanged — and reaches
 * `data-hint` / `aria-description` in its readable case.
 */
export function stackItemKindLabel(item: StackItem): string {
  const p = item.payload;
  switch (p.kind) {
    case "text":
      // A bare inline slice has no registry kind of its own.
      return "Text";
    case "paragraph":
      return TEXT_OBJECT_REGISTRY.paragraph.label;
    case "heading":
      return TEXT_OBJECT_REGISTRY.heading.label;
    case "card":
      return CARD_REGISTRY[CARD_KIND_BY_STACK_CARD_KIND[p.card.cardKind]].label;
  }
}
