/**
 * An OPEN surface's painted state follows the live editor (task 738).
 *
 * A menu that stays open over the document — the lightning panel keeps itself
 * open so several formats can be applied in one open — paints state it reads
 * from the editor during render: `editor.isActive("bold")`, a row's
 * `applies()`. `editor` is not React state, and TipTap v3's `useEditor` does
 * not re-render per transaction, so without a subscription that paint is a
 * snapshot taken at the panel's last render: click **B** and the word turns
 * bold while the cell stays unlit.
 *
 * This hook is the one door for "re-render me when what I paint changed". The
 * caller supplies a `signature()` — a string built from the SAME reads its
 * render makes — and the hook re-asks it after transactions, at most once per
 * animation frame, re-rendering the caller only when the string differs from
 * the last one it saw. Equal signature → zero renders.
 *
 * Every transaction counts, not only `docChanged` ones: ⌘B at a collapsed caret
 * is a stored-marks transaction that changes no document, and a selection move
 * can change which marks are active.
 *
 * Keystroke sanctity: mount it only in a component that exists only while its
 * surface is OPEN. The handler is O(1) (a pending-RAF check); the RAF body is
 * the caller's `signature()` — O(cells), never a document walk.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

export function useLiveEditorSignature(
  editor: Pick<Editor, "on" | "off"> | null | undefined,
  signature: () => string,
): number {
  const [version, setVersion] = useState(0);
  // Latest-closure ref: written after each render, read only in the RAF.
  const signatureRef = useRef(signature);
  useEffect(() => {
    signatureRef.current = signature;
  });

  useEffect(() => {
    // Test doubles and not-yet-built editors carry no event API.
    if (!editor || typeof editor.on !== "function") return;
    let last: string | null = null;
    try {
      last = signatureRef.current();
    } catch {
      last = null;
    }
    let raf: number | null = null;
    const handler = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        let next: string;
        try {
          next = signatureRef.current();
        } catch {
          return; // a view mid-teardown — the surface is closing anyway
        }
        if (next === last) return;
        last = next;
        setVersion((v) => v + 1);
      });
    };
    editor.on("transaction", handler);
    return () => {
      editor.off("transaction", handler);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [editor]);

  return version;
}
