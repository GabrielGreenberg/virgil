"use client";

/**
 * StackIcon — always-visible round button at the bottom-left of the
 * viewport. Click toggles the StackStrip. Drag-over (either an
 * in-flight FloatingPanel move or an HTML5 capture drag) illuminates
 * the ring blue.
 *
 * Pinned via `position: fixed; bottom; left` — viewport-anchored, never
 * follows page scroll. Visual style reads from Virgil design tokens so
 * the icon belongs to the same material family as floating cards.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStackDropTarget, setStackIconRect } from "@/lib/stack/stack-drop-target";
import { MIME_TEXT_INSERT } from "@/lib/marginalia";
import type { Editor } from "@tiptap/react";
import { addStackItem } from "@/hooks/useStack";
import { parkDuringLayoutGesture } from "@/lib/pane-resize";
import { LAYOUT_SITE_STACK_ICON } from "@/lib/layout-gesture-probe";

export interface StackIconProps {
  open: boolean;
  onToggle: () => void;
  /** Main editor — needed for HTML5-drag-into-stack handlers (text
   *  selections, paragraph captures from the editor's own grip). */
  mainEditor: Editor | null;
  /** Source attribution for new stack items. */
  source: { docId: string | null; docTitle?: string };
}

const ICON_DIAMETER = 56;
export const STACK_INSET_LEFT = 12;
export const STACK_INSET_BOTTOM = 12;

