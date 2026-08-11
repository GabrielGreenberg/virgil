/**
 * Pure figure / graphics block ATTRS + raw-synthesis helpers — React-free.
 *
 * CHIP 6a split these leaf helpers out of `figure-block.ts` / `graphics-block.ts`
 * (which import the React `FigureBlockNodeView`, and through it `@/lib/storage`)
 * so a React-LIGHT consumer — notably the action registry's `figureRun` /
 * `graphicsRun`, and the node-env / jsdom vitests that import the registry — can
 * pull the fresh-attrs builders WITHOUT dragging the
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
  "  \\centering\n  \\includegraphics[width=0.6\\textwidth]{}";

export interface FreshFigureBlockAttrs {
  extras: string;
  placement: string;
  starred: boolean;
  source: string | null;
  widthPercent: number;
  sources: unknown[];
  label: string;
  /** A figure the USER is authoring gets a caption — that is what the empty
   *  caption row in the chrome is for. (Provenance is only "false" for a
   *  caption-less env read off disk; see `env-body.ts`.) */
  hasCaption: boolean;
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
    hasCaption: true,
    numbered: true,
    figureNumber: null,
    uuid: generateShortId(existing),
  };
}

// NOTE (tasks 318/319): `synthesizeFigureRaw` — this module's second, hand-
// written copy of the serializer's env-body builder — is RETIRED. It had
// already drifted (no `[short]` LoF bracket, so the popover erased task 263's
// byte on a no-op save), and each new declared fact would have had to be
// remembered in two places. Rebuilds now go through the ONE builder,
// `buildFigureEnvBody` in `@/lib/figures/env-body`.

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
