"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  DATA_LINK_CARD,
  DATA_LINK_ID,
  LINK_REGISTRY,
  linkCardKey,
} from "../link-registry";
import type { CardKind } from "@/panels/_shared/types";
import type { LinkKind } from "./types";
import { findRowScroll } from "@/components/editor-layout/layout-scroll";

interface Connector {
  id: string;
  d: string;
}

interface LinkConnectorProps {
  editor: Editor | null;
  /** The link id to connect (from marker to card entry). */
  linkId: string | null;
  /** Which link kind — drives stroke style via the registry. */
  linkKind: LinkKind;
  /** Target card ref — selects the panel-side entry via `data-link-card`. */
  targetCard: { kind: CardKind; id: string };
  /** Which side the panel is on relative to the editor. */
  panelSide: "left" | "right";
  /** Ref to the main area containing both editor and panel. */
  mainRef: React.RefObject<HTMLDivElement | null>;
  /** Optional override for the panel-side selector (used by the
   *  citation↔bib cross-link: the panel entry lives in a different panel). */
  panelEntrySelector?: string;
  /** Used to invalidate positions when the doc changes. */
  docVersion?: unknown;
  /**
   * Layout variant:
   * - `"floating"` (default): panel is docked beside the editor. Uses a
   *   curved bezier with corner radii to route around the margin lane.
   *   Skipped when the entry is `position: absolute` (in-text mode).
   * - `"in-text"`: panel items are positioned absolutely over the
   *   editor's column. Uses a simpler horizontal + small-vertical-jog
   *   path. Only renders when the entry is `position: absolute`.
   */
  variant?: "floating" | "in-text";
}

/**
 * Unified SVG connector between an in-editor link marker and its panel
 * card. Replaces the per-kind `FootnoteConnectors`/`CitationConnectors`.
 *
 * DOM contract: the marker carries `data-link-id="<linkId>"`; the panel
 * card carries `data-link-card="<cardKind>:<cardId>"`. Both are uniform
 * across kinds — stroke style is the only per-kind difference.
 */
