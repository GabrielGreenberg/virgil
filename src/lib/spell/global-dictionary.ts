/**
 * The GLOBAL dictionary (task 518) — words that are simply the user's, in
 * every paper.
 *
 * Its sibling, the per-paper `dictionary.json`, is the right home for a term
 * that belongs to ONE argument (a coinage, a transliteration) — it travels
 * with the paper and is a file the user can read. This list is for the words
 * that follow the WRITER rather than the paper ("Gricean", "supervenience"),
 * so it lives in `localStorage` and is shared by every document.
 *
 * Cross-window-safe by the standing law: a module-level snapshot re-hydrates on
 * the native `storage` event through `subscribeToStorageKey` (never a
 * hand-rolled listener — the two guards that contract carries are easy to get
 * subtly wrong), and every write goes through `writeStorageIfChanged` so a peer
 * sync cannot echo into a ping-pong.
 *
 * Cost class: O(list) on a change edge. Nothing reads it per keystroke — the
 * composed `AcceptedWords` set is what the checker consults.
 */

import { useSyncExternalStore } from "react";
import { subscribeToStorageKey, writeStorageIfChanged } from "@/lib/cross-window-storage";

export const GLOBAL_DICTIONARY_KEY = "virgil:spell-dictionary";

let cached: readonly string[] | null = null;
const listeners = new Set<() => void>();

/** Parse + validate — the ONE path, shared by the hydrate and the peer sync. */
function readFromStorage(): readonly string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(GLOBAL_DICTIONARY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Object.freeze(
      parsed.filter((w): w is string => typeof w === "string" && w.trim().length > 0),
    );
  } catch {
    return [];
  }
}

function emit(): void {
  for (const l of listeners) l();
}

/** The current list. Stable by identity until it actually changes. */
export function globalDictionary(): readonly string[] {
  if (!cached) cached = readFromStorage();
  return cached;
}

/** Replace the list (used by the add/remove doors and by tests). */
export function setGlobalDictionary(words: readonly string[]): void {
  const next = Object.freeze([...new Set(words.map((w) => w.trim()).filter(Boolean))]);
  cached = next;
  writeStorageIfChanged(GLOBAL_DICTIONARY_KEY, JSON.stringify(next));
  emit();
}

/** Add one term. No-op when it is already there. */
export function addToGlobalDictionary(word: string): void {
  const term = word.trim();
  if (!term) return;
  const current = globalDictionary();
  if (current.includes(term)) return;
  setGlobalDictionary([...current, term]);
}

/** Test seam: forget the module snapshot so the next read re-hydrates. */
export function __resetGlobalDictionaryForTest(): void {
  cached = null;
  emit();
}

let unsubscribeStorage: (() => void) | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribeStorage) {
    unsubscribeStorage = subscribeToStorageKey(GLOBAL_DICTIONARY_KEY, () => {
      cached = readFromStorage();
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      unsubscribeStorage?.();
      unsubscribeStorage = null;
    }
  };
}

/** React binding. */
export function useGlobalDictionary(): readonly string[] {
  return useSyncExternalStore(subscribe, globalDictionary, () => EMPTY);
}

const EMPTY: readonly string[] = Object.freeze([]);
