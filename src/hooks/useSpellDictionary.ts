/**
 * The PAPER's dictionary (task 518) — `virgil/dictionary.json`.
 *
 * A term accepted in one paper does not leak into another, and the list is a
 * file the user can read and edit: that is the whole reason it is a sidecar
 * rather than a second global list. Declared in `sidecar-value.ts` as
 * `content` tier / `disk` store / `mount: true` — content because it is the
 * user's own writing (a coinage they taught Virgil is not recomputable from
 * anything), disk because a term belongs to the PAPER and every machine that
 * opens it should see the same list, and the write cadence is a non-issue
 * because it changes only on a deliberate "Add to dictionary" click.
 */

import { useMemo } from "react";
import { usePersistentState } from "@/hooks/usePersistentState";

export const SPELL_DICTIONARY_FILE = "dictionary.json";

/** The sidecar's shape. An object rather than a bare array so a later field
 *  (a per-term note, an ignore-here list) has somewhere to go. */
export interface SpellDictionarySidecar {
  words: string[];
}

const EMPTY: SpellDictionarySidecar = { words: [] };

export interface SpellDictionaryHook {
  words: readonly string[];
  /** Add one term. No-op when already present (by the accepted-word key). */
  addWord: (word: string) => void;
  /** Remove one term, matched exactly as stored. */
  removeWord: (word: string) => void;
  loaded: boolean;
}

export function useSpellDictionary(docId: string | null): SpellDictionaryHook {
  const { state, update, loaded } = usePersistentState<SpellDictionarySidecar>(
    docId,
    SPELL_DICTIONARY_FILE,
    EMPTY,
    {
      errorLabel: "spelling dictionary",
      migrate: (raw) => {
        // Tolerate a bare array (a hand-written file, or an older shape).
        if (Array.isArray(raw)) {
          return { words: raw.filter((w): w is string => typeof w === "string") };
        }
        const obj = raw as Partial<SpellDictionarySidecar> | null;
        const words = Array.isArray(obj?.words)
          ? obj.words.filter((w): w is string => typeof w === "string")
          : [];
        return { words };
      },
    },
  );

  return useMemo<SpellDictionaryHook>(
    () => ({
      words: state.words,
      loaded,
      addWord: (word) => {
        const term = word.trim();
        if (!term) return;
        update((prev) =>
          prev.words.includes(term) ? prev : { ...prev, words: [...prev.words, term] },
        );
      },
      removeWord: (word) =>
        update((prev) => ({ ...prev, words: prev.words.filter((w) => w !== word) })),
    }),
    [state.words, loaded, update],
  );
}
