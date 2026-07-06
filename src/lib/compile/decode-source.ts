/**
 * Byte-safe .tex decoding for the compile path (P2).
 *
 * The old hook decoded every text file with a NON-fatal `TextDecoder`, which
 * silently replaces malformed bytes with U+FFFD (the replacement char). A
 * non-UTF-8 `.tex` (Latin-1, a mangled paste) would then be corrupted BEFORE
 * the engine ever saw it — and, on the documentclass-rewrite path, that
 * corrupted string could be persisted back to disk.
 *
 * `decodeTexBytes` uses a FATAL decoder: on success it returns `{ text }`; on
 * any decode failure it returns `{ raw }` (the original bytes, untouched), so
 * the caller can write the bytes straight to memfs and never introduce U+FFFD.
 */

export type DecodedTex = { text: string } | { raw: Uint8Array };

/**
 * Decode `.tex`/`.bib` bytes as UTF-8, fatally. Returns `{ text }` on a clean
 * decode or `{ raw: bytes }` (byte-exact passthrough) when the bytes are not
 * valid UTF-8, so a non-UTF-8 file is never corrupted with U+FFFD.
 */
export function decodeTexBytes(bytes: Uint8Array): DecodedTex {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text };
  } catch {
    return { raw: bytes };
  }
}
