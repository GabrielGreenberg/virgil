"use client";

import { FONT_SERIF } from "@/lib/font-stacks";

interface Props {
  dragActive: boolean;
  children: React.ReactNode;
}

/** Visual-only drop affordance. Drag/drop *handling* lives at the window
 *  level in LibraryView so a drop anywhere in the app — not just within
 *  this region — gets ingested. This component renders the dashed outline
 *  and overlay text whenever a file is being dragged over the window. */
export default function DropZone({ dragActive, children }: Props) {
  return (
    <div
      style={{
        position: "relative",
        // Fill the remaining height in a flex-column parent without
        // pushing past it — `height: 100%` would ignore sibling space and
        // force the page to scroll instead of the right detail pane.
        flex: 1,
        minHeight: 0,
        outline: dragActive ? "3px dashed var(--accent)" : "none",
        outlineOffset: -8,
        borderRadius: "var(--radius-sm)",
      }}
    >
      {children}
      {dragActive && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(124, 94, 60, 0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontSize: 18,
            color: "var(--accent)",
            fontFamily: FONT_SERIF,
          }}
        >
          Drop PDF, Word, .tex, or .bib files to add to the library
        </div>
      )}
    </div>
  );
}
