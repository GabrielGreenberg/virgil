/**
 * The open suggestion menu (task 518) — a gesture-scoped module singleton.
 *
 * Exactly one spelling menu is open at a time, app-wide, so this is the
 * category `AGENTS.md` sanctions for a module singleton (`card-lift`,
 * `dock-drag`, `drag-ghost`): a value that is genuinely app-global, not a
 * per-document fact wearing a global's clothes. What makes it safe is that the
 * REQUEST carries everything the menu needs — the word, its range, the view to
 * edit, and the PORT that owns this document's dictionaries — so the renderer
 * needs no per-document context and can be mounted ONCE at the app root, above
 * the N keep-alive panes that each have a dictionary of their own.
 *
 * (Holding an `EditorView` here is the same shape the lift/drop singletons
 * already hold: it lives only for the gesture, and `closeSpellMenu` runs on the
 * menu's own dismissal, on a replacement request, and on the plugin's destroy.)
 */

import { useSyncExternalStore } from "react";
import type { EditorView } from "@tiptap/pm/view";
import type { SpellcheckPort } from "@/lib/spell/spell-port";

export interface SpellMenuRequest {
  /** The flagged word, exactly as it appears in the document. */
  word: string;
  /** Its document range in `view`. */
  from: number;
  to: number;
  /** Viewport rect of the word, for anchoring. */
  rect: DOMRect;
  view: EditorView;
  /** The document's own dictionaries + the shared engine. */
  port: SpellcheckPort;
}

let request: SpellMenuRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function openSpellMenu(next: SpellMenuRequest): void {
  request = next;
  emit();
}

/** Close, optionally only if the open request belongs to `view`. */
export function closeSpellMenu(view?: EditorView): void {
  if (!request) return;
  if (view && request.view !== view) return;
  request = null;
  emit();
}

export function spellMenuRequest(): SpellMenuRequest | null {
  return request;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSpellMenuRequest(): SpellMenuRequest | null {
  return useSyncExternalStore(subscribe, spellMenuRequest, () => null);
}
