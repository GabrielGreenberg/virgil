/**
 * Dev-only client hook that mirrors Gabriel's localStorage prefs to disk
 * via `/api/dev/sync-prefs`. Feeds the personal-prefs promotion pipeline
 * (see `tools/promote-defaults.mjs`).
 *
 * Polls every 30s and POSTs only when the merged blob changes. No tie-in
 * to useViewPrefs/usePreferences event plumbing — keeps the surface area
 * minimal; latency is fine for a 48h cron.
 *
 * Gated by `NEXT_PUBLIC_DEV_STORAGE=true` since that's what unlocks the
 * sister API route (`src/app/api/dev/sync-prefs/route.dev.ts`).
 */

"use client";

import { useEffect } from "react";

const POLL_INTERVAL_MS = 30_000;

const SOURCE_KEYS = [
  "virgil-view-prefs/global",
  "virgil-editor-prefs",
  "virgil-panel-colors",
] as const;

function snapshot(): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of SOURCE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      out[key] = JSON.parse(raw);
    } catch {
      // Corrupt blob — skip rather than poisoning the snapshot.
    }
  }
  if (Object.keys(out).length === 0) return null;
  out.savedAt = new Date().toISOString();
  return out;
}

export function useDevPrefsMirror() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_DEV_STORAGE) return;

    let lastSerialized = "";
    let cancelled = false;

    const tick = async () => {
      const snap = snapshot();
      if (!snap) return;
      // Compare without the savedAt field — only re-POST when actual prefs change.
      const { savedAt: _ignored, ...rest } = snap;
      const sig = JSON.stringify(rest);
      if (sig === lastSerialized) return;
      lastSerialized = sig;
      try {
        await fetch("/api/dev/sync-prefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(snap),
        });
      } catch {
        // Best-effort. The next tick will retry.
      }
      if (cancelled) return;
    };

    void tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
}
