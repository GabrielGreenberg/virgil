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
 * `textobject:linkedRange:<id>` key disappears, the handle for `<id>` is
 * removed. `removeTransientAnchor` is a guarded no-op when the anchor turns
 * out to be a real card anchor (a grab that reused a note's range), so a real
 * annotation is never deleted on close.
 *
 * Keystroke-safe: depends only on the editor instance and the
 * `poppedOutCards` identity — neither changes on a plain keystroke — and does
 * O(closed linkedRange popouts) work, never O(doc), per fire.
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { removeTransientAnchor } from "@/links/links";

const LINKED_RANGE_KEY_PREFIX = "textobject:linkedRange:";

export function useTransientAnchorCleanup(
  editor: Editor | null,
  poppedOutCards: readonly string[],
): void {
  const prevKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const current = new Set<string>();
    for (const key of poppedOutCards) {
      if (key.startsWith(LINKED_RANGE_KEY_PREFIX)) current.add(key);
    }
    const prev = prevKeysRef.current;
    prevKeysRef.current = current;
    if (!editor || editor.isDestroyed) return;
    for (const key of prev) {
      if (current.has(key)) continue;
      removeTransientAnchor(editor, key.slice(LINKED_RANGE_KEY_PREFIX.length));
    }
  }, [editor, poppedOutCards]);
}
