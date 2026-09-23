/**
 * Task 724 — the TWO contracts a card body hands its host, expressed ONCE.
 *
 * A card component tells its host two things: *"I was activated"* and *"jump to
 * me, here is my element."* Both were free-form props that each of fifteen
 * registrations in `./index.tsx` re-spelled by hand, and five of them re-derived
 * what the card had already decided:
 *
 *   - four handed `useAnchoredCard.onBodyActivate` a TOGGLING select
 *     (`isSelected ? null : id`). That composition is monotonic by
 *     construction — it `store.select(ref)`s first and mirrors the host slot
 *     after — so the toggle reached into the one selection authority and undid
 *     the select that had run three lines earlier: every other click of a
 *     popped-out card dropped its halo, and every third click re-scrolled the
 *     document. `body-activate-composition.test.tsx` already forbade it; the
 *     test only ever saw a synthetic host.
 *   - one dropped the element the card resolved for it, which is not cosmetic:
 *     `scrollToExample` WITH a source element aligns the block only if needed,
 *     and WITHOUT one focuses the main editor, plants the caret in the block
 *     and scrolls unconditionally.
 *
 * The fix is not five careful edits — the surgical version of the second one
 * has already been performed once (EX-F3-03 fixed the omni path and the float
 * was not). It is to make FORWARDING the only thing a registration can spell:
 *
 *   - `selectMirror(slot, id)` takes the panel's selection setter through a
 *     parameter type that has no `null` in it, so the toggling form does not
 *     compile; and
 *   - `editorJump(ref, door, id)` names the DOOR and the ID and never the
 *     element, so the element cannot be dropped on the way through.
 *
 * The census (`cards/__tests__/float-body-contract-census.test.ts`) reads the
 * real registration table and keeps both shapes retired.
 */

import type { RefObject } from "react";
import type { EditorHandle } from "@/components/Editor";

/**
 * A panel's selection slot as a card BODY may see it. The real setters are
 * `Dispatch<SetStateAction<string | null>>` — they legitimately clear, from
 * click-away and from the store's own null branch — but a body click is the one
 * caller that may never say `null`, so it holds the setter through this
 * narrowed end. Passing `null` is a type error rather than folklore.
 */
export type SelectSlot = (id: string) => void;

/**
 * The MONOTONIC select mirror (C15). `onBodyActivate` selects in the store and
 * then invokes this as the per-panel mirror; it can only ever agree.
 */
export function selectMirror(slot: SelectSlot, id: string): () => void {
  return () => {
    slot(id);
  };
}

/**
 * Every `EditorHandle` door of the by-id jump shape `(id, sourceEl?) => void` —
 * DERIVED from the handle rather than hand-listed, so a new one is reachable
 * here the day it is declared and a changed signature stops compiling.
 * (`jumpToCard` takes a card, not an id, and is correctly absent.)
 */
export type IdJumpDoor = {
  [K in keyof EditorHandle]-?: EditorHandle[K] extends (
    id: string,
    sourceEl?: HTMLElement | null,
  ) => void
    ? K
    : never;
}[keyof EditorHandle];

/**
 * The JUMP contract: forward the element the card resolved into a by-id editor
 * door. The registration names the door and the id; the element is threaded
 * HERE, in the one place, so no registration can discard it.
 */
export function editorJump(
  editorRef: RefObject<EditorHandle | null>,
  door: IdJumpDoor,
  id: string,
): (sourceEl: HTMLElement | null) => void {
  return (sourceEl) => {
    editorRef.current?.[door](id, sourceEl);
  };
}
