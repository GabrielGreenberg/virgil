/**
 * Read/write permission helpers for FileSystemHandle.
 *
 * The FSA spec gates `requestPermission()` behind transient activation:
 * it can only be called from inside a real user gesture handler. That
 * means `useEffect`, timers, and microtasks are all forbidden — you have
 * to be on the call stack of a click/keypress/etc.
 *
 * `queryPermission()` has no such restriction; it can be called any time.
 *
 * Convention in this codebase: use `queryRW()` from anywhere, and only
 * call `requestRW()` / `ensureRW()` from within a click handler.
 *
 * Note on persistence: in installed PWAs on Chromium 122+, the browser
 * may offer the user an option to remember the grant. When that happens,
 * `queryRW()` on a subsequent page load returns "granted" directly and
 * the gate UI never appears. This is purely a browser behavior change;
 * the API surface is the same.
 */

type PermState = "granted" | "denied" | "prompt";

interface HandleWithPerms {
  queryPermission(d?: { mode?: "read" | "readwrite" }): Promise<PermState>;
  requestPermission(d?: { mode?: "read" | "readwrite" }): Promise<PermState>;
}

function asPermHandle(handle: FileSystemHandle): Partial<HandleWithPerms> {
  return handle as unknown as Partial<HandleWithPerms>;
}

export async function queryRW(handle: FileSystemHandle): Promise<PermState> {
  const h = asPermHandle(handle);
  // OPFS handles (and any engine lacking the FSA permissions extension —
  // notably Firefox/Safari) expose no `queryPermission`. OPFS is same-origin
  // private storage that is always readable/writable, so treat a missing API
  // as already-granted rather than routing into a gate that can never resolve
  // (there is no picker to grant from).
  if (typeof h.queryPermission !== "function") return "granted";
  return h.queryPermission({ mode: "readwrite" });
}

export async function requestRW(handle: FileSystemHandle): Promise<PermState> {
  const h = asPermHandle(handle);
  if (typeof h.requestPermission !== "function") return "granted";
  return h.requestPermission({ mode: "readwrite" });
}

/**
 * If the handle already has readwrite permission, return true.
 * Otherwise prompt for it. MUST be called from a user gesture if the
 * permission isn't already granted.
 */
export async function ensureRW(handle: FileSystemHandle): Promise<boolean> {
  if ((await queryRW(handle)) === "granted") return true;
  return (await requestRW(handle)) === "granted";
}
