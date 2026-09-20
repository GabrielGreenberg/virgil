/**
 * The Mode-B collection SSOT — "which card collections carry a text-range
 * (`linkedRange`) anchor?", asked ONCE.
 *
 * Virgil anchors a card to the document two ways:
 *
 *   • **Mode A** — the card names a paragraph uuid; the paragraph paints an
 *     accent rail. No mark in the text.
 *   • **Mode B** — the card owns a `linkedAnchor` MARK over a text RANGE; the
 *     span is tinted and is hoverable/clickable in the prose.
 *
 * Four consumers need the Mode-B set: the in-text hover bridge
 * (`useTextHoverBridge`), the orphan reaper's alive-set
 * (`useLinkedAnchorReconciler`), the load-time mark re-apply
 * (`reapply-mode-b-anchors`), and the shell's hovered-anchor resolver
 * (`EditorLayout` → `entityToAnchorId`). Until task 666 each of them carried
 * its OWN hand-written list, and they did not agree: the hover bridge knew
 * four of six, so a highlight's tinted text — and a todo's, when the todo was
 * created from a selection — was PAINTED BUT INERT: nothing on hover, nothing
 * on click, while the panel→text direction worked. That is the
 * "a registry earns its name by being read" law's exact failure shape: one
 * membership question, N hand-kept lists, so the narrowest list silently loses
 * a feature.
 *
 * WHAT IS DERIVED, AND WHAT IS DECLARED
 *
 *  - **Membership is DERIVED**, from a facet that already existed:
 *    `LEGACY_TOKEN_CROSSWALK[kind].legacyDataKind`, whose own contract is
 *    verbatim "`null` if this kind never carries a `linkedAnchor` mark". No new
 *    registry facet was added — see `carriesModeBAnchor`.
 *  - **The slot BINDING is DECLARED** in `MODE_B_COLLECTIONS` below (which bag
 *    slot hosts which kinds, and in what order), because nothing in the
 *    registry answers "which array of the per-doc card bag does this kind live
 *    in" — the panel does not: the `notes` panel hosts `note` AND `highlight`
 *    across two separate arrays. That table is CHECKED against the derived
 *    membership by a dev assertion here and by a census
 *    (`mode-b-collection-set.test.ts`), so a new Mode-B kind cannot be added
 *    without binding it to a slot, and no consumer may hand-list the set.
 *
 * The forcing function for consumers is the TYPE: `ModeBBag` is
 * `Record<ModeBSlot, …>`, total over the slot union, so a consumer that wants
 * the Mode-B cards cannot accept a narrow four-slot argument and still compile.
 * `forEachModeBCard` is the one walker they all share.
 *
 * Light leaf: registry predicates + the crosswalk + type-only imports. No
 * React, no editor, no `links/` runtime edge.
 */

import type { CardKind } from "./types";
import type { Link } from "@/links/_shared/types";
import type { LinkedAnchorKind } from "@/links/links";
import { CARD_KINDS, cardKindFromRecord, isAnchoredCardKind } from "./predicates";
import { legacyDataKindForCardKind } from "./legacy-token-crosswalk";

/** The minimal per-record shape every Mode-B consumer reads: identity, the
 *  on-disk polymorphism discriminator, and the links the text anchor lives in.
 *  Structurally satisfied by every card record (and by `CardWithLinks`). */
export interface ModeBRecord {
  id: string;
  kind?: string;
  links?: Link[];
}

/** The per-doc card-bag slots that can hold a Mode-B card. Names match
 *  `EntityCollectionSlots` / `CardFloatCtx` (`todoItems` / `reportCards`, not
 *  `todos` / `reports`); a type-level assertion in the census pins the subset
 *  relation so a rename on either side fails CI rather than drifting. */
export type ModeBSlot =
  | "notes"
  | "todoItems"
  | "comments"
  | "cutterCards"
  | "reportCards"
  | "highlights";

/** The Mode-B card bag. TOTAL over `ModeBSlot` — this totality is the whole
 *  point: it is what makes "the hover bridge only knew four of six" not
 *  expressible any more. */
export type ModeBBag = { readonly [S in ModeBSlot]: ReadonlyArray<ModeBRecord> };

/**
 * Does a card of this kind carry a Mode-B (`linkedRange`) text-range anchor?
 *
 * DERIVED, not declared: a kind carries a Mode-B anchor iff it is `anchored`
 * in `CARD_REGISTRY` **and** the crosswalk gives it a `legacyDataKind` — the
 * `data-link-card` token, which the crosswalk's own doc defines as "`null` if
 * this kind never carries a `linkedAnchor` mark". So the membership fact was
 * already written down; it just was not read.
 *
 * Today that is exactly nine kinds: note, highlight, todo, report,
 * report-request, revision-comment, revision-suggestion, cutter-comment,
 * cutter-suggestion. `archive` / `example` / `footnote` / `citation` are
 * anchored but Mode-A or atom-borne (`legacyDataKind: null`); `bib` / `error`
 * are unanchored.
 */
export function carriesModeBAnchor(kind: CardKind): boolean {
  return isAnchoredCardKind(kind) && legacyDataKindForCardKind(kind) !== null;
}

