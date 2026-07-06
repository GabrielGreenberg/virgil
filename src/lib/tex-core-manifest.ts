/**
 * Curated core TeX-asset manifest (P1 offline-assets).
 *
 * This is the "Tier A" local seed: the set of TeX assets Virgil self-hosts
 * same-origin under `public/swiftlatex/texbundle/` so that base LaTeX (and,
 * once the manager captures them, the core packages Virgil itself emits —
 * expex / natbib / graphicx / amsmath / amssymb / xcolor; tikz opt-in) ALWAYS
 * compile offline, regardless of the TeXlyre mirror's state.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  HOW THIS FILE IS POPULATED  (READ BEFORE EDITING BY HAND)
 * ─────────────────────────────────────────────────────────────────────────
 * The `cacheKey` for every asset is COMPILER-INTERNAL: it is the worker's own
 * `<numericFormatCode>/<reqname>` key, and the numeric format code is assigned
 * by pdfTeX at runtime — it CANNOT be known ahead of time or hand-authored
 * reliably. Therefore this manifest is *machine-populated* from a LIVE capture:
 *
 *   1. Compile a representative doc ONLINE once (warms the worker's cache).
 *   2. Dump the worker's freshly-cached entries to JSON (see the dump snippet
 *      in the P1 handoff / build-script header).
 *   3. Run `node scripts/build-tex-bundle.mjs <dump.json>` — it writes each
 *      asset's bytes to `public/swiftlatex/texbundle/<fileid>` and REGENERATES
 *      the `CORE_MANIFEST` array below from the captured cacheKey→fileid map.
 *
 * The single entry seeded here for the base `.fmt` uses a PLACEHOLDER cacheKey
 * (`__PLACEHOLDER_FMT_CACHEKEY__`). It is deliberately wrong: `provisionEngine`
 * tolerates it (a mis-keyed seed simply never gets hit by a real lookup — the
 * worker falls back to the mirror as it does today), and the manager REPLACES
 * it with the real `<code>/swiftlatexpdftex.fmt` cacheKey from the live dump.
 * Until then the persistent write-through cache (Tier B) still delivers
 * offline-after-first-online-fetch, so the mechanism is useful immediately.
 *
 * BUILD-TIME NOTE: the `.fmt` bytes MUST be re-vendored in lockstep with any
 * SwiftLaTeX WASM bump — a seeded `.fmt` from a mismatched WASM would produce
 * subtle compile differences. The build script is the single writer of the
 * texbundle; do not drop files in by hand.
 */

/** One curated core asset: its compiler-internal cacheKey, its memfs fileid,
 *  and the same-origin public path (under BASE_PATH) its bytes are served at. */
export interface CoreManifestEntry {
  /** The worker's own `<numericFormatCode>/<reqname>` kpse cache key. */
  cacheKey: string;
  /** The memfs filename the worker writes the asset to (`TEXCACHEROOT/<fileid>`). */
  fileid: string;
  /** Same-origin path (relative to BASE_PATH) the bytes are fetched from. */
  path: string;
}

/**
 * Sentinel cacheKey for the base `.fmt`. The manager replaces this with the
 * real `<numericFormatCode>/swiftlatexpdftex.fmt` captured from a live dump.
 * `provisionEngine` seeds it harmlessly if it's still the placeholder.
 */
export const PLACEHOLDER_FMT_CACHEKEY = "__PLACEHOLDER_FMT_CACHEKEY__";

/** Public path (relative to BASE_PATH) of the vendored base format file. */
export const CORE_FMT_PATH = "/swiftlatex/swiftlatexpdftex.fmt";

/**
 * The curated core manifest. Seeded with ONLY the base `.fmt` under a
 * placeholder cacheKey (see the header). The build script regenerates this
 * array in full from a live capture — including the texbundle assets that
 * back the packages Virgil emits.
 */
export const CORE_MANIFEST: readonly CoreManifestEntry[] = [
  {
    // Manager-populated: replace PLACEHOLDER_FMT_CACHEKEY with the real
    // `<code>/swiftlatexpdftex.fmt` key from the live dump.
    cacheKey: PLACEHOLDER_FMT_CACHEKEY,
    fileid: "swiftlatexpdftex.fmt",
    path: CORE_FMT_PATH,
  },
];
