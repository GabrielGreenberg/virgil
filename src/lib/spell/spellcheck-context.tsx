"use client";

/**
 * The spellchecker's React seam (task 518).
 *
 * ONE provider per document composes everything the checker needs — the
 * preference, the paper dictionary, the global list, the bibliography — into a
 * single {@link SpellcheckPort} held in a STABLE ref, and every editor surface
 * inside the document reads that same ref. Two properties make this the right
 * shape rather than props threaded through each surface:
 *
 *   - a ref means the extension list a `useEditor` builds ONCE never has to be
 *     rebuilt when a dictionary changes (rebuilding it would remount the
 *     editor);
 *   - a document has exactly one answer to "is this word acceptable here", so a
 *     card body and the paper it sits beside can never disagree — which is the
 *     same reason the accepted-word authority is one module rather than three
 *     tests.
 *
 * Outside a provider the hook answers a ref that stays `null`, which the
 * decoration plugin reads as "not my surface": the Library reader, a
 * standalone `RichTextField`, and every SSR render simply have no checker.
 */

import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import type { BibEntry } from "@/lib/types";
import { buildAcceptedWords, type AcceptedWords } from "@/lib/spell/accepted-words";
import {
  ensureChecked,
  knownSync,
  spellEngineAvailable,
  suggestFor,
} from "@/lib/spell/spell-client";
import { addToGlobalDictionary } from "@/lib/spell/global-dictionary";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

const SpellcheckPortContext = createContext<SpellcheckPortRef | null>(null);

/** What the provider needs from the document it sits inside. */
export interface SpellcheckProviderProps {
  /** The `checkSpelling` view preference. */
  enabled: boolean;
  /** The paper's `dictionary.json` terms. */
  paperWords: readonly string[];
  /** Add a term to the paper's `dictionary.json`. */
  addPaperWord: (word: string) => void;
  /** The user's global list. */
  globalWords: readonly string[];
  /** `references.bib`, for the name derivation. */
  bibEntries: readonly BibEntry[];
  children: ReactNode;
}

export function SpellcheckProvider({
  enabled,
  paperWords,
  addPaperWord,
  globalWords,
  bibEntries,
  children,
}: SpellcheckProviderProps) {
  const accepted: AcceptedWords = useMemo(
    () => buildAcceptedWords({ paper: paperWords, global: globalWords, bibEntries }),
    [paperWords, globalWords, bibEntries],
  );

  // The invalidation channel, as an opaque CHANGE TOKEN derived from exactly
  // the inputs that can change a verdict. The plugin compares it with
  // `Object.is` once per `update` and turns a change into one whole-document
  // re-check; per-block invalidation comes from the transaction itself, so this
  // carries only what a transaction cannot describe.
  //
  // A memoized token rather than an incrementing counter, and the reason is not
  // style: a counter has to be READ out of a ref during render to be bumped,
  // which React's own lint forbids — and the first cut that bumped it from an
  // EFFECT instead never fired at all, because the refs below must ALSO be
  // refreshed during render (the plugin's `update` can run before an effect
  // does, and a stale `enabled` there flashes the browser's underline back on
  // for a frame), so the effect always found them already equal. Measured, that
  // left "Add to dictionary" accepting the word while the squiggle stayed.
  const versionToken = useMemo(() => ({}), [accepted, enabled]);

  // Live mirrors, written (never read) during render so the plugin's next
  // `update` — which may run before any effect — sees the current values.
  const versionRef = useRef<object>(versionToken);
  versionRef.current = versionToken;
  const acceptedRef = useRef(accepted);
  acceptedRef.current = accepted;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const addPaperWordRef = useRef(addPaperWord);
  addPaperWordRef.current = addPaperWord;

  // A STATE cell, not a ref: the port and its cell must be stable for the life
  // of the provider (an extension list built once closes over the cell), and a
  // `useRef(...).current` read during render is exactly what the lint above
  // forbids. The port's own closures read the refs at CALL time, which is
  // where a ref read belongs.
  const [port] = useState<SpellcheckPort>(() => ({
    enabled: () => enabledRef.current && spellEngineAvailable(),
    version: () => versionRef.current,
    isAccepted: (word) => acceptedRef.current.has(word),
    knownSync,
    ensure: ensureChecked,
    suggest: suggestFor,
    // The two ACCEPT doors. They write; the token change that clears the
    // squiggle is the `useMemo` above, fired by the changed word list flowing
    // back in — so a term is never excused before it is persisted, and there is
    // no second path to "this word is fine".
    acceptInPaper: (word) => addPaperWordRef.current(word),
    acceptGlobally: (word) => addToGlobalDictionary(word),
  }));
  const [portRef] = useState<SpellcheckPortRef>(() => ({ current: null }));
  portRef.current = port;

  return (
    <SpellcheckPortContext.Provider value={portRef}>
      {children}
    </SpellcheckPortContext.Provider>
  );
}

/**
 * The port ref for the surface being built. Stable for the life of the
 * component, so it is safe to close over inside a `useEditor` extension list.
 */
export function useSpellcheckPortRef(): SpellcheckPortRef {
  const ctx = useContext(SpellcheckPortContext);
  // A STATE cell rather than `useRef(...).current`, for the reason the
  // provider states: reading `.current` during render is what the lint (and
  // React Compiler) forbid. The cell is stable and stays `null` forever
  // outside a provider, which the plugin reads as "not my surface".
  const [fallback] = useState<SpellcheckPortRef>(() => ({ current: null }));
  return ctx ?? fallback;
}
