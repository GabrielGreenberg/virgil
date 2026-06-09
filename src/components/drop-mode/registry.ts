/**
 * Drop-spec dispatch. `lookupSpec(cardKey)` resolves the `DropSpec` for a drag
 * session. Card kinds are now folded onto `CARD_REGISTRY[kind].dropSpec` (the
 * SSOT) via the `@/cards/drop-specs` side-effect registration — this module
 * keeps only the NON-card, transient drag specs (in-text atom grab, stack pull)
 * plus the two text-object specs.
 *
 * Specs are co-located with their panel under `src/panels/<panel>/drop-spec.ts`
 * (folded into the card registry) and under `src/components/drop-mode/specs/`
 * (document-level kinds, referenced here directly).
 */

import type { DropSpec } from "./types";
import { textObjectDropSpec } from "./specs/textobject";
import { textRangeMoveDropSpec } from "./specs/text-range-move";
import { inTextAtomGrabSpec } from "./specs/in-text-atom-grab";
import { stackPullDropSpec } from "./specs/stack-pull";
import { STACK_PULL_PREFIX } from "@/lib/stack/types";
import { parseAnyKey } from "@/floats/float-key";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { isCardKind } from "@/cards/predicates";
// Fold every card kind's DropSpec onto CARD_REGISTRY[kind].dropSpec.
import "@/cards/drop-specs";

/**
 * Transient drag-session keys that are NOT popout keys (never flipped to the
 * `float:` grammar): the direct in-text Atom grab (footnote / citation / ref /
 * inline math — source captured at mousedown) and the stack-pull (dragging an
 * item OUT of the Stack). Dispatched on the raw key prefix.
 */
const TRANSIENT_SPECS: Record<string, DropSpec | undefined> = {
  "atom-grab": inTextAtomGrabSpec,
  [STACK_PULL_PREFIX]: stackPullDropSpec,
};

/**
 * Resolve the drop spec for a full cardKey. **Dual-read** (AF phased flip):
 * `parseAnyKey` reads the `float:<domain>:<kind>:<id>` grammar AND the legacy
 * `<prefix>:<id>` / `textobject:<kind>:<id>` shapes.
 *
 *  - text-object → `textObjectDropSpec`, except a plain text selection
 *    (`linkedRange`) which moves as a SLICE at an inline caret → the
 *    `text-range-move` spec (L3f-2).
 *  - card kind → the folded `CARD_REGISTRY[kind].dropSpec` (both revision kinds
 *    share `revisionDropSpec`; `bib`/`ai`/`error` have none → `undefined`).
 *  - `atom-grab` / `stack-pull` (transient, parsed as a card "kind") → the
 *    `TRANSIENT_SPECS` table.
 */
export function lookupSpec(cardKey: string): DropSpec | undefined {
  const parsed = parseAnyKey(cardKey);
  if (!parsed) {
    const sep = cardKey.indexOf(":");
    return TRANSIENT_SPECS[sep === -1 ? cardKey : cardKey.slice(0, sep)];
  }
  if (parsed.domain === "textobject") {
    if (parsed.kind === "linkedRange") return textRangeMoveDropSpec;
    return textObjectDropSpec;
  }
  if (isCardKind(parsed.kind)) {
    return CARD_REGISTRY[parsed.kind].dropSpec ?? undefined;
  }
  return TRANSIENT_SPECS[parsed.kind];
}
