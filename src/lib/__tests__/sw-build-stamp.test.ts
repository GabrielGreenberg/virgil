/**
 * Task 611 — the service worker's version is the BUILD's, not a hand-bumped
 * literal.
 *
 * A browser installs a new worker only when `sw.js`'s bytes change. Before
 * this task `public/sw.js` carried `CACHE_NAME = "virgil-v9"`, changed by hand
 * 9 times in ~100 releases, so most deploys produced no waiting worker, no
 * update banner and no cache purge; a tab left open across a deploy 404'd on
 * chunks the cache held (network-first returned the 404); and every build's
 * chunks piled up in one cache.
 *
 * Legs:
 *   1. THE STAMPER — `scripts/stamp-service-worker.mjs` replaces both
 *      placeholders, the stamp is a content hash of the export (same bytes ⇒
 *      same worker; any changed file ⇒ new worker), the precache list is
 *      scope-relative (task 365) and holds the shell + hashed chunks only, and
 *      a missing placeholder is a hard failure.
 *   2. THE WIRING — `npm run build` runs it (`postbuild`), the deploy builds
 *      through `npm run build`, and no script still tells a human to bump.
 *   3. THE WORKER — the stamped `sw.js`, driven in a VM against fake caches:
 *      install precaches the build under its scope; a non-ok answer yields to
 *      a held copy; hashed chunks are served cache-first; activate keeps this
 *      build, the fonts and the builds windows can still need (task 887:
 *      the previously ACTIVE build + any build a live window reports
 *      running — never a superseded waiter by creation order).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  contentSha,
  precacheList,
  stampServiceWorker,
} from "../../../scripts/stamp-service-worker.mjs";

const REPO = path.resolve(__dirname, "../../..");
const SW_SOURCE = fs.readFileSync(path.join(REPO, "public/sw.js"), "utf8");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

/** A miniature static export with the real `public/sw.js` copied in. */
function fixture(overrides: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sw-stamp-"));
  tmpDirs.push(root);
  const files: Record<string, string> = {
    "index.html": "<html>shell</html>",
    "404.html": "<html>missing</html>",
    "_next/static/chunks/app-abc123.js": "console.log('app')",
    "_next/static/css/main-def456.css": "body{}",
    "swiftlatex/texbundle/manifest.json": "[]",
    "sw.js": SW_SOURCE,
    ...overrides,
  };
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  return root;
}

function stamped(root: string): string {
  stampServiceWorker(root);
  return fs.readFileSync(path.join(root, "sw.js"), "utf8");
}

describe("leg 1 — the stamper", () => {
  it("replaces both placeholders and leaves none behind", () => {
    const root = fixture();
    const { stamp, precache } = stampServiceWorker(root);
    const out = fs.readFileSync(path.join(root, "sw.js"), "utf8");
    expect(out).not.toContain("__VIRGIL_BUILD_");
    expect(stamp).toMatch(/^[0-9a-f]{16}$/);
    expect(out).toContain(`const BUILD_STAMP = ${JSON.stringify(stamp)};`);
    expect(out).toContain(`const BUILD_PRECACHE = ${JSON.stringify(precache)};`);
  });

  it("precaches the shell and the hashed chunks, scope-relative, each with its content sha", () => {
    const { precache } = stampServiceWorker(fixture());
    expect(precache).toEqual([
      ["./", contentSha("<html>shell</html>")],
      ["./_next/static/chunks/app-abc123.js", contentSha("console.log('app')")],
      ["./_next/static/css/main-def456.css", contentSha("body{}")],
    ]);
    for (const [p] of precache) expect(p.startsWith("/"), p).toBe(false);
    expect(precacheList(["a.html"])).toEqual([]);
  });

  it("task 888 — lists the TeX core + dictionary exactly once each, with shas", () => {
    const { precache } = stampServiceWorker(
      fixture({
        "swiftlatex/swiftlatexpdftex.fmt": "FMT",
        "swiftlatex/texbundle/amsmath.sty": "AMS",
        // The manifest's first row IS the .fmt, and a stray leading slash.
        "swiftlatex/texbundle/manifest.json": JSON.stringify({
          paths: [
            "swiftlatex/swiftlatexpdftex.fmt",
            "/swiftlatex/texbundle/amsmath.sty",
            "swiftlatex/texbundle/not-shipped.sty",
          ],
        }),
        "dictionaries/en/index.aff": "AFF",
        "dictionaries/en/index.dic": "DIC",
      }),
    );
    const paths = precache.map(([p]) => p);
    expect(new Set(paths).size).toBe(paths.length);
    expect(precache).toEqual(
      expect.arrayContaining([
        ["./swiftlatex/swiftlatexpdftex.fmt", contentSha("FMT")],
        ["./swiftlatex/texbundle/amsmath.sty", contentSha("AMS")],
        ["./dictionaries/en/index.aff", contentSha("AFF")],
        ["./dictionaries/en/index.dic", contentSha("DIC")],
      ]),
    );
    // A listed path the export lacks is skipped, not fetched into a 404.
    expect(paths).not.toContain("./swiftlatex/texbundle/not-shipped.sty");
  });

  it("identical exports stamp identical workers", () => {
    expect(stamped(fixture())).toBe(stamped(fixture()));
  });

  it("a changed chunk, or any other changed file, stamps a different worker", () => {
    const base = stamped(fixture());
    const newChunk = stamped(
      fixture({ "_next/static/chunks/app-abc123.js": "console.log('app v2')" }),
    );
    const newBundle = stamped(fixture({ "swiftlatex/texbundle/manifest.json": '["x"]' }));
    expect(newChunk).not.toBe(base);
    expect(newBundle).not.toBe(base);
    expect(newBundle).not.toBe(newChunk);
  });

  it("refuses a worker without the placeholders (already stamped, or renamed)", () => {
    const root = fixture();
    stampServiceWorker(root);
    expect(() => stampServiceWorker(root)).toThrow(/expected exactly one/);
    const renamed = fixture({ "sw.js": SW_SOURCE.replace("__VIRGIL_BUILD_STAMP__", "x") });
    expect(() => stampServiceWorker(renamed)).toThrow(/expected exactly one/);
  });
});

