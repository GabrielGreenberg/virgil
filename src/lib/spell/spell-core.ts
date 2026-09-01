/**
 * The LANGUAGE half of the spellchecker (task 518) — pure, and the only thing
 * that knows what English is.
 *
 * Two questions, one engine:
 *
 *   - `isKnown(word)` — a table lookup, asked of every checkable token in a
 *     changed paragraph;
 *   - `suggest(word)` — an edit-distance search over the whole dictionary,
 *     asked ONLY when the user clicks a squiggle. That asymmetry is the
 *     performance design: checking is cheap enough to run on every touched
 *     block, suggesting is not, so it never runs unbidden.
 *
 * The engine deliberately knows NOTHING about the user's own words. The paper
 * dictionary, the global list and the bibliography names are composed on the
 * main thread by `accepted-words.ts`, so a dictionary change re-derives with no
 * round trip to the worker and this module stays a pure function of the two
 * vendored assets — which is what makes it testable from a five-line inline
 * dictionary rather than from a 550 KB one.
 *
 * ## Case, and why it is nspell's business rather than ours
 *
 * Hunspell's `.dic` encodes which words may be capitalized and which may not,
 * and nspell implements that. So `isKnown` hands the token over VERBATIM: a
 * pre-lowercased lookup would accept `english` and a pre-capitalized one would
 * accept `Teh`.
 */

import nspell from "nspell";

/** The two Hunspell files, as text. */
export interface DictionaryText {
  aff: string;
  dic: string;
}

/** What the checker asks of a language. */
export interface SpellEngine {
  isKnown(word: string): boolean;
  suggest(word: string): string[];
}

/** Build an engine over one Hunspell pair. Throws on an unparseable `.aff`. */
export function createSpellEngine(dict: DictionaryText): SpellEngine {
  const inst = nspell(dict.aff, dict.dic);
  return {
    isKnown: (word: string) => {
      try {
        return inst.correct(word);
      } catch {
        // A token nspell's affix machinery chokes on is not evidence of a
        // misspelling. Fail toward NOT flagging — a missed typo is the status
        // quo, a false squiggle on legitimate prose is the thing this whole
        // feature is trying not to be.
        return true;
      }
    },
    suggest: (word: string) => {
      try {
        return inst.suggest(word);
      } catch {
        return [];
      }
    },
  };
}

/**
 * Fetch the vendored pair. Used by the worker and by the main-thread fallback;
 * both go through `dictionaryAssetUrls`, so neither can build the path itself.
 */
export async function fetchDictionaryText(urls: {
  aff: string;
  dic: string;
}): Promise<DictionaryText> {
  const [affResp, dicResp] = await Promise.all([fetch(urls.aff), fetch(urls.dic)]);
  if (!affResp.ok || !dicResp.ok) {
    throw new Error(
      `dictionary fetch failed (aff ${affResp.status}, dic ${dicResp.status})`,
    );
  }
  const [aff, dic] = await Promise.all([affResp.text(), dicResp.text()]);
  return { aff, dic };
}
