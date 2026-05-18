"use client";

/**
 * Module-scope store for the inline `\`-command popup. The ProseMirror
 * plugin owns the canonical state (see slash-popup.ts) and mirrors it
 * here on every transaction. The popup React component subscribes via
 * `useSlashPopupState()` and re-renders.
 *
 * Same shape as anchored-card-store.ts — `useSyncExternalStore` keeps
 * us dependency-free and works across portals / popped-out surfaces.
 */

import { useSyncExternalStore } from "react";

export type SlashPopupState =
  | { open: false }
  | {
      open: true;
      slashPos: number;
      query: string;
      selectedIndex: number;
      filtered: string[];
    };

let _state: SlashPopupState = { open: false };
const _listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function emit(): void {
  for (const fn of _listeners) fn();
}

export const slashPopupStore = {
  getState: (): SlashPopupState => _state,
  set(next: SlashPopupState): void {
    if (statesEqual(_state, next)) return;
    _state = next;
    emit();
  },
  subscribe,
};

function statesEqual(a: SlashPopupState, b: SlashPopupState): boolean {
  if (a.open !== b.open) return false;
  if (!a.open || !b.open) return true;
  if (a.slashPos !== b.slashPos) return false;
  if (a.query !== b.query) return false;
  if (a.selectedIndex !== b.selectedIndex) return false;
  if (a.filtered.length !== b.filtered.length) return false;
  for (let i = 0; i < a.filtered.length; i++) {
    if (a.filtered[i] !== b.filtered[i]) return false;
  }
  return true;
}

const getServerSnapshot = () => ({ open: false }) as SlashPopupState;

export function useSlashPopupState(): SlashPopupState {
  return useSyncExternalStore(subscribe, slashPopupStore.getState, getServerSnapshot);
}
