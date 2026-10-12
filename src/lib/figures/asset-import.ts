/**
 * Where a picked BINARY asset lands inside the paper folder — the ONE answer
 * both storage backends read (task 533).
 *
 * > **A binary asset landing in the paper folder claims a FREE name, or reuses
 * > an identical one. It never replaces a byte that is already there.**
 *
 * `importFigureFile` used to copy the picked file to `figures/<basename>`
 * through a truncating write with no existence check, no byte compare and no
 * de-duplicating name — so Figure 5's `plot.png` silently destroyed Figure 1's,
 * in both backends, with no prompt and no `.history/` slot (FSA has no trash,
 * and nothing snapshots `figures/`). The colliding names are exactly the ones
 * people pick: `plot.png`, `figure1.png`, `image.png`, every default export
 * name R / matplotlib / Illustrator emit.
 *
 * The rule is task 415's ("no FSA write of a file whose bytes are already on
 * disk") asked of bytes instead of text, plus the one thing a text writer never
 * needs: a differing collision does not overwrite, it takes the next free name.
 *
 * Two rungs, walked over the candidate names `<stem>.<ext>`, `<stem>-2.<ext>`,
 * `<stem>-3.<ext>`, …:
 *
 *   1. The candidate is ABSENT     ⇒ write there. (`action: "write"`)
 *   2. The candidate holds the SAME bytes ⇒ reuse it, write nothing.
 *      (`action: "reuse"` — the commonest collision there is, the same asset
 *      picked for a second figure, costs no swap file and no sync-daemon
 *      event.)
 *   3. The candidate holds DIFFERENT bytes ⇒ it is someone else's; try the next.
 *
 * Rung 2 runs on EVERY candidate, not only the first, so an asset that was
 * once minted as `plot-2.png` is found there on a later re-pick instead of
 * being minted a third time — which is what keeps the surgical alternative
 * ("mint a unique name unconditionally") from filling `figures/` with copies of
 * one identical asset, the write traffic tasks 363/415 spent two passes
 * reducing.
 *
 * This module is an import-free LEAF, because the two backends are the two
 * layers that must agree and neither may import the other (the placement rule
 * `latex-markers.ts` and `node-attr-sets.ts` each earned). It decides the NAME
 * and the ACTION; the backend owns the probe and the write. The comparison is
 * a direct byte compare rather than a content hash: it costs the same O(n)
 * pass, and it cannot false-match.
 */

// ---------------------------------------------------------------------------
// TeX-safe names — task 1081.
// ---------------------------------------------------------------------------
//
// > **A path Virgil writes into `\includegraphics{…}` holds no character TeX
// > reads as syntax.**
//
// The picked file's name used to go verbatim into the brace group. `fig
// 50%.png` became `\includegraphics{figures/fig 50%.png}`: the `%` comments
// out `.png}` and the rest of the line, the group never closes, the reload
// parses the figure wrong (or swallows what follows) and pdfTeX fails — in the
// user's only copy of the paper. `#`, `{`, `}`, `\`, `~`, `^`, `$`, `&` and `"`
// break the group, the tokenizer or the kernel's quoting the same way.
// `\detokenize{}` is no rescue: `%` is consumed at tokenization, before any
// macro sees it.
//
// So there is ONE predicate for "TeX can read this path back", and two ways to
// meet it: an asset Virgil COPIES in gets a safe name minted here (every unsafe
// character becomes `-`, then the collision walk runs on the minted name); a
// file already inside the paper folder cannot be renamed, so it is REFUSED
// (`TexUnsafeAssetPathError`) rather than written broken. Spaces stay — the
// LaTeX kernel has read them in graphics paths since 2019 — as do `_`, `.`,
// `-` and non-ASCII letters.

/** One character TeX reads as syntax inside a `\includegraphics` path, or a
 *  control character. Global so `texSafeAssetName` can replace every one. */
