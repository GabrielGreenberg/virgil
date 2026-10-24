"use client";

import { useMemo } from "react";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
import type { ArchiveOriginPanel } from "@/lib/archive-origin";
import type { PanelKind } from "@/panels/_shared/types";
import type { DormantDoors } from "./useDormantRevival";

/**
 * The CARRYING STORES (task 1271) — the card stores whose records can travel
 * with an archived passage, keyed by the archive-origin panel vocabulary
 * (`ARCHIVE_ORIGIN_PANELS`, the set `cmd_archive` admits).
 *
 * The dormant-link round trip has three doors — `carry` (the archive),
 * `returnRemapped` (Restore's collision remap) and `release` (the passage is
 * deleted for good) — plus the archive-origin `reinstate`. All four are
 * per-STORE, not per-kind, so they live in ONE table: a `DormantStoreTable`
 * entry supplies every door or fails to type-check, and the exhaustive key
 * makes a missing store a type error. `EditorPane` builds the table once and
 * READS it at all four sites — the lifecycle literal's per-kind `carry`, the
 * Restore remap, the passage delete and `reinstate`. Before this, only `carry`
 * rode a censused table; the other two were hand-lists of five hooks, so a new
 * carrying store could wire `carry` and silently never follow a remap or be
 * released.
 */
export interface DormantStore extends DormantDoors {
  /** Archive-origin restore door (task 712): put the verbatim card back. */
  reinstate: (raw: unknown) => boolean;
}

export type DormantStoreTable = Record<ArchiveOriginPanel, DormantStore>;

/** `CARD_REGISTRY[kind].panel` → the carrying store that holds its records.
 *  The two vocabularies differ only in `todo` vs `todos`. */
const STORE_OF_PANEL: Partial<Record<PanelKind, ArchiveOriginPanel>> = {
  notes: "notes",
  todo: "todos",
  cutter: "cutter",
  revisions: "revisions",
  reports: "reports",
};

/** Which carrying store holds `kind`'s cards — null for a kind no store
 *  carries. Derived from the registry's `panel`, never listed per kind. The
 *  CENSUS (`dormant-store-census.test.ts`) pins that every kind declaring
 *  `lifecycle.carry` resolves here, and that the lifecycle literal's `carry`
 *  reads exactly this store's door. */
export function dormantStoreOfKind(kind: CardKind): ArchiveOriginPanel | null {
  const panel = CARD_REGISTRY[kind]?.panel;
  return (panel && STORE_OF_PANEL[panel]) || null;
}

/** One store's doors, memoized on the door identities (each is a stable
 *  callback) rather than on the hook object, whose identity follows its cards. */
function useStore(s: DormantStore): DormantStore {
  const { carry, returnRemapped, release, reinstate } = s;
  return useMemo(
    () => ({ carry, returnRemapped, release, reinstate }),
    [carry, returnRemapped, release, reinstate],
  );
}

/** Build the table once per host. Stable across typing: every member is. */
export function useDormantStores(stores: DormantStoreTable): DormantStoreTable {
  const notes = useStore(stores.notes);
  const todos = useStore(stores.todos);
  const cutter = useStore(stores.cutter);
  const revisions = useStore(stores.revisions);
  const reports = useStore(stores.reports);
  return useMemo(
    () => ({ notes, todos, cutter, revisions, reports }),
    [notes, todos, cutter, revisions, reports],
  );
}
