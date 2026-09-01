/**
 * AUTOCORRECT — a small CURATED table of unambiguous word typos, applied at
 * type time (task 519; phase 3 of 3 of the spellchecker program).
 *
 * ## What this is NOT, and the reason is the whole design
 *
 * It is **not** dictionary-driven "closest word" replacement. A spellchecker
 * that silently swapped a flagged word for its nearest neighbour would rewrite
 * the user's own vocabulary — a technical term, a surname, a coinage — with no
 * reverse map and no signal that anything happened, which is exactly what the
 * write-path doctrine ("no automatic write may lose content", AGENTS.md) is
 * against. Everything Virgil is unsure about gets a SQUIGGLE (task 518) and a
 * gesture; only what a human has declared unambiguous is rewritten unasked.
 *
 * It is also **words only**. No auto-capitalisation, no punctuation insertion,
 * nothing sentence-level: one word in, one word out, with whatever punctuation
 * the user typed around it carried through UNTOUCHED. That is a property of
 * the table's shape rather than a rule someone must remember — a row is two
 * words, so a row that inserted a space or a full stop is unwritable.
 *
 * ## The table is the SSOT; the rule is derived
 *
 * ONE `InputRule` is built from `AUTOCORRECT_TABLE`, so an addition is one row
 * and nothing else. And "unambiguous" is CHECKABLE rather than asserted:
 * `autocorrect-table.test.ts` runs every row past the app's own shipped
 * Hunspell dictionary and fails a `wrong` the dictionary ACCEPTS (i.e. a real
 * word someone thought was a typo) or a `right` it REJECTS. That leg is what
 * makes the list safe to grow.
 *
 * ## Case
 *
 * Two spellings per row, DERIVED: the lower-case form, and the Title-case form
 * for a word at the start of a sentence. Nothing else — an ALL-CAPS token is
 * skipped, the same call `isCheckableWord` makes for the checker (academic
 * prose is dense with acronyms), and a mixed-case `tEh` is left alone because
 * we cannot say what the user meant. The replacement never CHANGES a word's
 * case: `teh.` at the start of a sentence becomes `the.`, not `The.`.
 *
 * ## Where it declines
 *
 * - Every byte-literal container and `code` mark — TipTap's own input-rule
 *   gate, inherited by riding the same plugin (see `smart-quotes.ts`).
 * - Every raw-LaTeX run, settled or in flight — `typedTextIsProse`, which is
 *   this feature's own gate and the reason it exists: a word swap inside
 *   `\label{…}` is a broken cross-reference, where a smart quote there is
 *   cosmetic.
 * - Any word the user has ACCEPTED — the paper dictionary, the global list, or
 *   a name out of `references.bib`. There is ONE authority for "this word is
 *   fine here" (`accepted-words.ts`) and a typo table that overrode it would be
 *   a second one: adding a word to your dictionary must stop Virgil correcting
 *   it, not merely stop it underlining it.
 * - When the preference is off, or on a surface that declared no port at all
 *   (the Library reader, a bare `RichTextField`). A surface that never stated
 *   an answer gets no silent rewriting — the conservative direction, and the
 *   same one the checker takes.
 */

import { Extension, InputRule } from "@tiptap/core";
import type { SpellcheckPortRef } from "@/lib/spell/spell-port";
import { typedTextIsProse } from "./typed-prose-gate";

/** One curated correction: a word that is never a word, and what it is. */
export interface AutocorrectRow {
  /** The typo, lower case. Must not be a word the dictionary accepts. */
  readonly wrong: string;
  /** The correction, lower case. Must be a word the dictionary accepts. */
  readonly right: string;
}

/**
 * THE CURATED LIST.
 *
 * Membership rule, and it is narrow on purpose: a transposition or a
 * doubled/undoubled consonant that is not a word in ANY register — not a
 * British spelling (`dependant` is a noun and is deliberately absent), not a
 * proper noun, not a technical identifier, not a plausible variable. A missed
 * correction costs nothing; a wrong one rewrites the user's prose.
 *
 * ADDING A ROW is one line here. The suite vets it against the shipped
 * dictionary, so a row whose `wrong` is secretly a real word fails CI rather
 * than shipping.
 */
