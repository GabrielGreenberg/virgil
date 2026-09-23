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
 * WHAT EACH STUB ANSWERS. Deriving the NAME set closed one axis and left the
 * other open: every derived door was the same bare `vi.fn()`, which resolves
 * `undefined` — and `undefined` is in no door's contract. `mutateSidecar` is
 * declared `Promise<T | null>`, so its one production consumer narrows on
 * `=== null`; the stub's `undefined` sailed past that guard and dereferenced
 * (task 643). So the default RETURN is derived too, from the backend's own
 * declared return type: `| null` doors answer `null`, `void` doors `undefined`,
 * `string` `""`, arrays `[]`, `Record<…>` `{}`. A door whose declared return is
 * an object shape source text cannot synthesize is listed in
 * {@link UNSYNTHESIZABLE_RETURNS} — declared and guarded rather than silently
 * `undefined`, so the gap cannot grow unnoticed. Suites that exercise one of
 * those doors pass an override.
 *
 * To change the default stub body (e.g. every door resolving `null`), pass
 * `{ stub: () => vi.fn(async () => null) }` as the second argument.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { codeOnly, commentsStripped } from "./_source-scan";

/** The barrel whose surface the stub mirrors. */
export const STORAGE_MODULE = path.resolve(__dirname, "../storage.ts");

/** `export const x` / `export function x` / `export async function x`. */
const DECLARED = /^export\s+(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z0-9_]+)/gm;
/** `export { a, b as c } from "…"` — VALUE re-exports only (`export type {` is skipped). */
const REEXPORTED = /^export\s*\{([^}]*)\}\s*from/gm;

let namesCache: readonly string[] | null = null;
let returnsCache: ReadonlyMap<string, string> | null = null;
let identityCache: ReadonlyMap<string, number> | null = null;

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

/**
 * The backend whose declared return types the stub's defaults mirror.
 *
 * `storage.ts` itself states none: it forwards `backend.<name>` bindings, whose
 * types come from `typeof import("@/lib/storage-fsa")`. So the barrel is the
 * source for the NAME set and the backend is the source for the SHAPES — the
 * same two-source split the barrel's own type annotation already makes.
 */
export const STORAGE_BACKEND_MODULE = path.resolve(__dirname, "../storage-fsa.ts");

/** Resolve a `@/…` specifier the way the barrel's own imports do. */
const fromAlias = (spec: string): string | null =>
  spec.startsWith("@/") ? path.resolve(__dirname, "../..", spec.slice(2) + ".ts") : null;

/** Split a parameter list on its TOP-LEVEL commas (a `Record<a, b>` is one). */
function splitParams(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === "<" || c === "{" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === "}" || c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

/**
 * Split a type on its TOP-LEVEL `|`, ignoring bars nested in `<>`, `{}`, `()`
 * or `[]`. `Record<string, FileStat | null>` is one arm, not two — its `| null`
 * belongs to the value type, and a stub that read it as the door's own would
 * answer `null` where the contract promises an object.
 */
function topLevelArms(type: string): string[] {
  const arms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < type.length; i++) {
    const c = type[i];
    if (c === "<" || c === "{" || c === "(" || c === "[") depth++;
    else if (c === ">" || c === "}" || c === ")" || c === "]") depth--;
    else if (c === "|" && depth === 0) {
      arms.push(type.slice(start, i).trim());
      start = i + 1;
    }
  }
  arms.push(type.slice(start).trim());
  return arms.filter(Boolean);
}

/** `Promise<X>` → `X`; anything else unchanged. A stub is async either way. */
function unwrapPromise(type: string): string {
  const m = /^Promise\s*<([\s\S]*)>$/.exec(type.trim());
  return m ? m[1].trim() : type.trim();
}

/**
 * Every declared return type of the backend's doors, keyed by export name.
 *
 * Read from source text for the same reason the name set is: importing the real
 * module is the failure the stub exists to avoid. One hop of `export { a as b }
 * from "@/…"` is followed, because `getDocWriteHandle` is exactly that — a
 * `| null` door whose shape lives in `doc-pipeline`.
 */
