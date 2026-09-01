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
 * `version()` is the invalidation channel: it bumps when anything that could
 * change a VERDICT changes — the preference, the paper dictionary, the global
 * list, the bibliography — and a bump means "re-check the whole document".
 * Per-block invalidation comes from the transaction itself, so this counter
 * only ever carries the changes a transaction cannot describe.
 */

export interface SpellcheckPort {
  /** Should Virgil check this document at all? (preference AND engine health) */
  enabled(): boolean;
  /** Bumps when a verdict could have changed for reasons no transaction shows. */
  version(): number;
  /** The user's own words — never flagged. */
  isAccepted(word: string): boolean;
  /** Cached dictionary verdict; `undefined` = not asked yet. */
  knownSync(word: string): boolean | undefined;
  /** Warm the cache for these words. */
  ensure(words: readonly string[]): Promise<void>;
}

/** A ref cell holding the live port (or `null` before/outside a provider). */
export interface SpellcheckPortRef {
  current: SpellcheckPort | null;
}
