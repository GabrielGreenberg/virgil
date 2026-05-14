"use client";

/**
 * Mounts the drop-mode indicator + confirmation dialog, and registers
 * the per-doc `DropCtx` with the controller. Mount one instance near
 * the layout root (sibling to `<DockOutline/>` and friends) where the
 * `usePoppedCards` and main-editor refs are already available.
 *
 * The component takes:
 *   - `mainEditor` — used so specs can enforce `targetScope: "main-only"`.
 *   - `closePopout` — typically `popped.close` from `usePoppedCards`.
 *
 * The confirm flow uses `useConfirmDialog`, which provides an imperative
 * `confirm(...)` returning `Promise<boolean>`. The promise pipes
 * through `DropCtx.confirm` so spec code stays sync-friendly.
 */

import { useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { useConfirmDialog } from "../ConfirmDialog";
import { setDropCtx } from "./controller";
import { DropModeIndicator } from "./Indicator";
import type { ParagraphAnchorApi } from "./types";

export interface DropModeProviderProps {
  mainEditor: Editor | null;
  closePopout: (cardKey: string) => void;
  notes?: ParagraphAnchorApi;
  highlights?: ParagraphAnchorApi;
  todos?: ParagraphAnchorApi;
  quotations?: ParagraphAnchorApi;
  archive?: ParagraphAnchorApi;
  cutterCards?: ParagraphAnchorApi;
  revisions?: ParagraphAnchorApi;
}

export function DropModeProvider({
  mainEditor,
  closePopout,
  notes,
  highlights,
  todos,
  quotations,
  archive,
  cutterCards,
  revisions,
}: DropModeProviderProps) {
  const { confirm, dialog } = useConfirmDialog();
  // Keep `confirm` accessible to the controller via a ref so the
  // module-level signal doesn't capture a stale closure.
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;

  useEffect(() => {
    setDropCtx({
      mainEditor,
      closePopout,
      confirm: (opts) => confirmRef.current(opts),
      notes,
      highlights,
      todos,
      quotations,
      archive,
      cutterCards,
      revisions,
    });
    return () => {
      setDropCtx(null);
    };
  }, [mainEditor, closePopout, notes, highlights, todos, quotations, archive, cutterCards, revisions]);

  return (
    <>
      <DropModeIndicator />
      {dialog}
    </>
  );
}
