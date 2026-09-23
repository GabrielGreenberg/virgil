/**
 * TASK 726 — WIRE-it-or-DELETE-it, as a standing rule.
 *
 * Virgil's law is that a published export is alive only if something CALLS it,
 * and a registry is an SSOT only if something READS it. Per-doc sidecar hooks
 * are where that law gets broken quietly, because a hook is self-consistent: it
 * type-checks, it has tests, its rationale comment reads perfectly, and nothing
 * anywhere says it is never mounted. `useExamples` sat that way through two
 * passes. Task 570 deleted its editor-derived RECONCILE on exactly this ground
 * ("WIRE-it-or-DELETE-it") and left the hook standing; the layer around it —
 * the `examples.json` merge rule, the `mount: true` row, the kind→file mapping,
 * and a `textFields: ["title"]` on a card that has never contained the string
 * `title` — went on describing a mechanism with no runtime. A future reader
 * would have believed all of it, because the comments said so in plain English.
 *
 * The lesson of 570 was written down; the thing 570 could not do was FAIL. So
 * this file reads the real tree and pins three rules:
 *
 *   R1 — a per-doc sidecar hook must have a production CALLER. If nothing
 *        mounts it, the storage it describes has no runtime, and the next
 *        person to wire it inherits a mount effect nobody has ever run.
 *   R2 — a `mount: true` sidecar row must be SPELLED by some production module
 *        other than the SSOT tables themselves. The mount bundle pre-reads
 *        exactly the files a hook owns; a row no hook owns makes the bundle
 *        read a file for nobody and, worse, asserts an owner that isn't there.
 *   R3 — a `legacy` row is the DECLARED form of a retired sidecar: mount:false,
 *        spelled by nothing. It keeps its row only so the conflict scanner
 *        still recognises forks a folder already holds (`sidecar-value.ts`).
 *
 * Allowlists: R1 has one, for the two door/utility hooks that are consumed by
 * OTHER hooks rather than by a component, and it is checked in the falsifying
 * direction (an entry that has acquired callers is stale and must leave).
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";
import {
  LEGACY_SIDECAR_FILENAMES,
  MOUNT_SIDECAR_FILENAMES,
  SIDECAR_VALUE,
} from "@/lib/sidecar-value";

const read = (abs: string) => fs.readFileSync(abs, "utf8");
const rel = (abs: string) => path.relative(REPO_ROOT, abs);

/** Every production `.ts`/`.tsx` under `src/` and `library/`. */
function productionFiles(): string[] {
  return [
    ...trackedFiles("src", /\.(ts|tsx)$/),
    ...trackedFiles("library", /\.(ts|tsx)$/),
  ].filter((p) => !/__tests__|\.test\.tsx?$/.test(p));
}

/** A hook FILE is a per-doc sidecar hook iff its code reaches the sidecar
 *  storage doors or the `usePersistentState` primitive that wraps them. */
const SIDECAR_DOOR =
  /\b(readSidecar|readSidecarIfExists|writeSidecar|writeSidecarMerged|mutateSidecar|usePersistentState)\b/;

/** A CALL or a generic call: `useX(`, `useX<Foo>(`. Anchored on the name, so
 *  `// see useX` in a comment can't stand in for a caller (the haystack is
 *  comment-stripped anyway) and `useXSomething(` can't either. */
const callerNeedle = (hook: string) =>
  new RegExp(`\\b${hook}\\s*[<(]`);

/**
 * Hooks legitimately consumed by OTHER HOOKS rather than by a component. They
 * are still alive under R1's real question ("does anything call this?"); the
 * allowlist exists only because their callers are themselves hooks, which is a
 * shape worth naming rather than hiding. Both are verified to HAVE callers, so
 * this list can never excuse a dead one.
 */
const HOOK_CONSUMED_BY_HOOKS = new Set(["usePersistentState", "useReconcileModeAAnchors"]);

/** The tables that DECLARE sidecar filenames. A row spelled only here is a
 *  declaration with no runtime — which is exactly what R2 asks about. */
const SSOT_TABLES = [
  "src/lib/sidecar-value.ts",
  "src/lib/sidecar-merge.ts",
  "src/lib/sidecar-files.ts",
  "src/lib/host-writability.ts",
];

function sidecarHookFiles(): string[] {
  return productionFiles().filter(
    (p) =>
      /(^|\/)(src|library)\/hooks\/use[A-Za-z0-9]+\.ts$/.test(rel(p)) &&
      SIDECAR_DOOR.test(codeOnly(read(p))),
  );
}

