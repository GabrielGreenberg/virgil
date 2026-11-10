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
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { isHistoryTransaction, redoDepth, undoDepth } from "@tiptap/pm/history";
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

/** Do holdings answer THIS removal at all? Only when the batch is the REDO OF
 *  AN ARCHIVE — the one removal that re-enacts the archive without saying so.
 *
 *  A snippet stays un-retired through an Undo of its archive (pinned on
 *  purpose — task 1297: it is still a record a Restore can use), so its ids
 *  are held while the passage is LIVE again. Any other removal of that live
 *  passage is not the archive and its cards must orphan exactly as if nothing
 *  were archived: an ordinary Backspace / Cut (1297), but equally an UNDO that
 *  takes the passage away (undoing the paste that created it), or a REDO of
 *  some other event (an ordinary Cut of it, undone). "Is this a history
 *  transaction?" was a proxy for the literal question and answered yes to all
 *  of those (task 1302). The literal answer is kept by `archiveReplayTracker`,
 *  which follows each archive's own history EVENT through the undo/redo
 *  stacks and marks the transaction that redoes it. Every guard that consults
 *  the registry asks this first, so all of them give one answer per batch.
 *  O(batch). */
export function holdingsApplyTo(transactions: readonly Transaction[]): boolean {
  return holdingsScopeOf(transactions) !== null;
}

/** WHICH holdings answer this removal (task 1557) — the one question every
 *  guard asks, so all of them give one answer per batch:
 *
 *    - `"clipboard"` — a CUT (ProseMirror's own `uiEvent: "cut"`). Cut is
 *      "archive to the clipboard": the passage's ids are held by the clipboard
 *      holding `clipboard-carry.ts` published as the cut began, and its cards
 *      go dormant there until a paste lands them. Only CLIPBOARD holdings are
 *      consulted, so an ordinary Cut of a passage an undone archive still
 *      holds orphans into nothing archive-side (task 1297 stands).
 *    - `"archive"` — the Redo of an archive (above).
 *    - `"clipboard"` too for the two HISTORY replays of the clipboard's carry
 *      (`archiveReplayTracker`): the Redo of a cut (it re-takes the passage
 *      to the clipboard), and the Undo of the paste that LANDED a held cut
 *      (it takes the landed passage back off the page — its cards return to
 *      dormant in the holding, so a later paste carries them again).
 *    - `null` — every other removal: nothing is held.
 *
 *  O(batch). */
export type HoldingsScope = "archive" | "clipboard";

export function holdingsScopeOf(transactions: readonly Transaction[]): HoldingsScope | null {
  let scope: HoldingsScope | null = null;
  for (const tr of transactions) {
    if (tr.getMeta("uiEvent") === "cut") return "clipboard";
    const replayed = CARRY_REPLAYS.get(tr);
    if (replayed === "clipboard") return "clipboard";
    if (replayed) scope = replayed;
  }
  return scope;
}

// ---------------------------------------------------------------------------
// The carry's history events (tasks 1302, 1557)
// ---------------------------------------------------------------------------

/** Set by the archive GESTURE's transaction (`commitRangeDelete` with an
 *  archive card half) — arms the tracker on the event it lands in. */
export const ARCHIVE_GESTURE_META = "virgilArchiveGesture";

/** Set by the transaction that LANDS a held cut (`clipboard-carry.ts`'s
 *  paste) — arms the tracker so the Undo of that paste re-carries. */
export const CLIPBOARD_LANDING_META = "virgilClipboardLanding";

/** A carry the history can replay, and which way the replay runs:
 *
 *    - an ARCHIVE gesture — its REDO re-removes the passage into the archive;
 *    - a CUT (`uiEvent: "cut"`) — its REDO re-takes it to the clipboard;
 *    - a clipboard LANDING — its UNDO takes the landed passage back off the
 *      page, into the clipboard holding it came from.
 *
 *  The opposite direction of each (Undo of the archive / the cut, Redo of the
 *  landing) brings the ids back, and dormant links revive by liveness — no
 *  scope needed. */
