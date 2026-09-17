// Virgil Service Worker — network-first with a cache fallback, except for the
// build's immutable hashed chunks, which are served cache-first.
//
// Strategy, per request (see `handle` below):
//   - same-origin `_next/static/**` (content-hashed, never change under one
//     name): cache first, network on a miss;
//   - everything else: network first. A 2xx answer refreshes the cache. When
//     the network fails outright OR answers non-ok (a 404 for a chunk the
//     deploy after ours deleted), a cached copy of the same request wins; a
//     never-cached navigation falls back to the scope root (the SPA shell).
//
// skill-bundle/* files are intentionally cached too so the Library tab
// can re-sync skills to the user's library folder when offline.
//
// Versioning (task 611): nobody bumps a version by hand. `npm run build`'s
// `postbuild` step (scripts/stamp-service-worker.mjs) rewrites BUILD_STAMP in
// the exported `out/sw.js` with a content hash of the whole export, and
// BUILD_PRECACHE with that build's hashed chunks + the app shell. So every
// deploy that changes any byte ships a worker with new bytes: the browser
// installs it, the banner appears, and on activate every build's cache but
// this one and its predecessor is purged — never an accumulation. Unstamped
// (the dev server), the placeholders are valid values and the worker bypasses
// itself on localhost anyway.
//
// Update strategy: we DO NOT call skipWaiting() or clients.claim() on
// install/activate. A new SW enters "waiting" state and stays there
// until the app posts {type:"SKIP_WAITING"} from a user click on the
// "Update available" banner in the Virgil bar. This keeps existing tabs
// stable across silent background SW installs and lets the user pick
// their refresh moment. See src/components/ServiceWorkerRegistration.tsx.
// Because the waiting worker precaches its own build while the active one
// keeps its cache, a tab still on the old build can lazily load any of that
// build's chunks after the server has replaced them.
const BUILD_STAMP = "__VIRGIL_BUILD_STAMP__";
const BUILD_PRECACHE = /*__VIRGIL_BUILD_PRECACHE__*/ [];
const CACHE_NAME = `virgil-${BUILD_STAMP}`;

// Allowed cross-origin responses (fonts) live in their OWN cache, whose name
// does not follow the build: a deploy must not strand an offline user without
// the typefaces they already downloaded. Its size is bounded by the families
// the user has picked.
const CROSS_ORIGIN_CACHE = "virgil-fonts";

// Same-origin curated TeX assets (P1 offline-assets). The main thread fetches
// these in `provisionEngine` to seed the worker's kpse cache; precaching them
// here makes that seed fetch itself offline-durable. The worker's OWN
// cross-origin sync XHR to the mirror is NOT — and cannot be — SW-intercepted
// (that's what the IndexedDB write-through cache + curated seed are for). We
// precache the base `.fmt` and, if it exists, a `texbundle-manifest.json`
// listing the curated core bundle (written by scripts/lib/tex-bundle-manifest.mjs
// on behalf of build-tex-bundle.mjs and vendor-tex-family.mjs);
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

// Scope root, e.g. "/" or "/tools/virgil/" depending on basePath. This is
// also the manifest start_url. A stamped build lists it in BUILD_PRECACHE, so
// it is cached at install — the first visit's page is not yet controlled by
// the worker (no clients.claim()), so runtime caching alone would miss it.
const OFFLINE_FALLBACK = new URL("./", self.location.href).href;

// Same-origin hashed build output, e.g. "/virgil/_next/static/".
const IMMUTABLE_PREFIX = new URL("./_next/static/", self.location.href).pathname;

self.addEventListener("install", (event) => {
  // Do NOT skipWaiting() here. The new SW sits in "waiting" until the
  // user clicks the in-app update banner, which posts SKIP_WAITING.
  //
  // Precache the same-origin curated TeX assets so the main-thread seed fetch
  // (provisionEngine) is offline-durable. In dev we never cache. Best-effort:
  // a failed precache must NOT abort the install (the SW still works for
  // everything else, and the mirror/write-through path still applies).
  if (IS_DEV) return;
  event.waitUntil(Promise.all([precacheTexAssets(), precacheBuild()]));
});

