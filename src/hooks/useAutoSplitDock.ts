"use client";

import { useEffect, useRef } from "react";
import type { Side } from "@/hooks/useViewPrefs";
import type { EditorPaneViewPrefs } from "@/components/EditorPane";

/**
 * Per-side observer that auto-engages split-dock mode when a single
 * docked panel doesn't fill the column and there's enough leftover
 * space for a second slot. Tracks the split ratio dynamically against
 * the panel's natural content height.
 *
 * Rule: only manages single-panel state. Zero or two panels on the
 * side are left alone (user-owned).
 */

const PIXEL_DRIFT_THRESHOLD = 8;

/** Measure a docked panel's natural content height: shell chrome plus
 *  the actual rendered content inside the scroll list. Works in both
 *  modes by walking the list's children — `scrollHeight` alone doesn't
 *  detect content that has shrunk below a constrained box. */
function measureNaturalHeight(shell: HTMLElement): number | null {
  const list = shell.querySelector<HTMLElement>(".overflow-y-auto");
  if (!list) {
    const h = shell.scrollHeight;
    return Number.isFinite(h) && h > 0 ? h : null;
  }
  const cs = getComputedStyle(list);
  const padTop = parseFloat(cs.paddingTop) || 0;
  const padBot = parseFloat(cs.paddingBottom) || 0;
  const children = Array.from(list.children) as HTMLElement[];
  let contentH = 0;
  if (children.length > 0) {
    const firstTop = children[0].getBoundingClientRect().top;
    const lastBottom = children[children.length - 1].getBoundingClientRect().bottom;
    contentH = Math.max(0, lastBottom - firstTop);
  }
  const listNatural = contentH + padTop + padBot;
  const chrome = Math.max(0, shell.clientHeight - list.clientHeight);
  const total = listNatural + chrome;
  return Number.isFinite(total) && total > 0 ? total : null;
}

export function useAutoSplitDock({
  side,
  viewPrefs,
}: {
  side: Side;
  viewPrefs: EditorPaneViewPrefs | undefined;
}) {
  const rafRef = useRef<number | null>(null);
  const vpRef = useRef(viewPrefs);
  vpRef.current = viewPrefs;

  const zenMode = viewPrefs?.zenMode ?? false;
  const dockSlots = viewPrefs?.prefs.dockSlots;
  const topSlot = dockSlots?.[`${side}-top`];
  const bottomSlot = dockSlots?.[`${side}-bottom`];
  const fullSlot = dockSlots?.[`${side}-full`];
  const isSplit = !viewPrefs
    ? false
    : side === "left"
      ? viewPrefs.prefs.activeLeftBottom != null
      : viewPrefs.prefs.activeRightBottom != null;

  useEffect(() => {
    if (!vpRef.current) return;
    if (zenMode) return;

    const root = document.documentElement;
    const colSelector = `[data-panel-column-side="${side}"]`;

    const evaluate = () => {
      const vp = vpRef.current;
      if (!vp) return;
      // Side fully collapsed: dockSlots may still carry a stale occupant
      // from before the collapse, but we must not auto-engage a split
      // (engageAutoSplit's null fallback would silently un-collapse the
      // side).
      const activeOnSide = side === "left" ? vp.prefs.activeLeft : vp.prefs.activeRight;
      if (activeOnSide == null) return;
      const slots = vp.prefs.dockSlots;
      const curIsSplit = side === "left"
        ? vp.prefs.activeLeftBottom != null
        : vp.prefs.activeRightBottom != null;

      const topId = curIsSplit ? slots[`${side}-top`] : undefined;
      const bottomId = curIsSplit ? slots[`${side}-bottom`] : undefined;
      const fullId = !curIsSplit ? slots[`${side}-full`] : undefined;
      const occupiedCount =
        (topId ? 1 : 0) + (bottomId ? 1 : 0) + (fullId ? 1 : 0);

      if (occupiedCount !== 1) return;
      const singleId = topId ?? bottomId ?? fullId;
      if (!singleId) return;

      const col = document.querySelector<HTMLElement>(colSelector);
      if (!col) return;

      // Resolve the dock-frame height to pixels. The --dock-slot-frame-h
      // custom property is a calc() expression that browsers don't
      // resolve to px in getPropertyValue. The slot element exposes the
      // same value as `max-height`, which getComputedStyle resolves.
      // Fallback: probe with a temporary hidden element.
      let frameH = NaN;
      const slotEl = col.querySelector<HTMLElement>("[data-dock-slot]");
      if (slotEl) {
        frameH = parseFloat(getComputedStyle(slotEl).maxHeight);
      }
      if (!Number.isFinite(frameH) || frameH <= 0) {
        const probe = document.createElement("div");
        probe.style.cssText =
          "position:absolute;visibility:hidden;pointer-events:none;height:var(--dock-slot-frame-h)";
        col.appendChild(probe);
        frameH = probe.getBoundingClientRect().height;
        probe.remove();
      }
      if (!Number.isFinite(frameH) || frameH <= 0) return;

      const minH = parseFloat(
        getComputedStyle(root).getPropertyValue("--panel-min-h"),
      ) || 200;

      const shell = document.querySelector<HTMLElement>(
        `[data-floating-panel="true"][data-panel-shell-id="${singleId}"]`,
      );
      if (!shell) return;
      const natural = measureNaturalHeight(shell);
      if (natural == null) return;

      const ratio = Math.max(0.05, Math.min(0.95, natural / frameH));

      if (!curIsSplit) {
        if (natural + minH <= frameH) {
          vp.engageAutoSplit(side, ratio);
        }
        return;
      }
      // Already split (single panel, bottom empty by construction).
      if (natural + minH > frameH) {
        vp.disengageAutoSplit(side);
        return;
      }
      const currentRatio = side === "left"
        ? vp.prefs.splitLeftRatio
        : vp.prefs.splitRightRatio;
      const pixelDrift = Math.abs((ratio - currentRatio) * frameH);
      if (pixelDrift > PIXEL_DRIFT_THRESHOLD) {
        vp.setSplitRatioInternal(side, ratio);
      }
    };

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        evaluate();
      });
    };

    schedule();

    const col = document.querySelector<HTMLElement>(colSelector);
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    if (col) {
      ro = new ResizeObserver(schedule);
      ro.observe(col);
      mo = new MutationObserver(schedule);
      mo.observe(col, { childList: true, subtree: true });
    }
    window.addEventListener("resize", schedule);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [side, zenMode, topSlot, bottomSlot, fullSlot, isSplit]);
}