describe("leg 2 — the wiring", () => {
  it("npm run build stamps the export", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts.postbuild).toBe("node scripts/stamp-service-worker.mjs");
    // A build that bypasses npm's pre/post hooks ships an unstamped worker.
    for (const [name, cmd] of Object.entries<string>(pkg.scripts)) {
      if (name === "build") continue;
      expect(cmd, `script "${name}" runs next build directly`).not.toMatch(/\bnext build\b/);
    }
  });

  it("the deploy builds through npm run build", () => {
    const deploy = fs.readFileSync(path.join(REPO, ".github/workflows/deploy.yml"), "utf8");
    expect(deploy).toMatch(/run: npm run build\b/);
    expect(deploy).not.toMatch(/\bnext build\b/);
  });

  it("no hand-written cache version, and nothing tells a human to bump one", () => {
    expect(SW_SOURCE).not.toMatch(/virgil-v\d/);
    expect(SW_SOURCE).toContain('const BUILD_STAMP = "__VIRGIL_BUILD_STAMP__";');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(abs);
        else if (/\.(m?js|ts|sh)$/.test(ent.name)) {
          if (/bump\s+CACHE_NAME/i.test(fs.readFileSync(abs, "utf8"))) offenders.push(abs);
        }
      }
    };
    walk(path.join(REPO, "scripts"));
    walk(path.join(REPO, "public"));
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// leg 3 — the stamped worker, in a VM
// ---------------------------------------------------------------------------

const SCOPE = "https://site.example/virgil/";

type FakeInit = number | { status?: number; statusText?: string; headers?: HeadersInit };

class FakeResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  constructor(
    readonly body: string,
    init: FakeInit = 200,
    readonly type = "basic",
  ) {
    const o = typeof init === "number" ? { status: init } : init;
    this.status = o.status ?? 200;
    this.statusText = o.statusText ?? "";
    this.headers = new Headers(o.headers);
  }
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status, headers: this.headers }, this.type);
  }
  async json() {
    return JSON.parse(this.body);
  }
  static error() {
    return new FakeResponse("", 0, "error");
  }
}

function keyOf(req: string | { url: string }) {
  return typeof req === "string" ? req : req.url;
}

function makeWorld(network: Record<string, FakeResponse>) {
  const stores = new Map<string, Map<string, FakeResponse>>();
  const fetched: string[] = [];
  const caches = {
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        async match(req: string | { url: string }) {
          return store.get(keyOf(req));
        },
        async put(req: string | { url: string }, resp: FakeResponse) {
          // The real Cache rejects a partial response.
          if (resp.status === 206) throw new TypeError("Partial response (status code 206) is unsupported");
          store.set(keyOf(req), resp);
        },
        async keys() {
          return [...store.keys()];
        },
        async delete(req: string | { url: string }) {
          return store.delete(keyOf(req));
        },
      };
    },
    async match(req: string | { url: string }) {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(req));
        if (hit) return hit;
      }
      return undefined;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name: string) {
      return stores.delete(name);
    },
  };
  const fetch = async (req: string | { url: string }) => {
    const url = keyOf(req);
    fetched.push(url);
    const resp = network[url];
    if (!resp) throw new TypeError("Failed to fetch");
    return resp.clone();
  };
  return { stores, fetched, caches, fetch };
}