export function storageReturnTypes(): ReadonlyMap<string, string> {
  if (returnsCache) return returnsCache;
  const out = new Map<string, string>();
  const identity = new Map<string, number>();
  const scan = (file: string, wanted: ReadonlySet<string> | null, alias: Map<string, string>) => {
    const src = codeOnly(readFileSync(file, "utf8"));
    for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) {
      const local = m[1];
      const exported = alias.get(local) ?? local;
      if (wanted && !wanted.has(local)) continue;
      const open = src.indexOf("(", m.index! + m[0].length);
      if (open < 0) continue;
      let depth = 0;
      let i = open;
      for (; i < src.length; i++) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")" && --depth === 0) break;
      }
      // From the closing paren to the body's `{`: the first brace at angle
      // depth 0, so an object type INSIDE `Promise<…>` is not mistaken for it.
      let angle = 0;
      let j = i + 1;
      for (; j < src.length; j++) {
        const c = src[j];
        if (c === "<") angle++;
        else if (c === ">") angle--;
        else if (c === "{" && angle === 0) break;
      }
      const ret = src.slice(i + 1, j).replace(/^\s*:\s*/, "").trim();
      if (!ret) continue;
      out.set(exported, ret.replace(/\s+/g, " "));
      // A return type that IS one of the function's own type parameters names
      // no shape at all — it says "whatever the caller handed me". Source text
      // can still answer it faithfully when that parameter also appears in a
      // PARAMETER position: `readSidecar<T>(docId, filename, defaultValue: T)`
      // resolves `T` to argument 2, which is exactly what the real door
      // returns when the file is absent — the state an empty backend is in.
      const generics = /^<([^>]*)>/.exec(src.slice(m.index! + m[0].length));
      const params = generics
        ? generics[1].split(",").map((t) => t.trim().split(/\s+extends\s+/)[0].trim())
        : [];
      const bare = unwrapPromise(ret);
      if (!params.includes(bare)) continue;
      const argIndex = splitParams(src.slice(open + 1, i)).findIndex(
        (param) => param.split(":").slice(1).join(":").trim() === bare,
      );
      if (argIndex >= 0) identity.set(exported, argIndex);
    }
  };
  scan(STORAGE_BACKEND_MODULE, null, new Map());
  // The barrel declares a couple of doors of its own (`drainDoc`) rather than
  // forwarding them, so it is a second source of shapes as well as the source
  // of names.
  scan(STORAGE_MODULE, null, new Map());
  // One hop: `export { local as exported } from "@/…"`. `commentsStripped`,
  // not `codeOnly`: the specifier this reads IS a string literal, and
  // `codeOnly` blanks literals by design.
  const backendSrc = commentsStripped(readFileSync(STORAGE_BACKEND_MODULE, "utf8"));
  for (const m of backendSrc.matchAll(/^export\s*\{([^}]*)\}\s*from\s*"([^"]+)"/gm)) {
    const file = fromAlias(m[2]);
    if (!file) continue;
    const alias = new Map<string, string>();
    for (const clause of m[1].split(",")) {
      const [local, exported] = clause.trim().split(/\s+as\s+/).map((t) => t.trim());
      if (local) alias.set(local, exported || local);
    }
    scan(file, new Set(alias.keys()), alias);
  }
  returnsCache = out;
  identityCache = identity;
  return out;
}

/**
 * Doors whose declared return is one of their own type parameters, mapped to
 * the argument index that supplies it. See the note in {@link storageReturnTypes}.
 */
export function storageIdentityArgs(): ReadonlyMap<string, number> {
  storageReturnTypes();
  return identityCache!;
}

/**
 * Doors whose declared return is an object shape source text cannot invent.
 *
 * Keyed by name, valued by the declared type so the entry says WHY it is here.
 * A stub for one of these still answers `undefined` — the one thing this file
 * otherwise refuses to do — so the set is declared rather than merely implied,
 * and `storage-mock-derivation.test.ts` asserts it matches the derivation
 * exactly: a new object-returning door must be added here deliberately, and a
 * door that gains `| null` must be removed. Suites exercising one of these pass
 * an override; a fixture factory for them is the residual half of task 643.
 */
