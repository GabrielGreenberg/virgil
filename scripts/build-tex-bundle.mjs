#!/usr/bin/env node
// Build the curated core TeX-asset bundle (P1 offline-assets).
//
// This turns a LIVE cache capture into (a) the self-hosted asset bytes under
// public/swiftlatex/texbundle/ and (b) a regenerated src/lib/tex-core-manifest.ts
// (cacheKey -> {fileid, path}) that provisionEngine seeds at boot.
//
// WHY A CAPTURE IS NEEDED: the worker's kpse cacheKey is
// `<numericFormatCode>/<reqname>`, and the numeric format code is assigned by
// pdfTeX at runtime — it cannot be hand-authored reliably. So the manager
// captures the real keys from a warmed worker, and this script bakes them in.
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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const texbundleDir = join(repoRoot, "public", "swiftlatex", "texbundle");
const manifestTsPath = join(repoRoot, "src", "lib", "tex-core-manifest.ts");
const bundleManifestJsonPath = join(texbundleDir, "manifest.json");

// The vendored base .fmt: its bytes already ship at this path, so we reference
// it rather than duplicating it into texbundle/.
const FMT_FILEID = "swiftlatexpdftex.fmt";
const FMT_PUBLIC_PATH = "/swiftlatex/swiftlatexpdftex.fmt";

/**
 * The SAME asset path, spelled for the SERVICE WORKER's precache manifest.
 *
 * Two tables come out of this script and their consumers apply DIFFERENT bases
 * (task 365), so they cannot share one spelling:
 *
 *   - `tex-core-manifest.ts` is read by `tex-assets.ts`, which prefixes the
 *     deploy basePath through `publicAssetUrl`. Root-relative, leading slash.
 *   - `texbundle/manifest.json` is read by `public/sw.js`, which resolves each
 *     entry with `new URL(p, self.location.href)` — i.e. against the SW's own
 *     SCOPE. A leading slash DISCARDS that base and escapes to the origin root,
 *     so under the production `/virgil` deploy every precache fetch 404'd, and
 *     the SW's per-asset try/catch swallowed it: no offline TeX assets, no
 *     error, and no symptom until the user went offline.
 *
 * So the SW list is scope-relative, matching `sw.js`'s own two constants
 * (`"./swiftlatex/…"`). The SW normalizes a leading slash defensively too, but
 * the table is emitted correct at the source.
 */
const swPath = (publicPath) => publicPath.replace(/^\/+/, "");

function fail(msg) {
  console.error(`build-tex-bundle: ${msg}`);
  process.exit(1);
}

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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

  const manifest = []; // { cacheKey, fileid, path }
  const bundlePaths = []; // public paths for the SW precache
  let totalBytes = 0;
  let writtenCount = 0;

  for (const e of byCacheKey.values()) {
    const bytes = Buffer.from(e.bytesBase64, "base64");
    totalBytes += bytes.length;

    if (e.fileid === FMT_FILEID) {
      // The .fmt is already vendored at public/swiftlatex/ — don't duplicate.
      manifest.push({ cacheKey: e.cacheKey, fileid: e.fileid, path: FMT_PUBLIC_PATH });
      bundlePaths.push(swPath(FMT_PUBLIC_PATH));
      console.log(`  fmt      ${e.cacheKey} -> ${FMT_PUBLIC_PATH} (${fmtBytes(bytes.length)}, referenced, not copied)`);
      continue;
    }

    const outPath = join(texbundleDir, e.fileid);
    await writeFile(outPath, bytes);
    writtenCount++;
    const publicPath = `/swiftlatex/texbundle/${e.fileid}`;
    manifest.push({ cacheKey: e.cacheKey, fileid: e.fileid, path: publicPath });
    bundlePaths.push(swPath(publicPath));
    console.log(`  asset    ${e.cacheKey} -> ${publicPath} (${fmtBytes(bytes.length)})`);
  }

  // Deterministic order (by cacheKey) so regeneration diffs are minimal.
  manifest.sort((a, b) => a.cacheKey.localeCompare(b.cacheKey));
  bundlePaths.sort();

  // Write the SW precache manifest.
  await writeFile(
    bundleManifestJsonPath,
    JSON.stringify({ paths: bundlePaths }, null, 2) + "\n",
  );

  // Regenerate src/lib/tex-core-manifest.ts.
  await writeFile(manifestTsPath, renderManifestTs(manifest));

  console.log("");
  console.log(`build-tex-bundle: ${manifest.length} manifest entr${manifest.length === 1 ? "y" : "ies"}, ${writtenCount} asset file(s) written to texbundle/`);
  console.log(`build-tex-bundle: total captured ${fmtBytes(totalBytes)}`);
  console.log(`build-tex-bundle: regenerated ${manifestTsPath.replace(repoRoot + "/", "")}`);
  console.log(`build-tex-bundle: wrote ${bundleManifestJsonPath.replace(repoRoot + "/", "")}`);
  console.log("");
  console.log("NEXT: bump CACHE_NAME in public/sw.js so the new texbundle isn't shadowed by a warm SW cache.");
}

/** Render the regenerated tex-core-manifest.ts (keeps CORE_FMT_PATH +
 *  PLACEHOLDER_FMT_CACHEKEY exports so nothing importing them breaks). */
function renderManifestTs(manifest) {
  const rows = manifest
    .map(
      (m) =>
        `  { cacheKey: ${JSON.stringify(m.cacheKey)}, fileid: ${JSON.stringify(m.fileid)}, path: ${JSON.stringify(m.path)} },`,
    )
    .join("\n");
  return `/**
 * Curated core TeX-asset manifest (P1 offline-assets).
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   node scripts/build-tex-bundle.mjs <captured-dump.json>
 *
 * The \`cacheKey\` of every entry is the worker's compiler-internal
 * \`<numericFormatCode>/<reqname>\` key, captured from a live compile. The bytes
 * for each entry live same-origin under BASE_PATH at the given \`path\` (the base
 * .fmt at /swiftlatex/swiftlatexpdftex.fmt; packages under
 * /swiftlatex/texbundle/<fileid>). \`provisionEngine\` fetches these and seeds
 * the worker's kpse cache before the first compile.
 *
 * BUILD-TIME NOTE: the .fmt bytes MUST be re-vendored in lockstep with any
 * SwiftLaTeX WASM bump; re-run the capture + this script after a WASM bump.
 */

/** One curated core asset: its compiler-internal cacheKey, its memfs fileid,
 *  and the same-origin public path (under BASE_PATH) its bytes are served at. */
export interface CoreManifestEntry {
  /** The worker's own \`<numericFormatCode>/<reqname>\` kpse cache key. */
  cacheKey: string;
  /** The memfs filename the worker writes the asset to (\`TEXCACHEROOT/<fileid>\`). */
  fileid: string;
  /** Same-origin path (relative to BASE_PATH) the bytes are fetched from. */
  path: string;
}

/**
 * Sentinel cacheKey for the base \`.fmt\`. Retained for callers that reference
 * it; once the manifest is generated from a live capture the real
 * \`<code>/swiftlatexpdftex.fmt\` cacheKey is used in CORE_MANIFEST below.
 */
export const PLACEHOLDER_FMT_CACHEKEY = "__PLACEHOLDER_FMT_CACHEKEY__";

/** Public path (relative to BASE_PATH) of the vendored base format file. */
export const CORE_FMT_PATH = ${JSON.stringify(FMT_PUBLIC_PATH)};

/** The curated core manifest (generated from a live capture). */
export const CORE_MANIFEST: readonly CoreManifestEntry[] = [
${rows}
];
`;
}

main().catch((err) => fail(err.stack || err.message));
