/**
 * Shared low-level storage types (leaf module — no imports, so both the FSA
 * and dev backends can depend on it without a cycle through the `storage`
 * barrel).
 */

/**
 * The outcome of a best-effort compiled-PDF persistence (P6). `writePdf` used
 * to be `Promise<void>`, which conflated three cases: a real write, an
 * intentional library/read-only skip, and a swallowed IO failure. The result
 * makes them distinguishable so the compile hook can:
 *   - `written` — persisted to disk; nothing to surface.
 *   - `skipped` — a library/read-only paper that intentionally never persists;
 *     NOT an error. The in-memory viewer still shows the compiled PDF.
 *   - `failed`  — the write was attempted and rejected (dev PUT `!resp.ok`, or
 *     a real FSA IO error). The hook surfaces a NON-BLOCKING notice — the
 *     compile itself succeeded and the in-memory PDF is fully usable.
 */
export type WritePdfResult =
  | { status: "written" }
  | { status: "skipped" }
  | { status: "failed"; error?: unknown };
