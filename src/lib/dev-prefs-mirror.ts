/**
 * Dev-only client hook that mirrors Gabriel's localStorage prefs to disk
 * via `/api/dev/sync-prefs`. Feeds the personal-prefs promotion pipeline
 * (see `tools/promote-defaults.mjs`).
 *
 * ONE declared writer (task 1487): the mirror runs only in a browser profile
 * that opted in as the promotion source (`virgil:prefs-mirror-source`, default
 * OFF — an agent's preview pane never sets it), and every POST carries that
 * profile's source id (`virgil:prefs-mirror-source-id`, minted on first use).
 * The route refuses a source other than the snapshot's owner; on a refusal the
 * mirror says so once and stops. Ownership + merge rule:
 * `src/lib/dev-prefs-snapshot.ts`.
 *
 * Polls every 30s and POSTs only when the merged blob changes. No tie-in
 * to useViewPrefs/usePreferences event plumbing — keeps the surface area
 * minimal; 30s latency is noise against the promote schedule (stated once,
 * in `tools/sync-defaults.sh`'s header).
 *
 * Gated by `NEXT_PUBLIC_DEV_STORAGE=true` since that's what unlocks the
 * sister API route (`src/app/api/dev/sync-prefs/route.dev.ts`).
 */

"use client";

import { useEffect } from "react";
import { MIRRORABLE_STORAGE_KEYS } from "./dev-prefs-registry";
import { readFlag } from "./feature-flags";
import type { SnapshotPost } from "./dev-prefs-snapshot";
import {
  normalizeGlobalSlice,
  VIEW_PREFS_GLOBAL_STORAGE_KEY,
} from "@/hooks/useViewPrefs";

const POLL_INTERVAL_MS = 30_000;

/** This browser profile's promotion-source id, minted on first use. */
export const PREFS_MIRROR_SOURCE_ID_KEY = "virgil:prefs-mirror-source-id";

function sourceId(): string | null {
  try {
    let id = localStorage.getItem(PREFS_MIRROR_SOURCE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(PREFS_MIRROR_SOURCE_ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function snapshot(): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const key of MIRRORABLE_STORAGE_KEYS) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      // The global view-prefs blob goes through the SAME door every live read
      // uses (task 929): a value outside its declared domain, a retired panel
      // id, or a key another build wrote must never reach the snapshot that
      // `tools/promote-defaults.mjs` bakes into SHIPPED defaults — its
      // whitelist checks keys, not values.
      out[key] =
        key === VIEW_PREFS_GLOBAL_STORAGE_KEY ? normalizeGlobalSlice(parsed) : parsed;
    } catch {
      // Corrupt blob — skip rather than poisoning the snapshot.
    }
  }
  if (Object.keys(out).length === 0) return null;
  return out;
}

export function useDevPrefsMirror() {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_DEV_STORAGE) return;
    if (!readFlag("virgil:prefs-mirror-source")) return;
    const source = sourceId();
    if (!source) return;

    let lastSerialized = "";
    let cancelled = false;
    let id: ReturnType<typeof setInterval> | undefined;

    // The first tick always POSTs (lastSerialized is empty), so every mount
    // re-confirms each blob's `blobSavedAt` — what the promoter's staleness
    // report measures. Later ticks POST only when the prefs change.
    const tick = async () => {
      const blobs = snapshot();
      if (!blobs) return;
      const sig = JSON.stringify(blobs);
      if (sig === lastSerialized) return;
      lastSerialized = sig;
      const body: SnapshotPost = { source, blobs };
      try {
        const res = await fetch("/api/dev/sync-prefs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 409) {
          // Another source owns the snapshot: stop for this session.
          const why = await res.json().catch(() => null);
          console.warn("[prefs-mirror] snapshot refused this browser:", why?.error ?? res.status);
          clearInterval(id);
        }
      } catch {
        // Best-effort. Clear the signature so the next tick retries.
        lastSerialized = "";
      }
      if (cancelled) return;
    };

    void tick();
    id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
}
