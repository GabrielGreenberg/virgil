#!/usr/bin/env node
// Build the bundled EXAMPLE document static asset.
//
// Output: public/examples/<EXAMPLE_DOC_ID>/
//   - a verbatim copy of every file in samples/annotation-history/
//     (preserving the relative tree: document.tex, references.bib,
//     figures/*, virgil/*.json)
//   - manifest.json — { seedVersion, generatedAt, docId, folderName,
//     texFilename, files: [{ path, encoding }] }
//
// The frontend seeder (src/lib/example-doc/example-seeder.ts) fetches the
// manifest at /examples/<id>/manifest.json, then each listed file, and
// writes the tree into OPFS on first open. Versioning is content-addressed:
// a sha256 over the deterministic concat of (relpath, bytes) becomes
// `seedVersion`, the marker the seeder compares against.
//
// Next.js `output: "export"` ships public/ verbatim, so this asset is
// available in the static production build (where there is no Node server).
//
// NOTE: docId / folderName / texFilename below MUST match the constants in
// src/lib/example-doc/example-seeder.ts.
//
// NOTE: when the example CONTENT changes, the seedVersion changes
// automatically; for returning users with a warm service-worker cache, also
// bump CACHE_NAME in public/sw.js so the new asset isn't shadowed.

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const DOC_ID = "example0";
const FOLDER_NAME = "example-annotation-history";
const TEX_FILENAME = "document.tex";

const sourceDir = join(repoRoot, "samples", "annotation-history");
const outDir = join(repoRoot, "public", "examples", DOC_ID);

const BINARY_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf"]);
// Never ship these into the bundle.
const SKIP_NAMES = new Set([".DS_Store", ".example-seed.json", ".history"]);

function encodingFor(relPath) {
  const dot = relPath.lastIndexOf(".");
  const ext = dot >= 0 ? relPath.slice(dot).toLowerCase() : "";
  return BINARY_EXTS.has(ext) ? "binary" : "utf8";
}

/** Recursively collect file relpaths under `dir` (sorted, deterministic). */
async function collect(dir, prefix, out) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collect(join(dir, entry.name), rel, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

async function main() {
  const relPaths = [];
  try {
    await collect(sourceDir, "", relPaths);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      throw new Error(`example source missing: ${relative(repoRoot, sourceDir)}`);
    }
    throw err;
  }
  if (relPaths.length === 0) {
    throw new Error(`example source is empty: ${relative(repoRoot, sourceDir)}`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const hash = createHash("sha256");
  const files = [];
  for (const rel of relPaths) {
    const bytes = await readFile(join(sourceDir, rel));
    const dest = join(outDir, rel);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bytes);

    hash.update(rel);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");

    files.push({ path: rel, encoding: encodingFor(rel) });
  }

  const seedVersion = hash.digest("hex").slice(0, 12);
  const manifest = {
    seedVersion,
    generatedAt: new Date().toISOString(),
    docId: DOC_ID,
    folderName: FOLDER_NAME,
    texFilename: TEX_FILENAME,
    files,
  };
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  console.log(
    `[example-bundle] v${seedVersion} — ${files.length} files → ${relative(repoRoot, outDir)}/`,
  );
}

main().catch((err) => {
  console.error("[example-bundle] failed:", err);
  process.exit(1);
});