type CarryKind = "archive" | "cut" | "landing";

const CARRY_SCOPE: Record<CarryKind, HoldingsScope> = {
  archive: "archive",
  cut: "clipboard",
  landing: "clipboard",
};
const REPLAYED_BY: Record<CarryKind, "undo" | "redo"> = {
  archive: "redo",
  cut: "redo",
  landing: "undo",
};

/** Where a carry's history event sits. `done` / `undone` name the stack and
 *  `depth` its eventCount WHILE the event is on top: it is still in that stack
 *  exactly as long as the stack never shrinks below `depth` (history only
 *  pops from the top, and a new edit clears the redo stack to 0). `pending` is
 *  the gesture itself, resolved on the next transaction, when the event is the
 *  top of the done stack. */
type CarryEventSlot = { kind: CarryKind } & (
  | { side: "pending" }
  | { side: "done" | "undone"; depth: number }
);

/** The transactions that REPLAY a carry, with the holdings scope they replay
 *  into. Keyed by the transaction object, so it is per-editor by construction
 *  and lets go with the batch. */
const CARRY_REPLAYS = new WeakMap<Transaction, HoldingsScope>();

/** The carry a transaction itself performs, if any. A cut that changed
 *  nothing (an empty selection) is no event. */
function carryKindOf(tr: Transaction): CarryKind | null {
  if (tr.getMeta(ARCHIVE_GESTURE_META) === true) return "archive";
  if (tr.getMeta(CLIPBOARD_LANDING_META) === true) return "landing";
  if (tr.docChanged && tr.getMeta("uiEvent") === "cut") return "cut";
  return null;
}

/** "undo" / "redo" for a prosemirror-history transaction, else null. Its meta
 *  is `{ redo, historyState }` under the history plugin's key, which the
 *  package does not export — so it is read through the plugin. O(plugins),
 *  history transactions only. */
function historyDirection(tr: Transaction, state: EditorState): "undo" | "redo" | null {
  if (!isHistoryTransaction(tr)) return null;
  for (const p of state.plugins) {
    const m = tr.getMeta(p) as { redo?: unknown; historyState?: unknown } | undefined;
    if (m && typeof m === "object" && typeof m.redo === "boolean" && "historyState" in m) {
      return m.redo ? "redo" : "undo";
    }
  }
  return null;
}

/** Follow every carry's history event; mark the transaction that REPLAYS one
 *  (`holdingsScopeOf`). Depths are read off the OLD state of each transaction
 *  (fully built, whatever this plugin's order relative to history's), so every
 *  change to a stack is observed at the next transaction — before any undo /
 *  redo can act on it. An event that leaves its stack any other way (the redo
 *  stack cleared by a new edit, the done stack trimmed past it) is dropped:
 *  failing closed means its cards orphan, never go dormant on a guess. */
