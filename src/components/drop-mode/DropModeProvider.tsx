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
import { InlineAtomGhost } from "./InlineAtomGhost";
import type {
  DropCtx,
  InlineAtomCardApis,
  ParagraphAnchorApi,
  StackPullApi,
} from "./types";

export interface DropModeProviderProps {
  mainEditor: Editor | null;
  closePopout: (cardKey: string) => void;
  /** CHIP-C: persist the `.tex` on a re-anchor commit (the `useDocument`
   *  immediate-flush entry the anchor-mint signal also uses). */
  requestAnchorFlush?: (paragraphId: string) => void;
  notes?: ParagraphAnchorApi;
  highlights?: ParagraphAnchorApi;
  todos?: ParagraphAnchorApi;
  archive?: ParagraphAnchorApi;
  cutterCards?: ParagraphAnchorApi;
  revisions?: ParagraphAnchorApi;
  reports?: ParagraphAnchorApi;
  stack?: StackPullApi;
  /** ONE prop for every inline-atom kind's create-branch accessor, built by
   *  `buildInlineAtomCardApis` (task 233) — not a per-kind prop each new kind
   *  has to remember to add in four places. */
  atomCards?: InlineAtomCardApis;
}

export function DropModeProvider({
  mainEditor,
  closePopout,
  requestAnchorFlush,
  notes,
  highlights,
  todos,
  archive,
  cutterCards,
  revisions,
  reports,
  stack,
  atomCards,
}: DropModeProviderProps) {
  const { confirm, dialog } = useConfirmDialog();

  // Snapshot the live ctx fields every render into a ref. The controller reads
  // them back through `ctxRef.current` (via the getters below), so the
  // registration effect runs exactly ONCE — its deps are `[]`.
  //
  // Why "once" matters: `setDropCtx(null)` CANCELS a live drop session — the
  // atoms-draggable guard that stops the global `user-select:none`, the
  // crosshair cursor, and `data-drop-mode-active` from sticking when the
  // editor unmounts mid-gesture (InlineAtomGrab has no controller mouseup to
  // fall back on). But this provider's props churn on ordinary re-renders:
  // `stack` (`dropStackApi`) is a 7-hook `useMemo` in EditorPane that recreates
  // every render, and a marginalia hover re-renders the whole pane. The old
  // 10-dep effect re-registered on every such churn, firing its cleanup
  // `setDropCtx(null)` mid-drag and killing the gesture for EVERY draggable
  // kind (R5). Running once — values read live through the ref — makes the drag
  // immune to ALL render/memo/hook churn, while a true unmount still cancels.
  const snapshot: DropCtx = {
    mainEditor,
    closePopout,
    requestAnchorFlush,
    confirm,
    notes,
    highlights,
    todos,
    archive,
    cutterCards,
    revisions,
    reports,
    stack,
    atomCards,
  };
  const ctxRef = useRef(snapshot);
  ctxRef.current = snapshot;

  useEffect(() => {
    // A stable ctx object whose getters always resolve to the latest snapshot,
    // so the controller's use-time reads stay fresh — hitTest reads
    // `mainEditor` on every mousemove; commit / applyDrop read the hook bag +
    // `confirm` + `closePopout` at mouseup. This is the freshness the
    // `confirmRef` indirection used to give `confirm` alone, now generalized to
    // every field. `[]` deps ⇒ the cleanup's `setDropCtx(null)` fires only on a
    // real unmount.
    const liveCtx: DropCtx = {
      get mainEditor() {
        return ctxRef.current.mainEditor;
      },
      get closePopout() {
        return ctxRef.current.closePopout;
      },
      get requestAnchorFlush() {
        return ctxRef.current.requestAnchorFlush;
      },
      get confirm() {
        return ctxRef.current.confirm;
      },
      get notes() {
        return ctxRef.current.notes;
      },
      get highlights() {
        return ctxRef.current.highlights;
      },
      get todos() {
        return ctxRef.current.todos;
      },
      get archive() {
        return ctxRef.current.archive;
      },
      get cutterCards() {
        return ctxRef.current.cutterCards;
      },
      get revisions() {
        return ctxRef.current.revisions;
      },
      get reports() {
        return ctxRef.current.reports;
      },
      get stack() {
        return ctxRef.current.stack;
      },
      get atomCards() {
        return ctxRef.current.atomCards;
      },
    };
    setDropCtx(liveCtx);
    return () => {
      setDropCtx(null);
    };
    // Register once; live values flow through `ctxRef`. (No reactive deps — the
    // effect references only the ref and a module import.)
  }, []);

  return (
    <>
      <DropModeIndicator />
      <InlineAtomGhost />
      {dialog}
    </>
  );
}
