"use client";

/**
 * React context exposing the "open drag-handle action menu" entry point.
 * Set by EditorPane (which owns the single menu's open/close state and
 * the dispatch logic). Consumed by every drag-handle host:
 *
 *  - ParagraphFloat, SelectionFloat, HeadingFloat (React drag handles
 *    inside the floats).
 *  - SelectionDragHandle (live-selection handle portaled to body).
 *
 * Editor.tsx's imperative paragraph/heading drag handles can't read this
 * context directly — they receive an `onDragHandleClickRef` prop that
 * EditorPane points at the same handler.
 */

import { createContext, useContext } from "react";
import type { DragHandlePassage } from "./drag-handle-actions";
import type { DragHandleAction } from "@/components/DragHandleMenu";

export interface DragHandleMenuApi {
  /** Open the action menu anchored to a handle. The caller passes the
   *  handle's bounding rect (for positioning) and a Passage describing
   *  what the menu should act on. */
  open: (passage: DragHandlePassage, anchorRect: DOMRect) => void;
  /** Run a passage action directly without opening the menu first.
   *  Used by SelectionActionsMenu (which renders its own button row and
   *  doesn't need the popover step). */
  dispatch: (action: DragHandleAction, passage: DragHandlePassage) => void;
}

const DragHandleMenuContext = createContext<DragHandleMenuApi | null>(null);

export const DragHandleMenuProvider = DragHandleMenuContext.Provider;

export function useDragHandleMenu(): DragHandleMenuApi | null {
  return useContext(DragHandleMenuContext);
}
