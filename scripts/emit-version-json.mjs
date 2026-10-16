#!/usr/bin/env node
// Publish the build's version as `out/version.json` (task 1153). Runs as the
// LAST `postbuild` step, after `stamp-service-worker.mjs`.
//
// The Virgil page on Gabriel's website reads
// `https://gabrielgreenberg.com/virgil/version.json` instead of carrying a
// hand-edited version string, so a release bumps exactly one thing:
// `package.json`. This file is that bump's only published copy — derived at
// build time, never committed, never hand-maintained — so the website and the
// deploy cannot disagree about which version is live.
//
// Written AFTER the service-worker stamp, on purpose: the stamper hashes every
// file in `out/`, and `builtAt` differs on every build, so emitting first would
// make every no-op rebuild announce a new worker. Emitted after, the file is
// outside the stamp and outside BUILD_PRECACHE, and the worker's runtime fetch
// path is network-first for any unpinned path — so a reload after a release
// reads the NEW version (sw-build-stamp.test.ts / version-json.test.ts pin it).

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION_FILE = "version.json";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

/**
 * The published statement: `{ version, builtAt, commit? }`. `version` is
 * package.json's, verbatim; `commit` is the CI checkout's sha when the build
 * runs under GitHub Actions (cheap, and absent locally rather than guessed).
 *
 * @param {{ version: string }} pkg
 * @param {{ now?: Date, env?: Record<string, string | undefined> }} [opts]
 * @returns {{ version: string, builtAt: string, commit?: string }}
 */
export function versionStatement(pkg, { now = new Date(), env = process.env } = {}) {
  if (!pkg || typeof pkg.version !== "string" || !pkg.version) {
    throw new Error("emit-version-json: package.json has no version");
  }
  /** @type {{ version: string, builtAt: string, commit?: string }} */
  const statement = { version: pkg.version, builtAt: now.toISOString() };
  if (env.GITHUB_SHA) statement.commit = env.GITHUB_SHA;
  return statement;
}

/**
 * Write `<outDir>/version.json` from `<repoRoot>/package.json`. Returns the statement.
 *
 * @param {string} outDir
 * @param {{ repoRoot?: string, now?: Date, env?: Record<string, string | undefined> }} [opts]
 */
export function emitVersionJson(outDir, { repoRoot = REPO_ROOT, ...opts } = {}) {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const statement = versionStatement(pkg, opts);
  writeFileSync(join(resolve(outDir), VERSION_FILE), JSON.stringify(statement) + "\n");
  return statement;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outDir = process.argv[2] ?? join(REPO_ROOT, "out");
  if (!process.argv[2] && process.env.NEXT_PUBLIC_DEV_STORAGE) {
    // Dev-storage builds are not static exports (next.config.ts) — no out/.
    console.log("emit-version-json: dev-storage build, no static export");
    process.exit(0);
  }
  try {
    const { version } = emitVersionJson(outDir);
    console.log(`emit-version-json: ${VERSION_FILE} → ${version}`);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
