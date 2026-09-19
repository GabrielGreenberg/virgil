/**
 * THE `@/lib/storage` test stub — DERIVED from the module's own export surface.
 *
 * Not a suite; a helper the suites import (vitest's `include` collects only
 * `*.test.{ts,tsx}`). It lives beside [_source-scan.ts](_source-scan.ts) and
 * [_export-census.ts](_export-census.ts) for the same reason those do.
 *
 * WHY A STUB IS NEEDED AT ALL. `src/lib/storage.ts` picks its backend with a
 * raw `require("@/lib/storage-fsa")`, and vitest's resolver applies the `@/`
 * alias only to ESM `import` — so any suite whose graph reaches the storage
 * barrel (every suite that touches the tiptap extension barrel does) dies at
 * module load with `Cannot find module '@/lib/storage-fsa'`. A `vi.mock`
 * factory replaces the module wholesale, so that body never runs.
 *
 * WHY IT IS DERIVED. `vi.mock` with a factory replaces the module WHOLESALE:
 * every export the factory omits is `undefined` in that suite, silently. So a
 * hand-written list of export names is a copy of another module's surface with
 * no guard — and at `88044ee9` there were 298 such copies across `src/`, in
 * four idioms (`STORAGE_FNS` / `names` / `FNS` / a bare `Proxy`) and a dozen
 * name sets. Every one of them omitted `listSidecarNames` and
 * `deleteSidecarSiblings`; 183 omitted `mutateSidecar`, the serialized
 * read-modify-write door the write-path law is built on; and fourteen stubbed
 * `enqueueDocWrite` or `snapshotPriorBundle`, names the module does not export
 * — the fossil of a rename that reached most copies and not all. Task 558 had
 * already hand-edited 25 of them in one commit to retire `writeBib`, and the
 * result was more variants, not fewer.
 *
 * So the key set is read from `storage.ts`'s SOURCE TEXT, once, here.
 * `vi.importActual("@/lib/storage")` is not available to us: importing the real
 * module is the exact failure the stub exists to avoid. Source text is the next
 * best single source, and it cannot omit an export or invent one.
 *
 * The stub's completeness is load-bearing in both directions and guarded by
 * [storage-mock-derivation.test.ts](storage-mock-derivation.test.ts): no suite
 * may hand-enumerate storage names, and no mock may stub a name the module does
 * not export.
 *
 * USAGE
 * ```ts
 * vi.mock("@/lib/storage", () => mockStorageModule());
 * ```
 * With per-suite behaviour, passing overrides that WIN over the derived stubs
 * (unknown keys are rejected — a typo'd override is otherwise a silent no-op):
 * ```ts
 * const mockRead = vi.fn();
 * vi.mock("@/lib/storage", () =>
 *   mockStorageModule({ readSidecar: mockRead, readSidecarIfExists: mockRead }));
 * ```
 * The arrow matters: `vi.mock` is hoisted above the imports, so the factory
 * must be a closure that resolves `mockStorageModule` when it RUNS (lazily, at
 * first request for the module) rather than an imported identifier passed at
 * hoist time.
 *
 * To change the default stub body (e.g. every door resolving `null`), pass
 * `{ stub: () => vi.fn(async () => null) }` as the second argument.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { codeOnly } from "./_source-scan";

/** The barrel whose surface the stub mirrors. */
export const STORAGE_MODULE = path.resolve(__dirname, "../storage.ts");

/** `export const x` / `export function x` / `export async function x`. */
const DECLARED = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_]+)/gm;
/** `export { a, b as c } from "…"` — VALUE re-exports only (`export type {` is skipped). */
const REEXPORTED = /^export\s*\{([^}]*)\}\s*from/gm;

let namesCache: readonly string[] | null = null;

/**
 * Every VALUE export of `@/lib/storage`, read from its source.
 *
 * Type-only exports are excluded by construction: `export type { … }` does not
 * match either pattern, and a type has no runtime binding to stub.
 */
export function storageExportNames(): readonly string[] {
  if (namesCache) return namesCache;
  const src = codeOnly(readFileSync(STORAGE_MODULE, "utf8"));
  const names = new Set<string>();
  for (const m of src.matchAll(DECLARED)) names.add(m[1]);
  for (const m of src.matchAll(REEXPORTED)) {
    for (const clause of m[1].split(",")) {
      const local = clause.trim().split(/\s+as\s+/).pop()?.trim();
      if (local && /^[A-Za-z0-9_]+$/.test(local)) names.add(local);
    }
  }
  namesCache = Object.freeze([...names].sort());
  return namesCache;
}

export interface MockStorageOptions {
  /** Builds the stub for each export. Default: `vi.fn()`. */
  stub?: (name: string) => unknown;
}

/**
 * A complete stub of `@/lib/storage`: one `vi.fn()` per real export, plus the
 * two non-function exports given their falsy production-test values
 * (`isDevStorage: false`).
 *
 * `overrides` win over the derived stubs. An override naming something the
 * module does not export THROWS — a mock cannot usefully stub a door that does
 * not exist, and a silently-ignored typo is how a suite comes to prove nothing.
 */
export function mockStorageModule(
  overrides: Record<string, unknown> = {},
  opts: MockStorageOptions = {},
): Record<string, unknown> {
  const names = storageExportNames();
  const stub = opts.stub ?? (() => vi.fn());
  const mod: Record<string, unknown> = {};
  for (const name of names) mod[name] = stub(name);
  // `isDevStorage` is a boolean re-export, not a door: production-shaped false.
  mod.isDevStorage = false;
  for (const [key, value] of Object.entries(overrides)) {
    if (!names.includes(key)) {
      throw new Error(
        `mockStorageModule: "${key}" is not an export of @/lib/storage ` +
          `(exports: ${names.join(", ")})`,
      );
    }
    mod[key] = value;
  }
  return mod;
}