export function StackIcon({
  open,
  onToggle,
  mainEditor,
  source,
}: StackIconProps) {
  const [html5Hover, setHtml5Hover] = useState(false);
  const [hover, setHover] = useState(false);
  const stackTarget = useStackDropTarget();
  const ref = useRef<HTMLButtonElement | null>(null);

  // Publish the icon's viewport rect for the FloatingPanel hit-test.
  // Viewport-anchored, so the rect only changes on resize.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () => {
      const h = window.innerHeight;
      const left = STACK_INSET_LEFT;
      const top = h - STACK_INSET_BOTTOM - ICON_DIAMETER;
      setStackIconRect({
        left,
        top,
        right: left + ICON_DIAMETER,
        bottom: top + ICON_DIAMETER,
      });
    };
    update();
    // Parked (task 317): the icon is bottom-left-anchored and its published
    // rect is only read by the FloatingPanel hit-test, which cannot fire
    // mid-gesture (an OS window drag delivers no pointer events to the page).
    const park = parkDuringLayoutGesture(update, LAYOUT_SITE_STACK_ICON);
    const onResize = () => park.fire();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      park.dispose();
      setStackIconRect(null);
    };
  }, []);

  // HTML5 drag-to-stack handlers — today the only live HTML5 producer
  // is `MIME_TEXT_INSERT` (from external paste / selection sources). The
  // legacy `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` MIMEs are gone — the
  // float-to-stack path now runs entirely through the in-app drop session
  // (the `virgil-stack-drop` event fired by FloatingPanel.tsx). Phase E
  // and beyond may emit `MIME_TEXTOBJECT` from TextObjectGrabHandle for
  // selection-hydration drag-out; we'll wire the consumer here then.
  const onDragOver = (e: React.DragEvent) => {
    const t = e.dataTransfer?.types ?? [];
    if (t.includes(MIME_TEXT_INSERT)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      if (!html5Hover) setHtml5Hover(true);
    }
  };
  const onDragLeave = (e: React.DragEvent) => {
    const related = e.relatedTarget as Node | null;
    if (!related || !e.currentTarget.contains(related)) {
      setHtml5Hover(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setHtml5Hover(false);
    if (!mainEditor) return;
    const insertData = e.dataTransfer.getData(MIME_TEXT_INSERT);
    if (insertData) {
      try {
        const { content } = JSON.parse(insertData) as { content: unknown };
        if (content) {
          const docJson = content as { type?: string; content?: unknown[] };
          const node =
            docJson.type === "doc" &&
            Array.isArray(docJson.content) &&
            docJson.content.length > 0
              ? (docJson.content[0] as Record<string, unknown>)
              : (content as Record<string, unknown>);
          addStackItem({
            id: crypto.randomUUID(),
            capturedAt: new Date().toISOString(),
            source,
            payload: {
              kind: "paragraph",
              node: node as unknown as import("@tiptap/react").JSONContent,
            },
          });
        }
      } catch {
        /* ignore */
      }
    }
  };

  if (typeof document === "undefined") return null;

  const illuminated = stackTarget || html5Hover;

  // ── Color resolution from Virgil design tokens ─────────────────────
  // Idle: warm mid-tone pod surface — darker than card chrome so the
  // icon reads as a discrete affordance against the canvas.
  // Open: a touch darker still.
  // Hover: subtle bump toward the darker end.
  // Illuminated (drag target): accent-blue ring, same family as
  // DockOutline + drop-mode indicator.
  // Resting bg: paper-light. Hover/open warm slightly. The outline
  // carries the contrast against the canvas: a warm mid-grey (the tone
  // we used for the previous resting fill).
  const ringColor =
    "color-mix(in srgb, var(--pod-dark, #eae6df) 88%, #000 12%)";
  const bg = illuminated
    ? "var(--accent-light, #f5f0ea)"
    : open
      ? "var(--pod-dark, #eae6df)"
      : hover
        ? "var(--pod-toolbar, #f5f3ef)"
        : "var(--surface, #ffffff)";
  const borderColor = illuminated ? "var(--accent-blue, #2563eb)" : ringColor;
  const borderWidth = illuminated ? 2 : 1;
  const boxShadow = illuminated
    ? "0 0 0 4px rgba(37, 99, 235, 0.18), var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))"
    : "var(--card-shadow-ambient, 0 2px 6px rgba(0,0,0,0.10))";

  return createPortal(
    <button
      ref={ref}
      type="button"
      aria-label="Stack"
      aria-pressed={open}
      data-stack-icon-hit="true"
      onClick={onToggle}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: "fixed",
        left: STACK_INSET_LEFT,
        bottom: STACK_INSET_BOTTOM,
        width: ICON_DIAMETER,
        height: ICON_DIAMETER,
        borderRadius: "50%",
        background: bg,
        border: `${borderWidth}px solid ${borderColor}`,
        boxShadow,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 999,
        padding: 0,
        transition:
          "background-color 120ms ease-out, border-color 120ms ease-out, box-shadow 120ms ease-out",
      }}
    >
      <StackGlyph illuminated={illuminated} />
    </button>,
    document.body,
  );
}

/** Three stacked square pages, leaning up-and-to-the-right. Each rect
 *  is 16×16 with a 3px stagger per axis so the layers are clearly
 *  legible at 30px. Stroke + fill come from design tokens. */
function StackGlyph({ illuminated }: { illuminated: boolean }) {
  // Stroke matches the muted ink used by L-strip icons — readable
  // against the warm-tinted button background without going to harsh
  // black. Fill stays paper-white so each page reads as a discrete
  // sheet.
  const stroke = illuminated ? "var(--accent-blue, #2563eb)" : "var(--virgil-bar-text, #78716c)";
  const fill = illuminated
    ? "color-mix(in srgb, var(--accent-blue, #2563eb) 8%, var(--surface, #ffffff))"
    : "var(--surface, #ffffff)";
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 30 30"
      fill="none"
      aria-hidden="true"
    >
      {/* Bottom-back page (lower-left) */}
      <rect
        x="3"
        y="10"
        width="16"
        height="16"
        rx="2"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      {/* Middle page */}
      <rect
        x="6"
        y="7"
        width="16"
        height="16"
        rx="2"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
      {/* Top page (upper-right) */}
      <rect
        x="9"
        y="4"
        width="16"
        height="16"
        rx="2"
        fill={fill}
        stroke={stroke}
        strokeWidth="1.5"
      />
    </svg>
  );
}
