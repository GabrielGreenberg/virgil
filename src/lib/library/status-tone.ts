/**
 * The ONE tone resolution for a library entry's two status axes.
 *
 * A library entry carries two orthogonal status facts — its bib-AUTH state
 * (`LibraryBibState` / the library silo's `BibAuthState`) and its processing
 * TIER (`LibraryIndexTier`, derived from the catalog's `IndexedState`) — and
 * both are rendered on THREE surfaces a tab or a click apart: the Library
 * list's `StatusPill`s, the paper-side Bibliography panel's status chips, and
 * the bib-entry picker's per-row pill. They describe the SAME catalog row, so
 * a per-surface colour table is not theming; it is three answers to one
 * question.
 *
 * Before task 500 there were FOUR hand-written tables across two silos and
 * they disagreed — most damagingly about `failed`, which the Bibliography
 * panel collapsed into the `unverified` branch and printed as "Unverified",
 * and which the picker painted amber and labelled "unverified" along with
 * `manuscript`, `canonical` and `needs-reauth`. So *"nobody has tried"* and
 * *"we tried and it FAILED"* looked identical on the two surfaces a user reads
 * while writing. (Three tables were the filed finding; the picker was found by
 * the CENSUS below, which is the argument for having one.)
 *
 * So the state → TONE decision is stated here, once, and every renderer reads
 * it. What each surface keeps is its own LABEL dialect (the list is glyph-
 * dense, the card is a sentence) and its own tooltip prose; what it may not
 * keep is a private opinion about colour. A census pins that
 * (`bib-state-tone.test.tsx`), with an EMPTY allowlist.
 *
 * IMPORT-FREE by design (type-only imports erase): both silos import it, so
 * it may pull in nothing at runtime — the placement rule `latex-markers.ts`
 * and `node-attr-sets.ts` each earned. A facet the layer that needs it cannot
 * import will be re-copied, every time.
 */

import type { BibAuthState, IndexedState } from "@library/lib/catalog";
import type {
  LibraryBibState,
  LibraryIndexTier,
} from "./library-types";

/** The status-pill tone family. Each member has a `--pill-<tone>-{bg,fg,edge}`
 *  triple in `library/styles/library.css`, which `globals.css` imports, so the
 *  tokens are available to BOTH silos. */
export type Tone = "green" | "amber" | "red" | "gray" | "blue";

/**
 * `LibraryBibState` (paper side) and `BibAuthState` (library side) are two
 * spellings of one union, and `library-types.ts` says so in prose ("kept in
 * lockstep"). These two assignments make TWO THIRDS of that prose a COMPILE
 * ERROR when it stops being true — this is the only place in the app where
 * both names are in scope at once, and therefore the only place it can be
 * checked at all.
 *
 * Stated rather than implied: the prose names a THIRD party,
 * `library/scripts/_tools.py CANONICAL_BIB_STATES`, and no TypeScript
 * assertion can reach it. That half stays a claim.
 */
const _bibStatesAgreeLtoR: BibAuthState = null as unknown as LibraryBibState;
const _bibStatesAgreeRtoL: LibraryBibState = null as unknown as BibAuthState;
void _bibStatesAgreeLtoR;
void _bibStatesAgreeRtoL;

/**
 * The bib-auth tone table. One row per state, with the reason at the site.
 *
 * The MAPPING is the Library list's, unchanged state for state — that surface's
 * colours were already token-driven and already distinguished `failed`, so the
 * paper side is the one that moves: `failed` amber → red, `manuscript` sky →
 * blue, `canonical` indigo → blue. (Two of the TOKEN VALUES did move, and for
 * an unrelated reason: amber and gray were under WCAG AA on their own grounds
 * and were nudged darker once the family stopped being one surface's palette.
 * See `library/styles/library.css`.)
 *
 * `manuscript` and `canonical` deliberately share `blue`: neither is a problem
 * to fix — both mean "no external registry will ever have this" — and the
 * distinction between them is carried by the LABEL ("Manuscript" / "Canonical"),
 * which is where a distinction that costs no attention belongs. A sixth tone
 * would buy a colour nobody has to act on.
 */
