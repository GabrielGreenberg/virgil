/**
 * The ONE reader/writer of the vendored TeX bundle's two generated tables.
 *
 * `src/lib/tex-core-manifest.ts` (cacheKey -> {fileid, path, family}) and
 * `public/swiftlatex/texbundle/manifest.json` ({ paths: [...] }) are two
 * spellings of the same fact, and their consumers apply DIFFERENT bases
 * (task 365) — so they cannot share one string, but they MUST share one
 * writer, or the SW precaches a set the engine does not seed.
 *
 * Two scripts produce them and this module is why they cannot disagree:
 *
 *   - `build-tex-bundle.mjs`  — bakes a LIVE capture dump (the `core` family).
 *   - `vendor-tex-family.mjs` — resolves a DECLARED family's closure against
 *                               the mirror (task 520).
 *
 * Both go through `writeBundle`, which is MERGE-by-family: a family's rows are
 * replaced wholesale and every other family's rows are carried through
 * untouched. That is what makes re-running either script idempotent, and what
 * lets a family's closure SHRINK without leaving orphan rows (and orphan bytes)
 * behind forever.
 */

import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(__dirname, "..", "..");
export const texbundleDir = join(repoRoot, "public", "swiftlatex", "texbundle");
export const manifestTsPath = join(repoRoot, "src", "lib", "tex-core-manifest.ts");
export const bundleManifestJsonPath = join(texbundleDir, "manifest.json");

/**
 * The vendored base `.fmt`: its bytes already ship at this path (next to the
 * WASM), so nothing re-copies them into texbundle/ — the manifest just points
 * at them.
 */
export const FMT_FILEID = "swiftlatexpdftex.fmt";
export const FMT_PUBLIC_PATH = "/swiftlatex/swiftlatexpdftex.fmt";

/** The family the original live capture's rows belong to. */
export const CORE_FAMILY = "core";

/**
 * The SAME asset path, spelled for the SERVICE WORKER's precache manifest.
 *
 * `tex-core-manifest.ts` is read by `tex-assets.ts`, which prefixes the deploy
 * basePath through `publicAssetUrl` — root-relative, leading slash.
 * `texbundle/manifest.json` is read by `public/sw.js`, which resolves each
 * entry with `new URL(p, self.location.href)` — i.e. against the SW's own
 * SCOPE. A leading slash DISCARDS that base and escapes to the origin root, so
 * under the production `/virgil` deploy every precache fetch 404'd and the SW's
 * per-asset try/catch swallowed it: no offline TeX assets, no error, and no
 * symptom until the user went offline. So the SW list is scope-relative.
 */
export const swPath = (publicPath) => publicPath.replace(/^\/+/, "");

/** The public path a non-`.fmt` asset's bytes are served at. */
export const publicPathFor = (fileid) =>
  fileid === FMT_FILEID ? FMT_PUBLIC_PATH : `/swiftlatex/texbundle/${fileid}`;

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Parse the generated `tex-core-manifest.ts` back into rows.
 *
 * Safe to do with a regex because THIS module also emits the file, one row per
 * line in a fixed shape — the parser and the renderer are the same owner. A row
 * written before the `family` column existed reads as `core`, so an older
 * checkout upgrades in place on the next write rather than losing its rows.
 */