export function archiveReplayTracker(): Plugin<readonly CarryEventSlot[]> {
  return new Plugin<readonly CarryEventSlot[]>({
    key: new PluginKey("archiveReplayTracker"),
    state: {
      init: () => [],
      // [cost: O(1)/tx with no carry in history; else O(carry events still in the undo/redo stacks) depth compares — two eventCount reads, no doc walk on any path] (tasks 1302, 1557)
      apply(tr, slots, oldState) {
        const gesture = carryKindOf(tr);
        if (slots.length === 0 && !gesture) return slots;
        const done = undoDepth(oldState);
        const undone = redoDepth(oldState);
        const dir = historyDirection(tr, oldState);
        let changed = gesture !== null;
        const next: CarryEventSlot[] = [];
        for (const slot of slots) {
          const s: CarryEventSlot =
            slot.side === "pending" ? { kind: slot.kind, side: "done", depth: done } : slot;
          if (s !== slot) changed = true;
          if (s.side === "done") {
            if (done < s.depth) { changed = true; continue; } // trimmed away
            if (dir === "undo" && done === s.depth) {
              if (REPLAYED_BY[s.kind] === "undo") CARRY_REPLAYS.set(tr, CARRY_SCOPE[s.kind]);
              next.push({ kind: s.kind, side: "undone", depth: undone + 1 });
              changed = true;
              continue;
            }
          } else if (s.side === "undone") {
            if (undone < s.depth) { changed = true; continue; } // redo stack cleared
            if (dir === "redo" && undone === s.depth) {
              if (REPLAYED_BY[s.kind] === "redo") CARRY_REPLAYS.set(tr, CARRY_SCOPE[s.kind]);
              next.push({ kind: s.kind, side: "done", depth: done + 1 });
              changed = true;
              continue;
            }
          }
          next.push(s);
        }
        if (gesture) next.push({ kind: gesture, side: "pending" });
        return changed ? next : slots;
      },
    },
  });
}

interface HoldingsEntry {
  scope: HoldingsScope;
  holdings: ArchiveHoldings;
}

const REGISTRY = new Map<string, Map<object, HoldingsEntry>>();

function publish(docId: string, owner: object, entry: HoldingsEntry): void {
  let byOwner = REGISTRY.get(docId);
  if (!byOwner) {
    byOwner = new Map();
    REGISTRY.set(docId, byOwner);
  }
  byOwner.set(owner, entry);
}

export function publishArchiveHoldings(
  docId: string,
  owner: object,
  holdings: ArchiveHoldings,
): void {
  publish(docId, owner, { scope: "archive", holdings });
}

/** The CLIPBOARD's holding (task 1557): the ids a cut took to the clipboard,
 *  keyed by the clipboard holding's id. Same registry, same owner rule — the
 *  publishing `ClipboardCarry` plugin view is the owner, so one editor's cut
 *  never replaces another pane's. */
export function publishClipboardHoldings(
  docId: string,
  owner: object,
  holdings: ArchiveHoldings,
): void {
  publish(docId, owner, { scope: "clipboard", holdings });
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
  scope: HoldingsScope,
): string | null {
  if (!docId) return null;
  const byOwner = REGISTRY.get(docId);
  if (!byOwner) return null;
  for (const e of byOwner.values()) {
    if (e.scope !== scope) continue;
    const id = pick(e.holdings);
    if (id) return id;
  }
  return null;
}

/** The un-retired holding (an archive snippet, or the clipboard's — `scope`)
 *  of block `uuid` in `docId`, or null. O(owners). */
export function snippetHoldingUuid(
  docId: string | null | undefined,
  uuid: string,
  scope: HoldingsScope = "archive",
): string | null {
  return lookup(docId, (h) => h.uuids.get(uuid), scope);
}

/** The un-retired holding of `linkedAnchor` id `anchorId`, or null. */
export function snippetHoldingAnchor(
  docId: string | null | undefined,
  anchorId: string,
  scope: HoldingsScope = "archive",
): string | null {
  return lookup(docId, (h) => h.anchorIds.get(anchorId), scope);
}

/** Group departing ids by the snippet that holds them — the shape of the
 *  `virgil-anchors-archived` event. Ids no snippet holds are left out. */
export function groupHeldDepartures(
  docId: string | null | undefined,
  departed: { uuids?: readonly string[]; anchorIds?: readonly string[] },
  scope: HoldingsScope = "archive",
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
    const s = snippetHoldingUuid(docId, u, scope);
    if (s) slot(s).uuids.push(u);
  }
  for (const a of departed.anchorIds ?? []) {
    const s = snippetHoldingAnchor(docId, a, scope);
    if (s) slot(s).anchorIds.push(a);
  }
  return out;
}

/** Test seam: drop every entry. */
export function __resetArchiveHoldingsForTests(): void {
  REGISTRY.clear();
}
