// Virgil Service Worker — network-first with a cache fallback, except for what
// the build pins by content: its hashed chunks and its precached assets, which
// are served cache-first.
//
// Strategy, per request (see `handle` below):
//   - same-origin `_next/static/**` (content-hashed, never change under one
//     name): cache first, network on a miss;
//   - any other precached path (the TeX core, the dictionary) whose held copy
//     carries THIS build's content hash (task 888): cache first — it is
//     byte-for-byte what this build shipped;
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
// BUILD_PRECACHE with `[path, sha]` for every file the worker precaches. So every
// deploy that changes any byte ships a worker with new bytes: the browser
// installs it, the banner appears, and on activate every build's cache but
// the ones a window can still need is purged — never an accumulation (see
// "Build-cache retention" below). Unstamped
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

// Content-addressed precache (task 888). Every BUILD_PRECACHE entry is
// `[scopeRelativePath, sha]`, the sha a hash of the file's bytes, written by
// the stamper. A precached copy is stored carrying its sha in this header, so
// an install can tell — for ANY path, not just a hashed chunk's name — that a
// held copy is byte-identical to what this build ships, and copy it instead of
// downloading it. Before this, every deploy re-fetched the ~19 MB of vendored
// TeX + dictionary files (the 9.9 MB .fmt twice) though they almost never
// change.
const SHA_HEADER = "x-virgil-sha";
const BUILD_SHAS = new Map(
  BUILD_PRECACHE.map(([p, sha]) => [scopeUrl(p), sha]),
);

// Allowed cross-origin responses (fonts) live in their OWN cache, whose name
// does not follow the build: a deploy must not strand an offline user without
// the typefaces they already downloaded. Its size is bounded by the families
// the user has picked.
const CROSS_ORIGIN_CACHE = "virgil-fonts";

// What the precache covers beyond the build's chunks and shell — the vendored
// TeX core (P1 offline-assets: the base .fmt + every path of
// `swiftlatex/texbundle/manifest.json`, so provisionEngine's seed fetch is
// offline-durable) and the Hunspell dictionary (task 518: without it the
// spellchecker silently has no dictionary offline) — is decided by the stamper
// at BUILD time (`ASSET_PRECACHE` in scripts/stamp-service-worker.mjs) and
// arrives here in BUILD_PRECACHE with everything else. The worker's OWN
// cross-origin sync XHR to the mirror is NOT — and cannot be — SW-intercepted
// (that's what the IndexedDB write-through cache + curated seed are for).

// Build-cache retention (task 887). Which OTHER build caches survive is a
// question about windows, not about creation order: "the newest other cache"
// was a superseded waiter's whenever two deploys landed before anyone clicked
// the banner — and keeping it purged the build every open window was running.
// So retention reads two records, both in this build-independent cache:
//   - the ACTIVATION LEDGER: the build caches whose worker actually activated,
//     oldest first. This build and the one active before it are kept (task
//     610: a window that held unsaved work stays on the old build, now
//     controlled by this worker).
//   - CLIENT REPORTS: each window posts the hashed scripts it booted from
//     (ServiceWorkerRegistration.tsx); any build cache holding a live window's
//     scripts is kept, whether or not its worker ever activated.
// The same sweep runs after install (a superseded waiter's cache goes then,
// once the new build has copied what it shares) and on activate.
const META_CACHE = "virgil-meta";
const LEDGER_KEY = scopeUrl("__virgil-meta/activated.json");
const CLIENT_KEY_PREFIX = scopeUrl("__virgil-meta/client/");
const LEDGER_LIMIT = 8;
const CLIENT_SCRIPT_LIMIT = 64;

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
  // Precache the build (shell, chunks, vendored TeX + dictionary). In dev we
  // never cache. Best-effort: a failed precache must NOT abort the install
  // (the SW still works for everything else, and the mirror/write-through
  // path still applies).
  if (IS_DEV) return;
  event.waitUntil(
    precacheBuild().then(() => sweepBuildCaches({ activating: false })),
  );
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

