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

/**
 * Call `onChange` whenever a PEER window mutates `key` in `localStorage`
 * (including via `localStorage.clear()`). Returns an unsubscribe function.
 *
 * The handler is invoked with no arguments — the caller re-reads storage
 * through its own parse/validate path, so validation lives in exactly one
 * place per store rather than being duplicated on the sync path.
 *
 * SSR-safe: a no-op (returning a no-op unsubscribe) when there is no `window`.
 */
export function subscribeToStorageKey(
  key: string,
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    // `key === null` is a storage.clear(); accept it only from localStorage
    // (a peer's sessionStorage.clear() also fires with a null key and must
    // not trigger a spurious re-read). Otherwise: our key only.
    if (e.key === null ? e.storageArea !== localStorage : e.key !== key) return;
    onChange();
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
