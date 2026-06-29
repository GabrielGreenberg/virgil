// Virgil Service Worker — stale-while-revalidate with offline fallback.
// The cache fills as the user browses online; on fetch failure we serve
// from cache, and reloads of a never-cached navigation fall back to the
// scope root (the SPA shell), letting client-side routing take over.
//
// skill-bundle/* files are intentionally cached too so the Library tab
// can re-sync skills to the user's library folder when offline.
//
// Bump CACHE_NAME whenever you ship a change the SW could otherwise serve
// stale. The activate handler purges every cache whose name doesn't match.
//
// Update strategy: we DO NOT call skipWaiting() or clients.claim() on
// install/activate. A new SW enters "waiting" state and stays there
// until the app posts {type:"SKIP_WAITING"} from a user click on the
// "Update available" banner in the Virgil bar. This keeps existing tabs
// stable across silent background SW installs and lets the user pick
// their refresh moment. See src/components/ServiceWorkerRegistration.tsx.
const CACHE_NAME = "virgil-v5";

// Cross-origin hosts whose responses we deliberately cache so they keep
// working offline. Google Fonts is on the allowlist because the Fonts…
// dialog loads picker-pool families from there at runtime.
const CACHEABLE_ORIGINS = new Set([
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
]);

// Localhost dev mode: never cache. Stops the SW from pinning stale
// Turbopack chunks across iterations.
const IS_DEV =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1" ||
  self.location.hostname.startsWith("192.168.");

// Scope root, e.g. "/" or "/tools/virgil/" depending on basePath. This
// is also the manifest start_url, so it's guaranteed to be cached once
// the user has opened the app online at least once.
const OFFLINE_FALLBACK = new URL("./", self.location.href).href;

self.addEventListener("install", () => {
  // Do NOT skipWaiting() here. The new SW sits in "waiting" until the
  // user clicks the in-app update banner, which posts SKIP_WAITING.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      // Do NOT clients.claim() here. Once the user accepts the update,
      // the app reloads on `controllerchange`; the new SW takes over
      // cleanly on the fresh page. Auto-claiming would also seize
      // control of any other open tabs the user hasn't explicitly
      // refreshed, which is the exact behavior we removed.
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !CACHEABLE_ORIGINS.has(url.origin)) return;

  // In dev, pass through every request directly to the network so HMR
  // and rebuilt chunks are never served stale.
  if (IS_DEV) return;

  event.respondWith(handle(request));
});

async function handle(request) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(request.url);
  const isAllowedCrossOrigin = CACHEABLE_ORIGINS.has(url.origin);
  try {
    const response = await fetch(request);
    if (response) {
      // Same-origin: only cache "basic" 2xx (skips redirects/errors).
      // Allowed cross-origin: cache opaque (no-cors woff2) or cors 2xx.
      const cacheable = isAllowedCrossOrigin
        ? response.type === "opaque" || response.ok
        : response.ok && response.type === "basic";
      if (cacheable) cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await cache.match(OFFLINE_FALLBACK);
      if (fallback) return fallback;
    }
    return Response.error();
  }
}
