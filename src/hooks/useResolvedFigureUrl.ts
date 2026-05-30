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
// We cache the decoded Blob, NOT an object URL: each consumer mints + revokes
// its own URL from the shared Blob, so there's no cross-instance revocation
// hazard, and the Blob outlives any single URL. The Map is bounded in
// practice by the figure count of the docs opened this session (a handful of
// modest webp rasters); entries for a closed doc are inert (the Blob is freed
// once nothing references it — GC reclaims the Map value when overwritten).
interface CachedRaster {
  blob: Blob;
  /** The `sha1(source:fingerprint)` the blob was resolved at — lets a
   *  consumer confirm, off the async path, that the source hasn't changed. */
  cacheKey: string;
}
const rasterCache = new Map<string, CachedRaster>();
const rasterCacheKey = (docId: string, source: string) => `${docId}\u0000${source}`;

// Resolve a figure source path to a displayable blob URL, caching the
// screen-resolution raster in `<paper>/virgil/figures-cache/` AND sharing the
// decoded Blob in-memory (rasterCache) across editor instances. The hook owns
// each instance's blob URL lifecycle (revokes on unmount / source change).
//
// Flow per mount:
//   0. Synchronously adopt a shared cached raster if present (pre-paint), so
//      the first frame already shows the image.
//   1. readFigureSource → bytes + ext + fingerprint
//   2. computeCacheKey from source + fingerprint
//   3. If the adopted raster's key still matches → keep it (no re-decode)
//   4. Else try the on-disk raster cache; if a matching raster exists, hand
//      back that blob; otherwise rasterize → write to cache → hand back
//   5. Publish the resolved Blob to the shared rasterCache.
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
    let createdUrl: string | null = null;

    // (0) Synchronous shared-cache adopt. If another instance already resolved
    // this figure (main editor on doc load → the popped float mounting later),
    // paint the image on THIS frame. The async re-validation below confirms
    // the source's fingerprint is unchanged and only re-resolves if it isn't.
    const ckey = rasterCacheKey(docId, source);
    const hit = rasterCache.get(ckey);
    let adoptedKey: string | null = null;
    if (hit) {
      createdUrl = URL.createObjectURL(hit.blob);
      adoptedKey = hit.cacheKey;
      setUrl(createdUrl);
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
        if (adoptedKey && adoptedKey === cacheKey && createdUrl) {
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

        // Swap in the freshly-resolved URL, revoking any adopted-but-stale one.
        if (createdUrl) URL.revokeObjectURL(createdUrl);
        createdUrl = URL.createObjectURL(blob);
        setUrl(createdUrl);
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
      if (createdUrl) URL.revokeObjectURL(createdUrl);
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
