/**
 * "This word must never be flagged" — ONE authority (task 518).
 *
 * A stock English dictionary underlines a large fraction of a philosophy
 * paper: coinages, transliterated Greek, German nouns, and every author's
 * surname. Three things fix that, and the point of this module is that they
 * are three SOURCES of one answer rather than three tests scattered across the
 * checker, the popover and the "add to dictionary" affordance:
 *
 *   - **the paper's own dictionary** (`virgil/dictionary.json`) — terms accepted
 *     in this paper, travelling with it, readable by the user;
 *   - **the global list** — words that are simply the user's, wherever they
 *     write (`localStorage`, cross-window-safe);
 *   - **the bibliography** — every name in an `author` or `editor` field of
 *     `references.bib`. Free, and it removes the single largest source of
 *     false flags without the user typing anything.
 *
 * The base dictionary is NOT one of these. It lives in the worker and answers
 * a question about ENGLISH; this answers a question about the USER, and keeping
 * them apart is what lets a dictionary change re-derive instantly with no
 * worker round trip (and what keeps the worker a pure function of its assets).
 *
 * ## Matching, and the two normalizations
 *
 * Lookup is CASE-INSENSITIVE in both directions — a user who adds `Gricean`
 * means "stop flagging this term", not "stop flagging this capitalization" —
 * and strips ONE trailing possessive (`Grice's`, `Grice’s` → `Grice`), which is
 * the one inflection a proper noun reliably grows in prose. Nothing else is
 * inferred: `Griceans` is a different word and stays flagged until it is added.
 * Guessing plurals would be morphology invented for names the dictionary has
 * never seen.
 *
 * ## Cost class
 *
 * Building the set is O(paper terms + global terms + bibliography names) and
 * happens on a CHANGE EDGE only — a dictionary write, a bib reload, a document
 * switch. `has()` is a `Set` lookup. Nothing here is on the keystroke path.
 */

import type { BibEntry } from "@/lib/types";
import { bibFieldDisplay } from "@/lib/bib-parser";
import { wordsIn } from "@/lib/spell/prose-words";

/** The composed answer. */
export interface AcceptedWords {
  /** True when this word must never be flagged. */
  has(word: string): boolean;
  /** How many distinct normalized terms are accepted (diagnostics/tests). */
  readonly size: number;
}

/** The three sources, kept separate so each can be refreshed on its own edge. */
export interface AcceptedWordSources {
  /** The paper's `dictionary.json` terms. */
  paper?: readonly string[];
  /** The user's global list. */
  global?: readonly string[];
  /** `references.bib`, for the name derivation. */
  bibEntries?: readonly BibEntry[];
}

const POSSESSIVE_RE = /['’]s$/;

/**
 * The lookup key for a word. Exported because the "add to dictionary"
 * affordance must decide whether a term is ALREADY accepted using exactly this
 * rule — a second normalization there is how a term gets added twice and the
 * squiggle stays.
 */
export function acceptedWordKey(word: string): string {
  return word.replace(POSSESSIVE_RE, "").toLocaleLowerCase();
}

/**
 * Every name word in a bibliography's `author` / `editor` fields.
 *
 * Fields are read through `bibFieldDisplay` — the task-409 projection door —
 * so `L{\'o}pez` contributes the accented `ó` that the prose actually says;
 * and split with `wordsIn`, the same rule the prose is tokenized by, so
 * `van der Berg` contributes three accepted words and `O'Brien` one. ALL name
 * words rather than surnames alone: a first name is as likely to appear in
 * prose as a last one, and both are equally not-English.
 *
 * ## The grouping braces are dropped, and that is NOT a renegotiation of 409
 *
 * 409 decided, deliberately, that a bibliography's BibTeX grouping braces
 * SURVIVE its display projection (`L{ó}pez` stays as written), because deciding
 * what a bare `{…}` MEANS needs a vocabulary this codebase has no SSOT for and
 * hand-listing one is the drift its census exists to prevent. That decision is
 * about what a READER sees, and it is untouched here.
 *
 * This is a different question. A brace is not a letter, so `wordsIn` splits on
 * it — `L{ó}pez` would contribute `pez` and never `López`, i.e. the surname the
 * user actually writes would stay flagged while a fragment of it was excused.
 * In an author field a grouping brace has exactly one BibTeX meaning ("keep
 * this together"), so removing it before SPLITTING is a narrow, name-field-only
 * repair rather than a general projection: nothing is rendered from it and no
 * new vocabulary is invented.
 */
export function bibNameWords(entries: readonly BibEntry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    for (const field of ["author", "editor"] as const) {
      const value = bibFieldDisplay(entry, field);
      if (!value) continue;
      out.push(...wordsIn(value.replace(/[{}]/g, "")));
    }
  }
  return out;
}

/** Compose the three sources into one lookup. */
export function buildAcceptedWords(sources: AcceptedWordSources): AcceptedWords {
  const keys = new Set<string>();
  const add = (raw: string) => {
    // A user term may be a phrase ("de re"); index its words, by the same rule
    // the prose is tokenized with, so both halves are accepted.
    for (const w of wordsIn(raw)) keys.add(acceptedWordKey(w));
    // …and the bare normalized form too, so a single term that `wordsIn`
    // rejects (a two-letter acronym the user deliberately added) still counts.
    const bare = acceptedWordKey(raw.trim());
    if (bare) keys.add(bare);
  };
  for (const w of sources.paper ?? []) add(w);
  for (const w of sources.global ?? []) add(w);
  for (const w of bibNameWords(sources.bibEntries ?? [])) keys.add(acceptedWordKey(w));
  return {
    has: (word: string) => keys.has(acceptedWordKey(word)),
    size: keys.size,
  };
}

/** The empty authority — nothing is excused. Used before anything has loaded. */
export const NO_ACCEPTED_WORDS: AcceptedWords = { has: () => false, size: 0 };
