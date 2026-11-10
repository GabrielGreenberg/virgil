/**
 * The leading glyphs of the Virgil bar's ⋯ menu (Gabriel, 2026-11-10: "add
 * icons to this menu"). One 14px outlined glyph per row, lucide-drawn on a 24
 * grid, stroke-only and `currentColor`; the line weight is the stylesheet's
 * ("One line weight"), not the number here. Decorative: a row's accessible name
 * is its label, so every glyph is `aria-hidden`.
 *
 * Gabriel's follow-up: the old bar icons are the basis, held to the current
 * standards. So most glyphs are the pre-sand-bar bar's own (task 1e5ff74
 * folded the bar's tools into ⋯), outlined where they were solid; rows that
 * had no glyph (Zen, Style, Commands, Text) are drawn to match.
 *
 * A runtime LEAF, like the other icons in this folder.
 */

import type { ReactNode } from "react";
import { ICON_STROKE } from "./icon-stroke";

export type MenuGlyphName =
  | "compile"
  | "ai-requests"
  | "style"
  | "print"
  | "zen"
  | "timer"
  | "collab"
  | "commands"
  | "refresh"
  | "helper"
  | "preferences"
  | "bug"
  | "toolbar"
  | "toolbar-show"
  | "view-text"
  | "view-code"
  | "view-pdf";

const PATHS: Record<MenuGlyphName, ReactNode> = {
  // The old bar's play triangle, as an outline (it was filled).
  compile: <path d="M7 4.5v15a.8.8 0 0 0 1.2.7l12-7.5a.8.8 0 0 0 0-1.4l-12-7.5A.8.8 0 0 0 7 4.5Z" />,
  "ai-requests": (
    // The bar's own AI-requests sun-star, so the folded row matches the button.
    <g transform="rotate(15 12 12)">
      <path d="M12 3v18M3 12h18M5.64 5.64l12.72 12.72M18.36 5.64 5.64 18.36" />
    </g>
  ),
  style: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </>
  ),
  // An open ensō: the old bar's Zen was a word, and a moon reads as dark mode.
  zen: <path d="M19.4 9A8 8 0 1 1 15 4.6" />,
  timer: (
    // The old bar's tomato clock: a round face with a leaf.
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 10v3.5l2.4 1.6" />
      <path d="M8.6 4.6c1.4-.9 3-.9 3.4.4.4-1.3 2-1.3 3.4-.4" />
    </>
  ),
  collab: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  commands: (
    <>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </>
  ),
  refresh: (
    // The row's own folder-with-download glyph from before, on the 24 grid.
    <>
      <path d="M3 7.8V18a1.8 1.8 0 0 0 1.8 1.8h14.4A1.8 1.8 0 0 0 21 18V9.3a1.8 1.8 0 0 0-1.8-1.8h-8.1L9 4.8H4.8A1.8 1.8 0 0 0 3 6.6Z" />
      <path d="M12 10.8v5.1M9.6 13.8 12 16.2l2.4-2.4" />
    </>
  ),
  helper: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </>
  ),
  preferences: (
    // The old bar's painter's palette, as an outline (it was a solid
    // silhouette). The wells stay solid: the dot IS the mark.
    <>
      <path d="M12 3a9 9 0 0 0 0 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7h2.1c2.6 0 4.5-2 4.5-4.6C21 6.6 17 3 12 3Z" />
      <circle cx="7.5" cy="11.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="17" cy="11.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  bug: (
    <>
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </>
  ),
  toolbar: (
    // The old collapse chip's double chevron, pointing away: hide.
    <>
      <path d="m13 17 5-5-5-5" />
      <path d="m6 17 5-5-5-5" />
    </>
  ),
  // …and pointing back: show.
  "toolbar-show": (
    <>
      <path d="M11 17 6 12l5-5" />
      <path d="m18 17-5-5 5-5" />
    </>
  ),
  // The folded View rows (only while the bar's tools sit in ⋯). Code and PDF
  // are the old bar's glyphs; Text is drawn as their sibling.
  "view-text": <path d="M4 6h16M4 10h16M4 14h16M4 18h10" />,
  "view-code": (
    <>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
      <path d="m14.5 4-5 16" />
    </>
  ),
  "view-pdf": (
    <>
      <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
};

export function MenuGlyph({ name }: { name: MenuGlyphName }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-ink-muted"
      data-menu-glyph={name}
    >
      {PATHS[name]}
    </svg>
  );
}
