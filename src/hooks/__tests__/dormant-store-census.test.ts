/**
 * Dormant-store CENSUS (task 1271).
 *
 * The dormant-link round trip has three per-STORE doors — `carry`,
 * `returnRemapped`, `release` — plus the archive-origin `reinstate`. They are
 * supplied once, by the `DormantStoreTable` (`useDormantStores`), whose type
 * requires all four per store and whose `ArchiveOriginPanel` key is exhaustive.
 * This census pins the two halves the type cannot see:
 *
 *  - every kind that DECLARES `lifecycle.carry` lives in a carrying store
 *    (`dormantStoreOfKind`), so its card can be returned and released, not
 *    only carried;
 *  - `EditorPane` READS the table at every door: the lifecycle literal's
 *    per-kind `carry` is exactly its store's door, and the remap, the passage
 *    delete and `reinstate` iterate / index the table rather than hand-listing
 *    hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CARD_REGISTRY } from "@/cards/card-registry";
import type { CardKind } from "@/cards/types";
import { ARCHIVE_ORIGIN_PANELS } from "@/lib/archive-origin";
import { dormantStoreOfKind } from "../useDormantStores";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const KINDS = Object.keys(CARD_REGISTRY) as CardKind[];
const CARRYING = KINDS.filter((k) => CARD_REGISTRY[k].lifecycle.carry);

/** Source with line comments blanked, so prose can't satisfy a match. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(REPO_ROOT, rel), "utf8")
    .split("\n")
    .map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l))
    .join("\n");
}

describe("dormant-store CENSUS", () => {
  it("there are carrying kinds to check (the census is not vacuous)", () => {
    expect(CARRYING.length).toBeGreaterThan(0);
  });

  it("every kind declaring lifecycle.carry resolves to a carrying store", () => {
    const strays = CARRYING.filter((k) => dormantStoreOfKind(k) === null);
    expect(
      strays,
      "these kinds declare lifecycle.carry but no carrying store holds them — " +
        "add their store to `DormantStoreTable` (all three doors) and to " +
        "`dormantStoreOfKind`'s panel map",
    ).toEqual([]);
  });

  it("every carrying store is reached by some carrying kind (no dead row)", () => {
    const reached = new Set(CARRYING.map(dormantStoreOfKind));
    for (const store of ARCHIVE_ORIGIN_PANELS) expect(reached.has(store), store).toBe(true);
  });

  const pane = code("src/components/EditorPane.tsx");

  it("the lifecycle literal's carry is exactly its store's door, for every carrying kind", () => {
    const start = pane.indexOf("const cardLifecycleRegistry = useMemo<CardLifecycleRegistry>(");
    expect(start, "re-point this census at the lifecycle literal").toBeGreaterThan(-1);
    const literal = pane.slice(start, pane.indexOf("const cardLifecycle = useCardLifecycleApi(", start));
    const wired = new Map<string, string | null>();
    for (const m of literal.matchAll(/\n\s*"?([a-z][\w-]*)"?:\s*\{([^{}]*)\}/g)) {
      const kind = m[1];
      const body = m[2];
      if (!/\bcarry:/.test(body)) continue;
      wired.set(kind, /\bcarry:\s*dormantStores\.(\w+)\.carry\b/.exec(body)?.[1] ?? null);
    }
    expect([...wired.keys()].sort()).toEqual([...CARRYING].sort());
    for (const k of CARRYING) {
      expect(wired.get(k), `${k}.carry must read dormantStores.${dormantStoreOfKind(k)}.carry`).toBe(
        dormantStoreOfKind(k),
      );
    }
  });

  it("the remap, the passage delete and reinstate all read the table", () => {
    expect(pane).toMatch(/useDormantStores\(\{/);
    expect(pane).toMatch(/Object\.values\(dormantStores\)\)\s*store\.returnRemapped\(/);
    expect(pane).toMatch(/Object\.values\(dormantStores\)\)\s*store\.release\(/);
    expect(pane).toMatch(/dormantStores\[panel\]\.reinstate\(/);
    // No door hand-picked off a hook beside the table.
    expect(pane).not.toMatch(/HookRaw\.(returnRemapped|release|reinstate)\b/);
  });
});
