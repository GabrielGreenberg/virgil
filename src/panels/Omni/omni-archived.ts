/**
 * The ARCHIVED rule for OmniView — stated ONCE, read by every omni renderer.
 *
 * An archived card lives only under its home panel's View Archives/All. That
 * fact has three renderers in one window — the docked panel list, the margin
 * markers, and the omni gutter — and this file is the omni half of the same
 * resolution the other two already read (`EditorPane.archivedIds`, whose own
 * doc comment has always named OmniView as a consumer). Same law as tasks 369
 * ("two DRAWINGS of one anchor read ONE resolution"), 410 and 435, for the
 * `archived` fact instead of the anchor one.
 *
 * **The filter is applied to the ASSEMBLED item array, not per builder.** That
 * placement is the whole point: before task 476 the rule was re-derived twice
 * and incompletely — a local `active()` helper in `omni-host` covering six of
 * the ten families, a private `if (ref.archived) continue;` inside the footnote
 * builder, and citations covered by NEITHER, so an archived citation rendered
 * in the "N unplaced" bin forever while the unanchored chip beside it (reading
 * `archivedIds`) counted zero. A per-builder obligation can be skipped by
 * omission; a filter over the assembled array cannot, so the eleventh builder
 * inherits the rule by existing.
 *
 * **Kind-blind by construction, and deliberately so.** `archivedIds` is a set
 * of raw card ids across every panel — the same set the margin markers test
 * `m.entityId` against — so reading it here is what makes the two surfaces
 * agree BY CONSTRUCTION rather than by two implementations staying in step.
 * The `isArchivable` gate below adds no discrimination against that set; it is
 * a cheap statement of scope, so a non-archivable kind (`example`, `error`)
 * whose entity id somehow collided with an archived card's could never be
 * dropped by this rule.
 *
 * Cost: O(items) once per `items` memo — already that memo's own scale, and
 * off the keystroke path (the memo rebuilds only when a sidecar collection or
 * a selection id changes).
 */
import { parseFloatKey } from "@/floats/float-key";
import { CARD_REGISTRY } from "@/cards/card-registry";
import { isArchivable } from "@/cards/predicates";
import type { CardKind } from "@/cards/types";
import type { OmniItem } from "@/panels/_shared/types";

/** A multi-anchor card publishes one row per anchor, `…@<index>`
 *  (`buildOmniAnchorRows`). Digits-only and anchored at the END, so it can
 *  never eat an `@` that belongs to a card id. */
const MULTI_ANCHOR_SUFFIX = /@\d+$/;

/**
 * The `(kind, id)` an `OmniItem.id` names, or null when the id is not an
 * archivable card's row. Every builder's id is `cardPopKey(kind, id)` =
 * `float:card:<kind>:<id>`, optionally `@<n>`-suffixed for a multi-anchor row.
 * Parsing is colon-safe (`parseFloatKey` takes everything after the 3rd colon
 * as the id), so a card id carrying interior colons round-trips.
 */
export function omniItemCardRef(
  omniId: string,
): { kind: CardKind; id: string } | null {
  const parsed = parseFloatKey(omniId);
  if (!parsed || parsed.domain !== "card") return null;
  if (!(parsed.kind in CARD_REGISTRY)) return null;
  const kind = parsed.kind as CardKind;
  if (!isArchivable(kind)) return null;
  const id = parsed.id.replace(MULTI_ANCHOR_SUFFIX, "");
  return id ? { kind, id } : null;
}

/** Whether this omni row belongs to a card the cross-panel SSOT says is archived. */
export function omniItemIsArchived(
  item: OmniItem,
  archivedIds: ReadonlySet<string>,
): boolean {
  if (archivedIds.size === 0) return false;
  const ref = omniItemCardRef(item.id);
  return ref !== null && archivedIds.has(ref.id);
}

/**
 * Drop every row belonging to an archived card. Identity-stable when nothing
 * is archived (the common case), so downstream memos stay cached.
 */
export function filterArchivedOmniItems(
  items: OmniItem[],
  archivedIds: ReadonlySet<string>,
): OmniItem[] {
  if (archivedIds.size === 0) return items;
  const kept = items.filter((it) => !omniItemIsArchived(it, archivedIds));
  return kept.length === items.length ? items : kept;
}
