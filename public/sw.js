// Virgil Service Worker — stale-while-revalidate with offline fallback.
// The cache fills as the user browses online; on fetch failure we serve
// from cache, and reloads of a never-cached navigation fall back to the
// scope root (the SPA shell), letting client-side routing take over.
const CACHE_NAME = "virgil-v2";

// Scope root, e.g. "/" or "/tools/virgil/" depending on basePath. This
// is also the manifest start_url, so it's guaranteed to be cached once
// the user has opened the app online at least once.
const OFFLINE_FALLBACK = new URL("./", self.location.href).href;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(handle(request));
});

async function handle(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone());
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
