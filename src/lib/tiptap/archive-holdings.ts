// ARCHIVE HOLDINGS (task 1269) — "is this departing id held by an archive?"
//
// An archive capture takes a passage's identities with it: the uuids of the
// blocks it removed WHOLE (a partial cut is uuid-less by `cutFreshAttrs`) and
// the `linkedAnchor` ids its carried marks name (`carriedMarks`). While the
// snippet is un-retired, those ids are not dead — a Restore brings them back.
//
// The archive GESTURE says so itself (LIFECYCLE_DELETE_META + the per-kind
// `carry`). A HISTORY REPLAY of it does not: Redo of an Archive re-removes the
// same text with no meta, so the anchor guard resurrected an empty placeholder
// and the orphan sweep stripped the cards. The answer has to follow the
// DOCUMENT, not the gesture — so the guards ask this registry, which
// `useArchive` publishes from its snippets on every archive change (never per
// transaction: a lookup here is O(1)).
//
// Per-doc under multi-pane keep-alive: a REGISTRY keyed by docId, each entry
// keyed by its OWNER (the publishing hook instance), and a departing owner
// retracts only its own entry.

import type { JSONContent } from "@tiptap/react";
import type { Transaction } from "@tiptap/pm/state";
import { isHistoryTransaction } from "@tiptap/pm/history";
import type { ArchivedSnippet } from "@/lib/types";
import { archiveOriginOf } from "@/lib/archive-origin";

export interface ArchiveHoldings {
  /** Block uuid → the un-retired snippet whose content holds it. */
  uuids: ReadonlyMap<string, string>;
  /** `linkedAnchor` id → the un-retired snippet whose carried marks name it. */
  anchorIds: ReadonlyMap<string, string>;
}

export const NO_HOLDINGS: ArchiveHoldings = { uuids: new Map(), anchorIds: new Map() };

const HELD_BY_SNIPPET = new WeakMap<ArchivedSnippet, { uuids: string[]; anchorIds: string[] }>();

function collectUuids(node: JSONContent | undefined, out: string[]): void {
  if (!node) return;
  const uuid = (node.attrs as { uuid?: unknown } | undefined)?.uuid;
  if (typeof uuid === "string" && uuid) out.push(uuid);
  for (const child of node.content ?? []) collectUuids(child, out);
}

function heldBySnippet(s: ArchivedSnippet): { uuids: string[]; anchorIds: string[] } {
  let held = HELD_BY_SNIPPET.get(s);
  if (!held) {
    const uuids: string[] = [];
    collectUuids(s.content, uuids);
    held = {
      uuids,
      anchorIds: (s.carriedMarks ?? []).map((m) => m.anchorId).filter(Boolean),
    };
    HELD_BY_SNIPPET.set(s, held);
  }
  return held;
}

/** What the snippets hold. A retired snippet (`archived`: restored, or set
 *  aside — `restoreSnippet` refuses either) can bring nothing back, and a
 *  whole-CARD snippet (task 712) holds a card's words, not paper text — both
 *  hold nothing. Cached per snippet object, so an archive change re-reads only
 *  the snippets that changed. */
export function holdingsOf(snippets: readonly ArchivedSnippet[]): ArchiveHoldings {
  const uuids = new Map<string, string>();
  const anchorIds = new Map<string, string>();
  for (const s of snippets) {
    if (s.archived) continue;
    if (archiveOriginOf(s).kind !== "excerpt") continue;
    const held = heldBySnippet(s);
    for (const u of held.uuids) uuids.set(u, s.id);
    for (const a of held.anchorIds) anchorIds.set(a, s.id);
  }
  return uuids.size === 0 && anchorIds.size === 0 ? NO_HOLDINGS : { uuids, anchorIds };
}

/** Task 1297: do holdings answer THIS removal at all? Only a HISTORY REPLAY.
 *  A snippet stays un-retired through an Undo of its archive (pinned on
 *  purpose — it is still a record a Restore can use), so its ids are held
 *  while the passage is LIVE again. A later ordinary Backspace / Cut of that
 *  passage is not the archive — its cards must orphan exactly as if nothing
 *  were archived. A Redo is the one removal that re-enacts the archive without
 *  saying so, and prosemirror-history marks it. Every guard that consults the
 *  registry asks this first, so all of them give one answer per batch. O(batch). */
export function holdingsApplyTo(transactions: readonly Transaction[]): boolean {
  return transactions.some((tr) => isHistoryTransaction(tr));
}

const REGISTRY = new Map<string, Map<object, ArchiveHoldings>>();

export function publishArchiveHoldings(
  docId: string,
  owner: object,
  holdings: ArchiveHoldings,
): void {
  let byOwner = REGISTRY.get(docId);
  if (!byOwner) {
    byOwner = new Map();
    REGISTRY.set(docId, byOwner);
  }
  byOwner.set(owner, holdings);
}

/** A departing owner removes only its OWN entry. */
export function retractArchiveHoldings(docId: string, owner: object): void {
  const byOwner = REGISTRY.get(docId);
  if (!byOwner) return;
  byOwner.delete(owner);
  if (byOwner.size === 0) REGISTRY.delete(docId);
}

function lookup(
  docId: string | null | undefined,
  pick: (h: ArchiveHoldings) => string | undefined,
): string | null {
  if (!docId) return null;
  const byOwner = REGISTRY.get(docId);
  if (!byOwner) return null;
  for (const h of byOwner.values()) {
    const id = pick(h);
    if (id) return id;
  }
  return null;
}

/** The un-retired snippet holding block `uuid` in `docId`, or null. O(owners). */
export function snippetHoldingUuid(docId: string | null | undefined, uuid: string): string | null {
  return lookup(docId, (h) => h.uuids.get(uuid));
}

/** The un-retired snippet holding `linkedAnchor` id `anchorId`, or null. */
export function snippetHoldingAnchor(
  docId: string | null | undefined,
  anchorId: string,
): string | null {
  return lookup(docId, (h) => h.anchorIds.get(anchorId));
}

/** Group departing ids by the snippet that holds them — the shape of the
 *  `virgil-anchors-archived` event. Ids no snippet holds are left out. */
export function groupHeldDepartures(
  docId: string | null | undefined,
  departed: { uuids?: readonly string[]; anchorIds?: readonly string[] },
): Map<string, { uuids: string[]; anchorIds: string[] }> {
  const out = new Map<string, { uuids: string[]; anchorIds: string[] }>();
  const slot = (snippetId: string) => {
    let g = out.get(snippetId);
    if (!g) {
      g = { uuids: [], anchorIds: [] };
      out.set(snippetId, g);
    }
    return g;
  };
  if (!docId || !REGISTRY.has(docId)) return out;
  for (const u of departed.uuids ?? []) {
    const s = snippetHoldingUuid(docId, u);
    if (s) slot(s).uuids.push(u);
  }
  for (const a of departed.anchorIds ?? []) {
    const s = snippetHoldingAnchor(docId, a);
    if (s) slot(s).anchorIds.push(a);
  }
  return out;
}

/** Test seam: drop every entry. */
export function __resetArchiveHoldingsForTests(): void {
  REGISTRY.clear();
}
