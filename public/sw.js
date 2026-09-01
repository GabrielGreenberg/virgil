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
const CACHE_NAME = "virgil-v8";

// Same-origin curated TeX assets (P1 offline-assets). The main thread fetches
// these in `provisionEngine` to seed the worker's kpse cache; precaching them
// here makes that seed fetch itself offline-durable. The worker's OWN
// cross-origin sync XHR to the mirror is NOT — and cannot be — SW-intercepted
// (that's what the IndexedDB write-through cache + curated seed are for). We
// precache the base `.fmt` and, if it exists, a `texbundle-manifest.json`
// listing the curated core bundle (written by scripts/build-tex-bundle.mjs);
// each listed path is precached too. Missing entries are tolerated — a cold /
// lighter deploy simply precaches less.
const TEX_ASSET_PRECACHE = ["./swiftlatex/swiftlatexpdftex.fmt"];
const TEX_BUNDLE_MANIFEST = "./swiftlatex/texbundle/manifest.json";

// The vendored Hunspell dictionary (task 518). Virgil's own spellchecker
// FETCHES these two files, so without them it silently has no dictionary
// offline — and the honest consequence of a failed load is that the surface
// hands itself back to the browser's checker, i.e. the LaTeX-awareness quietly
// disappears. Scope-relative, like every path in this file; the spellings are
// pinned against `src/lib/spell/dictionary-asset.ts` by
// `dictionary-asset.test.ts`, since a service worker cannot import TypeScript.
const DICTIONARY_PRECACHE = [
  "./dictionaries/en/index.aff",
  "./dictionaries/en/index.dic",
];

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

self.addEventListener("install", (event) => {
  // Do NOT skipWaiting() here. The new SW sits in "waiting" until the
  // user clicks the in-app update banner, which posts SKIP_WAITING.
  //
  // Precache the same-origin curated TeX assets so the main-thread seed fetch
  // (provisionEngine) is offline-durable. In dev we never cache. Best-effort:
  // a failed precache must NOT abort the install (the SW still works for
  // everything else, and the mirror/write-through path still applies).
  if (IS_DEV) return;
  event.waitUntil(precacheTexAssets());
});

async function precacheTexAssets() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const paths = [...TEX_ASSET_PRECACHE, ...DICTIONARY_PRECACHE];
    // Optionally fold in the texbundle manifest's listed asset paths.
    try {
      const manifestUrl = new URL(TEX_BUNDLE_MANIFEST, self.location.href).href;
      const resp = await fetch(manifestUrl, { cache: "no-store" });
      if (resp.ok) {
        const manifest = await resp.json();
        const listed = Array.isArray(manifest)
          ? manifest
          : Array.isArray(manifest && manifest.paths)
            ? manifest.paths
            : [];
        for (const p of listed) if (typeof p === "string") paths.push(p);
        // Cache the manifest itself too so a reload can re-read it offline.
        await cache.put(manifestUrl, resp.clone());
      }
    } catch {
      // No texbundle manifest (lighter deploy) — precache just the base .fmt.
    }
    await Promise.all(
      paths.map(async (p) => {
        try {
          // Scope-relative by contract (task 365): every path in this manifest
          // is resolved against the SW's OWN scope, so a leading slash would
          // discard that base and escape to the origin root — under a
          // subdirectory deploy (/virgil) that 404s every asset, silently,
          // because the catch below swallows it. The generator emits the
          // relative form; this strip is the defensive twin, so a manifest
          // written by an older build (or by hand) still precaches into scope
          // rather than failing invisibly.
          const url = new URL(String(p).replace(/^\/+/, ""), self.location.href).href;
          const resp = await fetch(url, { cache: "no-store" });
          if (resp.ok) await cache.put(url, resp.clone());
        } catch {
          // Individual asset unreachable at install — the runtime fetch
          // handler will cache it on the first successful online load.
        }
      }),
    );
  } catch {
    // caches unavailable — nothing to precache; ignore.
  }
}

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
