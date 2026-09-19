// @vitest-environment node
//
// Task 640 — THE `@/lib/storage` stub has one home, and it is DERIVED.
//
// `vi.mock` with a factory replaces a module WHOLESALE: every export the
// factory omits is `undefined` in that suite, silently, and the suite stays
// green. So a factory that hand-enumerates the barrel's export names is a copy
// of another module's surface with no guard — and at `88044ee9` there were 298
// of them across `src/`, in four idioms (`STORAGE_FNS` / `names` / `FNS` /
// `Object.fromEntries`) and a dozen name sets. Every one omitted
// `listSidecarNames` and `deleteSidecarSiblings`; 183 omitted `mutateSidecar`,
// the serialized read-modify-write door the write-path law is built on;
// fourteen stubbed `enqueueDocWrite` or `snapshotPriorBundle`, which the module
// does not export; and 96 bound `isDevStorage` to a FUNCTION, so every suite in
// that family ran with a truthy dev-storage flag against a module whose real
// export is the boolean `false`.
//
// [_mock-storage.ts](_mock-storage.ts) reads the key set from `storage.ts`'s
// own source, so it cannot omit an export or invent one. This census keeps it
// the only reader — the reachability half of "a registry earns its name by
// being read": a derived stub is only worth anything if nothing else is allowed
// to hand-copy the surface beside it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { commentsStripped, REPO_ROOT, trackedFiles } from "./_source-scan";
import { storageExportNames, STORAGE_MODULE } from "./_mock-storage";

const MOCK_TARGET = 'vi.mock("@/lib/storage"';
/**
 * The derived helper is the one file allowed to name the surface — and this
 * census itself, whose anti-vacuity samples below QUOTE each retired idiom on
 * purpose. Exempting the census is not a loophole in it: the samples are
 * template literals it feeds to its own detector, so if they ever stopped
 * matching, the anti-vacuity leg is the thing that goes red.
 */
const EXEMPT = new Set(
  ["src/lib/__tests__/_mock-storage.ts", "src/lib/__tests__/storage-mock-derivation.test.ts"].map(
    (p) => path.join(REPO_ROOT, p),
  ),
);

const rel = (abs: string) => path.relative(REPO_ROOT, abs);

/** Every `.ts`/`.tsx` the repo ships under the two census silos. */
function population(): string[] {
  return [...trackedFiles("src", /\.tsx?$/), ...trackedFiles("library", /\.tsx?$/)];
}

/**
 * The balanced extent of each `vi.mock("@/lib/storage", …)` call in `src`,
 * comment-stripped with STRING LITERALS KEPT — the names this census reads are
 * string literals, so `codeOnly` would blank the very thing it must see.
 */
