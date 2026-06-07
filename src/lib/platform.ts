/**
 * Tiny platform probe — the single source of truth for "are we on a Mac?",
 * used to render ⌘/⌥/⌃/⇧ vs Ctrl/Alt/Shift in {@link Kbd} and anywhere a
 * keyboard shortcut is shown to the user.
 *
 * SSR note: returns `true` (Mac) when `navigator` is unavailable so the
 * server render and the first client render agree (avoiding a hydration
 * mismatch). Components that care correct the value in a mount effect —
 * see `Kbd`'s `useIsMac()`.
 */
export function isMac(): boolean {
  if (typeof navigator === "undefined") return true;
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = uaData?.platform || navigator.platform || navigator.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
