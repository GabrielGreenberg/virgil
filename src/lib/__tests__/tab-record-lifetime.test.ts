// @vitest-environment jsdom
//
// Task 603 — a window's tab record outlives the PAGE. `pagehide` used to
// delete it (via `forgetWindow`), racing the reload that reads it back; and
// the windows registry it also maintained had no reader. Now:
//
//   1. STAMP    — `writeTabs` stamps `savedAt`; `readTabs` returns the record.
//   2. SWEEP    — the startup sweep deletes only records that are neither
//                 alive (liveness lock) nor recent; a pre-603 record with no
//                 stamp gets a grace stamp; the retired registry value goes.
//   3. LIVENESS — `liveWindowIds` reads the browser's lock table.
//   4. CENSUS   — no windows-registry writer or pagehide-time tab deletion
//                 remains in the source tree.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const idb = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const clone = <T>(v: T): T =>
    v === undefined ? v : (structuredClone(v) as T);
  return {
    data,
    api: {
      createStore: () => ({}),
      get: async (key: string) => clone(data.get(key)),
      set: async (key: string, value: unknown) => {
        data.set(key, clone(value));
      },
      del: async (key: string) => {
        data.delete(key);
      },
      keys: async () => [...data.keys()],
      update: async (key: string, updater: (old: unknown) => unknown) => {
        data.set(key, clone(updater(clone(data.get(key)))));
      },
    },
  };
});
vi.mock("idb-keyval", () => idb.api);
vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));

import {
  readTabs,
  sweepTabRecords,
  TAB_RECORD_MAX_AGE_MS,
  writeTabs,
  type TabsState,
} from "@/lib/doc-index";
import { liveWindowIds } from "@/lib/multi-window/window-liveness";
import { getWindowId } from "@/lib/multi-window/window-id";

const DAY = 24 * 60 * 60 * 1000;
const tabs = (ids: string[], savedAt?: number): TabsState => ({
  openTabIds: ids,
  currentDocId: ids[0] ?? null,
  ...(savedAt === undefined ? {} : { savedAt }),
});

beforeEach(() => {
  idb.data.clear();
});

describe("tab records outlive the page (task 603)", () => {
  it("STAMP — writeTabs stamps savedAt and the reload reads the tabs back", async () => {
    const before = Date.now();
    await writeTabs("w1", tabs(["a", "b"]));
    const back = await readTabs("w1");
    expect(back.openTabIds).toEqual(["a", "b"]);
    expect(back.savedAt).toBeGreaterThanOrEqual(before);
  });

  it("SWEEP — deletes a closed, stale window's record and nothing else", async () => {
    const now = 1_000 * DAY;
    idb.data.set("tabs/gone-old", tabs(["a"], now - TAB_RECORD_MAX_AGE_MS - 1));
    idb.data.set("tabs/gone-recent", tabs(["b"], now - DAY));
    idb.data.set("tabs/alive-idle", tabs(["c"], now - 400 * DAY));
    idb.data.set("tabs/me", tabs(["d"], now - 400 * DAY));
    idb.data.set("index", { docs: [] });
    const swept = await sweepTabRecords({
      liveWindowIds: new Set(["me", "alive-idle"]),
      now,
    });
    expect(swept).toEqual(["gone-old"]);
    expect([...idb.data.keys()].sort()).toEqual(
      ["index", "tabs/alive-idle", "tabs/gone-recent", "tabs/me"].sort(),
    );
  });

  it("SWEEP — a pre-603 record (no stamp) gets a grace stamp, not deletion", async () => {
    const now = 1_000 * DAY;
    idb.data.set("tabs/legacy", tabs(["a"]));
    expect(await sweepTabRecords({ liveWindowIds: new Set(), now })).toEqual([]);
    expect((idb.data.get("tabs/legacy") as TabsState).savedAt).toBe(now);
    // …and a full max-age later, it is swept like any other.
    expect(
      await sweepTabRecords({
        liveWindowIds: new Set(),
        now: now + TAB_RECORD_MAX_AGE_MS + 1,
      }),
    ).toEqual(["legacy"]);
  });

  it("SWEEP — the retired windows registry value is deleted", async () => {
    idb.data.set("windows-registry", { w1: { lastSeen: 1, openTabIds: [] } });
    await sweepTabRecords({ liveWindowIds: new Set() });
    expect(idb.data.has("windows-registry")).toBe(false);
  });

  it("LIVENESS — reads held and pending window locks, always including this window", async () => {
    const query = vi.fn(async () => ({
      held: [{ name: "virgil-window/peer" }, { name: "virgil-doc-a" }],
      pending: [{ name: "virgil-window/waiting" }],
    }));
    vi.stubGlobal("navigator", { ...navigator, locks: { query } });
    try {
      const ids = await liveWindowIds();
      expect([...ids].sort()).toEqual(
        [getWindowId(), "peer", "waiting"].sort(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("CENSUS — no write-only window registry, no pagehide tab deletion", () => {
  const root = join(__dirname, "..", "..", "..");
  function walk(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !p.includes("__tests__")) out.push(p);
    }
    return out;
  }
  const files = ["src", "library", "editor"]
    .map((d) => join(root, d))
    .flatMap((d) => {
      try {
        return walk(d, []);
      } catch {
        return [];
      }
    });

  it("nothing defines or calls touchWindow / forgetWindow / a windows registry", () => {
    const hits = files.filter((f) =>
      /\b(touchWindow|forgetWindow|readWindowsRegistry|WindowsRegistry)\b/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(hits.map((f) => relative(root, f))).toEqual([]);
  });

  it("the only writer of the retired key is the sweep's delete", () => {
    const src = readFileSync(join(root, "src/lib/doc-index.ts"), "utf8");
    const uses = src.match(/RETIRED_WINDOWS_REGISTRY_KEY/g) ?? [];
    expect(uses).toHaveLength(2); // the declaration + `del(…)` in the sweep
    expect(src).toMatch(/await del\(RETIRED_WINDOWS_REGISTRY_KEY, store\)/);
  });
});
