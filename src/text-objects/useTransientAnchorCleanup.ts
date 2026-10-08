"use client";

/**
 * Strip the transient (cardless) `linkedAnchor` handle behind a plain
 * selection-grab popout once that popout closes.
 *
 * A plain selection grab is gesture input, not an annotation: it stamps an
 * invisible `kind:"transient"` anchor as a range handle (no card, no
 * highlight — see `hydrateSelectionToTextObject` + `linked-anchor-attrs`)
 * and pops out a `linkedRange` float. When that float is dismissed the
 * handle must not linger in the doc.
 *
 * This watches `poppedOutCards` — the single source of truth for what's open
 * — so it catches EVERY close path: the float's own X button (routed through
 * EditorPane), Cmd-W / Escape (EditorLayout), or a programmatic close. When a
 * `linkedRange` float for `<id>` disappears, the handle for `<id>` is removed.
 *
 * Keys are classified through the key grammar's own parser
 * (`parseTextObjectPopoutKey`, dual-read over `float:textobject:…` and the
 * legacy `textobject:…`), never a prefix literal: task 788 — a hard-coded
 * `"textobject:linkedRange:"` prefix outlived the grammar flip to
 * `float:textobject:linkedRange:<id>`, matched nothing, and every closed grab
 * leaked a `\vlid…\vlidend` pair into the user's .tex. Tracking by ID (not
 * key string) also means a grammar re-spelling of the SAME open float is not
 * mistaken for a close. `removeTransientAnchor` is a guarded no-op when the anchor turns
 * out to be a real card anchor (a grab that reused a note's range), so a real
 * annotation is never deleted on close.
 *
 * OWNED PER PANE (task 1000): mounted by every `EditorPane` with ITS editor,
 * never once by the layout with the ACTIVE one. `poppedOutCards` is
 * window-global while the anchor lives in exactly one doc, so an active-editor
 * watcher stripped the wrong doc whenever the popout closed with another pane
 * in front — and then forgot the id, leaking the mark into the owning doc's
 * .tex. Per pane, the owning doc always strips; the rest are guarded no-ops.
 *
 * Keystroke-safe: depends only on the editor instance and the
 * `poppedOutCards` identity — neither changes on a plain keystroke — and does
 * O(closed linkedRange popouts) work, never O(doc), per fire.
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { removeTransientAnchor } from "@/links/links";
import { isRangeKind, parseTextObjectPopoutKey } from "./text-object-registry";

export function useTransientAnchorCleanup(
  editor: Editor | null,
  poppedOutCards: readonly string[],
): void {
  const prevIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const current = new Set<string>();
    for (const key of poppedOutCards) {
      const ref = parseTextObjectPopoutKey(key);
      // Range-ness is asked of the registry (task 743), never spelled.
      if (ref && isRangeKind(ref.kind)) current.add(ref.id);
    }
    const prev = prevIdsRef.current;
    prevIdsRef.current = current;
    if (!editor || editor.isDestroyed) return;
    for (const id of prev) {
      if (current.has(id)) continue;
      removeTransientAnchor(editor, id);
    }
  }, [editor, poppedOutCards]);
}
