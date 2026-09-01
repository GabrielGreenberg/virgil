/**
 * `nspell` ships no types (task 518). This is the surface Virgil uses, and
 * nothing more: a constructor over the two Hunspell files plus the two
 * questions the checker asks.
 */
declare module "nspell" {
  interface NSpellInstance {
    /** Is this word spelled correctly (case forms included)? */
    correct(word: string): boolean;
    /** Ranked alternatives for a misspelling. Expensive — never per keystroke. */
    suggest(word: string): string[];
    /** Teach the instance one extra word. */
    add(word: string, model?: string): NSpellInstance;
  }
  function nspell(aff: string, dic: string): NSpellInstance;
  export = nspell;
}
