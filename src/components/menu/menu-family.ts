/**
 * The open menu's FAMILY (task 1548) — kept out of `MenuProvider.tsx` so an
 * opener that only ASKS the question (the ⚡ bolt) does not import the menu
 * primitive's whole graph.
 */

/**
 * "Does this node belong to the open menu's FAMILY?" (task 1548) — the menu's
 * own container, every element on its click-outside exclude set (the caller's
 * `excludeRefs`: its trigger, a portaled child popover) and, recursively, every
 * nested provider's family. It is the SAME membership the click-outside
 * dismissal already treats as "inside", stated as one answer a consumer can ask.
 */
export type MenuFamilyTest = (node: Node | null) => boolean;

/** The recursive walk behind a `MenuFamilyTest`; `seen` guards a cycle. */
export type FamilyWalk = (node: Node, seen: Set<HTMLElement>) => boolean;
/** Each mounted provider's family test, keyed by its container element — so a
 *  parent whose exclude set holds a nested provider's container asks THAT
 *  provider (and through it, its own nested popovers) rather than a bare
 *  `contains` that would miss a grandchild portaled to `document.body`. */
export const FAMILY_BY_CONTAINER = new WeakMap<HTMLElement, FamilyWalk>();

/** Does the open menu family hold DOM focus right now? `false` for a null
 *  test (no menu open). One `activeElement` read — called on focus EDGES and
 *  inside an existing RAF-coalesced compute, never per transaction. */
export function menuFamilyOwnsFocus(
  test: MenuFamilyTest | null | undefined,
): boolean {
  if (!test || typeof document === "undefined") return false;
  const held = document.activeElement;
  return !!held && held !== document.body && test(held);
}
