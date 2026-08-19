/**
 * **The emergency local mirror** — task 391, the memory-side half of the
 * disk-side laws.
 *
 * 2026-08-19, ~70 minutes of writing lost. Every disk gate behaved as
 * designed: a sync daemon reverted the `.tex`, the DiskWatcher detected it,
 * the 364 clobber guard PAUSED autosave so Virgil would not overwrite the
 * external edit, and the file on disk stayed protected. Then the overnight
 * deploy's service-worker "Update available" banner appeared, the user clicked
 * it, and the page reloaded — dropping the only copy of the work.
 *
 * > **When a write cannot land, the editor's memory is the only copy. So
 * > memory gets a durable mirror, and no door that drops memory may cost more
 * > than one tick of it.** One mechanism bounds EVERY memory-drop door — the
 * > service-worker reload, the conflict badge's Reload, a tab close, a browser
 * > crash, an OS restart, and the doors nobody has found yet — to seconds.
 *
 * ## Why IndexedDB, and why not the FSA disk
 *
 * The disk is precisely what cannot be written: the mirror exists for the
 * states in which a disk write is refused, paused, or erroring, so a mirror
 * that lived on disk would be unavailable exactly when it is needed.
 * IndexedDB is same-origin, survives a reload and a crash, needs no
 * permission, and is already where Virgil keeps its doc index and TeX cache —
 * so the privacy footprint is unchanged. It rides the SAME `virgil`/`kv`
 * store those use; do not open a second database.
 *
 * ## What is stored, and what is NOT
 *
 * The live ProseMirror model (`editor.getJSON()`), plus the metadata a
 * recovery decision needs: when the mirror was taken, when this document last
 * landed on disk, and WHY it could not land. Deliberately not the `.tex`
 * bytes: the mirror is a MODEL, so restoring it goes back through the same
 * mount and preservation gates any load does (task 357) rather than around
 * them, and the serializer — which can itself refuse (357's dispatcher half)
 * — is never on the emergency path.
 *
 * ## Lifecycle
 *
 * Armed by {@link shouldMirror} whenever a document holds unlanded work that
 * is either BLOCKED (write refused / paused / erroring — arm at once, this is
 * the incident's state) or simply AGING past {@link MIRROR_ARM_AFTER_MS} (a
 * long uninterrupted typing burst never lets the 1500 ms debounce fire, so
 * memory is the only copy there too — a crash, not a gate, is that state's
 * hazard). Written on a wall-clock tick, equality-bailed. **Cleared by one
 * thing only: a write that actually landed.** So a mirror that survives to the
 * next open is, by construction, work that never reached disk.
 *
 * ## Multi-window
 *
 * One slot per document, last-writer-wins, stamped with the writing window's
 * id. That is sound rather than lossy because doc ownership is already
 * single-writer across windows (`multi-window/doc-ownership.ts` holds a Web
 * Lock per open doc), so at most one window is editing a given paper; the
 * `windowId` is recorded so a recovery offer can say where the work came from
 * and so a future handoff can reason about it.
 *
 * ## Keystroke sanctity
 *
 * Nothing here subscribes to the editor. The only caller is a wall-clock
 * interval (plus the tab-hidden settle edge), which asks for the model ONCE
 * per tick and bails on an unchanged snapshot — reference-first, so the shared
 * DocProducts `docJson` costs an O(1) compare. Typing runs zero code in this
 * module.
 */

import { get, set, del, keys, createStore } from "idb-keyval";
import type { JSONContent } from "@tiptap/react";

import { hashContent } from "@/lib/disk-ledger";
import {
  getUnsavedWork,
  type UnsavedBlockReason,
  type UnsavedWorkState,
} from "@/lib/unsaved-work";

// Reuse the SAME origin store doc-index / tex-assets / doc-ownership use.
const store = createStore("virgil", "kv");

const KEY_PREFIX = "emergency-mirror/";

/** How often the ticker asks the editor for a snapshot while armed. The floor
 *  on how much a crash can cost. */
export const MIRROR_TICK_MS = 5_000;

