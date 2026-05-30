"use client";

import { useCallback, useLayoutEffect, useState } from "react";
import { rasterizeFigure, RasterizeError } from "@/lib/figures/rasterize";
import {
  readFigureSource,
  readFigureRaster,
  writeFigureRaster,
  deleteFigureRaster,
  writeFigureIndex,
  readFigureIndex,
  getDocWriteHandle,
} from "@/lib/storage";

export type FigureUrlStatus = "loading" | "ready" | "not-found" | "error";

export interface UseResolvedFigureUrlResult {
  url: string | null;
  status: FigureUrlStatus;
  error: string | null;
  refresh: () => void;
}

async function sha1Hex12(input: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    let hash = 5381;
    for (let i = 0; i < input.length; i++) {
      hash = ((hash * 33) ^ input.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(12, "0").slice(0, 12);
  }
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-1", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

// Module-level shared cache of resolved figure rasters, keyed by
// `docId\0source`. The first instance to resolve a figure (typically a
// main-editor FigurePanel on doc load) publishes the decoded Blob here; a
// later-mounting consumer (e.g. the read-only FigurePanel inside a popped
// section float) adopts it SYNCHRONOUSLY on its first frame instead of
// flashing the "Loading…" placeholder during the async storage round-trip
// (Issue-7: the lifted ghost already shows the image; the released float
// should match it on first paint).
//
// We keep the decoded Blob here so the synchronous adopt path can recover the
// raster's `cacheKey` — and thus the shared-URL key below — BEFORE the async
// fingerprint check runs. The Map is bounded in practice by the figure count
// of the docs opened this session (a handful of modest webp rasters).
interface CachedRaster {
  blob: Blob;
  /** The `sha1(source:fingerprint)` the blob was resolved at — lets a
   *  consumer confirm, off the async path, that the source hasn't changed. */
  cacheKey: string;
}
const rasterCache = new Map<string, CachedRaster>();
const rasterCacheKey = (docId: string, source: string) => `${docId}\u0000${source}`;

// Module-level shared, REFCOUNTED object URLs, keyed by
// `docId\0source\0cacheKey`. Every consumer of a given raster (the main-editor
// FigurePanel, the popped float's read-only FigurePanel, and — transitively,
// via cloneNode — the lifted ghost) references the SAME object-URL string, so
// a later-mounting consumer's <img> hits the browser's decoded-image cache and
// paints on its first frame WITHOUT re-decoding.
//
// Issue-7b: Issue-7 cached only the Blob and had each consumer mint its OWN
// `createObjectURL`. A fresh object URL is a NEW resource → a decode-cache MISS
// → the browser re-decodes the bytes before it can paint (measured ~2ms for a
// 1000×720 webp, ~5ms for 2160×1320, vs ~0.1ms to reuse a warm URL), i.e. 1+
// unpainted frame across the ghost→float release handoff — the residual
// flicker that Issue-7's DOM-state probe (MutationObserver + img.complete)
// could not see because it measured DOM presence, not paint/decode. Sharing
// the URL string puts the float on the ghost's fast path: the ghost already
// reuses the main editor's URL (cloneNode copies the `src`), so the released
// float now matches it and paints on frame 1.
//
// We REFCOUNT because the URL must outlive ANY single consumer yet be revoked
// once the LAST one drops it — solving the cross-instance revocation hazard
// Issue-7 sidestepped by never sharing a URL. The main-editor figure holds a
// ref for the life of the open doc, so a float adopting then closing only
// moves the count 1↔2 and never revokes a URL out from under a live consumer.
// Keying by `cacheKey` (not just docId+source) means a genuine source change
// (new fingerprint → new cacheKey) mints a distinct URL rather than reusing a
// stale one.
interface SharedFigureUrl {
  url: string;
  refs: number;
}
const urlCache = new Map<string, SharedFigureUrl>();
// Self-delimiting composite key — docId/source may contain spaces or slashes
// and cacheKey is fixed-length hex, so JSON-array encoding is collision-proof
// without a separator sentinel (and keeps the source free of the NUL control
// byte a `\0` join would embed, which makes git treat the file as binary).
const urlCacheKey = (docId: string, source: string, cacheKey: string) =>
  JSON.stringify([docId, source, cacheKey]);

/** Acquire (or first mint) the shared object URL for a resolved raster,
 *  bumping its refcount. Pair every call with `releaseSharedFigureUrl(key)`. */
function acquireSharedFigureUrl(key: string, blob: Blob): string {
  let entry = urlCache.get(key);
  if (!entry) {
    entry = { url: URL.createObjectURL(blob), refs: 0 };
    urlCache.set(key, entry);
  }
  entry.refs += 1;
  return entry.url;
}

/** Drop one reference to a shared object URL; revoke + evict at refcount 0. */
function releaseSharedFigureUrl(key: string): void {
  const entry = urlCache.get(key);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    URL.revokeObjectURL(entry.url);
    urlCache.delete(key);
  }
}

// Resolve a figure source path to a displayable blob URL, caching the
// screen-resolution raster in `<paper>/virgil/figures-cache/`, sharing the
// decoded Blob in-memory (rasterCache), AND sharing a single refcounted object
// URL (urlCache) across editor instances. The hook acquires/releases its
// instance's reference to the shared URL (release on unmount / source change).
//
// Flow per mount:
//   0. Synchronously adopt a shared cached raster if present (pre-paint),
//      acquiring its shared URL, so the first frame already shows the image.
//   1. readFigureSource → bytes + ext + fingerprint
//   2. computeCacheKey from source + fingerprint
//   3. If the adopted raster's key still matches → keep it (no re-decode)
//   4. Else try the on-disk raster cache; if a matching raster exists, hand
//      back that blob; otherwise rasterize → write to cache → hand back
//   5. Publish the resolved Blob to rasterCache and acquire its shared URL.
//
// `refresh()` deletes the cache entry (in-memory + on-disk) and re-runs the
// pipeline; used by the per-figure reload button.
export function useResolvedFigureUrl(
  docId: string | null,
  source: string,
): UseResolvedFigureUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<FigureUrlStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [bust, setBust] = useState(0);

  // useLayoutEffect (not useEffect) so the synchronous shared-cache adopt
  // below commits BEFORE the browser paints — a warm-cache consumer shows the
  // image on its first painted frame, never the "Loading…" placeholder.
  useLayoutEffect(() => {
    if (!docId || !source) {
      setStatus("loading");
      return;
    }
    let cancelled = false;
    // The urlCache key this effect currently holds a reference to (null until
    // it acquires one). We release exactly this key on unmount / re-resolve.
    let heldUrlKey: string | null = null;

    // (0) Synchronous shared-cache adopt. If another instance already resolved
    // this figure (main editor on doc load → the popped float mounting later),
    // paint the image on THIS frame by ACQUIRING the shared, refcounted URL —
    // the same string the main editor (and its cloneNode ghost) already use, so
    // the <img> hits the warm decode cache and paints with no re-decode flash
    // (Issue-7b). The async re-validation below confirms the source's
    // fingerprint is unchanged and only re-resolves if it isn't.
    const ckey = rasterCacheKey(docId, source);
    const hit = rasterCache.get(ckey);
    let adoptedKey: string | null = null;
    if (hit) {
      heldUrlKey = urlCacheKey(docId, source, hit.cacheKey);
      const url = acquireSharedFigureUrl(heldUrlKey, hit.blob);
      adoptedKey = hit.cacheKey;
      setUrl(url);
      setStatus("ready");
      setError(null);
    } else {
      setStatus("loading");
      setError(null);
    }

    (async () => {
      try {
        const sourceFile = await readFigureSource(docId, source);
        if (cancelled) return;
        if (!sourceFile) {
          setStatus("not-found");
          return;
        }
        const cacheKey = await sha1Hex12(`${source}:${sourceFile.fingerprint}`);
        if (cancelled) return;

        // (3) The adopted blob is still current (same fingerprint) → keep the
        // already-painted image; skip the raster read + a redundant object-URL
        // swap that would needlessly re-decode the same bytes.
        if (adoptedKey && adoptedKey === cacheKey && heldUrlKey) {
          setStatus("ready");
          return;
        }

        // (4) Try the on-disk raster cache, else rasterize fresh.
        let blob = await readFigureRaster(docId, cacheKey);
        if (cancelled) return;
        if (!blob) {
          blob = await rasterizeFigure(sourceFile.bytes, sourceFile.ext);
          if (cancelled) return;

          // On-disk cache is best-effort — display works even if we can't persist
          try {
            const h = getDocWriteHandle(docId);
            if (h) {
              await writeFigureRaster(h, cacheKey, blob);
              const index = await readFigureIndex(docId);
              index[cacheKey] = {
                source,
                mtimeMs: Date.now(),
                size: blob.size,
              };
              await writeFigureIndex(h, index);
            }
          } catch {
            // ignore — cache is an optimization
          }
          if (cancelled) return;
        }

        // (5) Publish to the shared in-memory cache so a later-mounting
        // consumer can adopt it synchronously (Issue-7).
        rasterCache.set(ckey, { blob, cacheKey });

        // Acquire the shared, refcounted URL for the freshly-resolved raster
        // (Issue-7b: consumers reuse the same string → warm decode cache → no
        // re-decode flash on a later mount), then release any adopted-but-stale
        // URL we held. `heldUrlKey !== nextKey` here because the matched-adopt
        // case already returned at (3).
        const nextKey = urlCacheKey(docId, source, cacheKey);
        const nextUrl = acquireSharedFigureUrl(nextKey, blob);
        if (heldUrlKey && heldUrlKey !== nextKey) releaseSharedFigureUrl(heldUrlKey);
        heldUrlKey = nextKey;
        setUrl(nextUrl);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof RasterizeError ? e.message : String((e as Error)?.message || e);
        setError(msg);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (heldUrlKey) releaseSharedFigureUrl(heldUrlKey);
    };
  }, [docId, source, bust]);

  const refresh = useCallback(() => {
    if (!docId) return;
    // Drop the shared in-memory raster so the bust-triggered re-resolve below
    // can't adopt the stale blob (the on-disk raster is deleted async too).
    rasterCache.delete(rasterCacheKey(docId, source));
    (async () => {
      try {
        const sourceFile = await readFigureSource(docId, source);
        if (sourceFile) {
          const cacheKey = await sha1Hex12(`${source}:${sourceFile.fingerprint}`);
          const h = getDocWriteHandle(docId);
          if (h) await deleteFigureRaster(h, cacheKey).catch(() => {});
        }
      } finally {
        setBust((n) => n + 1);
      }
    })();
  }, [docId, source]);

  return { url, status, error, refresh };
}
