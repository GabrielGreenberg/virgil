/**
 * The ONE wiring site for the inline-atom card accessors (`DropCtx.atomCards`).
 *
 * Task 233 — why this module exists. The "anchor the unanchored" create branch
 * rebuilds an inline atom for a card that has no marker in any editor, so
 * everything the atom can't regenerate has to come from the CARD. That data
 * reached the spec through a per-kind optional sub-bag on `DropCtx`, added by
 * hand and threaded through `DropModeProvider`'s FOUR enumerations (props
 * interface, destructure, snapshot, live getters) plus an `EditorPane` prop.
 * Citation got all five edits. Footnote got the spec and none of the wiring —
 * and because its `createAtom` "worked" (it built a syntactically fine atom
 * with an EMPTY body), the gap was invisible until it ate a user's footnote.
 *
 * So the accessor set is no longer hand-enumerated. It is a `Record` over
 * `InlineAtomCardKind` (the key union of `InlineAtomCardAttrs`):
 *
 *   - a kind that declares attrs but has no builder here → **compile error**;
 *   - a builder whose sources aren't supplied by `EditorPane` → **compile
 *     error**;
 *   - `DropModeProvider` takes ONE `atomCards` prop, so adding the next
 *     inline-atom kind (`ai`, `ref`, …) touches this file and nothing else.
 *
 * The contract test (`__tests__/atom-card-api-coverage.test.ts`) closes the
 * remaining gap the type system can't see: that every card kind whose
 * registered `dropSpec` declares `requiresCardApi` is actually a key here.
 */

import type { JSONContent } from "@tiptap/core";
import { emptyRichContent } from "@/lib/footnote-content";
import type {
  InlineAtomCardApi,
  InlineAtomCardApis,
  InlineAtomCardAttrs,
  InlineAtomCardKind,
} from "./types";

/**
 * The per-doc hook reads each builder needs. Deliberately structural (not the
 * hook objects themselves) so this module stays a leaf and the test can drive
 * it with plain stubs.
 */
export interface InlineAtomCardApiSources {
  /** `useFootnotes.contentFor` — the card's live body, normalized to a doc. */
  footnoteContentFor: (id: string) => JSONContent | null;
  /** `useFootnotes.markAnchored` — clear the ref's `unanchored`/`archived`. */
  markFootnoteAnchored: (id: string) => void;
  /** `useCitations.commandFor` — the card's `\cite{…}`, null for a draft. */
  citationCommandFor: (id: string) => string | null;
  /** `useCitations.markAnchored` — clear the ref's `unanchored`/`archived`. */
  markCitationAnchored: (id: string) => void;
}

/**
 * One builder per inline-atom card kind. The mapped type is the guard: a kind
 * added to `InlineAtomCardAttrs` and forgotten here does not compile.
 */
const INLINE_ATOM_CARD_BUILDERS: {
  [K in InlineAtomCardKind]: (
    s: InlineAtomCardApiSources,
  ) => InlineAtomCardApi<InlineAtomCardAttrs[K]>;
} = {
  footnote: (s) => ({
    // Never null: an empty body is a legal footnote, and a missing ref (the
    // card was deleted mid-gesture) degrades to the same empty create shape
    // rather than declining a drop the user already committed to.
    atomAttrsFor: (id) => ({ content: s.footnoteContentFor(id) ?? emptyRichContent() }),
    onAnchored: s.markFootnoteAnchored,
  }),
  citation: (s) => ({
    // Null command ⇒ the spec declines (a keyless `\cite{}` can never
    // serialize) — the same predicate the upstream disabled button uses.
    atomAttrsFor: (id) => ({ command: s.citationCommandFor(id) }),
    onAnchored: s.markCitationAnchored,
  }),
};

/** Every inline-atom card kind that owns a create branch — the runtime twin of
 *  the `InlineAtomCardKind` union, derived from the builder record so the two
 *  cannot drift. */
export const INLINE_ATOM_CARD_KINDS = Object.keys(
  INLINE_ATOM_CARD_BUILDERS,
) as InlineAtomCardKind[];

/**
 * Build the whole `DropCtx.atomCards` bag from one doc's hook reads.
 *
 * The return type is TOTAL — every kind, no optionals — even though the ctx
 * slot it feeds is partial. Optionality is right on `DropCtx.atomCards` (a doc
 * may not wire the feature at all) and wrong here: a builder that returns "maybe
 * nothing" pushes non-null assertions onto every consumer, which is exactly the
 * shape that would hide a future partial builder.
 */
export function buildInlineAtomCardApis(
  sources: InlineAtomCardApiSources,
): Required<InlineAtomCardApis> {
  const entries = INLINE_ATOM_CARD_KINDS.map((kind) => [
    kind,
    INLINE_ATOM_CARD_BUILDERS[kind](sources),
  ]);
  // The record is total over the kind union (a missing kind doesn't compile),
  // so the built object is total too — TS just can't follow that through the
  // per-key generic. This is the one cast, and the `Required<>` return type is
  // what makes it visible to every consumer.
  return Object.fromEntries(entries) as Required<InlineAtomCardApis>;
}
