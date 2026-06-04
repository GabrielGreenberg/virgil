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
//     "version":     <sha256 over the sub-versions; 12 chars>,
//     "generatedAt": <iso>,
//     "sources": [
//       { "name": "library",  "version": <sub-version>, "files": [...] },
//       { "name": "editor",   "version": <sub-version>, "files": [...] },
//       { "name": "virgil",   "version": <sub-version>, "files": [...] },
//       { "name": "manifest", "version": <sub-version>, "files": [...] }
//     ]
//   }
//
// The sync engine walks `sources`, prefixes each file's path with its
// `name` ("library/..." or "editor/...") to form the fetch URL, then
// rewrites that prefix to the on-disk layout (.claude/commands/library/
// or .virgil/scripts/editor/, etc.). See library/lib/skill-sync.ts.
//
// The `manifest` source is the operational manifest (docs/workspace/*.md).
// Unlike the three subsystem bundles — each emitted by its own sub-builder
// (library/build, editor/build, virgil/build) into public/skill-bundle/<name>/
// — the manifest is Virgil-global, owned by no subsystem, so this meta-builder
// sources it directly (the one leg it builds rather than stitches). It ships to
// each paper's .claude/virgil/ via the "manifest" prefix in skill-sync's
// diskPathFor; the content-addressed version below folds it into the refresh
// signal for free.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const bundleRoot = join(repoRoot, "public", "skill-bundle");

// The three subsystem bundles, each emitted by its own sub-builder and read
// here via loadSubManifest. The `manifest` source is built by this file.
const SUBSYSTEMS = ["library", "editor", "virgil"];
const MANIFEST_NAME = "manifest";
const MANIFEST_SRC_DIR = join(repoRoot, "docs", "workspace");

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

// Build the operational-manifest source: copy docs/workspace/*.md into
// public/skill-bundle/manifest/ and return its {name, version, files} entry.
// Content-addressed version (sha256 over bundlePath+content, like the
// sub-builders) so an unchanged manifest yields an unchanged meta-version.
async function buildManifestSource() {
  const outDir = join(bundleRoot, MANIFEST_NAME);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  let entries;
  try {
    entries = await readdir(MANIFEST_SRC_DIR, { withFileTypes: true });
  } catch (err) {
    throw new Error(
      `[meta-bundle] manifest source dir missing at ${relative(repoRoot, MANIFEST_SRC_DIR)} — ${err.message}`,
    );
  }
  // `_`-prefixed files are includes, not shipped (matches the skill builders).
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
  if (names.length === 0) {
    throw new Error(
      `[meta-bundle] no manifest docs found in ${relative(repoRoot, MANIFEST_SRC_DIR)}`,
    );
  }

  const files = [];
  const hash = createHash("sha256");
  for (const name of names) {
    const content = await readFile(join(MANIFEST_SRC_DIR, name));
    await writeFile(join(outDir, name), content);
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
    files.push(name);
  }
  const version = hash.digest("hex").slice(0, 12);
  // Parity sub-manifest (the meta uses the returned values; this is for
  // debuggability and to mirror the other sources' on-disk shape).
  await writeFile(
    join(outDir, "bundle-manifest.json"),
    JSON.stringify({ version, generatedAt: new Date().toISOString(), files }, null, 2) + "\n",
  );
  return { name: MANIFEST_NAME, version, files };
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
  // The operational manifest — the one source this builder emits itself.
  const manifest = await buildManifestSource();
  sources.push(manifest);
  hash.update(manifest.name);
  hash.update("\0");
  hash.update(manifest.version);
  hash.update("\0");

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
