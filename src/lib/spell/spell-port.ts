/**
 * The seam between the CHECKER and the SURFACE (task 518).
 *
 * The decoration plugin is a plain ProseMirror plugin mounted on two editor
 * stacks; everything it needs from React — the preference, the composed
 * accepted-word set, the dictionary cache — reaches it through this one
 * interface, held in a ref. That is what keeps the plugin free of React and
 * free of the module singletons, so a test can drive it against a hand-built
 * port with a five-word dictionary.
 *
 * `version()` is the invalidation channel: it CHANGES when anything that could
 * change a VERDICT changes — the preference, the paper dictionary, the global
 * list, the bibliography — and a change means "re-check the whole document".
 * Per-block invalidation comes from the transaction itself, so this token only
 * ever carries the changes a transaction cannot describe.
 */

export interface SpellcheckPort {
  /** Should Virgil check this document at all? (preference AND engine health) */
  enabled(): boolean;
  /**
   * Should Virgil CORRECT an unambiguous typo as the user finishes it (task
   * 519)? Its own preference row, independent of `enabled` — a user may want
   * the underline without the rewriting, or the rewriting without the
   * underline — and it rides this port rather than a second provider because a
   * document has exactly one answer to every question about WORDS, and the
   * corrector asks two of them the checker already owns (`isAccepted`, and
   * what a word is).
   *
   * The engine is deliberately NOT consulted: the curated table is a module
   * constant, so autocorrect works with no dictionary loaded at all.
   */
  autocorrect(): boolean;
  /**
   * An opaque CHANGE TOKEN, compared with `Object.is`. It becomes a NEW value
   * whenever a verdict could have changed for a reason no transaction
   * describes — the preference, the paper dictionary, the global list, the
   * bibliography — and a change means "re-check the whole document".
   *
   * A token rather than a counter because the provider derives it with a
   * `useMemo` over exactly those inputs: an incrementing number would have to
   * be read out of a ref during render, which is precisely the thing React's
   * own lint forbids, and the consumer never wanted the ORDER anyway.
   */
  version(): unknown;
  /** The user's own words — never flagged. */
  isAccepted(word: string): boolean;
  /** Cached dictionary verdict; `undefined` = not asked yet. */
  knownSync(word: string): boolean | undefined;
  /** Warm the cache for these words. */
  ensure(words: readonly string[]): Promise<void>;
  /**
   * Ranked alternatives for a flagged word. A whole-dictionary edit-distance
   * search, so it runs ONLY on a user gesture — never while typing. That
   * asymmetry with `knownSync` (a table lookup) is the performance design.
   */
  suggest(word: string): Promise<string[]>;
  /** Accept this word for THIS PAPER (writes `dictionary.json`). */
  acceptInPaper(word: string): void;
  /** Accept this word EVERYWHERE (writes the global list). */
  acceptGlobally(word: string): void;
}

/** A ref cell holding the live port (or `null` before/outside a provider). */
export interface SpellcheckPortRef {
  current: SpellcheckPort | null;
}