describe("R1 · a per-doc sidecar hook has a production caller", () => {
  it("the scan actually finds the sidecar hooks (not a vacuous pass)", () => {
    const names = sidecarHookFiles().map((p) => path.basename(p, ".ts"));
    expect(names).toContain("useNotes");
    expect(names).toContain("useTodos");
    expect(names).toContain("useFootnotes");
    expect(names.length).toBeGreaterThan(10);
  });

  it("every sidecar hook is CALLED somewhere in production", () => {
    const files = productionFiles().map((p) => ({ rel: rel(p), code: codeOnly(read(p)) }));
    const orphans: string[] = [];
    for (const abs of sidecarHookFiles()) {
      const hook = path.basename(abs, ".ts");
      const needle = callerNeedle(hook);
      const callers = files.filter((f) => f.rel !== rel(abs) && needle.test(f.code));
      if (callers.length === 0) orphans.push(rel(abs));
    }
    expect(
      orphans,
      "these hooks read/write a sidecar but nothing mounts them — WIRE it or " +
        "DELETE it (task 726; `useExamples` sat this way for two passes)",
    ).toEqual([]);
  });

  it("the allowlist only names hooks that DO have callers (no stale licence)", () => {
    const files = productionFiles().map((p) => ({ rel: rel(p), code: codeOnly(read(p)) }));
    for (const hook of HOOK_CONSUMED_BY_HOOKS) {
      const needle = callerNeedle(hook);
      const callers = files.filter(
        (f) => !f.rel.endsWith(`/${hook}.ts`) && needle.test(f.code),
      );
      expect(callers.length, `${hook} is allowlisted but has no callers`).toBeGreaterThan(0);
    }
  });

  it("the needle SEES a caller-less hook (synthetic canary, both directions)", () => {
    const code = codeOnly(`
      // useGhost is mentioned only in this comment.
      import { useGhost } from "@/hooks/useGhost";
      const x = useLive<State>(docId, "notes.json", EMPTY);
    `);
    expect(callerNeedle("useLive").test(code)).toBe(true);
    expect(callerNeedle("useGhost").test(code)).toBe(false);
    // And the door predicate really does classify: a hook that touches no
    // sidecar door is not in scope at all.
    expect(SIDECAR_DOOR.test('const s = usePersistentState<S>(docId, "todos.json", E)')).toBe(true);
    expect(SIDECAR_DOOR.test("const [a, b] = useState(0);")).toBe(false);
  });
});

describe("R2 · a mount:true sidecar row is owned by a real module", () => {
  const spellersOf = (filename: string): string[] =>
    productionFiles()
      .filter((p) => !SSOT_TABLES.includes(rel(p)))
      .filter((p) => read(p).includes(`"${filename}"`))
      .map(rel);

  it("every mount:true file is spelled outside the SSOT tables", () => {
    const unowned = MOUNT_SIDECAR_FILENAMES.filter((f) => spellersOf(f).length === 0);
    expect(
      unowned,
      "the mount bundle pre-reads these for nobody — either wire the owner or " +
        "retire the row (`legacy: true`)",
    ).toEqual([]);
  });

  it("the speller scan is not vacuous, and the SSOT tables really are excluded", () => {
    expect(spellersOf("notes.json").length).toBeGreaterThan(0);
    // `examples.json` is the drained case: after task 726 the ONLY module that
    // spells it is the value table, which is why it is `legacy` and not
    // `mount: true`. If this ever finds a speller, the retirement is over and
    // the row must say so.
    expect(spellersOf("examples.json")).toEqual([]);
  });
});

describe("R3 · a legacy row is a DECLARED retirement", () => {
  it("names the retirement task 726 drained", () => {
    expect([...LEGACY_SIDECAR_FILENAMES]).toEqual(["examples.json"]);
  });

  it("a legacy row is never mount:true (a directory read for a file nothing owns)", () => {
    for (const f of LEGACY_SIDECAR_FILENAMES) {
      expect(SIDECAR_VALUE[f]!.mount, `${f} is retired but still mount:true`).toBe(false);
      expect(MOUNT_SIDECAR_FILENAMES).not.toContain(f);
    }
  });

  it("a legacy row is spelled by no production module", () => {
    const offenders: string[] = [];
    for (const f of LEGACY_SIDECAR_FILENAMES) {
      for (const p of productionFiles()) {
        if (SSOT_TABLES.includes(rel(p))) continue;
        if (read(p).includes(`"${f}"`)) offenders.push(`${rel(p)} spells ${f}`);
      }
    }
    expect(
      offenders,
      "a retired sidecar has no readers and no writers — if one is back, drop " +
        "`legacy` and declare what owns it",
    ).toEqual([]);
  });

  it("useExamples is gone, and a re-created one would face R1", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "src/hooks/useExamples.ts"))).toBe(false);
  });
});