export const AUTOCORRECT_TABLE: readonly AutocorrectRow[] = [
  // transpositions
  { wrong: "teh", right: "the" },
  { wrong: "hte", right: "the" },
  { wrong: "taht", right: "that" },
  { wrong: "adn", right: "and" },
  { wrong: "thier", right: "their" },
  { wrong: "freind", right: "friend" },
  { wrong: "recieve", right: "receive" },
  { wrong: "recieved", right: "received" },
  { wrong: "recieves", right: "receives" },
  { wrong: "recieving", right: "receiving" },
  { wrong: "beleive", right: "believe" },
  { wrong: "beleived", right: "believed" },
  { wrong: "wierd", right: "weird" },
  { wrong: "acheive", right: "achieve" },
  { wrong: "acheived", right: "achieved" },
  { wrong: "foriegn", right: "foreign" },
  { wrong: "remeber", right: "remember" },
  { wrong: "strenght", right: "strength" },
  // doubled / undoubled consonants
  { wrong: "occured", right: "occurred" },
  { wrong: "occuring", right: "occurring" },
  { wrong: "occurance", right: "occurrence" },
  { wrong: "refered", right: "referred" },
  { wrong: "refering", right: "referring" },
  { wrong: "prefered", right: "preferred" },
  { wrong: "transfered", right: "transferred" },
  { wrong: "commited", right: "committed" },
  { wrong: "begining", right: "beginning" },
  { wrong: "writting", right: "writing" },
  { wrong: "neccessary", right: "necessary" },
  { wrong: "accomodate", right: "accommodate" },
  { wrong: "accross", right: "across" },
  { wrong: "embarass", right: "embarrass" },
  { wrong: "paralel", right: "parallel" },
  { wrong: "supress", right: "suppress" },
  { wrong: "succesful", right: "successful" },
  { wrong: "succesfully", right: "successfully" },
  { wrong: "reccomend", right: "recommend" },
  { wrong: "reccomended", right: "recommended" },
  { wrong: "dissapear", right: "disappear" },
  // vowel slips
  { wrong: "seperate", right: "separate" },
  { wrong: "seperated", right: "separated" },
  { wrong: "seperately", right: "separately" },
  { wrong: "seperation", right: "separation" },
  { wrong: "definately", right: "definitely" },
  { wrong: "existance", right: "existence" },
  { wrong: "independant", right: "independent" },
  { wrong: "consistant", right: "consistent" },
  { wrong: "persistant", right: "persistent" },
  { wrong: "apparant", right: "apparent" },
  { wrong: "compatable", right: "compatible" },
  { wrong: "concious", right: "conscious" },
  { wrong: "enviroment", right: "environment" },
  { wrong: "goverment", right: "government" },
  { wrong: "knowlege", right: "knowledge" },
  { wrong: "priviledge", right: "privilege" },
  { wrong: "noticable", right: "noticeable" },
  { wrong: "similiar", right: "similar" },
  { wrong: "suprise", right: "surprise" },
  { wrong: "explaination", right: "explanation" },
  { wrong: "arguement", right: "argument" },
  { wrong: "arguements", right: "arguments" },
  // dropped letters
  { wrong: "untill", right: "until" },
  { wrong: "truely", right: "truly" },
  { wrong: "publically", right: "publicly" },
  { wrong: "particulary", right: "particularly" },
  { wrong: "completly", right: "completely" },
  { wrong: "immediatly", right: "immediately" },
  { wrong: "unfortunatly", right: "unfortunately" },
  { wrong: "finaly", right: "finally" },
  { wrong: "tommorow", right: "tomorrow" },
  { wrong: "writen", right: "written" },
];

/** The lookup the rule resolves a match through. Built once from the table. */
const BY_WRONG: ReadonlyMap<string, string> = new Map(
  AUTOCORRECT_TABLE.map((r) => [r.wrong, r.right]),
);

/**
 * A character that is NOT part of a word — the same alphabet
 * `prose-words.ts`'s `WORD_RE` builds its tokens out of, so "where does a word
 * end" has one answer across the checker and the corrector. Apostrophes are
 * word-interior, so `teh's` is deliberately left alone.
 */
const BOUNDARY = "[^\\p{L}\\p{M}\\p{Nd}'’]";

/**
 * `<boundary-or-start><typo><boundary>` at the end of the typed text. The
 * trailing boundary is the TRIGGER — the correction lands when the word is
 * finished, never mid-word — and it is carried through the replacement
 * verbatim, which is what "no rule touches punctuation" means concretely.
 */
const FIND = new RegExp(
  `(^|${BOUNDARY})(${AUTOCORRECT_TABLE.map((r) => r.wrong).join("|")})(${BOUNDARY})$`,
  "iu",
);

/**
 * The replacement for a matched spelling, or `null` when this casing is one we
 * decline to touch (ALL-CAPS, or mixed like `tEh`).
 *
 * Exported for the suite: the case rule is a decision, not an implementation
 * detail, and it is asserted directly rather than only through the editor.
 */
export function correctionFor(typed: string): string | null {
  const canonical = BY_WRONG.get(typed.toLowerCase());
  if (!canonical) return null;
  if (typed === typed.toLowerCase()) return canonical;
  // Title case: first character upper, rest lower. Nothing else — and the
  // capital is PRESERVED, never introduced.
  const title = typed[0].toUpperCase() + typed.slice(1).toLowerCase();
  if (typed === title) return canonical[0].toUpperCase() + canonical.slice(1);
  return null;
}

export interface AutocorrectOptions {
  /**
   * The document's word-layer port (task 518). `null` — or a port whose
   * `autocorrect()` is false — means no correcting on this surface.
   */
  portRef: SpellcheckPortRef | null;
}

export const Autocorrect = Extension.create<AutocorrectOptions>({
  name: "autocorrect",

  addOptions() {
    return { portRef: null };
  },

  addInputRules() {
    const portRef = this.options.portRef;
    return [
      new InputRule({
        find: FIND,
        handler: ({ state, range, match }) => {
          const port = portRef?.current;
          if (!port?.autocorrect()) return null;
          const lead = match[1] ?? "";
          const typed = match[2] ?? "";
          const trail = match[3] ?? "";
          const fixed = correctionFor(typed);
          if (!fixed) return null;
          // A word the user has told us is fine is not a typo — one authority
          // for that, shared with the checker.
          if (port.isAccepted(typed)) return null;
          // The bytes about to be overwritten must be PROSE. `range.to` is the
          // trigger position: everything the rule replaces lies before it.
          if (!typedTextIsProse(state.doc.resolve(range.to))) return null;
          state.tr.insertText(`${lead}${fixed}${trail}`, range.from, range.to);
          return undefined;
        },
      }),
    ];
  },
});
