/**
 * Pure figure / graphics block ATTRS + raw-synthesis helpers — React-free.
 *
 * CHIP 6a split these leaf helpers out of `figure-block.ts` / `graphics-block.ts`
 * (which import the React `FigureBlockNodeView`, and through it `@/lib/storage`)
 * so a React-LIGHT consumer — notably the action registry's `figureRun` /
 * `graphicsRun`, and the node-env / jsdom vitests that import the registry — can
 * pull the fresh-attrs builders + `synthesizeFigureRaw` WITHOUT dragging the
 * NodeView + storage graph in (the `@/lib/storage` `require("@/…")` resolver
 * gotcha). `figure-block.ts` / `graphics-block.ts` re-export these under their
 * old names so every existing import path (`@/lib/tiptap/figure-block`, the
 * `@/lib/tiptap` barrel, `FigureBlockNodeView`) keeps working unchanged.
 *
 * Everything here is a pure function of its inputs — no React, no DOM, no
 * storage, no TipTap schema — so it is safe to import from anywhere.
 */

import { generateShortId } from "@/lib/uuid";

// ── figureBlock ────────────────────────────────────────────────────────────

// Initial `extras` body for a fresh figure: centered `\includegraphics` with
// an empty path so the user has the LaTeX shape to fill in. `\caption{}` and
// `\label{}` are NOT included here — those are stored on the sub-node and
// the `label` attr respectively, and rebuilt by the serializer.
export const FIGURE_STUB_EXTRAS =
  "\\centering\n  \\includegraphics[width=0.6\\textwidth]{}\n  ";

export interface FreshFigureBlockAttrs {
  extras: string;
  placement: string;
  starred: boolean;
  source: string | null;
  widthPercent: number;
  sources: unknown[];
  label: string;
  numbered: boolean;
  figureNumber: null;
  uuid: string;
}

export function freshFigureBlockAttrs(existing: Set<string>): FreshFigureBlockAttrs {
  return {
    extras: FIGURE_STUB_EXTRAS,
    placement: "",
    starred: false,
    source: null,
    widthPercent: 60,
    sources: [],
    label: "fig:",
    numbered: true,
    figureNumber: null,
    uuid: generateShortId(existing),
  };
}

// Rebuild a verbatim `\begin{figure}` body from structured attrs + caption
// text. Used by the serializer (at save time) AND by the popover surface
// (when opening the source editor — the popover wants something to display
// /edit even though the canonical content lives in attrs + sub-node).
export function synthesizeFigureRaw(
  extras: string,
  captionTex: string,
  label: string,
): string {
  const parts: string[] = ["\n  "];
  const extrasBody = (extras || "").replace(/\s+$/, "");
  if (extrasBody) {
    // Re-indent so the extras body sits at the same 2-space indent as the
    // rest of the env body we synthesise.
    parts.push(extrasBody.replace(/\n/g, "\n  "));
    parts.push("\n  ");
  }
  parts.push(`\\caption{${captionTex}}`);
  if (label) {
    parts.push("\n  ");
    parts.push(`\\label{${label}}`);
  }
  parts.push("\n");
  return parts.join("");
}

// ── graphicsBlock ──────────────────────────────────────────────────────────

export const GRAPHICS_STUB_COMMAND = "\\includegraphics[width=0.5\\textwidth]{}";

export interface FreshGraphicsBlockAttrs {
  command: string;
  source: string;
  widthPercent: number;
  uuid: string;
}

export function freshGraphicsBlockAttrs(existing: Set<string>): FreshGraphicsBlockAttrs {
  return {
    command: GRAPHICS_STUB_COMMAND,
    source: "",
    widthPercent: 50,
    uuid: generateShortId(existing),
  };
}
