#!/usr/bin/env node
// Stitch the editor and library skill bundles into a single top-level
// meta-manifest that the frontend's skill-sync engine consumes.
//
// Run AFTER both sub-builders have completed (predev/prebuild scripts
// chain this last). Reads each sub-bundle's bundle-manifest.json from
// public/skill-bundle/{editor,library}/ and emits a meta-manifest at
// public/skill-bundle/bundle-manifest.json with:
//
//   {
//     "version":     <sha256 over the two sub-versions; 12 chars>,
//     "generatedAt": <iso>,
//     "sources": [
//       { "name": "library", "version": <sub-version>, "files": [...] },
//       { "name": "editor",  "version": <sub-version>, "files": [...] }
//     ]
//   }
//
// The sync engine walks `sources`, prefixes each file's path with its
// `name` ("library/..." or "editor/...") to form the fetch URL, then
// rewrites that prefix to the on-disk layout (.claude/commands/library/
// or .virgil/scripts/editor/, etc.). See library/lib/skill-sync.ts.

import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const bundleRoot = join(repoRoot, "public", "skill-bundle");

const SUBSYSTEMS = ["library", "editor", "virgil"];

async function loadSubManifest(name) {
  const path = join(bundleRoot, name, "bundle-manifest.json");
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    throw new Error(
      `[meta-bundle] missing sub-manifest for "${name}" at ${relative(repoRoot, path)} — did the sub-builder run?`,
    );
  }
  return JSON.parse(text);
}

async function main() {
  const sources = [];
  const hash = createHash("sha256");
  for (const name of SUBSYSTEMS) {
    const sub = await loadSubManifest(name);
    sources.push({
      name,
      version: sub.version,
      files: sub.files,
    });
    hash.update(name);
    hash.update("\0");
    hash.update(sub.version);
    hash.update("\0");
  }
  const version = hash.digest("hex").slice(0, 12);
  const meta = {
    version,
    generatedAt: new Date().toISOString(),
    sources,
  };
  const out = join(bundleRoot, "bundle-manifest.json");
  await writeFile(out, JSON.stringify(meta, null, 2) + "\n");
  const totalFiles = sources.reduce((acc, s) => acc + s.files.length, 0);
  console.log(
    `[meta-bundle] v${version} — ${sources.length} subsystems, ${totalFiles} files → ${relative(repoRoot, out)}`,
  );
}

main().catch((err) => {
  console.error("[meta-bundle] failed:", err);
  process.exit(1);
});