export const BIB_STATE_TONE: Readonly<Record<LibraryBibState, Tone>> = {
  /** No authentication attempt has been recorded. Not a problem — an absence. */
  none: "gray",
  /** Best-effort fields, nobody has tried yet. A caution, not an alarm. */
  unverified: "amber",
  /** Verified against Crossref / OpenAlex / … */
  authenticated: "green",
  /** Unpublished or forthcoming — no external source applies. */
  manuscript: "blue",
  /** Pre-digital classic — no DOI/ISBN registry will ever index it. */
  canonical: "blue",
  /** We TRIED and it failed. The one state that is an alarm rather than a
   *  caution, and the whole reason this table exists: it must never again be
   *  indistinguishable from `unverified`. */
  failed: "red",
  /** Fields were rewritten from the file; a re-auth pass is owed. Action
   *  needed, but nothing is known to be wrong — a caution. */
  "needs-reauth": "amber",
};

/** Tone for a library entry's bib-authentication state.
 *
 *  FAILS OPEN to `gray`: `catalog.json` is written by the out-of-process
 *  skills, so a state name this build does not know is a shape that reaches
 *  here from disk. Gray says "no information", which is the truthful reading
 *  of a state we cannot interpret — and it is strictly better than the
 *  pre-500 behaviour, where an unrecognized key indexed a `Record` to
 *  `undefined` and painted `var(--pill-undefined-bg)`, i.e. nothing at all. */
export function bibStateTone(state: LibraryBibState): Tone {
  return BIB_STATE_TONE[state] ?? "gray";
}

/** Runtime vocabulary of the bib-auth axis, DERIVED from the tone table — so a
 *  new state member is a compile error there and joins every sweep and census
 *  that reads this by declaration alone. */
export const BIB_STATES = Object.keys(BIB_STATE_TONE) as readonly LibraryBibState[];

/**
 * The processing-tier tone table — the same axis one facet over, and it had
 * the same disease: the Library list gave `deepIndexed` plain green while the
 * paper side gave it its own darker emerald step.
 *
 * The distinction survives in the LABEL ("Indexed PDF" / "Deep-indexed PDF",
 * "✓ idx" / "✓✓ idx"), for the same reason `canonical` and `manuscript` share
 * blue: a deep index is not a different STATUS from an index, it is a better
 * one, and a second green is a colour the reader has to learn to read.
 */
export const INDEX_TIER_TONE: Readonly<Record<LibraryIndexTier, Tone>> = {
  /** In the library as a bibliography entry only — an absence, not a problem. */
  "bib-only": "gray",
  /** Queued or extracting — in flight. */
  processing: "amber",
  indexed: "green",
  "deep-indexed": "green",
  failed: "red",
};

/** Tone for a library entry's processing tier. Fails open to `gray` for the
 *  reason {@link bibStateTone} states. */
export function indexTierTone(tier: LibraryIndexTier): Tone {
  return INDEX_TIER_TONE[tier] ?? "gray";
}

/** Runtime vocabulary of the tier axis, DERIVED as above. */
export const INDEX_TIERS = Object.keys(INDEX_TIER_TONE) as readonly LibraryIndexTier[];

/**
 * Catalog `indexed.state` → the paper-side Bib only / Indexed / Deep-indexed
 * tier. Keeps the indexed-vs-deepIndexed distinction that `mapStatus`
 * collapses, so cards can surface a readable processing tier.
 *
 * It lives HERE rather than in `useLibrary.ts` (which re-exports it for its
 * existing callers) because `indexTierTone` is stated over the TIER and the
 * Library list's pills are keyed on the raw `IndexedState` — so the list can
 * only read the one tone table by going through this mapping, and a hook
 * module is not something a leaf pill component should have to import.
 */
export function indexStateTier(s: IndexedState): LibraryIndexTier {
  switch (s) {
    case "deepIndexed":
      return "deep-indexed";
    case "indexed":
      return "indexed";
    case "queued":
    case "running":
      return "processing";
    case "failed":
      return "failed";
    case "none":
      return "bib-only";
    default:
      // NOT dead, and byte-for-byte the pre-500 behaviour: `IndexedState` is
      // read from `catalog.json`, which the out-of-process skills write, and
      // the reader normalizes only the ONE legacy spelling it knows
      // (`richIndexed`). Anything else lands here, and "we have this entry but
      // no index we understand" is exactly `bib-only`.
      return "bib-only";
  }
}