function loadWorker(
  source: string,
  world: ReturnType<typeof makeWorld>,
  liveWindows: string[] = [],
) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL(`${SCOPE}sw.js`),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
    clients: { matchAll: async () => liveWindows.map((id) => ({ id })) },
  };
  vm.runInNewContext(source, {
    self,
    caches: world.caches,
    fetch: world.fetch,
    Response: FakeResponse,
    Headers,
    URL,
    Promise,
    Array,
    String,
    JSON,
    Set,
    Map,
    encodeURIComponent,
    decodeURIComponent,
  });
  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let responded: Promise<unknown> | undefined;
    const extended: Promise<unknown>[] = [];
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => extended.push(p),
      respondWith: (p: Promise<unknown>) => (responded = p),
    };
    listeners[type](event);
    const result = responded ? await responded : undefined;
    // Like the browser: the worker lives until every waitUntil settles (an
    // extension added while answering included).
    for (let i = 0; i < extended.length; i++) await extended[i];
    return result;
  };
  return {
    install: () => run("install"),
    activate: () => run("activate"),
    report: (clientId: string, scripts: string[]) =>
      run("message", {
        source: { id: clientId },
        data: { type: "VIRGIL_CLIENT_BUILD", scripts },
      }),
    request: (url: string, mode = "no-cors") =>
      run("fetch", { request: { url, method: "GET", mode } }) as Promise<FakeResponse | undefined>,
    /** Dispatch a fetch WITHOUT waiting on its extensions — what they are is the assertion. */
    dispatchFetch: (url: string) => {
      const extended: Promise<unknown>[] = [];
      let responded: Promise<unknown> | undefined;
      listeners.fetch({
        request: { url, method: "GET", mode: "no-cors" },
        waitUntil: (p: Promise<unknown>) => extended.push(p),
        respondWith: (p: Promise<unknown>) => (responded = p),
      });
      return { responded: responded!, extended };
    },
  };
}

function stampedWorker() {
  const root = fixture();
  const { stamp } = stampServiceWorker(root);
  return { source: fs.readFileSync(path.join(root, "sw.js"), "utf8"), cacheName: `virgil-${stamp}` };
}

const CHUNK = `${SCOPE}_next/static/chunks/app-abc123.js`;

