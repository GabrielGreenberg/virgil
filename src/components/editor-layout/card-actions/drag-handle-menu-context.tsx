"use client";

/**
 * React context exposing the "open drag-handle action menu" entry point.
 * Set by EditorPane (which owns the single menu's open/close state and
 * the dispatch logic). Consumed by every drag-handle host:
 *
 *  - TextObjectGrabHandle (the unified main-editor grip; live selection
 *    + every persistent TextObject kind go through this).
 *  - Float-internal handles (the per-kind float bodies re-use the menu
 *    when the user clicks the float's own grip).
 *
 * The menu's `open(ref, anchorRect)` takes the same `TextObjectRef |
 * SelectionRef` union the dispatcher consumes, so the call sites don't
 * need a translation layer.
 */

import { createContext, useContext } from "react";
import type { DragHandleRef } from "./drag-handle-actions";
import type { DragHandleAction } from "@/components/DragHandleMenu";

export interface DragHandleMenuApi {
  /** Open the action menu anchored to a handle. The caller passes the
   *  handle's bounding rect (for positioning) and the ref describing
   *  what the menu should act on (a TextObject or a live selection). */
  open: (ref: DragHandleRef, anchorRect: DOMRect) => void;
  /** Run a ref action directly without opening the menu first.
   *  Used by SelectionActionsMenu (which renders its own button row and
   *  doesn't need the popover step). */
  dispatch: (action: DragHandleAction, ref: DragHandleRef) => void;
}

const DragHandleMenuContext = createContext<DragHandleMenuApi | null>(null);

export const DragHandleMenuProvider = DragHandleMenuContext.Provider;

export function useDragHandleMenu(): DragHandleMenuApi | null {
  return useContext(DragHandleMenuContext);
}