const TEX_UNSAFE_PATH_CHAR = /[%#{}\\~^$&"\u0000-\u001f\u007f]/g;

/** Every TeX-unsafe character in `path`, in order, deduplicated — the
 *  refusal's evidence. Empty ⇔ the path is safe to write. */
export function texUnsafePathChars(path: string): string[] {
  return [...new Set(path.match(TEX_UNSAFE_PATH_CHAR) ?? [])];
}

/** Whether `path` can be written into `\includegraphics{…}` and read back
 *  byte-for-byte by both Virgil's parser and TeX. */
export function isTexSafeGraphicsPath(path: string): boolean {
  return texUnsafePathChars(path).length === 0;
}

/** Mint a TeX-safe basename from a picked one: every unsafe character becomes
 *  `-`, runs of `-` collapse, and a stem left empty becomes `figure`. A name
 *  that is already safe comes back unchanged (so pre-1081 assets keep their
 *  names and the reuse rung still finds them). */
export function texSafeAssetName(basename: string): string {
  if (isTexSafeGraphicsPath(basename)) return basename;
  const { stem, ext } = splitBasename(basename);
  const clean = (s: string) =>
    s.replace(TEX_UNSAFE_PATH_CHAR, "-").replace(/-{2,}/g, "-");
  let safeStem = clean(stem).replace(/^-+|-+$/g, "");
  if (safeStem === "" || safeStem === ".") safeStem = "figure";
  return `${safeStem}${clean(ext)}`;
}

/** The import door's refusal: a file already inside the paper folder whose
 *  path TeX cannot read. Nothing is copied and nothing may be dispatched. */
export class TexUnsafeAssetPathError extends Error {
  readonly path: string;
  readonly chars: string[];
  constructor(path: string) {
    const chars = texUnsafePathChars(path);
    super(
      `[asset-import] "${path}" contains ${chars.map((c) => JSON.stringify(c)).join(", ")}, ` +
        "which LaTeX reads as syntax — rename the file and pick it again",
    );
    this.name = "TexUnsafeAssetPathError";
    this.path = path;
    this.chars = chars;
  }
}

/** What the resolver decided for a picked asset. */
export interface AssetImportResolution {
  /** The basename to use — the picked name, or a `<stem>-N.<ext>` mint. */
  name: string;
  /** `write` = the name is free, put the bytes there; `reuse` = the name
   *  already holds these exact bytes, write nothing. */
  action: "write" | "reuse";
}

/** A probe hit that also reports the entry's ON-DISK name. On a
 *  case-insensitive filesystem (APFS, NTFS) a probe for `Plot.png` finds
 *  `plot.png`; the reuse rung must answer with the name the disk holds, or a
 *  case-sensitive TeX (Overleaf, Linux) cannot find the file (task 1081). */
export interface AssetProbeHit {
  bytes: Uint8Array;
  name: string;
}

/** Reads the bytes at `name` inside the destination directory, or `null` if
 *  no such file exists — bare bytes, or an `AssetProbeHit` when the backend
 *  can name the on-disk entry. A probe that THROWS aborts the import: an
 *  unreadable entry is not evidence that the name is free, and guessing would
 *  reinstate the overwrite this module exists to prevent. */
export type AssetProbe = (
  name: string,
) => Promise<Uint8Array | AssetProbeHit | null>;

/**
 * Upper bound on the candidate walk. Far past anything a real `figures/`
 * folder holds, and a refusal rather than an overwrite when it is reached —
 * the failure direction that costs nothing on disk.
 */
export const MAX_ASSET_NAME_CANDIDATES = 1000;

/** Split `plot.v2.png` into `{ stem: "plot.v2", ext: ".png" }`. A leading dot
 *  (`.hidden`) and a name with no dot both have an EMPTY extension, so the
 *  mint suffix lands at the end rather than inside a dotfile's name. */
export function splitBasename(basename: string): { stem: string; ext: string } {
  const dot = basename.lastIndexOf(".");
  if (dot <= 0) return { stem: basename, ext: "" };
  return { stem: basename.slice(0, dot), ext: basename.slice(dot) };
}

/** The n-th candidate name: the basename itself for `n = 1`, else
 *  `<stem>-<n><ext>`. */
export function nthCandidateName(basename: string, n: number): string {
  if (n <= 1) return basename;
  const { stem, ext } = splitBasename(basename);
  return `${stem}-${n}${ext}`;
}

/** Exact byte equality. Length first, so a mismatch on size costs O(1). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Decide where `bytes` picked as `basename` should land, given a probe of the
 * destination directory. See the module header for the three rungs.
 *
 * Throws when every candidate up to `MAX_ASSET_NAME_CANDIDATES` is taken by a
 * DIFFERENT file — refusing is the only answer that replaces nothing.
 */
export async function resolveAssetImport(
  basename: string,
  bytes: Uint8Array,
  probe: AssetProbe,
): Promise<AssetImportResolution> {
  // Task 1081: the walk runs on the TeX-safe name, so every candidate it can
  // return is one `\includegraphics{…}` reads back intact.
  const safe = texSafeAssetName(basename);
  for (let n = 1; n <= MAX_ASSET_NAME_CANDIDATES; n++) {
    const name = nthCandidateName(safe, n);
    const existing = await probe(name);
    if (existing === null) return { name, action: "write" };
    const hit =
      existing instanceof Uint8Array ? { bytes: existing, name } : existing;
    if (bytesEqual(hit.bytes, bytes)) return { name: hit.name, action: "reuse" };
  }
  throw new Error(
    `[asset-import] no free name for "${safe}" after ` +
      `${MAX_ASSET_NAME_CANDIDATES} candidates — refusing rather than overwriting`,
  );
}