// Precache everything BUILD_PRECACHE lists (tasks 611, 888). Best-effort: a
// failure leaves that path to runtime caching and never aborts the install.
// A path a held build cache already has with the same content hash is copied,
// not downloaded again — and nothing is fetched twice (the stamper lists each
// path once).
async function precacheBuild() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const held = await heldBuildCaches();
    const queue = BUILD_PRECACHE.slice();
    const worker = async () => {
      for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
        try {
          const [p, sha] = entry;
          const url = scopeUrl(p);
          if (shaOf(await cache.match(url)) === sha) continue;
          const copy = await heldCopyOf(held, url, sha);
          const resp = copy || (await fetch(url, { cache: "no-store" }));
          await putCached(cache, url, resp, sha);
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

// Every OTHER build's cache, opened.
async function heldBuildCaches() {
  const names = (await caches.keys()).filter(
    (k) => k !== CACHE_NAME && k !== CROSS_ORIGIN_CACHE && k !== META_CACHE,
  );
  return Promise.all(names.map((n) => caches.open(n)));
}

// A held copy byte-identical to what this build ships at `url`: one stamped
// with the same sha — or, for a hashed chunk, any copy (its name is its
// content; this also reuses chunks cached before copies carried a sha).
async function heldCopyOf(held, url, sha) {
  const immutable = new URL(url).pathname.startsWith(IMMUTABLE_PREFIX);
  for (const c of held) {
    const resp = await c.match(url);
    if (resp && (immutable || (sha && shaOf(resp) === sha))) return resp;
  }
  return undefined;
}

function shaOf(resp) {
  return (resp && resp.headers && resp.headers.get(SHA_HEADER)) || null;
}

// The ONE door every cache write goes through (task 888). It stores only a
// complete answer: a 200, or an opaque cross-origin one (a no-cors font). `ok`
// would also admit 206 Partial Content — a Range request's slice — which
// cache.put rejects, an unhandled rejection in the worker. With a `sha`, the
// copy is stored carrying it (see SHA_HEADER). Resolves true when stored.
async function putCached(cache, key, resp, sha) {
  if (!resp || (resp.status !== 200 && resp.type !== "opaque")) return false;
  try {
    await cache.put(key, sha && shaOf(resp) !== sha ? withSha(resp, sha) : resp);
    return true;
  } catch {
    return false;
  }
}

function withSha(resp, sha) {
  const headers = new Headers(resp.headers);
  headers.set(SHA_HEADER, sha);
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}

self.addEventListener("activate", (event) => {
  if (IS_DEV) return;
  // Do NOT clients.claim() here. Once the user accepts the update, the app
  // reloads on `controllerchange`; the new SW takes over cleanly on the fresh
  // page. Auto-claiming would also seize control of any other open tabs the
  // user hasn't explicitly refreshed, which is the exact behavior we removed.
  event.waitUntil(sweepBuildCaches({ activating: true }));
});

// Delete every build cache no window can still need (task 887 — see
// "Build-cache retention" at the top). Kept: this build, the fonts, the meta
// cache, the ledger's last two activated builds, and every build a live window
// reports running. Best-effort: a failure here leaves caches in place, never
// breaks install or activation.
async function sweepBuildCaches({ activating }) {
  try {
    const meta = await caches.open(META_CACHE);
    const prior = await readLedger(meta);
    // At install the ledger's newest entry is the ACTIVE build, and the one
    // before it is what the active worker is still retaining. With no ledger
    // yet (the first worker to keep one), nothing is known to be safe to drop.
    if (!activating && prior.length === 0) return;
    const ledger = activating ? await recordActivation(meta, prior) : prior;
    const keys = await caches.keys();
    const builds = keys.filter(
      (k) => k !== CACHE_NAME && k !== CROSS_ORIGIN_CACHE && k !== META_CACHE,
    );
    const keep = new Set(ledger.slice(-2));
    // No earlier activation on record: fall back to the newest other build
    // cache (`caches.keys()` is creation order), the pre-ledger rule.
    if (activating && prior.length === 0 && builds.length > 0) {
      keep.add(builds[builds.length - 1]);
    }
    for (const name of await liveClientBuilds(meta, builds)) keep.add(name);
    await Promise.all(
      builds.filter((k) => !keep.has(k)).map((k) => caches.delete(k)),
    );
  } catch {
    // caches unavailable — nothing to sweep.
  }
}

async function readLedger(meta) {
  try {
    const resp = await meta.match(LEDGER_KEY);
    const list = resp ? await resp.json() : [];
    return Array.isArray(list) ? list.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

async function recordActivation(meta, prior) {
  const ledger = prior.filter((n) => n !== CACHE_NAME);
  ledger.push(CACHE_NAME);
  const next = ledger.slice(-LEDGER_LIMIT);
  await meta.put(LEDGER_KEY, new Response(JSON.stringify(next)));
  return next;
}

// The build caches live windows are running. A window's report lists the
// hashed scripts it booted from; the build it runs is the cache holding the
// most of them (ties — chunks two builds share — keep both). Reports from
// windows that have since closed are deleted here.
async function liveClientBuilds(meta, builds) {
  const keep = new Set();
  if (!self.clients || builds.length === 0) return keep;
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const live = new Set(windows.map((c) => c.id));
  for (const req of await meta.keys()) {
    const url = typeof req === "string" ? req : req.url;
    if (!url.startsWith(CLIENT_KEY_PREFIX)) continue;
    if (!live.has(decodeURIComponent(url.slice(CLIENT_KEY_PREFIX.length)))) {
      await meta.delete(req);
      continue;
    }
    let scripts = [];
    try {
      scripts = await (await meta.match(req)).json();
    } catch {
      continue;
    }
    if (!Array.isArray(scripts) || scripts.length === 0) continue;
    let best = 0;
    let running = [];
    for (const name of builds) {
      const cache = await caches.open(name);
      let held = 0;
      for (const s of scripts) if (await cache.match(s)) held++;
      if (held > best) {
        best = held;
        running = [name];
      } else if (held > 0 && held === best) {
        running.push(name);
      }
    }
    for (const name of running) keep.add(name);
  }
  return keep;
}

// A window's report: the same-origin hashed scripts it booted from.
function clientScripts(data) {
  if (!Array.isArray(data && data.scripts)) return [];
  const out = [];
  for (const s of data.scripts) {
    if (typeof s !== "string") continue;
    try {
      const u = new URL(s, self.location.href);
      if (u.origin === self.location.origin && u.pathname.startsWith(IMMUTABLE_PREFIX)) {
        out.push(u.href);
      }
    } catch {
      // not a URL — ignore
    }
    if (out.length >= CLIENT_SCRIPT_LIMIT) break;
  }
  return out;
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "VIRGIL_CLIENT_BUILD" && !IS_DEV) {
    const id = event.source && event.source.id;
    const scripts = clientScripts(event.data);
    if (!id || scripts.length === 0) return;
    event.waitUntil(
      caches
        .open(META_CACHE)
        .then((meta) =>
          meta.put(
            CLIENT_KEY_PREFIX + encodeURIComponent(id),
            new Response(JSON.stringify(scripts)),
          ),
        )
        .catch(() => {}),
    );
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

  event.respondWith(handle(event));
});

async function handle(event) {
  const { request } = event;
  const url = new URL(request.url);
  const isAllowedCrossOrigin = url.origin !== self.location.origin;
  const cache = await caches.open(
    isAllowedCrossOrigin ? CROSS_ORIGIN_CACHE : CACHE_NAME,
  );

  // What this build pins by content, served from what we hold: hashed build
  // output never changes under one name, and a precached asset whose copy
  // carries this build's sha is exactly what the build shipped. Navigations
  // stay network-first (the shell is precached too, for the offline fallback).
  if (!isAllowedCrossOrigin && request.mode !== "navigate") {
    const immutable = url.pathname.startsWith(IMMUTABLE_PREFIX);
    const sha = BUILD_SHAS.get(request.url);
    if (immutable || sha) {
      const held = await cache.match(request);
      if (held && (immutable || shaOf(held) === sha)) return held;
    }
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
    // Waited on, so the worker is not stopped before the copy lands.
    event.waitUntil(putCached(cache, request, response.clone()));
  } else if (!isAllowedCrossOrigin && !response.ok) {
    // The server no longer has it (a deploy replaced the build this tab is
    // running) or is failing: a copy we hold beats the error.
    const cached = await heldCopy(cache, request);
    if (cached) return cached;
  }
  return response;
}

// A cached copy of `request`: this build's (or the fonts') cache first, then
// any retained build's.
async function heldCopy(cache, request) {
  return (await cache.match(request)) || (await caches.match(request));
}
