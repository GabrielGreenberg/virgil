/**
 * Cross-window localStorage sync — the ONE encoding of the `storage`-event
 * contract.
 *
 * ## The bug class this exists to kill
 *
 * A module-global store that hydrates from `localStorage` ONCE and then
 * serializes its WHOLE snapshot back on every setter is silently unsafe as
 * soon as a second app window exists (multi-window is first-class here —
 * `openNewVirgilWindow`). Windows A and B both hydrate the same snapshot; A
 * writes a change; B never learns, so B's snapshot is permanently stale, and
 * B's next write serializes its stale object OVER A's — A's change is gone,
 * silently, and the two windows disagree until one reloads.
 *
 * The fix is the native `storage` event, which fires in every OTHER window but
 * never in the writing one: on it, re-read and re-notify, so a window's
 * snapshot can never go stale and its next write can never clobber a peer's
 * from a stale base.
 *
 * ## Why a shared primitive rather than a per-store listener
 *
 * The contract has two guards that are easy to get subtly wrong, and getting
 * either wrong is invisible until it isn't:
 *
 * 1. **Foreign keys** — every window hears every key. Only ours is ours.
 * 2. **`key === null` is a `clear()`**, not a change to some key named null —
 *    and a peer's `sessionStorage.clear()` fires with a null key too, so the
 *    clear must be accepted ONLY when it came from `localStorage`. Without the
 *    `storageArea` check an unrelated session-storage clear spuriously
 *    replaces the snapshot.
 *
 * Encoding those once means a new synced store is a one-liner that can't get
 * them wrong. `outline-prefs-store.ts` (which first carried this fix, task
 * 111) now rides this primitive too, so there is exactly one copy.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { onTabHidden } from "@/lib/tab-hidden";

/**
 * Call `onChange` whenever a PEER window mutates `key` in `localStorage`
 * (including via `localStorage.clear()`). Returns an unsubscribe function.
 *
 * The handler re-reads storage through its own parse/validate path, so
 * validation lives in exactly one place per store rather than being duplicated
 * on the sync path. It is handed the key that CHANGED — `null` for a
 * `clear()`, which invalidates everything at once — so a caller spanning
 * several keys can narrow; a zero-argument handler (the common case) simply
 * ignores it.
 *
 * SSR-safe: a no-op (returning a no-op unsubscribe) when there is no `window`.
 */