function storageMockRegions(src: string): { text: string; at: number }[] {
  const code = commentsStripped(src);
  const out: { text: string; at: number }[] = [];
  let from = 0;
  for (;;) {
    const start = code.indexOf(MOCK_TARGET, from);
    if (start < 0) break;
    let depth = 0;
    let end = code.length;
    for (let i = code.indexOf("(", start); i < code.length; i++) {
      const c = code[i];
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    out.push({ text: code.slice(start, end), at: start });
    from = end;
  }
  return out;
}

const lineOf = (src: string, offset: number) => src.slice(0, offset).split("\n").length;

/**
 * Array literals of string elements inside a region — the hand-enumerated
 * surface copy, whatever the variable is called (`STORAGE_FNS`, `names`,
 * `FNS`). A list counts as a copy of the storage surface when it is mostly
 * storage export names: three real names is past coincidence, and it is the
 * SHAPE that is forbidden, not any particular spelling.
 */
function nameListsIn(region: string): string[][] {
  const lists: string[][] = [];
  // Innermost bracket spans only (`[^[\]]*`), and a linear string-literal
  // scan inside them. A single regex describing "an array OF string literals"
  // needs a repeated group around a quantified alternation, which backtracks
  // catastrophically on the first unclosed bracket in a 2 kB region — it hung
  // the census rather than failing it, which is the worse of the two.
  for (const m of region.matchAll(/\[[^[\]]*\]/g)) {
    const body = m[0].slice(1, -1);
    const items = [...body.matchAll(/"([^"\\]*)"/g)].map((s) => s[1]);
    if (items.length < 3) continue;
    // Elements only — a list with code between them is not a name list.
    if (body.replace(/"[^"\\]*"|[,\s]/g, "") !== "") continue;
    lists.push(items);
  }
  return lists;
}

/** Names a factory BINDS: `mod.x =` / `mod["x"] =` plus depth-1 object keys. */
function boundNames(region: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const m of region.matchAll(/\b\w+\.([A-Za-z_]\w*)\s*=\s*([^\n;]*)/g)) {
    out.push({ name: m[1], value: m[2] });
  }
  for (const m of region.matchAll(/\b\w+\[\s*"([^"]+)"\s*\]\s*=\s*([^\n;]*)/g)) {
    out.push({ name: m[1], value: m[2] });
  }
  // Depth-1 keys of every brace-balanced object literal in the region.
  for (let i = 0; i < region.length; i++) {
    if (region[i] !== "{") continue;
    let depth = 0;
    let j = i;
    for (; j < region.length; j++) {
      if (region[j] === "{") depth++;
      else if (region[j] === "}" && --depth === 0) break;
    }
    const body = region.slice(i + 1, j);
    let d = 0;
    let keyStart = 0;
    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (c === "{" || c === "(" || c === "[") d++;
      else if (c === "}" || c === ")" || c === "]") d--;
      else if (c === "," && d === 0) keyStart = k + 1;
      else if (c === ":" && d === 0) {
        const key = body.slice(keyStart, k).trim().replace(/^"|"$/g, "");
        // The value runs to the next comma at THIS depth — walking it out
        // rather than regex-ing for one, since every interesting value
        // (an arrow, a `vi.fn(async () => …)`) has commas inside it.
        let vd = 0;
        let end = body.length;
        for (let v = k + 1; v < body.length; v++) {
          const vc = body[v];
          if (vc === "{" || vc === "(" || vc === "[") vd++;
          else if (vc === "}" || vc === ")" || vc === "]") vd--;
          else if (vc === "," && vd === 0) {
            end = v;
            break;
          }
        }
        if (/^[A-Za-z_]\w*$/.test(key)) {
          out.push({ name: key, value: body.slice(k + 1, end).trim() });
        }
        keyStart = end + 1;
        k = end;
      }
    }
    i = j;
  }
  return out;
}

const EXPORTS = new Set(storageExportNames());

