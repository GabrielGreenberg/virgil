"use client";

/**
 * InlineAtomGhost — the translucent copy of an inline Atom that floats with
 * the cursor during an `InlineAtomGrab` drag. The inline cousin of
 * `<LiftedTextOverlay>` (the block-lift ghost), minus the header / popout
 * mode: an atom is tiny, and its "float" is its Card — a separate thing.
 *
 * `InlineAtomGrab` is a ProseMirror plugin (not React), so it can't drive
 * this overlay directly; it writes the `inline-atom-ghost` module store and
 * this component subscribes — the same producer/subscriber split the
 * drop-mode `Indicator` uses (controller ← plugin, Indicator → portal).
 *
 * Gated on BOTH the ghost store AND the live `useDropSession()`: only
 * `InlineAtomGrab` writes the ghost store and always pairs it with an
 * `atom-grab:` session, so a non-null ghost already implies an atom drag.
 * The extra `session` gate closes the Esc→mouseup window — Escape ends the
 * session (controller) while the plugin's listeners persist until the
 * trailing mouseup, so without it the ghost would linger after the blue bar
 * has already vanished. With it, the ghost disappears in the same tick as
 * the bar.
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useDropSession } from "./controller";
import { useInlineAtomGhost } from "./inline-atom-ghost";

export function InlineAtomGhost() {
  const ghost = useInlineAtomGhost();
  const session = useDropSession();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const el = ghost?.el ?? null;

  // The clone is an HTMLElement, not a React tree — attach it directly via a
  // ref rather than dangerouslySetInnerHTML (a string round-trip would mangle
  // inline-math's KaTeX MathML subtree). Keyed on the clone identity, which is
  // stable across cursor updates, so a mousemove never re-appends.
  useEffect(() => {
    const host = bodyRef.current;
    if (!host || !el) return;
    if (!host.contains(el)) {
      while (host.firstChild) host.removeChild(host.firstChild);
      host.appendChild(el);
    }
  }, [el]);

  if (typeof document === "undefined") return null;
  if (!ghost || !session) return null;

  // Displace the ghost off the cursor so it never covers the insert point (the
  // cursor and the blue inline bar share the same spot). Default above the
  // cursor; flip below when the cursor is near the viewport top so the ghost
  // can't clip off-screen. translateY's % resolves against the ghost's own
  // content-sized height, so no measurement is needed. (grabOffsetX still pins
  // it horizontally near where the atom was grabbed.)
  const GHOST_GAP = 14;
  const ghostTransform =
    ghost.cursorY < 60
      ? `translateY(${GHOST_GAP}px)`
      : `translateY(calc(-100% - ${GHOST_GAP}px))`;

  return createPortal(
    <div
      ref={bodyRef}
      // `tiptap` re-establishes the editor's content scope so the atom's
      // class-based styling (and global KaTeX CSS) resolves on the clone even
      // though the portal lives outside `.tiptap`'s ancestor chain — same
      // reasoning as LiftedTextOverlay's `.tiptap`-wrapped body.
      className="inline-atom-ghost tiptap"
      aria-hidden="true"
      style={{
        position: "fixed",
        left: ghost.cursorX - ghost.grabOffsetX,
        top: ghost.cursorY,
        transform: ghostTransform,
      }}
    />,
    document.body,
  );
}