export function subscribeToStorageKey(
  key: string,
  onChange: (changedKey: string | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    // `key === null` is a storage.clear(); accept it only from localStorage
    // (a peer's sessionStorage.clear() also fires with a null key and must
    // not trigger a spurious re-read). Otherwise: our key only.
    if (e.key === null ? e.storageArea !== localStorage : e.key !== key) return;
    onChange(e.key);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/**
 * Multi-key form of {@link subscribeToStorageKey} — one listener covering a
 * store that spans several keys (`usePreferences` writes three; `useLibraryTabs`
 * five). Returns a single unsubscribe.
 */
export function subscribeToStorageKeys(
  keys: readonly string[],
  onChange: (changedKey: string | null) => void,
): () => void {
  const offs = keys.map((k) => subscribeToStorageKey(k, onChange));
  return () => offs.forEach((off) => off());
}

/**
 * React binding for the same contract, for the HOOK-STATE variant of the store
 * shape: state lives in `useState` rather than a module global, so the listener
 * must live in an effect and `setState` from a fresh read.
 *
 * `onPeerChange` is invoked on every peer write; it should **re-read storage
 * through the store's own parse/validate path** and `setState` — exactly like
 * the module-global stores do. It is held in a ref, so an inline arrow is fine
 * and the subscription is never torn down/re-armed on re-render; only a change
 * of `keys` (compared by content) re-subscribes.
 *
 * ## The hazard this docstring exists to name
 *
 * If the store persists from a `useEffect` that watches its state (rather than
 * from its setters), a peer sync becomes a **write**: window B re-reads A's
 * blob → setState → the persist effect fires → B writes → A hears a storage
 * event → A re-reads and setStates → A's persist effect fires → … a two-window
 * ping-pong that never settles. Persist from the SETTERS, or route the write
 * through {@link writeStorageIfChanged} so the echo write is a no-op and the
 * loop dies on its first bounce.
 */
export type StorageKeyHandlers = Readonly<Record<string, () => void>>;

export function useStorageKeySync(
  keys: string | readonly string[],
  onPeerChange: () => void,
): void;
export function useStorageKeySync(handlers: StorageKeyHandlers): void;
export function useStorageKeySync(
  keysOrHandlers: string | readonly string[] | StorageKeyHandlers,
  onPeerChange?: () => void,
): void {
  const handlerMap: StorageKeyHandlers | null =
    typeof keysOrHandlers === "string" || Array.isArray(keysOrHandlers)
      ? null
      : (keysOrHandlers as StorageKeyHandlers);
  const keyList: readonly string[] = handlerMap
    ? Object.keys(handlerMap)
    : typeof keysOrHandlers === "string"
      ? [keysOrHandlers]
      : (keysOrHandlers as readonly string[]);

  // ONE dispatcher, refreshed in an effect rather than during render
  // (react-hooks/refs). The subscription below reads it at EVENT time, which
  // is always after this has run.
  const dispatchRef = useRef<(changedKey: string | null) => void>(() => {});
  useEffect(() => {
    dispatchRef.current = (changedKey) => {
      if (!handlerMap) {
        onPeerChange?.();
        return;
      }
      // A `clear()` arrives as `key === null` and invalidates EVERY key at
      // once, so it runs every handler. That branch is the one a per-key
      // caller would otherwise have to remember — and the one two of the
      // three pre-177 hand-rolled listeners forgot — so the door owns it and
      // no caller writes it.
      if (changedKey === null) {
        for (const fn of Object.values(handlerMap)) fn();
        return;
      }
      handlerMap[changedKey]?.();
    };
  });

  // Content-keyed so a caller may pass an inline array literal (or an inline
  // handler map) without re-subscribing on every render.
  const keySignature = keyList.join("\0");

  useEffect(() => {
    return subscribeToStorageKeys(keySignature.split("\0"), (changedKey) =>
      dispatchRef.current(changedKey),
    );
  }, [keySignature]);
}

/**
 * Write `value` to `key` only when it differs from what is already stored.
 *
 * A no-op write still fires a `storage` event in every peer window, so an
 * unconditional write from a persist-on-change effect is what turns a peer
 * sync into the ping-pong described above. Making the write idempotent kills
 * that loop at the source and costs one `getItem` — and it also stops a store
 * from waking every other window on a re-render that changed nothing.
 *
 * Returns whether **storage now holds `value`** — `true` both when it wrote
 * and when the value was already there, `false` only when the write FAILED
 * (quota / private mode / no window). That is the question every caller
 * actually has: "is my snapshot on disk?" A caller tracking what it has
 * successfully persisted (`view-session-store`'s merge base) must not treat a
 * skipped-because-identical write as a failure, nor a failed write as done.
 */
export function writeStorageIfChanged(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (localStorage.getItem(key) === value) return true; // already on disk
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false; // quota / private mode
  }
}

/**
 * Read `key` as a plain string, with absence and a throwing `localStorage`
 * (private mode, disabled site data, SSR) both reading as `""`. The mirror's
 * "what is on disk?" side; its write side is {@link writeStorageIfChanged}.
 */
function readMirror(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** Options for {@link useMirroredDraft}. */
export interface MirroredDraftOptions {
  /**
   * Coalesce consecutive `setValue` calls into ONE mirror write that fires
   * after this many ms of idle. `0` writes synchronously on every set (right
   * for a short field typed rarely — a machine name — where there is nothing
   * to coalesce and the simplest thing is also the safest).
   */
  debounceMs?: number;
}

/**
 * A `localStorage`-mirrored text buffer: React state that survives a reload,
 * converges across windows, and cannot silently lose what the user is typing.
 *
 * ## Why a door rather than four lines per component
 *
 * `usePersistentState` is this hook's twin one store-family over, and it took
 * three tasks to get right: task 392 retired "the armed timer handle is the
 * dirty test" from `useDocument`, task 559 registered the debounce with the
 * app-wide flush registry, and task 569 stated the rule the sidecar family now
 * lives by — *the external-change listener re-reads only when the instance is
 * CLEAN*, with ONE dirty predicate that no caller re-derives.
 *
 * The `localStorage` family is the third carrier of that shape, and until task
 * 629 its React member carried neither half. `BugReportWindow` mirrored the
 * user's report prose on a 400 ms debounce whose effect cleanup CANCELLED the
 * pending write instead of flushing it (type a sentence, reload inside 400 ms,
 * the sentence is gone — while the window's own dismissal justification said
 * "even a reload keeps it"), and its peer-sync handler re-read storage
 * unconditionally over the live textarea, coupled across BOTH its keys: one
 * character typed into a second window's little "From:" field reverted this
 * window's in-progress prose to the older persisted draft. Each half is four
 * lines, each half type-checks perfectly, and each half is invisible until it
 * isn't — which is exactly the argument this module's header already makes for
 * why the sync primitive exists at all.
 *
 * So both guarantees live HERE, and the next debounced mirror inherits them by
 * construction:
 *
 * 1. **The write is FLUSHED, never cancelled** — on unmount, on the tab-hidden
 *    edge ({@link onTabHidden}) and on `pagehide`. `pagehide` is deliberately
 *    included, and is deliberately absent from the sidecar family: a
 *    `localStorage` write is SYNCHRONOUS, so the last edge before teardown
 *    still lands it, whereas the async File System Access write `tab-hidden.ts`
 *    documents would be trading a coalesced write for a lost one there.
 *
 * 2. **THE ONE DIRTY PREDICATE** — "does storage hold what I hold?", asked as
 *    `valueRef.current !== persistedRef.current`, where `persistedRef` is what
 *    a write has CONFIRMED on disk. Not the armed timer handle (task 392's
 *    mistake), and it subsumes the case a timer test cannot see at all: a write
 *    that FAILED (quota, private mode) leaves us dirty, so the guard keeps
 *    protecting the buffer and the next edge retries. A peer's storage event is
 *    adopted only while CLEAN.
 *
 * ## The stated residual
 *
 * While dirty, a peer's value is SKIPPED, not merged — this window keeps what
 * its user is typing and its next flush writes over the peer. That is
 * last-writer-wins on the local user's most recent intent, which is the right
 * answer for a composition buffer (nothing a user is typing may be destroyed
 * by a peer) and the same principle `view-session-store` settles on. The
 * windows converge on the next peer write after this one flushes.
 *
 * Per-key by construction: one instance owns one key, so an unrelated key's
 * event cannot reach this buffer — there is no multi-key handler to couple.
 * `key` is therefore expected to be CONSTANT for the life of an instance (a
 * module constant, as both of today's callers pass); a changing key is not
 * supported and would carry the old buffer onto the new key rather than
 * re-hydrating. Mount a keyed instance instead.
 */
export function useMirroredDraft(
  key: string,
  { debounceMs = 400 }: MirroredDraftOptions = {},
): [string, (next: string | ((prev: string) => string)) => void, () => void] {
  const [value, setValueState] = useState(() => readMirror(key));
  /** Live mirror of `value`, so an edge callback can flush the CURRENT text
   *  without waiting for a render. */
  const valueRef = useRef(value);
  /** What storage has CONFIRMED it holds — the dirty predicate's other half. */
  const persistedRef = useRef(value);
  const timerRef = useRef<number | null>(null);

  const cancelArmedTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** THE SETTLE DOOR: write NOW if dirty. Safe to call when clean. */
  const flush = useCallback((): void => {
    cancelArmedTimer();
    if (valueRef.current === persistedRef.current) return;
    if (writeStorageIfChanged(key, valueRef.current)) {
      persistedRef.current = valueRef.current;
    }
  }, [key, cancelArmedTimer]);

  const setValue = useCallback(
    (next: string | ((prev: string) => string)): void => {
      const resolved = typeof next === "function" ? next(valueRef.current) : next;
      if (resolved === valueRef.current) return;
      valueRef.current = resolved;
      setValueState(resolved);
      if (debounceMs <= 0) {
        flush();
        return;
      }
      cancelArmedTimer();
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        flush();
      }, debounceMs);
    },
    [debounceMs, flush, cancelArmedTimer],
  );

  // Peer sync, CLEAN-GATED. Adopting storage while this buffer holds an
  // unmirrored edit is the clobber this hook exists to make unrepresentable.
  useStorageKeySync(key, () => {
    if (valueRef.current !== persistedRef.current) return; // dirty → keep ours
    const next = readMirror(key);
    if (next === valueRef.current) return;
    valueRef.current = next;
    persistedRef.current = next; // adopted, so we are clean against disk
    setValueState(next);
  });

  // The three settle edges. `flush` is stable per `key`, but the unmount leg
  // goes through a ref so its cleanup fires on teardown ONLY — never on a
  // re-created callback.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(() => onTabHidden(() => flushRef.current()), []);
  useEffect(() => {
    const onPageHide = () => flushRef.current();
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);
  useEffect(() => () => flushRef.current(), []);

  return [value, setValue, flush];
}
