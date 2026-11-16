// Task 1654 — the dev-prefs registry's storage keys are PINNED to their
// runtime owners, and the Node tools read keys + defaults paths FROM the
// registry rather than restating them.
//
// The registry (`src/lib/dev-prefs-registry.json`) must stay plain JSON the
// `.mjs` tools can read, and production code must not import a dev artifact —
// so the registry cannot import the runtime keys, nor the runtime import the
// registry. This census is the bridge: a rename of any runtime constant that
// the registry does not follow (or vice versa) fails here, naming the store,
// instead of silently emptying the dev mirror + the twice-weekly promotion
// for that store (whose only other signal is a `snapshot has no … blob` line
// in a launchd log).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import devPrefsRegistry from "@/lib/dev-prefs-registry.json";
import { PREFS_STORAGE_KEY, TRANSFORMS_STORAGE_KEY } from "@/lib/pref-css-bootstrap";
import { PANEL_COLORS_STORAGE_KEY } from "@/lib/panel-theme";
import { VIEW_PREFS_GLOBAL_STORAGE_KEY } from "@/hooks/useViewPrefs";
import { VIEW_SESSION_KEY } from "@library/lib/view-session-store";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Registry row id → the runtime owner's storage-key constant. */
const RUNTIME_OWNER: Record<string, { key: string; owner: string }> = {
  "view-prefs": { key: VIEW_PREFS_GLOBAL_STORAGE_KEY, owner: "useViewPrefs.ts VIEW_PREFS_GLOBAL_STORAGE_KEY" },
  "print-options": { key: VIEW_PREFS_GLOBAL_STORAGE_KEY, owner: "useViewPrefs.ts VIEW_PREFS_GLOBAL_STORAGE_KEY" },
  "editor-prefs": { key: PREFS_STORAGE_KEY, owner: "pref-css-bootstrap.ts PREFS_STORAGE_KEY" },
  "editor-transforms": { key: TRANSFORMS_STORAGE_KEY, owner: "pref-css-bootstrap.ts TRANSFORMS_STORAGE_KEY" },
  "panel-colors": { key: PANEL_COLORS_STORAGE_KEY, owner: "panel-theme.ts PANEL_COLORS_STORAGE_KEY" },
  "library-columns": { key: VIEW_SESSION_KEY, owner: "view-session-store.ts VIEW_SESSION_KEY" },
};

/** The Node tools that consume the registry; each must look rows up by id. */
const NODE_READERS = ["tools/promote-defaults.mjs", "tools/check-prefs-coverage.mjs"];

type Row = (typeof devPrefsRegistry.promotable)[number] & { rawFrom?: string };
const ROWS = devPrefsRegistry.promotable as Row[];

describe("dev-prefs registry keys CENSUS (task 1654)", () => {
  it("every row has a unique id, and the census knows every id (both directions)", () => {
    const ids = ROWS.map((r) => r.id);
    expect(new Set(ids).size, `duplicate registry row id in ${ids.join(", ")}`).toBe(ids.length);
    expect([...ids].sort()).toEqual(Object.keys(RUNTIME_OWNER).sort());
  });

  it("every row's storageKey equals its runtime owner's constant", () => {
    const mismatches = ROWS.filter((r) => r.storageKey !== RUNTIME_OWNER[r.id]?.key).map(
      (r) =>
        `store "${r.id}": registry says ${JSON.stringify(r.storageKey)} but ` +
        `${RUNTIME_OWNER[r.id]?.owner} is ${JSON.stringify(RUNTIME_OWNER[r.id]?.key)}`,
    );
    expect(mismatches).toEqual([]);
  });

  it("a bake-transforms row's rawFrom names the editor-prefs runtime key", () => {
    for (const r of ROWS.filter((row) => row.strategy === "bake-transforms")) {
      expect(r.rawFrom, `store "${r.id}" rawFrom`).toBe(PREFS_STORAGE_KEY);
    }
  });

  it("the Node tools restate no registry storage key or defaults path", () => {
    const literals = new Set<string>(ROWS.flatMap((r) => [r.storageKey, r.defaultsFile]));
    const restated: string[] = [];
    for (const rel of NODE_READERS) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf-8");
      for (const lit of literals) {
        if (src.includes(`"${lit}"`) || src.includes(`'${lit}'`) || src.includes(`\`${lit}\``)) {
          restated.push(`${rel} restates ${JSON.stringify(lit)} — look the row up by id instead`);
        }
      }
    }
    expect(restated).toEqual([]);
  });
});
