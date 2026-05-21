"use client";

import { useCallback, useEffect, useState } from "react";
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

// Resolve a figure source path to a displayable blob URL, caching the
// screen-resolution raster in `<paper>/virgil/figures-cache/`. The hook
// owns the blob URL lifecycle (revokes on unmount / source change).
//
// Flow per mount:
//   1. readFigureSource → bytes + ext + fingerprint
//   2. computeCacheKey from source + fingerprint
//   3. Try cache → if a matching raster exists, hand back that blob
//   4. Otherwise rasterize → write to cache → hand back
//
// `refresh()` deletes the cache entry and re-runs the pipeline; used by
// the per-figure reload button.
export function useResolvedFigureUrl(
  docId: string | null,
  source: string,
): UseResolvedFigureUrlResult {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<FigureUrlStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [bust, setBust] = useState(0);

  useEffect(() => {
    if (!docId || !source) {
      setStatus("loading");
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    setStatus("loading");
    setError(null);

    (async () => {
      try {
        const sourceFile = await readFigureSource(docId, source);
        if (cancelled) return;
        if (!sourceFile) {
          setStatus("not-found");
          return;
        }
        const cacheKey = await sha1Hex12(`${source}:${sourceFile.fingerprint}`);

        // Try cache first
        const cached = await readFigureRaster(docId, cacheKey);
        if (!cancelled && cached) {
          createdUrl = URL.createObjectURL(cached);
          setUrl(createdUrl);
          setStatus("ready");
          return;
        }

        // Rasterize fresh
        const blob = await rasterizeFigure(sourceFile.bytes, sourceFile.ext);
        if (cancelled) return;

        // Cache is best-effort — display works even if we can't persist
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, source, bust]);

  const refresh = useCallback(() => {
    if (!docId) return;
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