/**
 * How long unlanded work with NO stated blocking reason may age before the
 * mirror arms. Deliberately several times the 1500 ms autosave debounce: an
 * ordinary typing burst lands normally and must never touch IndexedDB, while a
 * sustained burst (which keeps resetting the debounce, so no write is even
 * attempted) does get covered.
 */
export const MIRROR_ARM_AFTER_MS = 8_000;

/** A mirror older than this is debris — the paper was almost certainly saved
 *  from elsewhere, or abandoned. Swept on the first read of a session. */
export const MIRROR_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface EmergencyMirrorEntry {
  docId: string;
  /** The live editor model at the moment of the tick. */
  content: JSONContent;
  /** ms epoch of this tick. */
  savedAt: number;
  /** ms epoch of the last write that landed on disk, or `null`. */
  lastLandedAt: number | null;
  /** Why the work could not land, or `null` when it was merely aging. */
  reason: UnsavedBlockReason | null;
  /** Which window wrote this slot. */
  windowId: string;
  /** Fingerprint of `content`, so a reader can compare against the loaded
   *  bundle without a deep walk. */
  hash: string;
}

function keyFor(docId: string): string {
  return KEY_PREFIX + docId;
}

/**
 * Should this document's model be mirrored right now? The single arming
 * predicate, pure over the channel state so both the ticker and its tests ask
 * the same question.
 */
export function shouldMirror(
  state: UnsavedWorkState | null,
  now: number,
  /**
   * Bypass the AGING half of the rule. A door that is about to drop memory
   * passes this: "a write is on its way" stops being true the moment the page
   * goes, so young unlanded work is exactly as exposed as old unlanded work.
   * It does NOT bypass the dirty test — clean work needs no mirror.
   */
  force = false,
): boolean {
  if (!state || state.dirtySince === null) return false;
  // Blocked — this IS the incident's state; memory is the only copy NOW.
  if (state.reason !== null) return true;
  if (force) return true;
  // Unblocked but aging: a write is nominally on its way and simply has not
  // landed. Cover it once it outlives several debounce windows.
  return now - state.dirtySince >= MIRROR_ARM_AFTER_MS;
}

/** Read this document's mirror, sweeping it if it has aged out. */
export async function readMirror(
  docId: string,
  now = Date.now(),
): Promise<EmergencyMirrorEntry | null> {
  let entry: EmergencyMirrorEntry | undefined;
  try {
    entry = await get<EmergencyMirrorEntry>(keyFor(docId), store);
  } catch (err) {
    console.warn("[emergency-mirror] read failed", err);
    return null;
  }
  if (!entry) return null;
  if (now - entry.savedAt > MIRROR_MAX_AGE_MS) {
    await clearMirror(docId);
    return null;
  }
  return entry;
}

export async function writeMirror(entry: EmergencyMirrorEntry): Promise<void> {
  await set(keyFor(entry.docId), entry, store);
}

/**
 * Drop this document's mirror. Called on a landed save (the work is on disk)
 * and on the user's discard. Never called by a refusal — a refused write is
 * the whole reason the mirror exists.
 */
export async function clearMirror(docId: string): Promise<void> {
  try {
    await del(keyFor(docId), store);
  } catch (err) {
    console.warn("[emergency-mirror] clear failed", err);
  }
}

/**
 * Sweep mirrors that have aged past {@link MIRROR_MAX_AGE_MS}. Cheap (the
 * keyspace holds at most one entry per paper ever opened) and run once per
 * session from the recovery surface, so a document that is never reopened
 * cannot leak its slot forever.
 */
export async function pruneExpiredMirrors(now = Date.now()): Promise<number> {
  let allKeys: IDBValidKey[];
  try {
    allKeys = await keys(store);
  } catch {
    return 0;
  }
  let dropped = 0;
  for (const k of allKeys) {
    if (typeof k !== "string" || !k.startsWith(KEY_PREFIX)) continue;
    try {
      const entry = await get<EmergencyMirrorEntry>(k, store);
      if (!entry || now - entry.savedAt > MIRROR_MAX_AGE_MS) {
        await del(k, store);
        dropped++;
      }
    } catch {
      /* one unreadable slot must not strand the sweep */
    }
  }
  return dropped;
}

