/**
 * **The reload door** — task 391.
 *
 * A reload drops every mounted editor's memory at once. Virgil has exactly one
 * programmatic reload (`ServiceWorkerRegistration`'s `controllerchange`
 * handler) and one affordance that leads to it (the "Virgil update" banner),
 * and on 2026-08-19 neither consulted the documents whose only copy it was
 * about to discard: the banner's `applyUpdate()` posted `SKIP_WAITING` and the
 * page reloaded ~70 minutes of writing away.
 *
 * > **No door that drops memory may open before the work is safe.** "Safe"
 * > means one of two things, in this order: the pending write LANDED, or the
 * > emergency mirror TOOK IT. The first is the good outcome; the second is the
 * > one that must never be skipped, because the states in which a write cannot
 * > land are exactly the states in which a reload is most expensive.
 *
 * The entry points, by how much the caller can do about unsaved work:
 *
 * - {@link prepareForReload} — flush, then mirror, then REPORT what still has
 *   not landed. An affordance (the banner) calls this and decides: nothing
 *   unlanded ⇒ proceed; something unlanded ⇒ say so, name the blocking flow,
 *   and let the user choose knowing the mirror is taken.
 * - {@link prepareAllWindowsForReload} — the same question asked of EVERY
 *   live Virgil window (see "The multi-window half" below). The banner asks
 *   this one before `SKIP_WAITING`, because that reload is app-wide.
 * - {@link reloadNow} — the same preparation, then the reload, regardless.
 *   Only for a reload the user in THIS window already chose (their own update
 *   click, clean or confirmed "Update anyway").
 * - {@link reloadIfClean} — the same preparation, then the reload ONLY when
 *   nothing is unlanded. For every reload this window did NOT ask for (a
 *   `controllerchange` started from another window). It has no user to ask,
 *   so it does not act: it reports `false` and the caller defers to the
 *   banner.
 *
 * ## The multi-window half (task 610)
 *
 * The unsaved-work channel is a module-level map, so it is PER WINDOW. The
 * reload `SKIP_WAITING` causes is not: activation moves every controlled
 * client to the new worker and fires `controllerchange` in each. Pre-610 the
 * banner in a clean window A said "safe", posted `SKIP_WAITING`, and window B
 * — autosave paused behind the clobber guard — reloaded unconditionally, its
 * work surviving only in the mirror. The 391 incident, one window over.
 *
 * > **Every path by which one window reloads another passes the same gate.**
 *
 * 1. **Ask every window before `SKIP_WAITING`.** The banner asks the bus;
 *    each window's {@link installReloadReadinessResponder} answers with its
 *    own `prepareForReload()`. The set of windows to wait for comes from the
 *    browser (`liveWindowIds`, Web Locks). A window that does not answer in
 *    time is UNKNOWN, and unknown is a block the user must confirm, never
 *    clean.
 * 2. **A reload a window did not ask for defers.** Step 1 leaves a race (B
 *    can go dirty between answering and activation), so B's own
 *    `controllerchange` goes through {@link reloadIfClean}. When B still holds
 *    work it stays open on the old page under the new worker — safe, because
 *    the worker is network-first, the same situation as any tab left open
 *    across a deploy — and its banner says "updated in another window".
 *
 * Step 2 alone is a full safety net; step 1 is what lets A's banner tell the
 * truth before the click instead of after it.
 *
 * ## Why the flush is verified rather than awaited
 *
 * `writeDocBundle` returns `Promise<void>` and a REFUSED write returns
 * normally (task 357 hole 4) — the incident's unload flushes all "succeeded"
 * as refusals. So awaiting the flush proves nothing; the door re-reads the
 * unsaved-work channel afterwards and believes THAT.
 */

import {
  docsWithUnlandedWork,
  type UnsavedBlockReason,
} from "@/lib/unsaved-work";
import { flushAllPendingDocs } from "@/lib/multi-window/pending-saves";
import { mirrorAllNow } from "@/lib/emergency-mirror";
import {
  publish as busPublish,
  subscribe as busSubscribe,
  type BusEvent,
} from "@/lib/multi-window/bus";
import { getWindowId } from "@/lib/multi-window/window-id";
import {
  holdWindowLiveness,
  liveWindowIds,
} from "@/lib/multi-window/window-liveness";

export interface UnlandedDoc {
  docId: string;
  reason: UnsavedBlockReason | null;
  ageMs: number;
}

