/**
 * Builders for `ParagraphAnchorApi.modeB` — the ONE way a drop adapter in
 * `EditorPane` answers "what does a re-anchor do to this card's text-range
 * anchor?" (task 698).
 */

import { getTextAnchor, type CardWithLinks } from "@/links/links";
import type { ModeBReanchorPolicy } from "../types";

/**
 * A re-anchor RELEASES the card's Mode-B anchor. `find` looks the card up in
 * the panel's live state; `convert` performs the hook's own `linkedRange` →
 * Mode-A conversion — given the card id and the anchorId being released, so a
 * hook keyed by either can supply it (most panels expose the anchorId-keyed
 * `clearCardAnchor` their orphan listener already uses).
 *
 * The anchorId is read BEFORE the conversion (afterwards the card no longer
 * carries it) and returned so the spec strips the `linkedAnchor` mark.
 */
export function releaseModeB<C extends CardWithLinks>(
  find: (id: string) => C | undefined,
  convert: (id: string, anchorId: string) => void,
): ModeBReanchorPolicy {
  return {
    policy: "release",
    release: (id) => {
      const card = find(id);
      const anchorId = card ? getTextAnchor(card)?.anchorId : undefined;
      if (!anchorId) return null;
      convert(id, anchorId);
      return anchorId;
    },
  };
}