// Resolve a precache path against the worker's OWN scope.
function scopeUrl(p) {
  // Scope-relative by contract (task 365): every path in these manifests
  // is resolved against the SW's OWN scope, so a leading slash would
  // discard that base and escape to the origin root — under a
  // subdirectory deploy (/virgil) that 404s every asset, silently,
  // because the callers' catch swallows it. The generators emit the
  // relative form; this strip is the defensive twin, so a manifest
  // written by an older build (or by hand) still precaches into scope
  // rather than failing invisibly.
  const url = new URL(String(p).replace(/^\/+/, ""), self.location.href).href;
  return url;
}

// Precache this build's hashed chunks and the app shell (task 611).
// Best-effort, like the TeX precache: a failure leaves that path to runtime
// caching and never aborts the install. A hashed chunk an earlier build's
// cache already holds is copied, not downloaded again.
async function precacheBuild() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const queue = BUILD_PRECACHE.slice();
    const worker = async () => {
      for (let p = queue.shift(); p !== undefined; p = queue.shift()) {
        try {
          const url = scopeUrl(p);
          if (new URL(url).pathname.startsWith(IMMUTABLE_PREFIX)) {
            const held = await caches.match(url);
            if (held) {
              await cache.put(url, held);
              continue;
            }
          }
          const resp = await fetch(url, { cache: "no-store" });
          if (resp.ok) await cache.put(url, resp);
        } catch {
          // Unreachable at install — runtime caching picks it up later.
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  } catch {
    // caches unavailable — nothing to precache; ignore.
  }
}

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
          const url = scopeUrl(p);
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
      // Keep this build's cache, the fonts, and exactly ONE predecessor
      // build: the newest other build cache (`caches.keys()` is in creation
      // order). A window that stayed open on the old build while another
      // window accepted the update (task 610 — it holds unsaved work) is now
      // controlled by THIS worker, and can still lazily load its own build's
      // chunks from that cache. Everything older is purged, so at most two
      // builds are ever held.
      const keys = await caches.keys();
      const builds = keys.filter(
        (k) => k !== CACHE_NAME && k !== CROSS_ORIGIN_CACHE,
      );
      const predecessor = builds[builds.length - 1];
      await Promise.all(
        builds.filter((k) => k !== predecessor).map((k) => caches.delete(k)),
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
  const url = new URL(request.url);
  const isAllowedCrossOrigin = url.origin !== self.location.origin;
  const cache = await caches.open(
    isAllowedCrossOrigin ? CROSS_ORIGIN_CACHE : CACHE_NAME,
  );

  // Hashed build output never changes under one name: serve what we hold.
  if (!isAllowedCrossOrigin && url.pathname.startsWith(IMMUTABLE_PREFIX)) {
    const held = await cache.match(request);
    if (held) return held;
  }

  let response;
  try {
    response = await fetch(request);
  } catch {
    const cached = await heldCopy(cache, request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await cache.match(OFFLINE_FALLBACK);
      if (fallback) return fallback;
    }
    return Response.error();
  }

  // Same-origin: only cache "basic" 2xx (skips redirects/errors).
  // Allowed cross-origin: cache opaque (no-cors woff2) or cors 2xx.
  const cacheable = isAllowedCrossOrigin
    ? response.type === "opaque" || response.ok
    : response.ok && response.type === "basic";
  if (cacheable) {
    cache.put(request, response.clone());
  } else if (!isAllowedCrossOrigin && !response.ok) {
    // The server no longer has it (a deploy replaced the build this tab is
    // running) or is failing: a copy we hold beats the error.
    const cached = await heldCopy(cache, request);
    if (cached) return cached;
  }
  return response;
}

// A cached copy of `request`: this build's (or the fonts') cache first, then
// the retained predecessor build's.
async function heldCopy(cache, request) {
  return (await cache.match(request)) || (await caches.match(request));
}
