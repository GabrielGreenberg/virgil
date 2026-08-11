/**
 * Panel-tab COORDINATE SPACES — the projection and both of its inverses,
 * in ONE module.
 *
 * `useLibraryTabs` keeps two notions of "the tab list" and "the active tab":
 *
 *  - **raw** — the persisted `PanelTabsState` (`virgil-library-tabs-<panel>`).
 *    This is what every mutation splices, and it contains NO synthetic
 *    per-doc project ids.
 *  - **displayed** — what the strip actually renders: the raw list with the
 *    per-doc project tabs spliced in right after Central, and `activeId`
 *    overridden to the project tab of the current doc (unless the user has
 *    pinned a non-project tab).
 *
 * Anything the USER expresses — a drop insertion index, "the tab I am
 * looking at" — is stated in *displayed* coordinates, because the displayed
 * list is the only one they can see. Feeding such a value to a raw-space
 * mutator is a latent bug of one class (task 131): with N project tabs
 * present the two spaces differ by N, so a reorder lands N slots off (or
 * silently no-ops), and a replace-the-active-tab open clobbers whatever raw
 * `activeId` happens to point at — Central, which the user never closed.
 *
 * > **A projection that renders is a projection that mutates.** Where state
 * > is exposed through a projection, every input expressed in that
 * > projection's coordinates is translated back at the hook boundary, by the
 * > same module that built the projection — so the projection and its
 * > inverses cannot drift.
 *
 * All three functions here are pure so the translation is unit-testable
 * without a React tree; `useLibraryTabs` is their only consumer.
 */

import {
  CENTRAL_LIBRARY_ID,
  isProjectDocId,
  projectLibraryIdForDoc,
  type PanelTabsState,
} from "@library/lib/library-store";

export interface ProjectLeftTabsArgs {
  /** The persisted (raw) left-panel state. */
  raw: PanelTabsState;
  /** Visible per-doc project library ids, in doc order. Hidden ones
   *  (explicitly closed by the user) are filtered out by the caller. */
  projectIds: readonly string[];
  /** The Virgil doc currently in front, if any. Its project tab becomes the
   *  displayed active tab unless a non-project tab is pinned. */
  currentDocId?: string | null;
  /** The user's most-recent explicit click on a non-project tab. */
  pinnedActiveId?: string | null;
}

/**
 * raw → displayed. The ONE definition of the projection: project tabs sit
 * immediately after Central (or at the head when Central isn't first / is
 * closed), and the active id follows the current doc unless pinned.
 *
 * Note the shape this pins: a raw tab can never render *between* Central and
 * the project tabs. Several adjacent displayed insertion points therefore
 * denote the same raw slot — `displayedIndexToRaw` collapses them, which is
 * the correct answer rather than an approximation.
 */
export function projectLeftTabs(args: ProjectLeftTabsArgs): PanelTabsState {
  const { raw, projectIds, currentDocId, pinnedActiveId } = args;
  const persisted = raw.openIds.filter((id) => !isProjectDocId(id));
  const centralIdx = persisted.indexOf(CENTRAL_LIBRARY_ID);
  const openIds =
    centralIdx === 0
      ? [CENTRAL_LIBRARY_ID, ...projectIds, ...persisted.slice(1)]
      : [...projectIds, ...persisted];
  let activeId = raw.activeId;
  if (pinnedActiveId && openIds.includes(pinnedActiveId)) {
    activeId = pinnedActiveId;
  } else if (currentDocId) {
    const projId = projectLibraryIdForDoc(currentDocId);
    if (openIds.includes(projId)) activeId = projId;
  }
  if (!openIds.includes(activeId)) activeId = openIds[0] ?? "";
  return { openIds, activeId };
}

/**
 * displayed insertion index → raw insertion index.
 *
 * "Insert before `displayed[i]`" means "insert after every RAW tab that
 * precedes that point", so the answer is simply how many of the ids before
 * `i` are raw members. Counting membership rather than subtracting a project
 * count is total: it needs no assumption about where the projection put its
 * synthetic ids, and it stays correct for a panel with no projection at all
 * (displayed === raw → identity), which is why every mutator can route
 * through it unconditionally.
 */
export function displayedIndexToRaw(
  displayedIds: readonly string[],
  rawIds: readonly string[],
  displayedIndex: number,
): number {
  const clamped = Math.min(
    Math.max(0, displayedIndex),
    displayedIds.length,
  );
  const rawSet = new Set(rawIds);
  let raw = 0;
  for (let i = 0; i < clamped; i++) {
    if (rawSet.has(displayedIds[i])) raw++;
  }
  return raw;
}

export interface ResolveReplaceTargetArgs {
  /** The destination panel's RAW open ids. */
  rawIds: readonly string[];
  /** The DISPLAYED active id of that panel — the tab the user is looking at. */
  displayedActiveId: string;
  /** Whether an open raw tab may be replaced (known library, not pinned). */
  isReplaceable: (id: string) => boolean;
}

/**
 * The raw tab a newly-opened library/paper should REPLACE, or `null` to
 * append.
 *
 * Resolved from the DISPLAYED active id, because "replace the tab I'm
 * looking at" is the contract. A synthetic project tab is not in `rawIds`
 * and so has no slot to give up — that falls through to APPEND rather than
 * to "replace whatever raw `activeId` still points at", which is how opening
 * a library while a doc was in front used to make Central vanish.
 */
export function resolveReplaceTargetId(
  args: ResolveReplaceTargetArgs,
): string | null {
  const { rawIds, displayedActiveId, isReplaceable } = args;
  if (!displayedActiveId) return null;
  if (!rawIds.includes(displayedActiveId)) return null;
  return isReplaceable(displayedActiveId) ? displayedActiveId : null;
}
