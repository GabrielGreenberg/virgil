/**
 * THE validation door for a bibliography entry's HEAD — its `@type` and its
 * citekey (task 690).
 *
 * ## Why one door
 *
 * The Bibliography panel's "Edit entry" pod is two free-text `Input`s over the
 * two bytes that make a BibTeX block addressable:
 *
 * ```
 * @article{smith2020,
 *  ^^^^^^^ ^^^^^^^^^
 *   type     citekey
 * ```
 *
 * Neither was checked. Save accepted an EMPTY `@type` and emitted `@{key,…}`
 * into `references.bib` — a block Virgil's own extractor cannot read back, so
 * the next parse skipped the entry with a `console.warn` and the user's source
 * for it was, from the app's point of view, gone. A citekey containing a
 * space, a comma or a brace fails the same head scan for the same reason. And
 * renaming an entry ONTO a citekey another entry already had was accepted in
 * full: the panel then showed one card for two blocks, and every later edit
 * reached both.
 *
 * So the rule is stated ONCE, here, and read twice — by the card, to disable
 * Save and say why, and by the mutator, so no other caller can route around
 * the UI. That is the shape the write-path law asks for: a door that MEASURES
 * what it is about to commit, and refuses rather than guesses.
 *
 * ## What is refused, and why exactly these
 *
 * The rejected character set is not taste; it is what `bib-source.ts`'s
 * scanner and citation-js can read back. A head is legal here iff a block
 * carrying it round-trips through `parseBibFile`.
 *
 * bib-display-exempt-file: non-display. Every string here is a RAW `.bib`
 * coordinate on the way to disk; a display projection applied to a citekey
 * would put the projection in the file the `.tex` cites.
 */

import type { BibEntry } from "@/lib/types";
import type { BibEntryAddress } from "@/lib/bib-address";
import { resolveBibEntryIndex } from "@/lib/bib-address";

/** A head the door accepts, or the reason it does not — in the user's words,
 *  because the card renders it verbatim. */
export type BibHeadCheck = { ok: true } | { ok: false; reason: string };

/**
 * Characters a citekey may not contain. `,` `{` `}` and whitespace end the
 * head scan (`@\w+\s*\{([^,\s}]+)\s*,`); `@` starts a new block; `%` starts a
 * comment; `"` `#` `=` `(` `)` `\` and `~` are BibTeX syntax that makes the
 * block's extent a guess.
 */
const CITEKEY_FORBIDDEN = /[\s,{}@%"#=()\\~]/;

/** A BibTeX entry type: letters, optionally with digits or hyphens after. */
const ENTRY_TYPE_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Is this `@type` writable on its own? The half of the head rule that belongs
 * to EVERY write that sets a type — a rename, a retype, a "Replace with
 * library" — independent of any other entry in the file.
 */
export function validateBibEntryType(type: string): BibHeadCheck {
  const t = type.trim();
  if (!t) return { ok: false, reason: "An entry type is required (e.g. article)." };
  if (!ENTRY_TYPE_RE.test(t)) {
    return {
      ok: false,
      reason: "An entry type must be letters only (e.g. article, book, inproceedings).",
    };
  }
  return { ok: true };
}

/**
 * Is this `@type` + citekey pair writable to `references.bib`?
 *
 * `entries` is the list the entry lives in and `self` the address of the entry
 * being edited (omitted when the head is for a NEW entry) — together they make
 * the collision check exact: renaming an entry to the key it already has is
 * not a collision, and renaming onto a DIFFERENT block's key is.
 */
export function validateBibEntryHead(
  head: { key: string; type: string },
  context: { entries: BibEntry[]; self?: BibEntryAddress },
): BibHeadCheck {
  const key = head.key.trim();
  const type = head.type.trim();

  const typeCheck = validateBibEntryType(type);
  if (!typeCheck.ok) return typeCheck;
  if (!key) return { ok: false, reason: "A citation key is required." };
  const bad = key.match(CITEKEY_FORBIDDEN);
  if (bad) {
    const shown = /\s/.test(bad[0]) ? "a space" : `“${bad[0]}”`;
    return { ok: false, reason: `A citation key cannot contain ${shown}.` };
  }

  const selfIndex =
    context.self !== undefined
      ? resolveBibEntryIndex(context.entries, context.self)
      : -1;
  const collidesAt = context.entries.findIndex((e, i) => e.key === key && i !== selfIndex);
  if (collidesAt !== -1) {
    return {
      ok: false,
      reason: `Another entry already uses the key “${key}”. Pick a different key.`,
    };
  }
  return { ok: true };
}

/**
 * The head check for a SAVE — measured against the head the entry already has,
 * so the write answers for what it CHANGES and nothing else (task 691).
 *
 * `validateBibEntryHead` asks about a head in the absolute, which is the right
 * question for a rename and the wrong one for a field edit. A `references.bib`
 * may legally hold two blocks under one citekey — task 690 stopped HIDING the
 * second precisely so the user could repair it — and the absolute check calls
 * that a collision. Read on every Save it therefore refused to write the
 * FIELDS of either duplicate: an edit that touches no citekey, refused for a
 * collision the user did not create and could not clear without the edit.
 *
 * So: the TYPE is always this write's to answer for (it is being set either
 * way, and an unwritable one emits `@{key,…}` — a block the extractor cannot
 * read back, which the next write then drops). The KEY's rule — its character
 * set, and above all where it LANDS — applies when the key MOVES. A key that
 * stays put keeps whatever company it already had.
 *
 * The rule itself is still stated once, above; this is which part of it a
 * given write is accountable for. Read by the card (to disable Save and say
 * why) and by the mutator (so no caller routes around the UI).
 */
export function validateBibEntryHeadChange(
  current: { key: string; type: string },
  next: { key: string; type: string },
  context: { entries: BibEntry[]; self?: BibEntryAddress },
): BibHeadCheck {
  const key = next.key.trim();
  const type = next.type.trim();
  const typeCheck = validateBibEntryType(type);
  if (!typeCheck.ok) return typeCheck;
  if (key === current.key) return { ok: true };
  return validateBibEntryHead({ key, type }, context);
}