export const UNSYNTHESIZABLE_RETURNS: Readonly<Record<string, string>> = Object.freeze({
  createDocFromPicker: "Promise<FsaDocMeta>",
  createDocInFolder: "Promise<FsaDocMeta>",
  deleteSidecarSiblings: "Promise<SidecarCleanupReceipt>",
  detectBibPackage: "BibPackage",
  openExistingDocFromPicker: "Promise<FsaDocMeta>",
  pickProjectFolder: "Promise<FolderPickResult>",
  readBib: "Promise<BibReadResult>",
  readDocBundle: "Promise<DocBundle>",
  registerDocInFolder: "Promise<FsaDocMeta>",
  writeDocBundle: "Promise<DocWriteReceipt>",
  writePdf: "Promise<WritePdfResult>",
});

/**
 * The value a door's declared return type says an empty backend answers, or
 * `MISSING` when source text cannot honestly produce one.
 *
 * Exported for the census, which asserts this derivation and
 * {@link UNSYNTHESIZABLE_RETURNS} agree.
 */
export const MISSING = Symbol("no synthesizable default");

export function defaultForReturnType(type: string): unknown {
  const inner = unwrapPromise(type);
  const arms = topLevelArms(inner);
  // Absence first: a nullable door's whole point is that "nothing" is a value
  // it answers, and that is the arm an empty backend is always on.
  if (arms.some((a) => a === "null" || a === "undefined")) return null;
  if (arms.length > 1) return MISSING;
  const t = arms[0];
  if (t === "void" || t === "unknown" || t === "any") return undefined;
  if (t === "string") return "";
  if (t === "number") return 0;
  if (t === "boolean") return false;
  if (/\[\]$/.test(t) || /^(?:Readonly)?Array\s*</.test(t)) return [];
  if (/^(?:Readonly)?Record\s*</.test(t)) return {};
  return MISSING;
}

/**
 * The default body for one derived door: async, answering what its declared
 * return type says an empty backend answers.
 */
function defaultStub(name: string): unknown {
  const declared = storageReturnTypes().get(name);
  const identityArg = storageIdentityArgs().get(name);
  if (identityArg !== undefined) {
    return vi.fn(async (...args: unknown[]) => args[identityArg]);
  }
  const value = declared === undefined ? MISSING : defaultForReturnType(declared);
  if (value === MISSING) return vi.fn();
  if (value === undefined) return vi.fn(async () => undefined);
  return vi.fn(async () => value);
}

export interface MockStorageOptions {
  /**
   * Builds the stub for each export. Default: a `vi.fn()` answering what the
   * door's declared return type says an empty backend answers (see
   * {@link defaultForReturnType}).
   */
  stub?: (name: string) => unknown;
}

/**
 * A complete stub of `@/lib/storage`: one `vi.fn()` per real export — each
 * answering its declared return type's empty value, not `undefined` — plus the
 * one non-function export given its falsy production-test value
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
  const stub = opts.stub ?? defaultStub;
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
  // `mutateSidecar` is not an independent door — it IS `readSidecar` → mutate →
  // `writeSidecar`, run inside one critical section. Synthesizing it from its
  // declared return type gives `null` (the "nothing to change" arm), and since
  // task 719 that is the door EVERY `usePersistentState` sidecar writes
  // through: a suite that overrode the read and the write would then observe no
  // write at all, with both of its overrides unused. So this one default is
  // COMPOSED from the assembled stub rather than synthesized, AFTER the
  // overrides land, so it composes the suite's own doors. A suite wanting
  // something else overrides `mutateSidecar` itself.
  if (!("mutateSidecar" in overrides)) {
    mod.mutateSidecar = vi.fn(
      async (
        handle?: { docId: string },
        filename?: string,
        defaultValue?: unknown,
        mutate?: (current: unknown) => unknown,
      ) => {
        // Called with no arguments (the derivation census walks every door
        // that way), the honest answer is the declared `| null` arm: nothing
        // to change, nothing written.
        if (!handle || typeof mutate !== "function") return null;
        const read = mod.readSidecar as (
          docId: string,
          filename: string,
          defaultValue: unknown,
        ) => Promise<unknown>;
        const current =
          (await read(handle.docId, filename!, defaultValue)) ?? defaultValue;
        const next = mutate(current);
        if (next === null) return null;
        const write = mod.writeSidecar as (
          h: unknown,
          filename: string,
          data: unknown,
        ) => Promise<void>;
        await write(handle, filename!, next);
        return next;
      },
    );
  }
  return mod;
}