export default function LinkConnector({
  editor,
  linkId,
  linkKind,
  targetCard,
  panelSide,
  mainRef,
  panelEntrySelector,
  docVersion,
  variant = "floating",
}: LinkConnectorProps) {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const rafRef = useRef(0);

  const entry = LINK_REGISTRY[linkKind];
  const stroke = entry.connectorStroke;

  const compute = useCallback(() => {
    const main = mainRef.current;
    if (!editor || !main || !linkId || !stroke) {
      setConnectors([]);
      return;
    }

    const cr = main.getBoundingClientRect();
    const editorScrollEl = editor.view.dom.closest(
      ".overflow-y-auto",
    ) as HTMLElement | null;
    if (!editorScrollEl) {
      setConnectors([]);
      return;
    }
    const edRect = editorScrollEl.getBoundingClientRect();

    const marginLaneX =
      panelSide === "right"
        ? edRect.right - 28 - cr.left
        : edRect.left + 28 - cr.left;

    const markerEl = editor.view.dom.querySelector(
      `[${DATA_LINK_ID}="${linkId}"]`,
    ) as HTMLElement | null;
    if (!markerEl) {
      setConnectors([]);
      return;
    }

    const entrySelector =
      panelEntrySelector ??
      `[${DATA_LINK_CARD}="${linkCardKey(targetCard.kind, targetCard.id)}"]`;
    const entryEl = main.querySelector(entrySelector) as HTMLElement | null;
    if (!entryEl) {
      setConnectors([]);
      return;
    }
    // "floating" layout draws around the docked panel's margin lane and
    // doesn't apply when the entry is positioned absolutely over the
    // editor. "in-text" is the inverse: only when absolutely positioned.
    const entryPosition = getComputedStyle(entryEl).position;
    const isAbsoluteEntry = entryPosition === "absolute";
    if (variant === "floating" && isAbsoluteEntry) {
      setConnectors([]);
      return;
    }
    if (variant === "in-text" && !isAbsoluteEntry) {
      setConnectors([]);
      return;
    }

    const mRect = markerEl.getBoundingClientRect();
    const eRect = entryEl.getBoundingClientRect();

    if (variant === "in-text") {
      // Simple L-shape: horizontal from entry edge to marker X, then a
      // short vertical to the marker's vertical midpoint.
      if (mRect.bottom < edRect.top || mRect.top > edRect.bottom) {
        setConnectors([]);
        return;
      }
      const markerY = (mRect.top + mRect.bottom) / 2 - cr.top;
      const entryVisible =
        eRect.top >= cr.top - 100 && eRect.bottom <= cr.bottom + 100;
      const entryY = entryVisible ? eRect.top + 12 - cr.top : markerY;
      const markerX = (mRect.left + mRect.right) / 2 - cr.left;
      const entryX =
        panelSide === "right" ? eRect.left - cr.left - 2 : eRect.right - cr.left + 2;
      const needsJog = Math.abs(markerY - entryY) > 1;
      const d = needsJog
        ? `M ${entryX} ${entryY} L ${markerX} ${entryY} L ${markerX} ${markerY}`
        : `M ${entryX} ${entryY} L ${markerX} ${markerY}`;
      setConnectors([{ id: linkId, d }]);
      return;
    }

    if (eRect.bottom < cr.top || eRect.top > cr.bottom) {
      setConnectors([]);
      return;
    }

    const mx = mRect.left + mRect.width / 2 - cr.left;
    const mTop = mRect.top - cr.top;
    const mBottom = mRect.bottom - cr.top;

    const markerAbove = mRect.bottom < cr.top;
    const markerBelow = mRect.top > cr.bottom;
    const mCenter = markerAbove
      ? 0
      : markerBelow
        ? cr.height
        : (mTop + mBottom) / 2;

    const ey = eRect.top + 14 - cr.top;
    const ex =
      panelSide === "right" ? eRect.left - cr.left : eRect.right - cr.left;

    let d: string;
    const yDiff = Math.abs(mCenter - ey);
    if (!markerAbove && !markerBelow && yDiff < 30) {
      const lineY = (mCenter + ey) / 2;
      d = `M ${mx} ${lineY} L ${ex} ${lineY}`;
    } else if (markerAbove || markerBelow) {
      const startY = markerAbove ? -2 : cr.height + 2;
      const r3 = 4;
      const hDir = panelSide === "right" ? 1 : -1;
      const entryDist = Math.abs(ex - marginLaneX);
      const vDist = Math.abs(ey - startY);
      const rr = Math.max(0.5, Math.min(r3, vDist * 0.35, entryDist * 0.35));

      d = [
        `M ${marginLaneX} ${startY}`,
        `L ${marginLaneX} ${ey - (ey > startY ? rr : -rr)}`,
        `Q ${marginLaneX} ${ey}, ${marginLaneX + hDir * rr} ${ey}`,
        `L ${ex} ${ey}`,
      ].join(" ");
    } else {
      const entryBelow = ey >= mCenter;
      const startY = entryBelow ? mBottom + 1 : mTop - 1;
      const exitDir = entryBelow ? 1 : -1;
      const turnY = startY + exitDir * 4;
      const r = 4;
      const hDir = panelSide === "right" ? 1 : -1;
      const vDir = ey > turnY ? 1 : -1;

      const hDist = Math.abs(marginLaneX - mx);
      const vDist = Math.abs(ey - turnY);
      const exitDist = Math.abs(turnY - startY);
      const entryDist = Math.abs(ex - marginLaneX);

      const r1 = Math.max(0.5, Math.min(r, exitDist * 0.45, hDist * 0.35));
      const r2 = Math.max(0.5, Math.min(r, hDist * 0.35, vDist * 0.35));
      const r3 = Math.max(0.5, Math.min(r, vDist * 0.35, entryDist * 0.35));

      d = [
        `M ${mx} ${startY}`,
        `L ${mx} ${turnY - exitDir * r1}`,
        `Q ${mx} ${turnY}, ${mx + hDir * r1} ${turnY}`,
        `L ${marginLaneX - hDir * r2} ${turnY}`,
        `Q ${marginLaneX} ${turnY}, ${marginLaneX} ${turnY + vDir * r2}`,
        `L ${marginLaneX} ${ey - vDir * r3}`,
        `Q ${marginLaneX} ${ey}, ${marginLaneX + hDir * r3} ${ey}`,
        `L ${ex} ${ey}`,
      ].join(" ");
    }

    setConnectors([{ id: linkId, d }]);
    // docVersion is consumed only to force recomputes when the doc changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, linkId, targetCard.kind, targetCard.id, panelSide, mainRef, panelEntrySelector, stroke, docVersion, variant]);

  const scheduleCompute = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(compute);
  }, [compute]);

  useEffect(() => {
    compute();
    const main = mainRef.current;
    const rowScroll = findRowScroll();
    rowScroll?.addEventListener("scroll", scheduleCompute, { passive: true });
    main?.addEventListener("scroll", scheduleCompute, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", scheduleCompute);
    // In-text variant: the entry's vertical position depends on the
    // anchor's DOM coords, which only shift on doc changes (not bare
    // selection moves). Drop the selectionUpdate subscription —
    // typing was firing this hook twice per keystroke (once for the
    // text edit, once for the implied caret move). Also guard the
    // remaining 'update' on `tr.docChanged` so mark-only / metadata-
    // only transactions don't trigger a layout-reading recompute.
    const onDocUpdate = ({
      transaction,
    }: {
      transaction: import("@tiptap/pm/state").Transaction;
    }) => {
      if (!transaction.docChanged) return;
      scheduleCompute();
    };
    if (variant === "in-text" && editor) {
      editor.on("update", onDocUpdate);
    }
    return () => {
      cancelAnimationFrame(rafRef.current);
      rowScroll?.removeEventListener("scroll", scheduleCompute);
      main?.removeEventListener("scroll", scheduleCompute, { capture: true });
      window.removeEventListener("resize", scheduleCompute);
      if (variant === "in-text" && editor) {
        editor.off("update", onDocUpdate);
      }
    };
  }, [editor, compute, scheduleCompute, mainRef, variant]);

  if (connectors.length === 0 || !stroke) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
      width="100%"
      height="100%"
    >
      {connectors.map((c) => (
        <path
          key={c.id}
          d={c.d}
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeDasharray={stroke.dasharray}
          fill="none"
          opacity={stroke.opacity}
        />
      ))}
    </svg>
  );
}
