#!/usr/bin/env node
// Stamp the built service worker with the identity of the build it ships in
// (task 611). Runs as `postbuild`, i.e. after `next build` has written the
// static export to `out/`.
//
// A browser installs a new service worker only when the BYTES of `sw.js`
// change. `public/sw.js` is copied into `out/` verbatim, so without this step
// its bytes change only when a human edits it — and a deploy that leaves them
// alone reaches no open window: no waiting worker, no update banner, no purge
// of the old cache. This step rewrites the two placeholders in `out/sw.js`:
//
//   - BUILD_STAMP   → a content hash of every file the export ships (sw.js
//                     itself excluded). Identical output ⇒ identical stamp, so
//                     a no-op rebuild is not announced as an update; any
//                     changed byte anywhere ⇒ a new worker and a new cache name.
//   - BUILD_PRECACHE → `[path, sha]` for everything the worker precaches,
//                     scope-relative (task 365), each path once: the app shell,
//                     the immutable `_next/static/**` chunks (so a tab still
//                     running build N can lazily load build N's chunks after
//                     build N+1 has replaced them on the server), and the
//                     vendored offline assets — the TeX core (.fmt + every path
//                     of `swiftlatex/texbundle/manifest.json`) and the Hunspell
//                     dictionary. The sha is the file's content hash (task 888):
//                     at install the worker COPIES any path a held build cache
//                     already has with the same sha, so a deploy that leaves the
//                     ~19 MB of vendored assets alone downloads none of them.
//
// The placeholders are valid JavaScript on their own, so the unstamped
// `public/sw.js` (dev server, where the worker bypasses itself anyway) runs.
// A missing placeholder is a hard failure: a refactor that renamed one would
// otherwise ship an unstamped worker and silently bring the bug back.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const STAMP_PLACEHOLDER = '"__VIRGIL_BUILD_STAMP__"';
export const PRECACHE_PLACEHOLDER = "/*__VIRGIL_BUILD_PRECACHE__*/ []";

const SW_FILE = "sw.js";

/**
 * Vendored offline assets the worker precaches beyond the build's chunks.
 * Out-relative paths. The base `.fmt` (P1 offline-assets) makes the main
 * thread's engine-seed fetch offline-durable; the dictionary (task 518) is
 * what Virgil's own spellchecker fetches — pinned against
 * `src/lib/spell/dictionary-asset.ts` by `dictionary-asset.test.ts`, since this
 * script cannot import TypeScript. A path the export lacks is skipped (a
 * lighter deploy precaches less).
 */
export const ASSET_PRECACHE = [
  "swiftlatex/swiftlatexpdftex.fmt",
  "dictionaries/en/index.aff",
  "dictionaries/en/index.dic",
];

/** The curated TeX core bundle's path list (scripts/lib/tex-bundle-manifest.mjs). */
export const TEX_BUNDLE_MANIFEST = "swiftlatex/texbundle/manifest.json";

/** A file's content hash, as the worker compares it. */
export function contentSha(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/** The texbundle manifest's listed paths, out-relative; [] when absent/malformed. */
function texBundlePaths(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, TEX_BUNDLE_MANIFEST), "utf8"));
    const listed = Array.isArray(manifest) ? manifest : manifest && manifest.paths;
    return Array.isArray(listed) ? listed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Every regular file under `dir`, as sorted POSIX paths relative to `dir`. */
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile()) out.push(relative(dir, abs).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The worker's precache list: `[scopeRelativePath, sha]`, each file ONCE (the
 * texbundle manifest's first row IS the base `.fmt`), and only files the
 * export actually has. `sha(file)` hashes an out-relative file.
 *
 * @param {string[]} files
 * @param {{ assets?: string[], sha?: (file: string) => string | undefined }} [opts]
 * @returns {[string, string | undefined][]}
 */
export function precacheList(files, { assets = [], sha = () => "" } = {}) {
  const have = new Set(files);
  const seen = new Set();
  const out = [];
  const add = (file, path = `./${file}`) => {
    if (!have.has(file) || seen.has(file)) return;
    seen.add(file);
    out.push([path, sha(file)]);
  };
  add("index.html", "./");
  for (const f of files) if (f.startsWith("_next/static/")) add(f);
  for (const a of assets) add(String(a).replace(/^(\.\/|\/)+/, ""));
  return out;
}

/**
 * Rewrite `<outDir>/sw.js` in place. Returns `{ stamp, precache }`.
 * Throws when the export has no sw.js or a placeholder is missing.
 */
export function stampServiceWorker(outDir) {
  const root = resolve(outDir);
  const swPath = join(root, SW_FILE);
  const source = readFileSync(swPath, "utf8");
  for (const token of [STAMP_PLACEHOLDER, PRECACHE_PLACEHOLDER]) {
    const count = source.split(token).length - 1;
    if (count !== 1) {
      throw new Error(
        `stamp-service-worker: expected exactly one ${token} in ${swPath}, found ${count}`,
      );
    }
  }

  const files = listFiles(root).filter((f) => f !== SW_FILE);
  const hash = createHash("sha256");
  const shas = new Map();
  for (const f of files) {
    const bytes = readFileSync(join(root, f));
    shas.set(f, contentSha(bytes));
    hash.update(f);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  // The worker's own source is part of the build's identity too.
  hash.update(source);
  const stamp = hash.digest("hex").slice(0, 16);
  const precache = precacheList(files, {
    assets: [...ASSET_PRECACHE, ...texBundlePaths(root)],
    sha: (f) => shas.get(f),
  });

  const stamped = source
    .replace(STAMP_PLACEHOLDER, () => JSON.stringify(stamp))
    .replace(PRECACHE_PLACEHOLDER, () => JSON.stringify(precache));
  if (stamped.includes("__VIRGIL_BUILD_")) {
    throw new Error(`stamp-service-worker: a placeholder survived in ${swPath}`);
  }
  writeFileSync(swPath, stamped);
  return { stamp, precache };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ?? resolve(fileURLToPath(new URL("..", import.meta.url)), "out");
  if (!process.argv[2] && process.env.NEXT_PUBLIC_DEV_STORAGE) {
    // Dev-storage builds are not static exports (next.config.ts) — no out/.
    console.log("stamp-service-worker: dev-storage build, no static export to stamp");
    process.exit(0);
  }
  try {
    const { stamp, precache } = stampServiceWorker(outDir);
    console.log(
      `stamp-service-worker: build ${stamp}, ${precache.length} precache path(s)`,
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
