#!/usr/bin/env node
// Build the `core` family of the vendored TeX bundle from a LIVE cache capture
// (P1 offline-assets).
//
// This turns a live capture into (a) the self-hosted asset bytes under
// public/swiftlatex/texbundle/ and (b) the regenerated tables that
// provisionEngine and the service worker read.
//
// WHY A CAPTURE IS NEEDED FOR THIS FAMILY: the worker's kpse cacheKey is
// `<numericFormatCode>/<reqname>`, and for a FONT, MAP or ENCODING the numeric
// format code is assigned by pdfTeX at runtime — it cannot be hand-authored
// reliably. So the manager captures the real keys from a warmed worker, and
// this script bakes them in.
//
// Its sibling `vendor-tex-family.mjs` (task 520) is the other producer: for a
// PACKAGE family the format code is known (kpse `tex` = 26) and the closure is
// derivable from the sources, so a declared family needs no browser at all.
// Both write through scripts/lib/tex-bundle-manifest.mjs, which merges BY
// FAMILY — so this script replaces the `core` rows and leaves every declared
// family's rows exactly where they are.
//
// ─────────────────────────────────────────────────────────────────────────
//  INPUT  (a captured cache-dump JSON, one of these shapes):
//    A) [ { cacheKey, fileid, bytesBase64 }, ... ]
//    B) { entries: [ { cacheKey, fileid, bytesBase64 }, ... ] }
//  `bytesBase64` is the base64 of the asset's raw bytes (see the browser dump
//  snippet in the P1 handoff — it base64s each dumpNewCache entry's bytes).
//
//  OUTPUTS:
//    - public/swiftlatex/texbundle/<fileid>      (each asset's raw bytes)
//    - public/swiftlatex/texbundle/manifest.json ({ paths: [...] } for the SW
//      precache)
//    - src/lib/tex-core-manifest.ts              (regenerated CORE_MANIFEST)
//
//  The base .fmt entry (fileid "swiftlatexpdftex.fmt") is special: its bytes
//  already live at public/swiftlatex/swiftlatexpdftex.fmt (vendored with the
//  WASM), so the script does NOT re-copy them into texbundle/ — it just records
//  the captured cacheKey with path "/swiftlatex/swiftlatexpdftex.fmt".
//
//  USAGE:  node scripts/build-tex-bundle.mjs <dump.json>
//  Idempotent: re-running with the same dump reproduces the same outputs.
// ─────────────────────────────────────────────────────────────────────────

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  repoRoot,
  texbundleDir,
  manifestTsPath,
  bundleManifestJsonPath,
  publicPathFor,
  fmtBytes,
  writeBundle,
  FMT_FILEID,
  FMT_PUBLIC_PATH,
  CORE_FAMILY,
} from "./lib/tex-bundle-manifest.mjs";

function fail(msg) {
  console.error(`build-tex-bundle: ${msg}`);
  process.exit(1);
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) fail("missing input. Usage: node scripts/build-tex-bundle.mjs <dump.json>");

  let raw;
  try {
    raw = await readFile(resolve(process.cwd(), inputPath), "utf8");
  } catch (err) {
    fail(`cannot read ${inputPath}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON in ${inputPath}: ${err.message}`);
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.entries)
      ? parsed.entries
      : null;
  if (!entries) fail("dump must be an array or { entries: [...] }");
  if (entries.length === 0) fail("dump has no entries");

  await mkdir(texbundleDir, { recursive: true });

  // Dedup by cacheKey (last write wins), validate shapes.
  const byCacheKey = new Map();
  for (const e of entries) {
    if (!e || typeof e.cacheKey !== "string" || typeof e.fileid !== "string") {
      fail(`entry missing cacheKey/fileid: ${JSON.stringify(e).slice(0, 120)}`);
    }
    if (typeof e.bytesBase64 !== "string") {
      fail(`entry ${e.cacheKey} missing bytesBase64`);
    }
    byCacheKey.set(e.cacheKey, e);
  }

  const rows = [];
  let totalBytes = 0;
  let writtenCount = 0;

  for (const e of byCacheKey.values()) {
    const bytes = Buffer.from(e.bytesBase64, "base64");
    totalBytes += bytes.length;
    const publicPath = publicPathFor(e.fileid);

    if (e.fileid === FMT_FILEID) {
      // The .fmt is already vendored at public/swiftlatex/ — don't duplicate.
      console.log(
        `  fmt      ${e.cacheKey} -> ${FMT_PUBLIC_PATH} (${fmtBytes(bytes.length)}, referenced, not copied)`,
      );
    } else {
      await writeFile(join(texbundleDir, e.fileid), bytes);
      writtenCount++;
      console.log(`  asset    ${e.cacheKey} -> ${publicPath} (${fmtBytes(bytes.length)})`);
    }
    rows.push({ cacheKey: e.cacheKey, fileid: e.fileid, path: publicPath, family: CORE_FAMILY });
  }

  // Merge by family: replaces `core`, preserves every declared family's rows.
  const report = await writeBundle({ family: CORE_FAMILY, rows });

  console.log("");
  console.log(
    `build-tex-bundle: ${report.added} core entr${report.added === 1 ? "y" : "ies"}, ${writtenCount} asset file(s) written to texbundle/`,
  );
  if (report.rejected) {
    console.log(
      `build-tex-bundle: ${report.rejected} captured key(s) are already owned by a declared family — left there (see scripts/tex-bundle-families.mjs)`,
    );
  }
  if (report.pruned.length) {
    console.log(`build-tex-bundle: pruned ${report.pruned.length} orphaned file(s)`);
  }
  console.log(`build-tex-bundle: manifest now ${report.total} row(s) across all families`);
  console.log(`build-tex-bundle: total captured ${fmtBytes(totalBytes)}`);
  console.log(`build-tex-bundle: regenerated ${manifestTsPath.replace(repoRoot + "/", "")}`);
  console.log(`build-tex-bundle: wrote ${bundleManifestJsonPath.replace(repoRoot + "/", "")}`);
  console.log("");
  console.log("NEXT: bump CACHE_NAME in public/sw.js so the new texbundle isn't shadowed by a warm SW cache.");
}

main().catch((err) => fail(err.stack || err.message));