describe("leg 3 — the stamped worker", () => {
  it("install precaches the shell and the chunks under its own scope", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({
      [SCOPE]: new FakeResponse("shell"),
      [CHUNK]: new FakeResponse("chunk"),
      [`${SCOPE}_next/static/css/main-def456.css`]: new FakeResponse("css"),
    });
    await loadWorker(source, world).install();
    const cache = world.stores.get(cacheName)!;
    expect(cache.get(SCOPE)?.body).toBe("shell");
    expect(cache.get(CHUNK)?.body).toBe("chunk");
    expect(world.fetched.every((u) => u.startsWith(SCOPE))).toBe(true);
  });

  it("a hashed chunk an older build already holds is copied, not downloaded", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({ [SCOPE]: new FakeResponse("shell") });
    (await world.caches.open("virgil-older")).put(CHUNK, new FakeResponse("held"));
    await loadWorker(source, world).install();
    expect(world.stores.get(cacheName)!.get(CHUNK)?.body).toBe("held");
    expect(world.fetched).not.toContain(CHUNK);
  });

  it("a 404 for something the cache holds yields the held copy", async () => {
    const { source, cacheName } = stampedWorker();
    const page = `${SCOPE}skill-bundle/index.json`;
    const world = makeWorld({ [page]: new FakeResponse("gone", 404) });
    (await world.caches.open(cacheName)).put(page, new FakeResponse("held"));
    const resp = await loadWorker(source, world).request(page);
    expect(resp?.body).toBe("held");
  });

  it("a 404 with nothing held is passed through", async () => {
    const { source } = stampedWorker();
    const page = `${SCOPE}nope.json`;
    const world = makeWorld({ [page]: new FakeResponse("gone", 404) });
    const resp = await loadWorker(source, world).request(page);
    expect(resp?.status).toBe(404);
  });

  it("a predecessor build's chunk survives the server deleting it", async () => {
    const { source } = stampedWorker();
    const oldChunk = `${SCOPE}_next/static/chunks/old-999.js`;
    const world = makeWorld({ [oldChunk]: new FakeResponse("gone", 404) });
    (await world.caches.open("virgil-previous")).put(oldChunk, new FakeResponse("old"));
    const resp = await loadWorker(source, world).request(oldChunk);
    expect(resp?.body).toBe("old");
  });

  it("hashed chunks are served cache-first", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({ [CHUNK]: new FakeResponse("network") });
    (await world.caches.open(cacheName)).put(CHUNK, new FakeResponse("cached"));
    const resp = await loadWorker(source, world).request(CHUNK);
    expect(resp?.body).toBe("cached");
    expect(world.fetched).not.toContain(CHUNK);
  });

  it("other same-origin requests stay network-first and refresh the cache", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({ [SCOPE]: new FakeResponse("fresh") });
    (await world.caches.open(cacheName)).put(SCOPE, new FakeResponse("stale"));
    const resp = await loadWorker(source, world).request(SCOPE, "navigate");
    expect(resp?.body).toBe("fresh");
    expect(world.stores.get(cacheName)!.get(SCOPE)?.body).toBe("fresh");
  });

  it("offline navigation falls back to the shell", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    (await world.caches.open(cacheName)).put(SCOPE, new FakeResponse("shell"));
    const resp = await loadWorker(source, world).request(`${SCOPE}deep/route`, "navigate");
    expect(resp?.body).toBe("shell");
  });

  it("fonts live in their own cache, which survives activation", async () => {
    const { source } = stampedWorker();
    const font = "https://fonts.gstatic.com/s/x.woff2";
    const world = makeWorld({ [font]: new FakeResponse("", 0, "opaque") });
    const worker = loadWorker(source, world);
    await worker.request(font);
    expect(world.stores.get("virgil-fonts")?.has(font)).toBe(true);
    await worker.activate();
    expect(world.stores.has("virgil-fonts")).toBe(true);
  });

  it("with no activation on record, activate keeps ONE predecessor (the newest) and purges the rest", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    for (const name of ["virgil-v9", "virgil-fonts", "virgil-aaaa", "virgil-bbbb"]) {
      await world.caches.open(name);
    }
    await world.caches.open(cacheName);
    await loadWorker(source, world).activate();
    expect([...world.stores.keys()].sort()).toEqual(
      ["virgil-bbbb", "virgil-fonts", "virgil-meta", cacheName].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// task 887 — retention follows what ACTIVATED and what windows RUN, never
// creation order
// ---------------------------------------------------------------------------

const LEDGER = `${SCOPE}__virgil-meta/activated.json`;

async function seedLedger(world: ReturnType<typeof makeWorld>, names: string[]) {
  (await world.caches.open("virgil-meta")).put(LEDGER, new FakeResponse(JSON.stringify(names)));
}

function ledgerOf(world: ReturnType<typeof makeWorld>): string[] {
  return JSON.parse(world.stores.get("virgil-meta")!.get(LEDGER)!.body);
}

describe("task 887 — build-cache retention", () => {
  it("a superseded never-activated waiter loses to the build that was ACTIVE", async () => {
    // Windows run A. B installed and waited; C replaced it before anyone
    // clicked. C activates: A must survive, B must go.
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    for (const name of ["virgil-fonts", "virgil-A", "virgil-B"]) await world.caches.open(name);
    await seedLedger(world, ["virgil-A"]);
    await world.caches.open(cacheName);
    await loadWorker(source, world).activate();
    expect([...world.stores.keys()].sort()).toEqual(
      ["virgil-A", "virgil-fonts", "virgil-meta", cacheName].sort(),
    );
    expect(ledgerOf(world)).toEqual(["virgil-A", cacheName]);
  });

  it("install sweeps a superseded waiter's cache once it has copied what it shares", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({ [SCOPE]: new FakeResponse("shell") });
    (await world.caches.open("virgil-B")).put(CHUNK, new FakeResponse("from-B"));
    await world.caches.open("virgil-A");
    await world.caches.open("virgil-Z");
    await seedLedger(world, ["virgil-Z", "virgil-A"]);
    await loadWorker(source, world).install();
    // Copied from the waiter's cache, then that cache was dropped; the
    // active build (A) and the one it retains (Z) are untouched.
    expect(world.stores.get(cacheName)!.get(CHUNK)?.body).toBe("from-B");
    expect(world.fetched).not.toContain(CHUNK);
    expect([...world.stores.keys()].sort()).toEqual(
      ["virgil-A", "virgil-Z", "virgil-meta", cacheName].sort(),
    );
  });

  it("install with no ledger yet deletes nothing", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    for (const name of ["virgil-A", "virgil-B"]) await world.caches.open(name);
    await loadWorker(source, world).install();
    expect([...world.stores.keys()]).toEqual(
      expect.arrayContaining(["virgil-A", "virgil-B", cacheName]),
    );
  });

  it("a deferred window two updates back keeps its build while it is open", async () => {
    // Ledger: A then B activated. A window that stayed on A (task 610) is
    // still open and reported A's scripts. C activates: B is kept as the
    // previous active build, A because a live window runs it.
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    const aChunk = `${SCOPE}_next/static/chunks/a-111.js`;
    (await world.caches.open("virgil-A")).put(aChunk, new FakeResponse("a"));
    await world.caches.open("virgil-B");
    await seedLedger(world, ["virgil-A", "virgil-B"]);
    await world.caches.open(cacheName);
    const worker = loadWorker(source, world, ["win-1"]);
    await worker.report("win-1", [aChunk]);
    await worker.activate();
    expect([...world.stores.keys()].sort()).toEqual(
      ["virgil-A", "virgil-B", "virgil-meta", cacheName].sort(),
    );
  });

  it("a closed window's report is dropped and no longer retains its build", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    const aChunk = `${SCOPE}_next/static/chunks/a-111.js`;
    (await world.caches.open("virgil-A")).put(aChunk, new FakeResponse("a"));
    await world.caches.open("virgil-B");
    await seedLedger(world, ["virgil-A", "virgil-B"]);
    await world.caches.open(cacheName);
    await loadWorker(source, world, ["win-1"]).report("win-1", [aChunk]);
    await loadWorker(source, world, []).activate();
    expect(world.stores.has("virgil-A")).toBe(false);
    expect(
      [...world.stores.get("virgil-meta")!.keys()].some((k) => k.includes("/client/")),
    ).toBe(false);
  });

  it("a report keeps only same-origin hashed scripts", async () => {
    const { source } = stampedWorker();
    const world = makeWorld({});
    const worker = loadWorker(source, world, ["w"]);
    await worker.report("w", [
      `${SCOPE}_next/static/chunks/a-1.js`,
      "https://evil.example/_next/static/x.js",
      `${SCOPE}other.js`,
    ]);
    const meta = world.stores.get("virgil-meta")!;
    const [key] = [...meta.keys()];
    expect(JSON.parse(meta.get(key)!.body)).toEqual([`${SCOPE}_next/static/chunks/a-1.js`]);
  });

  it("re-activating the same build does not duplicate it in the ledger", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    await seedLedger(world, [cacheName, "virgil-A"]);
    await world.caches.open("virgil-A");
    await world.caches.open(cacheName);
    await loadWorker(source, world).activate();
    expect(ledgerOf(world)).toEqual(["virgil-A", cacheName]);
  });
});