export async function readManifestTs() {
  let src;
  try {
    src = await readFile(manifestTsPath, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  const re =
    /\{\s*cacheKey:\s*"((?:[^"\\]|\\.)*)",\s*fileid:\s*"((?:[^"\\]|\\.)*)",\s*path:\s*"((?:[^"\\]|\\.)*)"(?:,\s*family:\s*"((?:[^"\\]|\\.)*)")?\s*\}/g;
  for (const m of src.matchAll(re)) {
    rows.push({
      cacheKey: JSON.parse(`"${m[1]}"`),
      fileid: JSON.parse(`"${m[2]}"`),
      path: JSON.parse(`"${m[3]}"`),
      family: m[4] === undefined ? CORE_FAMILY : JSON.parse(`"${m[4]}"`),
    });
  }
  return rows;
}

/**
 * Replace `family`'s rows with `rows` and rewrite both tables + prune orphaned
 * bytes. Returns a small report for the caller to print.
 *
 * PRUNING is by FILEID and only ever removes a file no SURVIVING row points at
 * — two cacheKeys legitimately share one file (`26/expex` and `26/expex.sty`
 * both resolve to bytes the mirror names differently from the request), and a
 * file another family still references is never this family's to delete.
 */
export async function writeBundle({ family, rows, prune = true }) {
  const others = (await readManifestTs()).filter((r) => r.family !== family);

  // A cacheKey another family already owns stays with that family: one key,
  // one owner, so a later capture cannot silently duplicate a vendored row.
  const claimed = new Set(others.map((r) => r.cacheKey));
  const kept = rows.filter((r) => !claimed.has(r.cacheKey));
  const rejected = rows.length - kept.length;

  const merged = [...others, ...kept].sort(
    (a, b) => a.family.localeCompare(b.family) || a.cacheKey.localeCompare(b.cacheKey),
  );

  const liveFileids = new Set(merged.map((r) => r.fileid));
  let pruned = [];
  if (prune) {
    const onDisk = await readdir(texbundleDir).catch(() => []);
    for (const name of onDisk) {
      if (name === "manifest.json") continue;
      if (liveFileids.has(name)) continue;
      await unlink(join(texbundleDir, name));
      pruned.push(name);
    }
  }

  const paths = [...new Set(merged.map((r) => swPath(r.path)))].sort();
  await writeFile(bundleManifestJsonPath, JSON.stringify({ paths }, null, 2) + "\n");
  await writeFile(manifestTsPath, renderManifestTs(merged));

  return { total: merged.length, added: kept.length, rejected, pruned, paths: paths.length };
}

/** Render the generated `tex-core-manifest.ts`. */
export function renderManifestTs(manifest) {
  const rows = manifest
    .map(
      (m) =>
        `  { cacheKey: ${JSON.stringify(m.cacheKey)}, fileid: ${JSON.stringify(m.fileid)}, path: ${JSON.stringify(m.path)}, family: ${JSON.stringify(m.family)} },`,
    )
    .join("\n");
  return `/**
 * Curated core TeX-asset manifest (P1 offline-assets).
 *
 * GENERATED FILE — do not edit by hand. Regenerate with either producer:
 *   node scripts/build-tex-bundle.mjs <captured-dump.json>   # the \`core\` family
 *   node scripts/vendor-tex-family.mjs <family>              # a declared family
 *
 * Both go through scripts/lib/tex-bundle-manifest.mjs, which merges BY FAMILY —
 * so each producer replaces only its own rows and the two tables it writes (this
 * file and public/swiftlatex/texbundle/manifest.json) can never disagree.
 *
 * The \`cacheKey\` of every entry is the worker's compiler-internal
 * \`<numericFormatCode>/<reqname>\` key. The bytes for each entry live
 * same-origin under BASE_PATH at the given \`path\` (the base .fmt at
 * /swiftlatex/swiftlatexpdftex.fmt; packages under
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
  /**
   * Which declared vendor family owns this row — \`"core"\` for the original
   * live capture, otherwise a family in scripts/tex-bundle-families.mjs.
   *
   * READ by the producers: re-running one replaces exactly its own rows, so a
   * family's closure can SHRINK without leaving orphan rows (and orphan bytes)
   * behind. Not read at runtime.
   */
  family: string;
}

/**
 * Sentinel cacheKey for the base \`.fmt\`. Retained for callers that reference
 * it; once the manifest is generated from a live capture the real
 * \`<code>/swiftlatexpdftex.fmt\` cacheKey is used in CORE_MANIFEST below.
 */
export const PLACEHOLDER_FMT_CACHEKEY = "__PLACEHOLDER_FMT_CACHEKEY__";

/** Public path (relative to BASE_PATH) of the vendored base format file. */
export const CORE_FMT_PATH = ${JSON.stringify(FMT_PUBLIC_PATH)};

/** The curated core manifest (generated — see the header). */
export const CORE_MANIFEST: readonly CoreManifestEntry[] = [
${rows}
];
`;
}
