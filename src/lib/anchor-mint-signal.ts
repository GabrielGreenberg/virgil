/**
 * Anchor-mint transaction signal.
 *
 * A "paragraph anchor mint" is the lazy hydration of a block's `uuid` attribute
 * — `setNodeMarkup(pos, { ...attrs, uuid })` with `addToHistory: false` — fired
 * when a margin card (or a drop re-anchor) needs a stable anchor identity for an
 * as-yet-unpersisted block. That UUID is the ONLY link between the card and its
 * paragraph, and it reaches the `.tex` only as a trailing `%!v:<uuid>` comment
 * the serializer writes on save.
 *
 * The card link persists on a FAST clock (~300 ms sidecar + guaranteed unmount
 * flush); the paragraph UUID rides the SLOW 1500 ms doc-bundle autosave. A
 * reload in that gap re-mints the paragraph a fresh UUID and the card silently
 * orphans (see docs/memos/anchor-persistence-bug/SYNTHESIS.md).
 *
 * To close the race at the source, a mint transaction is TAGGED with
 * {@link ANCHOR_MINT_META}. The autosave subscriber (`useDocument.onUpdate`)
 * reads the tagged transaction off TipTap's `update` event and forces an
 * IMMEDIATE doc-bundle flush, so the paragraph UUID lands on the card's clock,
 * not the doc's.
 *
 * KEYSTROKE SANCTITY (AGENTS.md): the flush is gated STRICTLY on this meta. A
 * plain keystroke carries no such meta, so {@link isAnchorMintTransaction}
 * returns false and the normal 1500 ms debounce is untouched. The flush MUST
 * NEVER fire on an ordinary edit — only on a genuine UUID-mint transaction.
 */

import type { Transaction } from "@tiptap/pm/state";

/**
 * Transaction-meta key stamped on every anchor-UUID mint transaction. Both mint
 * sites — `ensureAnchorUuid` (the normal anchor path, `src/lib/anchor-uuid.ts`)
 * and the drop hit-test's `resolveAnchorableBlock`
 * (`src/components/drop-mode/hit-test.ts`) — set it. Namespaced so it can't
 * collide with any other string meta. (ProseMirror's `setMeta`/`getMeta` types
 * accept only `string | Plugin | PluginKey`, so this is a string, not a Symbol.)
 */
export const ANCHOR_MINT_META = "virgil/anchorMint";

/**
 * Stamp a transaction as an anchor-UUID mint. Call IMMEDIATELY before
 * dispatching the `setNodeMarkup(... uuid)` + `addToHistory:false` mint, so the
 * autosave subscriber can recognise it and flush the doc bundle now instead of
 * on the 1500 ms debounce.
 *
 * Returns the same transaction for fluent chaining.
 */
export function markAnchorMint(tr: Transaction): Transaction {
  return tr.setMeta(ANCHOR_MINT_META, true);
}

/**
 * Is this the mint transaction stamped by {@link markAnchorMint}? Read off
 * TipTap's `update` event (`{ editor, transaction }`) to gate the immediate
 * doc-bundle flush. False for every plain keystroke / ordinary edit — the
 * keystroke-sanctity gate.
 */
export function isAnchorMintTransaction(
  tr: Transaction | null | undefined,
): boolean {
  return tr?.getMeta(ANCHOR_MINT_META) === true;
}
