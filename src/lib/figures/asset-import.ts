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

/** What the resolver decided for a picked asset. */
export interface AssetImportResolution {
  /** The basename to use — the picked name, or a `<stem>-N.<ext>` mint. */
  name: string;
  /** `write` = the name is free, put the bytes there; `reuse` = the name
   *  already holds these exact bytes, write nothing. */
  action: "write" | "reuse";
}

/** Reads the bytes at `name` inside the destination directory, or `null` if
 *  no such file exists. A probe that THROWS aborts the import: an unreadable
 *  entry is not evidence that the name is free, and guessing would reinstate
 *  the overwrite this module exists to prevent. */
export type AssetProbe = (name: string) => Promise<Uint8Array | null>;

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
  for (let n = 1; n <= MAX_ASSET_NAME_CANDIDATES; n++) {
    const name = nthCandidateName(basename, n);
    const existing = await probe(name);
    if (existing === null) return { name, action: "write" };
    if (bytesEqual(existing, bytes)) return { name, action: "reuse" };
  }
  throw new Error(
    `[asset-import] no free name for "${basename}" after ` +
      `${MAX_ASSET_NAME_CANDIDATES} candidates — refusing rather than overwriting`,
  );
}
