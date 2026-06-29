/**
 * Identity constants for the bundled example document.
 *
 * Kept dependency-free (no imports) so light consumers — UI components,
 * the build script's expectations — can reference the fixed id without
 * pulling in `example-seeder.ts`, which depends on the `@/lib/storage`
 * barrel (and would otherwise drag that heavy module into component tests;
 * see the `vitest_extension_barrel_storage_mock` gotcha).
 */

/** Fixed, deterministic id. 8 chars (matches `randomUUID().slice(0,8)` width)
 *  and contains non-hex letters, so `generateEntityId()` (a v4 UUID, uuid.ts:40)
 *  can never mint it — no collision with a real doc. No reserved prefix, so it
 *  matches none of the storage core's `startsWith` carve-outs. */
export const EXAMPLE_DOC_ID = "example0";
/** Human-readable tab title. */
export const EXAMPLE_DOC_NAME = "Example — Annotation History";
/** OPFS subdirectory name + the doc's display `folderName`. Must match the
 *  `folderName` emitted by `scripts/build-example-bundle.mjs`. */
export const EXAMPLE_FOLDER_NAME = "example-annotation-history";
/** Fallback tex filename (the bundle manifest is authoritative). */
export const EXAMPLE_TEX_FILENAME = "document.tex";
