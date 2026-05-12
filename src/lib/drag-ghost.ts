/**
 * Clamped drag-ghost utility for HTML5 native drags.
 *
 * Why this exists: setDragImage hands the visual to the OS, which then
 * tracks the cursor freely — including up into the OS title bar / browser
 * chrome, where the drag image disappears, the cursor flips to "no-drop",
 * or some browsers interpret the drag as a window-tear-off. None of that
 * can be controlled with HTML5 drag.
 *
 * The fix: suppress the native ghost with a 1×1 transparent image, render
 * our own DOM element, and reposition it on document-level dragover events,
 * clamping `top` to the viewport top (y=0) so the visual can ride up over
 * the Virgil bar but never crosses into OS-controlled space.
 */
"use client";

import type { DragEvent as ReactDragEvent } from "react";

export interface AttachClampedDragGhostOptions {
  dragStartEvent: ReactDragEvent | DragEvent;
  /** Builds the ghost element. Called once at drag start. */
  buildGhost: () => HTMLElement;
  /** Cursor's X offset inside the ghost (ghost-local coords). */
  cursorOffsetX: number;
  /** Cursor's Y offset inside the ghost (ghost-local coords). */
  cursorOffsetY: number;
  /** Override the default clamp (viewport top, y=0) with a fixed Y in px. */
  topClampPx?: number;
}

const GHOST_ATTR = "data-virgil-drag-ghost";

const BLANK_IMG = (() => {
  if (typeof window === "undefined") return null;
  const img = new Image();
  img.src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  return img;
})();

interface ActiveGhost {
  el: HTMLElement;
  cleanup: () => void;
}

let currentGhost: ActiveGhost | null = null;

if (typeof window !== "undefined") {
  for (const el of Array.from(document.querySelectorAll(`[${GHOST_ATTR}]`))) {
    el.remove();
  }
}

export function attachClampedDragGhost(
  opts: AttachClampedDragGhostOptions,
): void {
  const {
    dragStartEvent,
    buildGhost,
    cursorOffsetX,
    cursorOffsetY,
    topClampPx,
  } = opts;

  const dt = dragStartEvent.dataTransfer;
  if (!dt) return;

  if (BLANK_IMG) {
    try {
      dt.setDragImage(BLANK_IMG, 0, 0);
    } catch {
      // Some test environments lack a real dataTransfer; the custom ghost
      // still renders, the native image just won't be suppressed.
    }
  }

  if (currentGhost) {
    currentGhost.cleanup();
    currentGhost = null;
  }

  const ghost = buildGhost();
  ghost.setAttribute(GHOST_ATTR, "");
  ghost.style.position = "fixed";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "99999";
  ghost.style.left = "-9999px";
  ghost.style.top = "-9999px";
  document.body.appendChild(ghost);

  const clampTop = topClampPx ?? 0;
  let rafId = 0;
  let lastClientX = 0;
  let lastClientY = 0;

  const applyPosition = () => {
    rafId = 0;
    const desiredTop = lastClientY - cursorOffsetY;
    const top = Math.max(clampTop, desiredTop);
    const w = ghost.offsetWidth;
    const maxLeft = Math.max(0, window.innerWidth - w);
    const desiredLeft = lastClientX - cursorOffsetX;
    const left = Math.max(0, Math.min(desiredLeft, maxLeft));
    ghost.style.top = `${top}px`;
    ghost.style.left = `${left}px`;
  };

  // Position once immediately using the dragstart coordinates so the ghost
  // appears under the cursor before the first dragover fires.
  lastClientX = (dragStartEvent as DragEvent).clientX;
  lastClientY = (dragStartEvent as DragEvent).clientY;
  applyPosition();

  const onDragOver = (e: DragEvent) => {
    lastClientX = e.clientX;
    lastClientY = e.clientY;
    if (!rafId) rafId = requestAnimationFrame(applyPosition);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") cleanup();
  };

  const cleanup = () => {
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener("dragover", onDragOver, true);
    document.removeEventListener("dragend", cleanup, true);
    document.removeEventListener("drop", cleanup, true);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    clearTimeout(safetyTimer);
    ghost.remove();
    if (currentGhost?.el === ghost) currentGhost = null;
  };

  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("dragend", cleanup, true);
  document.addEventListener("drop", cleanup, true);
  document.addEventListener("visibilitychange", onVisibilityChange);
  const safetyTimer = window.setTimeout(cleanup, 30_000);

  currentGhost = { el: ghost, cleanup };
}
