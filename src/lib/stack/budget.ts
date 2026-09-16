/**
 * **The Stack's cap is a BUDGET, not a count** (task 591).
 *
 * `STACK_MAX_ITEMS = 200` was written under the premise that "200 items × a
 * few KB stays comfortably within budget". A `heading` capture is the whole
 * dominated section as node JSON, plus its bib carry — so a handful of
 * chapter-sized captures can reach the origin's ~5 MB localStorage quota while
 * the count cap is still reporting plenty of room. Past that point every later
 * `setItem` throws, and the count cap can never make room because it is not
 * measuring the thing that ran out.
 *
 * So the cap is stated ONCE, here, in the unit the quota actually rations
 * (UTF-16 code units of the serialized envelope), and FIFO eviction — which
 * `STACK_MAX_ITEMS` already declared as its rule — is what the budget does
 * when exceeded. The count cap is not replaced; it is the first of two passes
 * in the same function, so no caller can apply one without the other.
 *
 * ### The item being added is never evicted
 *
 * Eviction always takes from the OLD end, and `fitStackItems` keeps the first
 * item unconditionally. An add whose own payload busts the whole budget
 * therefore fits nothing, the write throws, and the add door REFUSES — which
 * is the honest answer, and the one the Stack's producers are built to hear
 * (the float stays open, the lift stays un-torn). A silent trim to zero would
 * be the same lie one layer down.
 */

import {
  STACK_MAX_CHARS,
  STACK_MAX_ITEMS,
  type StackEnvelope,
  type StackItem,
} from "./types";

/** The ONE serialization of the envelope — shared by the fit and the write so
 *  a fitted result is never re-stringified (and never re-measured against a
 *  different string than the one that lands). */
export function serializeStackEnvelope(items: StackItem[]): string {
  const env: StackEnvelope = { version: 1, items };
  return JSON.stringify(env);
}

export interface FittedStack {
  /** Newest-first, within both caps. */
  items: StackItem[];
  /** Exactly what should be written for {@link FittedStack.items}. */
  serialized: string;
  /** How many were dropped off the old end to get there. */
  evicted: number;
}

/**
 * Trim a newest-first item list to BOTH caps by FIFO eviction.
 *
 * Costs one `JSON.stringify` per item plus one for the result, not one per
 * eviction — an over-budget envelope is measured, not repeatedly re-serialized.
 */
export function fitStackItems(items: StackItem[]): FittedStack {
  const capped = items.slice(0, STACK_MAX_ITEMS);
  // The wrapper's own cost (`{"version":1,"items":[]}`) is fixed; each item
  // adds its serialization plus the comma that joins it to the previous one.
  const overhead = serializeStackEnvelope([]).length;
  let used = overhead;
  const kept: StackItem[] = [];
  for (const item of capped) {
    const cost = JSON.stringify(item).length + (kept.length > 0 ? 1 : 0);
    // `kept.length > 0`: the newest item — the one being added — is kept
    // whatever it costs. See the module note.
    if (kept.length > 0 && used + cost > STACK_MAX_CHARS) break;
    kept.push(item);
    used += cost;
  }
  return {
    items: kept,
    serialized: serializeStackEnvelope(kept),
    evicted: items.length - kept.length,
  };
}
