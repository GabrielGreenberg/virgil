/**
 * Where the dictionary lives (task 518).
 *
 * The Hunspell pair is VENDORED into `public/dictionaries/en/` by
 * `tools/sync-dictionary.mjs` rather than imported from `dictionary-en`,
 * because that package's entry reads its files with `node:fs` and is therefore
 * not loadable in a browser at all. Two consequences follow, and both of them
 * are the reason this module exists rather than two string literals at the
 * fetch site:
 *
 *   - every reader must go through `publicAssetUrl` (task 365's door), or the
 *     fetch escapes to the origin root under a subdirectory deploy and 404s
 *     silently — the exact class that shipped for the vendored PDF viewer;
 *   - the service worker must precache them by the SAME paths, or the
 *     spellchecker is the one part of the app that stops working offline.
 *     `sw.js` cannot import TypeScript, so it restates the paths and
 *     `dictionary-asset.test.ts` pins the two spellings against each other.
 *
 * The dictionary is US English (`dictionary-en@4` — `color`, `center`, no
 * `colour`), which is the resolved default. A British variant is a different
 * package (`dictionary-en-gb`) vendored the same way; nothing else here would
 * change.
 */

import { publicAssetUrl } from "@/lib/public-asset-url";

/**
 * Paths WITHIN `public/`, scope-relative — the form `sw.js` needs (a leading
 * slash there would discard the SW's own scope and escape to the origin root).
 */
export const DICTIONARY_ASSET_PATHS = Object.freeze({
  aff: "dictionaries/en/index.aff",
  dic: "dictionaries/en/index.dic",
});

/** Deploy-correct URLs for the two files. */
export function dictionaryAssetUrls(): { aff: string; dic: string } {
  return {
    aff: publicAssetUrl(DICTIONARY_ASSET_PATHS.aff),
    dic: publicAssetUrl(DICTIONARY_ASSET_PATHS.dic),
  };
}
