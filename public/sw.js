// Virgil Service Worker — minimal, updates on refresh only
const CACHE_NAME = "virgil-v1";

// Install: activate immediately
self.addEventListener("install", () => {
  self.skipWaiting();
});

// Activate: clear old caches, claim clients
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Fetch: always go to network, fall back to cache for offline only
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || !request.url.startsWith("http")) return;

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