// ---------------------------------------------------------------------------
// task 888 — content-addressed precache: an unchanged asset is copied, never
// re-downloaded; the cache-write door stores 200s only and is waited on
// ---------------------------------------------------------------------------

const FMT = `${SCOPE}swiftlatex/swiftlatexpdftex.fmt`;
const STY = `${SCOPE}swiftlatex/texbundle/amsmath.sty`;
const AFF = `${SCOPE}dictionaries/en/index.aff`;

function texWorker(fmt = "FMT-v1", sty = "AMS-v1") {
  const root = fixture({
    "swiftlatex/swiftlatexpdftex.fmt": fmt,
    "swiftlatex/texbundle/amsmath.sty": sty,
    "swiftlatex/texbundle/manifest.json": JSON.stringify({
      paths: ["swiftlatex/swiftlatexpdftex.fmt", "swiftlatex/texbundle/amsmath.sty"],
    }),
    "dictionaries/en/index.aff": "AFF",
  });
  const { stamp } = stampServiceWorker(root);
  return { source: fs.readFileSync(path.join(root, "sw.js"), "utf8"), cacheName: `virgil-${stamp}` };
}

function texNetwork(fmt = "FMT-v1", sty = "AMS-v1") {
  return {
    [SCOPE]: new FakeResponse("<html>shell</html>"),
    [CHUNK]: new FakeResponse("console.log('app')"),
    [`${SCOPE}_next/static/css/main-def456.css`]: new FakeResponse("body{}"),
    [FMT]: new FakeResponse(fmt),
    [STY]: new FakeResponse(sty),
    [AFF]: new FakeResponse("AFF"),
  };
}