/**
 * The ticker. Owns the equality bail and the arming decision; knows nothing
 * about React or timers, so its whole contract is testable by calling
 * {@link MirrorTicker.tick} directly.
 */
export interface MirrorTicker {
  /**
   * Take one tick. Returns what it did, so a caller (and the suite) can tell a
   * write from a bail without watching IndexedDB.
   */
  tick(opts?: {
    now?: number;
    /** See {@link shouldMirror} — arm regardless of age. */
    force?: boolean;
  }): Promise<"written" | "unchanged" | "not-armed" | "no-model">;
  /** Forget the last-mirrored fingerprint (after a landed save clears the
   *  slot, the next armed tick must write again even at identical content). */
  reset(): void;
}

export function createMirrorTicker(opts: {
  docId: string;
  /** The live model, or `null` when the editor is gone. */
  getModel: () => JSONContent | null;
  windowId: string;
  /** Injected for tests; defaults to the real IndexedDB write. */
  write?: (entry: EmergencyMirrorEntry) => Promise<void>;
  /** Injected for tests; defaults to the real channel. */
  readState?: (docId: string) => UnsavedWorkState | null;
}): MirrorTicker {
  const write = opts.write ?? writeMirror;
  const readState = opts.readState ?? getUnsavedWork;
  let lastRef: JSONContent | null = null;
  let lastHash: string | null = null;

  return {
    reset() {
      lastRef = null;
      lastHash = null;
    },
    async tick(tickOpts = {}) {
      const now = tickOpts.now ?? Date.now();
      const state = readState(opts.docId);
      if (!shouldMirror(state, now, tickOpts.force === true)) return "not-armed";
      const model = opts.getModel();
      if (!model) return "no-model";
      // Reference-first: with the DocProducts pipeline mounted the shared
      // docJson is identity-stable for an unchanged document, so a quiet
      // armed tick costs one compare and no serialization.
      if (lastRef !== null && model === lastRef) return "unchanged";
      const hash = hashContent(JSON.stringify(model));
      if (hash === lastHash) {
        lastRef = model;
        return "unchanged";
      }
      try {
        await write({
          docId: opts.docId,
          content: model,
          savedAt: now,
          lastLandedAt: state?.lastLandedAt ?? null,
          reason: state?.reason ?? null,
          windowId: opts.windowId,
          hash,
        });
      } catch (err) {
        // Quota, a private-mode block, a closed database. The mirror is a net,
        // never a gate: a failure to mirror must not disturb editing, and the
        // next tick retries.
        console.warn("[emergency-mirror] write failed", err);
        return "unchanged";
      }
      lastRef = model;
      lastHash = hash;
      return "written";
    },
  };
}

// ── The live-ticker registry ───────────────────────────────────────────
//
// The reload doors are app-wide (a reload drops every mounted pipeline at
// once) while the tickers are per document, so the doors need a way to say
// "mirror everything that has not landed, NOW" without knowing which papers
// are open. Same token-matched shape as `multi-window/pending-saves.ts`, and
// for the same reason: a stale registration must not evict the live one.

const tickers = new Map<string, MirrorTicker>();

export function registerMirrorTicker(docId: string, t: MirrorTicker): void {
  tickers.set(docId, t);
}

export function unregisterMirrorTicker(docId: string, t: MirrorTicker): void {
  if (tickers.get(docId) === t) tickers.delete(docId);
}

/**
 * Take one tick on every registered ticker and wait for them. Each ticker
 * self-gates on {@link shouldMirror}, so a document whose work has landed
 * writes nothing.
 *
 * `force` bypasses the AGING half of the arming rule: a door that is about to
 * drop memory must mirror work that is merely young, because "a write is on
 * its way" stops being true the moment the page goes.
 */
export async function mirrorAllNow(
  opts: { force?: boolean } = {},
): Promise<void> {
  await Promise.all(
    [...tickers.values()].map((t) =>
      t.tick({ force: opts.force === true }).catch(() => "unchanged" as const),
    ),
  );
}

/** Test helper — wipe all registrations. */
export function __resetTickersForTests(): void {
  tickers.clear();
}
