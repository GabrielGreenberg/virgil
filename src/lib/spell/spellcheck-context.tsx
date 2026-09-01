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

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import type { BibEntry } from "@/lib/types";
import {
  buildAcceptedWords,
  NO_ACCEPTED_WORDS,
  type AcceptedWords,
} from "@/lib/spell/accepted-words";
import {
  ensureChecked,
  knownSync,
  spellEngineAvailable,
} from "@/lib/spell/spell-client";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

const SpellcheckPortContext = createContext<SpellcheckPortRef | null>(null);

/** What the provider needs from the document it sits inside. */
export interface SpellcheckProviderProps {
  /** The `checkSpelling` view preference. */
  enabled: boolean;
  /** The paper's `dictionary.json` terms. */
  paperWords: readonly string[];
  /** The user's global list. */
  globalWords: readonly string[];
  /** `references.bib`, for the name derivation. */
  bibEntries: readonly BibEntry[];
  children: ReactNode;
}

export function SpellcheckProvider({
  enabled,
  paperWords,
  globalWords,
  bibEntries,
  children,
}: SpellcheckProviderProps) {
  const accepted: AcceptedWords = useMemo(
    () => buildAcceptedWords({ paper: paperWords, global: globalWords, bibEntries }),
    [paperWords, globalWords, bibEntries],
  );

  // The invalidation channel. Bumped whenever a VERDICT could have changed for
  // a reason no transaction describes — which is exactly the set of inputs
  // above. The plugin reads it once per `update` (an integer compare) and turns
  // a bump into one whole-document re-check.
  const versionRef = useRef(0);
  const acceptedRef = useRef(accepted);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    if (acceptedRef.current !== accepted || enabledRef.current !== enabled) {
      acceptedRef.current = accepted;
      enabledRef.current = enabled;
      versionRef.current += 1;
    }
  }, [accepted, enabled]);
  // Keep the refs usable on the very first render too (the effect runs after
  // the plugin's first `update`, and a stale `enabled` there would flash the
  // browser's underline back on).
  acceptedRef.current = accepted;
  enabledRef.current = enabled;

  const portRef = useRef<SpellcheckPortRef>({ current: null }).current;
  if (!portRef.current) {
    const port: SpellcheckPort = {
      enabled: () => enabledRef.current && spellEngineAvailable(),
      version: () => versionRef.current,
      isAccepted: (word) => acceptedRef.current.has(word),
      knownSync,
      ensure: ensureChecked,
    };
    portRef.current = port;
  }

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
  const fallback = useRef<SpellcheckPortRef>({ current: null }).current;
  return ctx ?? fallback;
}

/** The composed accepted-word set — for the "Add to dictionary" affordance,
 *  which must decide "is this already accepted?" by exactly the checker's own
 *  rule. Answers the empty authority outside a provider. */
export function useAcceptedWords(): AcceptedWords {
  const ref = useContext(SpellcheckPortContext);
  const port = ref?.current;
  return useMemo<AcceptedWords>(
    () =>
      port
        ? { has: (w) => port.isAccepted(w), size: 0 }
        : NO_ACCEPTED_WORDS,
    [port],
  );
}
