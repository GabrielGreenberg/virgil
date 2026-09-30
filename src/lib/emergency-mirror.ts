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
 * ## The unanswered offer (task 851)
 *
 * > **An unanswered mirror ends only by the user's ANSWER (restore / discard)
 * > or by a landed write of THAT content.**
 *
 * The live slot is keyed per document, and the new session's own ticker and
 * its own first landed save both act on that slot — so, left there, the
 * surviving mirror would be overwritten or deleted by work that has nothing to
 * do with it while the offer still stands, and a second crash before the user
 * answered lost it for good. So the open path PROMOTES it
 * ({@link openMirrorRecovery}): the surviving entry is copied to its own
 * `emergency-mirror-offer/<docId>/<hash>` slot (write first, then delete the
 * live slot — never the other way round), and from then on nothing but the
 * answer ({@link clearMirrorOffer}), the open path's own hash match against
 * what was loaded, or the doc id's retirement (`purgeDoc`) removes it. The
 * live slot is free for the new session.
 *
 * Nothing here deletes a mirror it cannot read: every read passes
 * `clearOnRefusal: false` (a malformed slot is reported to `__storageStats`
 * and left), and there is no age rule — age is not evidence that the work
 * reached disk. The one bound that may still delete is the slot COUNT
 * ({@link MIRROR_MAX_SLOTS}, task 757's size concern), which spares every
 * document open in this window and reports each eviction.
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

import { set, del, get, keys, createStore } from "idb-keyval";
import type { JSONContent } from "@tiptap/react";

import { hashContent } from "@/lib/disk-ledger";
import {
  noteStoredEviction,
  readStoredValue,
  type StoredVerdict,
} from "@/lib/stored-state";
import {
  getUnsavedWork,
  type UnsavedBlockReason,
  type UnsavedWorkState,
} from "@/lib/unsaved-work";

// Reuse the SAME origin store doc-index / tex-assets / doc-ownership use.
const store = createStore("virgil", "kv");

const KEY_PREFIX = "emergency-mirror/";
/** Task 851 — a surviving mirror the user has not yet answered, promoted out
 *  of the live slot so the new session cannot write or drop over it. */
const OFFER_PREFIX = "emergency-mirror-offer/";

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

/**
 * Task 757 — the per-slot WRITE cap, in characters of the model's JSON (which
 * the ticker computes anyway, for its fingerprint). A model this large is not
 * a paper a person typed; mirroring it would put tens of MB into IndexedDB on
 * a 5 s clock and hand the next open the same allocation to read back. Over
 * the cap the tick declines (and says so once) rather than writing.
 */
export const MIRROR_MAX_CHARS = 16 * 1024 * 1024;

/** Task 757 — the session sweep keeps at most this many slots (live + offer),
 *  newest first. One slot per paper ever left dirty; the count must not grow
 *  with use. Task 851: the ONLY rule that may delete unanswered work, so it
 *  spares every document open in this window and reports what it evicts. */
export const MIRROR_MAX_SLOTS = 24;

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

function offerPrefixFor(docId: string): string {
  return OFFER_PREFIX + docId + "/";
}

function offerKeyFor(docId: string, hash: string): string {
  return offerPrefixFor(docId) + hash;
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

/**
 * Task 757 — the mirror slot's shape check. A slot that is not a mountable
 * mirror (wrong doc, no model, a model that is not a `doc` node, missing
 * fingerprint) is refused: ABSENT to the reader, reported. Task 851: never
 * CLEARED — a shape the reader does not recognise (a schema change, a missing
 * field) may still be the user's only copy, so the bytes stay for a later
 * reader or a hand recovery.
 */
export function validateMirrorEntry(
  value: unknown,
  docId?: string,
): StoredVerdict {
  if (typeof value !== "object" || value === null) {
    return { why: "invalid", detail: "not an object" };
  }
  const e = value as Partial<EmergencyMirrorEntry>;
  if (typeof e.docId !== "string") return { why: "invalid", detail: "no docId" };
  if (docId !== undefined && e.docId !== docId) {
    return { why: "invalid", detail: `slot holds ${e.docId}` };
  }
  if (typeof e.savedAt !== "number" || !Number.isFinite(e.savedAt)) {
    return { why: "invalid", detail: "no savedAt" };
  }
  if (typeof e.hash !== "string") return { why: "invalid", detail: "no hash" };
  const c = e.content as { type?: unknown; content?: unknown } | undefined;
  if (!c || typeof c !== "object" || c.type !== "doc") {
    return { why: "invalid", detail: "content is not a doc model" };
  }
  if (c.content !== undefined && !Array.isArray(c.content)) {
    return { why: "invalid", detail: "doc content is not an array" };
  }
  return true;
}

/** Mirror reads go through the stored-state door (task 757) WITHOUT its
 *  clear-on-refusal (task 851): an unreadable or malformed slot is ABSENT and
 *  reported, never a throw — and never deleted. */
function readEntry(
  key: string,
  docId?: string,
): Promise<EmergencyMirrorEntry | null> {
  return readStoredValue<EmergencyMirrorEntry>(key, {
    store,
    validate: (v) => validateMirrorEntry(v, docId),
    clearOnRefusal: false,
  });
}

/** Read this document's LIVE mirror slot. */
export async function readMirror(
  docId: string,
): Promise<EmergencyMirrorEntry | null> {
  return readEntry(keyFor(docId), docId);
}

/** Every unanswered offer slot this document holds, newest first. */
async function readOffers(docId: string): Promise<
  { key: string; entry: EmergencyMirrorEntry }[]
> {
  let allKeys: IDBValidKey[];
  try {
    allKeys = await keys(store);
  } catch {
    return [];
  }
  const prefix = offerPrefixFor(docId);
  const out: { key: string; entry: EmergencyMirrorEntry }[] = [];
  for (const k of allKeys) {
    if (typeof k !== "string" || !k.startsWith(prefix)) continue;
    const entry = await readEntry(k, docId);
    if (entry) out.push({ key: k, entry });
  }
  out.sort((a, b) => b.entry.savedAt - a.entry.savedAt);
  return out;
}

/**
 * Task 851 — the open path's one question: what unanswered work does this
 * document hold that the loaded bundle (fingerprint `loadedHash`) does not?
 *
 * 1. A surviving LIVE slot whose content is what was loaded reached disk by
 *    some other route — it is cleared. Otherwise it is PROMOTED to an offer
 *    slot: written there first, and only then dropped from the live slot
 *    (re-read first, so a tick of this session that already landed in the
 *    live slot is not the one deleted). A failed promotion leaves the live
 *    slot alone and still offers it.
 * 2. Every offer slot whose content is what was loaded is cleared — that is
 *    "a landed write of THAT content", the one non-answer ending.
 * 3. The newest remaining offer is returned for the badge; older ones stay
 *    on disk and are offered in turn as each is answered
 *    ({@link readNextMirrorOffer}).
 */
export async function openMirrorRecovery(
  docId: string,
  loadedHash: string,
): Promise<EmergencyMirrorEntry | null> {
  const live = await readMirror(docId);
  let unpromoted: EmergencyMirrorEntry | null = null;
  if (live) {
    if (live.hash === loadedHash) {
      await clearMirror(docId);
    } else {
      try {
        await set(offerKeyFor(docId, live.hash), live, store);
        const still = (await get(keyFor(docId), store)) as
          | Partial<EmergencyMirrorEntry>
          | undefined;
        if (still?.hash === live.hash) await del(keyFor(docId), store);
      } catch (err) {
        console.warn("[emergency-mirror] offer promotion failed", err);
        unpromoted = live;
      }
    }
  }
  const offers = await readOffers(docId);
  const pending: EmergencyMirrorEntry[] = [];
  for (const { key, entry } of offers) {
    if (entry.hash === loadedHash) await del(key, store).catch(() => {});
    else pending.push(entry);
  }
  if (unpromoted) pending.unshift(unpromoted);
  return pending[0] ?? null;
}

/** The newest offer still standing for this document, after one was answered. */
export async function readNextMirrorOffer(
  docId: string,
): Promise<EmergencyMirrorEntry | null> {
  return (await readOffers(docId))[0]?.entry ?? null;
}

/**
 * The user ANSWERED this offer (restored it, landed; or discarded it) — drop
 * its slot. The one door that ends an offer on the user's word; also clears a
 * live slot still holding the same content (an unpromoted offer).
 */
export async function clearMirrorOffer(
  entry: Pick<EmergencyMirrorEntry, "docId" | "hash">,
): Promise<void> {
  try {
    await del(offerKeyFor(entry.docId, entry.hash), store);
    const live = (await get(keyFor(entry.docId), store)) as
      | Partial<EmergencyMirrorEntry>
      | undefined;
    if (live?.hash === entry.hash) await del(keyFor(entry.docId), store);
  } catch (err) {
    console.warn("[emergency-mirror] offer clear failed", err);
  }
}

/** Every offer slot of a RETIRED doc id (`purgeDoc` — task 604's door). */
export async function clearMirrorOffers(docId: string): Promise<void> {
  try {
    const prefix = offerPrefixFor(docId);
    for (const k of await keys(store)) {
      if (typeof k === "string" && k.startsWith(prefix)) await del(k, store);
    }
  } catch (err) {
    console.warn("[emergency-mirror] offer purge failed", err);
  }
}

export async function writeMirror(entry: EmergencyMirrorEntry): Promise<void> {
  await set(keyFor(entry.docId), entry, store);
}

/**
 * Drop this document's LIVE mirror slot. Called on a landed save (the work is
 * on disk) and on the user's discard. Never called by a refusal — a refused
 * write is the whole reason the mirror exists. Never touches an unanswered
 * offer (task 851): a landed save of THIS session's model says nothing about
 * the content an offer holds.
 */
export async function clearMirror(docId: string): Promise<void> {
  try {
    await del(keyFor(docId), store);
  } catch (err) {
    console.warn("[emergency-mirror] clear failed", err);
  }
}

let prunedThisSession = false;

/**
 * Bound the mirror slots (live + offer) to the newest {@link MIRROR_MAX_SLOTS}.
 * Runs ONCE per session (task 757: it was re-run on every paper open, reading
 * every slot's whole model each time), so the slot count cannot grow with use.
 * Reads one slot at a time and keeps only its timestamp.
 *
 * Task 851 — every slot here is unlanded work, so the sweep deletes by COUNT
 * only, and only as task 757's hard size bound: there is no age rule, a slot
 * it cannot read is left (reported by the door, not deleted), a document with
 * a live ticker in this window is never evicted (its fingerprint would go
 * stale against a slot that no longer exists), and each eviction is reported
 * to `__storageStats`.
 */
export async function pruneExpiredMirrors(): Promise<number> {
  if (prunedThisSession) return 0;
  prunedThisSession = true;
  let allKeys: IDBValidKey[];
  try {
    allKeys = await keys(store);
  } catch {
    return 0;
  }
  let dropped = 0;
  const evictable: { key: string; docId: string; savedAt: number }[] = [];
  let kept = 0;
  for (const k of allKeys) {
    if (typeof k !== "string") continue;
    if (!k.startsWith(KEY_PREFIX) && !k.startsWith(OFFER_PREFIX)) continue;
    const entry = await readEntry(k);
    if (!entry) continue;
    if (tickers.has(entry.docId)) kept++;
    else evictable.push({ key: k, docId: entry.docId, savedAt: entry.savedAt });
  }
  const room = Math.max(0, MIRROR_MAX_SLOTS - kept);
  if (evictable.length > room) {
    evictable.sort((a, b) => b.savedAt - a.savedAt);
    for (const { key, docId, savedAt } of evictable.slice(room)) {
      try {
        await del(key, store);
      } catch {
        continue;
      }
      noteStoredEviction(
        key,
        `unlanded mirror of ${docId} from ${new Date(savedAt).toISOString()} — over MIRROR_MAX_SLOTS`,
      );
      dropped++;
    }
  }
  return dropped;
}

/** Test helper — let the next sweep run again. */
export function __resetMirrorPruneForTests(): void {
  prunedThisSession = false;
}

/**
 * What one tick did — a RECEIPT, not an absence of throw (task 850, the
 * task-567 pattern). The mirror is a net, never a gate, so a tick never
 * throws; which means a caller that needs to know whether the net is actually
 * THERE must read this, because "it did not throw" is true of every outcome.
 *
 * - `written` — this tick put the current model in the slot.
 * - `unchanged` — the current model is ALREADY in the slot (an earlier tick
 *   wrote exactly this content). Only ever said about content a write landed.
 * - `not-armed` — nothing to cover: the document holds no unlanded work.
 * - `no-model` — the editor is gone; nothing could be taken.
 * - `oversized` — over {@link MIRROR_MAX_CHARS}; declined, nothing taken.
 * - `write-failed` — the IndexedDB write rejected (quota, private mode, a
 *   closed database); nothing taken, the next tick retries.
 */
export type MirrorTickOutcome =
  | "written"
  | "unchanged"
  | "not-armed"
  | "no-model"
  | "oversized"
  | "write-failed";

/** Does this outcome mean the document's current work is SAFE in the mirror
 *  (or needs no mirror)? The one reading of a receipt, so the reload door and
 *  its suites ask the same question. */
export function mirrorCovers(outcome: MirrorTickOutcome | undefined): boolean {
  return (
    outcome === "written" || outcome === "unchanged" || outcome === "not-armed"
  );
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
  }): Promise<MirrorTickOutcome>;
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
  // What happened to `lastRef` — a ref bail REPLAYS it (task 850). Pre-850 the
  // oversized branch remembered the ref too, so the second tick on the same
  // oversized model bailed as "unchanged": the reload door read that as
  // "already mirrored" about a model that had never been written.
  let lastRefOutcome: "unchanged" | "oversized" = "unchanged";
  let lastHash: string | null = null;
  let warnedOversize = false;

  return {
    reset() {
      lastRef = null;
      lastRefOutcome = "unchanged";
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
      if (lastRef !== null && model === lastRef) return lastRefOutcome;
      const json = JSON.stringify(model);
      if (json.length > MIRROR_MAX_CHARS) {
        // Task 757 — the write-time cap. Remember the ref so an unchanged
        // oversized model is not re-serialized every 5 s.
        if (!warnedOversize) {
          warnedOversize = true;
          console.warn(
            `[emergency-mirror] model is ${json.length} chars (cap ${MIRROR_MAX_CHARS}); not mirroring`,
          );
        }
        lastRef = model;
        lastRefOutcome = "oversized";
        return "oversized";
      }
      const hash = hashContent(json);
      if (hash === lastHash) {
        lastRef = model;
        lastRefOutcome = "unchanged";
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
        // next tick retries. But it is NOT "unchanged" (pre-850 it said so, and
        // the reload door promised a copy that did not exist): nothing was
        // taken, and the receipt says exactly that.
        console.warn("[emergency-mirror] write failed", err);
        return "write-failed";
      }
      lastRef = model;
      lastRefOutcome = "unchanged";
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
 *
 * Resolves to each document's receipt (task 850). A document with no
 * registered ticker is simply absent — and absent is NOT covered: nothing
 * could have taken its work. A ticker that throws (it should not) is
 * `write-failed`, never a silent success.
 */
export async function mirrorAllNow(
  opts: { force?: boolean } = {},
): Promise<Map<string, MirrorTickOutcome>> {
  const entries = await Promise.all(
    [...tickers.entries()].map(async ([docId, t]) => {
      const outcome = await t
        .tick({ force: opts.force === true })
        .catch(() => "write-failed" as const);
      return [docId, outcome] as const;
    }),
  );
  return new Map(entries);
}

/** Test helper — wipe all registrations. */
export function __resetTickersForTests(): void {
  tickers.clear();
}