describe("the @/lib/storage stub is derived, and derived once", () => {
  it("derives the whole surface from storage.ts — 44 value exports, none invented", () => {
    const names = storageExportNames();
    // Non-vacuity: a regex that stopped matching would report a tiny set.
    expect(names.length).toBeGreaterThan(40);
    // Named spot checks: the three doors every hand copy in the tree omitted.
    expect(names).toContain("mutateSidecar");
    expect(names).toContain("listSidecarNames");
    expect(names).toContain("deleteSidecarSiblings");
    // The fossils of a rename that reached most copies and not all.
    expect(names).not.toContain("enqueueDocWrite");
    expect(names).not.toContain("snapshotPriorBundle");
  });

  it("every door storage.ts forwards exists on BOTH backends", () => {
    // The independent route. `backend` is typed `typeof import(storage-fsa)`,
    // so a forwarded name the backend lost is `undefined` at runtime with no
    // type error — exactly how `enqueueDocWrite` survived in fourteen stubs.
    const barrel = commentsStripped(readFileSync(STORAGE_MODULE, "utf8"));
    const forwarded = [...barrel.matchAll(/^export\s+const\s+(\w+)\s*=\s*backend\.(\w+)/gm)];
    expect(forwarded.length).toBeGreaterThan(35);
    const surfaceOf = (file: string): Set<string> => {
      const src = commentsStripped(readFileSync(path.join(REPO_ROOT, file), "utf8"));
      const out = new Set<string>();
      for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/gm)) {
        out.add(m[1]);
      }
      for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const clause of m[1].split(",")) {
          const local = clause.trim().split(/\s+as\s+/).pop()?.trim();
          if (local && /^\w+$/.test(local)) out.add(local);
        }
      }
      return out;
    };
    const fsa = surfaceOf("src/lib/storage-fsa.ts");
    const dev = surfaceOf("src/lib/storage-dev.ts");
    const missing = forwarded
      .map((m) => m[2])
      .flatMap((name) => [
        ...(fsa.has(name) ? [] : [`storage-fsa is missing ${name}`]),
        ...(dev.has(name) ? [] : [`storage-dev is missing ${name}`]),
      ]);
    expect(missing, `storage.ts forwards a door no backend has:\n  ${missing.join("\n  ")}`).toEqual(
      [],
    );
    // Aliasing would make the barrel's name and the backend's diverge silently.
    expect(forwarded.filter((m) => m[1] !== m[2]).map((m) => m[0])).toEqual([]);
  });

  it("no suite hand-enumerates the storage surface", () => {
    const offenders: string[] = [];
    for (const file of population()) {
      if (EXEMPT.has(file)) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes(MOCK_TARGET)) continue;
      for (const region of storageMockRegions(src)) {
        for (const list of nameListsIn(region.text)) {
          const real = list.filter((n) => EXPORTS.has(n)).length;
          if (real >= 3) {
            offenders.push(
              `${rel(file)}:${lineOf(src, region.at)} — hand list of ${list.length} names ` +
                `(${real} real storage exports). Use: ` +
                `vi.mock("@/lib/storage", async () => (await import("@/lib/__tests__/_mock-storage")).mockStorageModule())`,
            );
          }
        }
      }
    }
    expect(offenders, `hand-copied storage surfaces:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });

  it("the detector still matches the idioms it retired (anti-vacuity)", () => {
    // If the census above reports zero because its regex broke rather than
    // because the tree is clean, these fail. One sample per retired idiom.
    const samples: Record<string, string> = {
      "STORAGE_FNS array": `vi.mock("@/lib/storage", () => {
         const STORAGE_FNS = ["readSidecar", "writeSidecar", "readTex", "writeTex"];
         const mod: Record<string, unknown> = { isDevStorage: false };
         for (const name of STORAGE_FNS) mod[name] = vi.fn();
         return mod;
       });`,
      "names + Object.fromEntries": `vi.mock("@/lib/storage", () => {
         const noop = () => undefined;
         const names = ["isDevStorage", "readSidecar", "writeSidecar", "readTex"];
         return Object.fromEntries(names.map((n) => [n, noop]));
       });`,
      "names + stub loop": `vi.mock("@/lib/storage", () => {
         const stub = () => undefined;
         const names = ["readSidecar", "writeSidecar", "readTex"];
         const mod: Record<string, unknown> = { isDevStorage: () => false };
         for (const n of names) mod[n] = stub;
         return mod;
       });`,
    };
    for (const [idiom, sample] of Object.entries(samples)) {
      const regions = storageMockRegions(sample);
      expect(regions.length, `${idiom}: region scanner found no vi.mock`).toBe(1);
      const lists = nameListsIn(regions[0].text);
      const real = lists.flat().filter((n) => EXPORTS.has(n)).length;
      expect(real, `${idiom}: detector no longer sees the hand list`).toBeGreaterThanOrEqual(3);
    }
    // And the population it sweeps is real, not an empty glob.
    const files = population();
    expect(files.length).toBeGreaterThan(1000);
    expect(files.filter((f) => readFileSync(f, "utf8").includes(MOCK_TARGET)).length).toBeGreaterThan(
      100,
    );
  });

  it("no storage mock binds a name the module does not export", () => {
    // Live after the migration: the ~150 bespoke per-suite fixtures keep their
    // own object literals, and this is what catches the next rename leaving a
    // stale stub behind in one of them.
    const bad: string[] = [];
    for (const file of population()) {
      if (EXEMPT.has(file)) continue;
      const src = readFileSync(file, "utf8");
      if (!src.includes(MOCK_TARGET)) continue;
      for (const region of storageMockRegions(src)) {
        const line = lineOf(src, region.at);
        for (const list of nameListsIn(region.text)) {
          if (list.filter((n) => EXPORTS.has(n)).length < 3) continue;
          for (const name of list) {
            if (!EXPORTS.has(name)) bad.push(`${rel(file)}:${line} — stubs "${name}"`);
          }
        }
        for (const { name, value } of boundNames(region.text)) {
          // Only judge names that LOOK like a storage door: a bound key could
          // belong to a nested fixture object this text scan cannot scope.
          if (EXPORTS.has(name)) {
            // `isDevStorage` is a boolean re-export, not a door. Bound to a
            // function it is truthy, and the suite silently takes the dev
            // branch of every `if (isDevStorage)` in its graph.
            if (name === "isDevStorage" && /=>|function\b/.test(value)) {
              bad.push(`${rel(file)}:${line} — binds isDevStorage to a function (${value})`);
            }
            continue;
          }
          if (/^(?:read|write|mutate|delete|list|get|create|pick|register|open|flush|drain|detect|import|snapshot|stat|invalidate|rename)[A-Z]/.test(name)) {
            bad.push(`${rel(file)}:${line} — stubs "${name}", not a @/lib/storage export`);
          }
        }
      }
    }
    expect(bad, `storage mocks naming non-exports:\n  ${bad.join("\n  ")}`).toEqual([]);
  });
});