describe("task 888 — content-addressed precache", () => {
  it("first install fetches each asset exactly once — the .fmt is not fetched twice", async () => {
    const { source, cacheName } = texWorker();
    const world = makeWorld(texNetwork());
    await loadWorker(source, world).install();
    expect(world.fetched.filter((u) => u === FMT)).toHaveLength(1);
    expect(world.fetched.filter((u) => u.endsWith("manifest.json"))).toEqual([]);
    const cache = world.stores.get(cacheName)!;
    for (const u of [FMT, STY, AFF]) expect(cache.has(u), u).toBe(true);
  });

  it("the next deploy's install, with the TeX + dictionary bytes unchanged, downloads none of them", async () => {
    const world = makeWorld(texNetwork());
    const v1 = texWorker();
    await loadWorker(v1.source, world).install();
    await loadWorker(v1.source, world).activate();
    world.fetched.length = 0;
    // A new build: one chunk changed, the vendored assets did not.
    const root = fixture({
      "_next/static/chunks/app-abc123.js": "console.log('app v2')",
      "swiftlatex/swiftlatexpdftex.fmt": "FMT-v1",
      "swiftlatex/texbundle/amsmath.sty": "AMS-v1",
      "swiftlatex/texbundle/manifest.json": JSON.stringify({
        paths: ["swiftlatex/swiftlatexpdftex.fmt", "swiftlatex/texbundle/amsmath.sty"],
      }),
      "dictionaries/en/index.aff": "AFF",
    });
    const { stamp } = stampServiceWorker(root);
    const v2 = fs.readFileSync(path.join(root, "sw.js"), "utf8");
    await loadWorker(v2, world).install();
    for (const u of [FMT, STY, AFF]) expect(world.fetched, u).not.toContain(u);
    const cache = world.stores.get(`virgil-${stamp}`)!;
    expect(cache.get(FMT)?.body).toBe("FMT-v1");
    expect(cache.get(STY)?.body).toBe("AMS-v1");
  });

  it("a CHANGED asset is fetched — a held copy with another sha is never reused", async () => {
    const world = makeWorld(texNetwork("FMT-v2"));
    const v1 = texWorker("FMT-v1");
    // v1's install ran against v1's network.
    (await world.caches.open(v1.cacheName)).put(
      FMT,
      new FakeResponse("FMT-v1", { headers: { "x-virgil-sha": contentSha("FMT-v1") } }),
    );
    const v2 = texWorker("FMT-v2");
    await loadWorker(v2.source, world).install();
    expect(world.fetched.filter((u) => u === FMT)).toHaveLength(1);
    expect(world.stores.get(v2.cacheName)!.get(FMT)?.body).toBe("FMT-v2");
  });

  it("a precached asset carrying this build's sha is served cache-first", async () => {
    const { source, cacheName } = texWorker();
    const world = makeWorld(texNetwork());
    const worker = loadWorker(source, world);
    await worker.install();
    world.fetched.length = 0;
    const resp = await worker.request(FMT);
    expect(resp?.body).toBe("FMT-v1");
    expect(world.fetched).not.toContain(FMT);
    expect(world.stores.get(cacheName)!.get(FMT)?.headers.get("x-virgil-sha")).toBe(
      contentSha("FMT-v1"),
    );
  });

  it("a 206 Partial Content is passed through and never put", async () => {
    const { source, cacheName } = stampedWorker();
    const media = `${SCOPE}media/clip.mp4`;
    const world = makeWorld({ [media]: new FakeResponse("slice", 206) });
    const resp = await loadWorker(source, world).request(media);
    expect(resp?.status).toBe(206);
    expect(world.stores.get(cacheName)?.has(media) ?? false).toBe(false);
  });

  it("a runtime put is extended with waitUntil — the worker cannot stop before it lands", async () => {
    const { source, cacheName } = stampedWorker();
    const page = `${SCOPE}skill-bundle/index.json`;
    const world = makeWorld({ [page]: new FakeResponse("fresh") });
    const { responded, extended } = loadWorker(source, world).dispatchFetch(page);
    await responded;
    expect(extended).toHaveLength(1);
    await Promise.all(extended);
    expect(world.stores.get(cacheName)!.get(page)?.body).toBe("fresh");
  });
});
