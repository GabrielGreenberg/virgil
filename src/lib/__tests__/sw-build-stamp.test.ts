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
 *      build, the fonts and one predecessor, and purges the rest.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { stampServiceWorker, precacheList } from "../../../scripts/stamp-service-worker.mjs";

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

  it("precaches the shell and the hashed chunks only, scope-relative", () => {
    const { precache } = stampServiceWorker(fixture());
    expect(precache).toEqual([
      "./",
      "./_next/static/chunks/app-abc123.js",
      "./_next/static/css/main-def456.css",
    ]);
    for (const p of precache) expect(p.startsWith("/"), p).toBe(false);
    expect(precacheList(["a.html"])).toEqual([]);
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

class FakeResponse {
  constructor(
    readonly body: string,
    readonly status = 200,
    readonly type = "basic",
  ) {}
  get ok() {
    return this.status >= 200 && this.status < 300;
  }
  clone() {
    return new FakeResponse(this.body, this.status, this.type);
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
          store.set(keyOf(req), resp);
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

function loadWorker(source: string, world: ReturnType<typeof makeWorld>) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const self = {
    location: new URL(`${SCOPE}sw.js`),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners[type] = fn;
    },
    skipWaiting: () => {},
  };
  vm.runInNewContext(source, {
    self,
    caches: world.caches,
    fetch: world.fetch,
    Response: FakeResponse,
    URL,
    Promise,
    Array,
    String,
  });
  const run = async (type: string, extra: Record<string, unknown> = {}) => {
    let pending: Promise<unknown> | undefined;
    const event = {
      ...extra,
      waitUntil: (p: Promise<unknown>) => (pending = p),
      respondWith: (p: Promise<unknown>) => (pending = p),
    };
    listeners[type](event);
    return pending ? await pending : undefined;
  };
  return {
    install: () => run("install"),
    activate: () => run("activate"),
    request: (url: string, mode = "no-cors") =>
      run("fetch", { request: { url, method: "GET", mode } }) as Promise<FakeResponse | undefined>,
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

  it("activate keeps this build and ONE predecessor, and purges the rest", async () => {
    const { source, cacheName } = stampedWorker();
    const world = makeWorld({});
    for (const name of ["virgil-v9", "virgil-fonts", "virgil-aaaa", "virgil-bbbb"]) {
      await world.caches.open(name);
    }
    await world.caches.open(cacheName);
    await loadWorker(source, world).activate();
    expect([...world.stores.keys()].sort()).toEqual(
      ["virgil-bbbb", "virgil-fonts", cacheName].sort(),
    );
  });
});
