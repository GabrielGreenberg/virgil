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
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// What ships, where it lands, and the bytes it ships with — the ONE answer,
// read by every builder and by both guards (task 506).
import {
  manifestFileNames,
  MANIFEST_SRC_DIR,
  shippedBytes,
  shippedPathMap,
} from "../library/build/bundle-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const bundleRoot = join(repoRoot, "public", "skill-bundle");

// The three subsystem bundles, each emitted by its own sub-builder and read
// here via loadSubManifest. The `manifest` source is built by this file.
const SUBSYSTEMS = ["library", "editor", "virgil"];
const MANIFEST_NAME = "manifest";

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

  // Which docs ship is `bundle-sources.mjs`'s answer, not a second filter here.
  const names = await manifestFileNames(repoRoot);
  if (names.length === 0) {
    throw new Error(
      `[meta-bundle] no manifest docs found in ${MANIFEST_SRC_DIR}`,
    );
  }
  const map = await shippedPathMap(repoRoot);

  const files = [];
  const sourceDigests = {};
  const hash = createHash("sha256");
  for (const name of names) {
    const repoPath = `${MANIFEST_SRC_DIR}/${name}`;
    const raw = await readFile(join(repoRoot, repoPath));
    // The manifest docs are read from `.claude/virgil/` in a managed folder,
    // where their sibling links still resolve and their pointers into the
    // skill set do not — unless re-spelled. Same rewrite every other shipped
    // markdown takes (task 506).
    const content = Buffer.from(shippedBytes(repoPath, raw.toString("utf8"), map), "utf8");
    await writeFile(join(outDir, name), content);
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
    files.push(name);
    sourceDigests[name] = {
      repoPath,
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  }
  const version = hash.digest("hex").slice(0, 12);
  // Parity sub-manifest (the meta uses the returned values; this is for
  // debuggability and to mirror the other sources' on-disk shape).
  await writeFile(
    join(outDir, "bundle-manifest.json"),
    JSON.stringify({ version, generatedAt: new Date().toISOString(), files, sourceDigests }, null, 2) + "\n",
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