/** The Mode-B-bearing card kinds, derived from `carriesModeBAnchor`. */
export const MODE_B_CARD_KINDS: readonly CardKind[] =
  CARD_KINDS.filter(carriesModeBAnchor);

/**
 * Spine `CardKind` → the `kind` attr the `linkedAnchor` MARK carries
 * (`LinkedAnchorKind`).
 *
 * The mark's namespace predates the comment/suggestion split, so it is NOT the
 * spine namespace: every kind's mark token is its `legacyDataKind` except the
 * two revision kinds, which BOTH fold onto the single `"revision"` mark (the
 * tint table `defaultTintForLinkedAnchorKind` and the `globals.css` rules key
 * on it). This is the exact inverse of `linkedAnchorKindToCardKind` in
 * `links.ts`, which folds `"revision"` → `"revision-comment"`.
 *
 * Returns `null` for a kind that carries no mark.
 */
export function markKindForCardKind(kind: CardKind): LinkedAnchorKind | null {
  if (kind === "revision-comment" || kind === "revision-suggestion") {
    return "revision";
  }
  return (legacyDataKindForCardKind(kind) as LinkedAnchorKind | null) ?? null;
}

/** One Mode-B collection: the bag slot, the kinds it hosts, and how to resolve
 *  a record of it to its spine `CardKind`. */
export interface ModeBCollection {
  slot: ModeBSlot;
  /** The Mode-B kinds this slot hosts (checked against `MODE_B_CARD_KINDS`). */
  kinds: readonly CardKind[];
  /** Resolve a record to its spine `CardKind`. Monomorphic slots answer with a
   *  constant; the polymorphic slots route through the ONE read classifier
   *  (`cardKindFromRecord`) rather than re-deriving `record.kind` per site. */
  kindOf: (record: ModeBRecord) => CardKind;
}

/**
 * The Mode-B collections, IN APPLY ORDER.
 *
 * ORDER IS LOAD-BEARING and is why this is a list rather than a set:
 * `reapply-mode-b-anchors` re-stamps marks in this order, and **highlights must
 * be LAST** — a highlight whose range sits inside a broader revision/cutter
 * selection has to win the overlap (`setMark` replaces the earlier mark), or
 * `LinkedAnchorGuard` fires a spurious orphan event and strips the highlight's
 * `textRange` from its sidecar. The remaining order (note → todo → revision →
 * cutter → report) is preserved byte-for-byte from the retired
 * `EditorLayout.applyLinkedAnchors` effect.
 */
export const MODE_B_COLLECTIONS: readonly ModeBCollection[] = [
  { slot: "notes", kinds: ["note"], kindOf: () => "note" },
  { slot: "todoItems", kinds: ["todo"], kindOf: () => "todo" },
  {
    slot: "comments",
    kinds: ["revision-comment", "revision-suggestion"],
    kindOf: (r) => cardKindFromRecord(r, "revisions"),
  },
  {
    slot: "cutterCards",
    kinds: ["cutter-comment", "cutter-suggestion"],
    kindOf: (r) => cardKindFromRecord(r, "cutter"),
  },
  {
    slot: "reportCards",
    kinds: ["report", "report-request"],
    kindOf: (r) => cardKindFromRecord(r, "reports"),
  },
  // Highlights LAST — see the block comment above (overlap last-wins).
  { slot: "highlights", kinds: ["highlight"], kindOf: () => "highlight" },
];

/** Every Mode-B card in the bag, visited in `MODE_B_COLLECTIONS` order with its
 *  resolved spine kind. The ONE walk all four consumers share. */
export function forEachModeBCard(
  bag: ModeBBag,
  visit: (record: ModeBRecord, kind: CardKind, collection: ModeBCollection) => void,
): void {
  for (const collection of MODE_B_COLLECTIONS) {
    for (const record of bag[collection.slot] ?? []) {
      visit(record, collection.kindOf(record), collection);
    }
  }
}

// Dev canary: the declared slot table must cover EXACTLY the derived
// membership. A new Mode-B kind that nobody bound to a slot would otherwise be
// invisible to all four consumers — the precise failure this module exists to
// retire. (The census `mode-b-collection-set.test.ts` fails CI on the same
// disagreement; this makes it loud at runtime in dev too.)
if (process.env.NODE_ENV !== "production") {
  const bound = new Set<string>(MODE_B_COLLECTIONS.flatMap((c) => c.kinds));
  const derived = new Set<string>(MODE_B_CARD_KINDS);
  const unbound = [...derived].filter((k) => !bound.has(k));
  const stray = [...bound].filter((k) => !derived.has(k));
  if (unbound.length || stray.length) {
    console.error(
      `[mode-b-collections] MODE_B_COLLECTIONS disagrees with the registry-derived ` +
        `Mode-B kind set — unbound: [${unbound.join(", ")}], stray: [${stray.join(", ")}]. ` +
        `Bind every Mode-B kind to a bag slot or the hover bridge, the orphan reaper, ` +
        `the load re-apply and the shell's anchor resolver are all blind to it.`,
    );
  }
}