export interface ReloadReadiness {
  /** Documents whose work is still not on disk after the flush. Empty ⇒ the
   *  reload costs nothing. */
  unlanded: UnlandedDoc[];
  /** Was a mirror pass taken for them? `false` only when the pass threw
   *  outright — the affordance must not promise a net it does not have. */
  mirrored: boolean;
}

/**
 * Make a reload as cheap as it can be made, then report honestly.
 *
 * 1. Fire every document's pending debounces — ALL of them — and await the
 *    writes. A document coalesces its writes in ~20 places (the bundle
 *    autosave, one debounce per card sidecar, the view-state coalescer), and
 *    each registers its settle door with the one pending-flusher registry
 *    (task 559); pre-559 only the bundle did, so a card body typed in the
 *    300 ms before a reload was outside this door, and the report below said
 *    `unlanded: []` about a document that was about to lose it. The registry
 *    runs in TWO PHASES: a coalescer that feeds the MODEL (the code pane's
 *    600 ms re-parse into TipTap) is `settle` and completes before any disk
 *    writer STARTS, so the bundle write snapshots a model that already
 *    carries the code edit.
 * 2. Re-read the channel — a refusal returns normally, so step 1's resolution
 *    is not evidence of anything.
 * 3. For whatever is still unlanded, force a mirror tick (`force`: young work
 *    is as exposed as old work once the page is going).
 *
 * The channel and the mirror deliberately stay MODEL-scoped. A sidecar write
 * is either landed by step 1 or logged by its own `persist` — it is not on
 * the unsaved-work channel (which would make every 300 ms card edit look like
 * blocked work) and cannot be in the mirror (which stores the TipTap model,
 * where a card body does not live). So `unlanded` still means model work; what
 * step 1 buys is that the sidecar half has actually been fired and awaited by
 * the time it is computed.
 */
export async function prepareForReload(): Promise<ReloadReadiness> {
  try {
    await flushAllPendingDocs();
  } catch {
    /* one doc's failed flush must not strand the others' mirroring */
  }
  const now = Date.now();
  const unlanded = docsWithUnlandedWork().map((s) => ({
    docId: s.docId,
    reason: s.reason,
    ageMs: s.dirtySince === null ? 0 : Math.max(0, now - s.dirtySince),
  }));
  if (unlanded.length === 0) return { unlanded, mirrored: true };
  let mirrored = true;
  try {
    await mirrorAllNow({ force: true });
  } catch {
    mirrored = false;
  }
  return { unlanded, mirrored };
}

/**
 * Prepare, then reload regardless. Only for a reload THIS window's user chose
 * (task 610): their update click already consulted every window and, if
 * anything was unlanded, got an explicit "Update anyway". The preparation
 * still runs, because the window can have gone dirty since.
 *
 * `reload` is REQUIRED rather than defaulted, and that is the census's doing
 * as much as the caller's: a default would make this module itself a speller
 * of `location.reload()`, and the leg that proves every reload in the app
 * enters this door works precisely by there being exactly ONE such speller.
 */
export async function reloadNow(reload: () => void): Promise<void> {
  await prepareForReload();
  reload();
}

/**
 * Prepare, then reload only if nothing is unlanded (task 610). For a reload
 * this window did not ask for: there is no user to consult, so a window
 * holding work does not reload — it resolves `false` (its mirror taken) and
 * the caller hands the decision to the banner.
 */
export async function reloadIfClean(reload: () => void): Promise<boolean> {
  const readiness = await prepareForReload();
  if (readiness.unlanded.length > 0) return false;
  reload();
  return true;
}

// ---------------------------------------------------------------------------
// The multi-window half (task 610)
// ---------------------------------------------------------------------------

/** How one window reaches the others. The real one is the BroadcastChannel
 *  bus + Web Locks liveness; tests pass a pair of in-memory ones. */
export interface ReadinessTransport {
  selfId: string;
  publish(e: BusEvent): void;
  subscribe(fn: (e: BusEvent) => void): () => void;
  /** Ids of every live window (including self), or `null` when the browser
   *  cannot say — then replies are collected for a fixed window instead. */
  liveIds(): Promise<Set<string> | null>;
}

function busTransport(): ReadinessTransport {
  return {
    selfId: getWindowId(),
    publish: busPublish,
    subscribe: busSubscribe,
    liveIds: async () => {
      if (typeof navigator === "undefined" || !navigator.locks) return null;
      return liveWindowIds();
    },
  };
}

