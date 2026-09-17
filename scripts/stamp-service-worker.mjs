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
//   - BUILD_PRECACHE → the build's immutable, content-hashed `_next/static/**`
//                     files plus the app shell, scope-relative (task 365). The
//                     worker precaches them at install, so a tab still running
//                     build N can lazily load build N's chunks after build N+1
//                     has replaced them on the server.
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

/** Scope-relative precache list, from the export's file list. */
export function precacheList(files) {
  const statics = files.filter((f) => f.startsWith("_next/static/"));
  const shell = files.includes("index.html") ? ["./"] : [];
  return [...shell, ...statics.map((f) => `./${f}`)];
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
  for (const f of files) {
    hash.update(f);
    hash.update("\0");
    hash.update(readFileSync(join(root, f)));
    hash.update("\0");
  }
  // The worker's own source is part of the build's identity too.
  hash.update(source);
  const stamp = hash.digest("hex").slice(0, 16);
  const precache = precacheList(files);

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