/** An unlanded document, and which window holds it. */
export interface WindowUnlandedDoc extends UnlandedDoc {
  /** `null` = this window. */
  windowId: string | null;
}

export interface AppReloadReadiness {
  unlanded: WindowUnlandedDoc[];
  /** Every window that reported unlanded work took its mirror. */
  mirrored: boolean;
  /** Live windows that did not answer — their state is UNKNOWN, which the
   *  caller must treat as a block. */
  unresponsive: string[];
}

/** Long enough for a peer to flush its writes to disk; the same budget as a
 *  doc handoff (`awaitRelease`). */
export const READINESS_TIMEOUT_MS = 4000;
/** Without Web Locks nobody can name the live windows, so take whatever
 *  answers inside this window. */
export const READINESS_BLIND_WAIT_MS = 750;

/**
 * `prepareForReload`, asked of every live Virgil window at once. Resolves
 * when every window the browser knows of has answered, or at the timeout.
 */
export async function prepareAllWindowsForReload(
  opts: {
    transport?: ReadinessTransport;
    timeoutMs?: number;
    blindWaitMs?: number;
  } = {},
): Promise<AppReloadReadiness> {
  const t = opts.transport ?? busTransport();
  const timeoutMs = opts.timeoutMs ?? READINESS_TIMEOUT_MS;
  const blindWaitMs = opts.blindWaitMs ?? READINESS_BLIND_WAIT_MS;
  const requestId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

  const live = await t.liveIds();
  const expected = new Set(live ?? []);
  expected.delete(t.selfId);

  const replies = new Map<
    string,
    Extract<BusEvent, { type: "reload-readiness-reply" }>
  >();
  let settle: () => void = () => {};
  const allIn = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const unsub = t.subscribe((e) => {
    if (e.type !== "reload-readiness-reply" || e.requestId !== requestId) return;
    if (e.windowId === t.selfId) return;
    replies.set(e.windowId, e);
    if (live && [...expected].every((id) => replies.has(id))) settle();
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    t.publish({
      type: "reload-readiness-request",
      requestId,
      fromWindowId: t.selfId,
    });
    const local = prepareForReload();
    if (live && expected.size === 0) settle();
    const wait = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, live ? timeoutMs : blindWaitMs);
    });
    const [mine] = await Promise.all([local, Promise.race([allIn, wait])]);

    const unlanded: WindowUnlandedDoc[] = mine.unlanded.map((d) => ({
      ...d,
      windowId: null,
    }));
    let mirrored = mine.unlanded.length === 0 || mine.mirrored;
    for (const r of replies.values()) {
      for (const d of r.unlanded) unlanded.push({ ...d, windowId: r.windowId });
      if (r.unlanded.length > 0 && !r.mirrored) mirrored = false;
    }
    const unresponsive = [...expected].filter((id) => !replies.has(id));
    return { unlanded, mirrored, unresponsive };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    unsub();
  }
}

let responderInstalled = false;

/**
 * Answer other windows' readiness requests with this window's own
 * `prepareForReload()`. Every Virgil window installs it once (from
 * `ServiceWorkerRegistration`, mounted by the root layout), and takes its
 * liveness lock at the same time, so the asker knows to wait for it.
 */
export function installReloadReadinessResponder(
  opts: {
    transport?: ReadinessTransport;
    prepare?: () => Promise<ReloadReadiness>;
  } = {},
): () => void {
  const real = !opts.transport;
  if (real) {
    if (responderInstalled) return () => {};
    responderInstalled = true;
    holdWindowLiveness();
  }
  const t = opts.transport ?? busTransport();
  const prepare = opts.prepare ?? prepareForReload;
  const unsub = t.subscribe((e) => {
    if (e.type !== "reload-readiness-request") return;
    if (e.fromWindowId === t.selfId) return;
    // A preparation that THROWS sends no reply: the asker then counts this
    // window as unknown (a block), never as clean.
    void prepare()
      .catch(() => null)
      .then((r) => {
        if (!r) return;
        t.publish({
          type: "reload-readiness-reply",
          requestId: e.requestId,
          windowId: t.selfId,
          unlanded: r.unlanded,
          mirrored: r.mirrored,
        });
      });
  });
  return () => {
    unsub();
    if (real) responderInstalled = false;
  };
}
