// @vitest-environment jsdom
//
// Task 542 — the "N conflicted copies" pill reports ghosts the user already
// deleted in Finder.
//
// The scan (task 363) had exactly ONE trigger, the doc-open, and its comment
// called a warm tab switch "a feature" — no help with one paper open: delete
// the forks outside the app and nothing ever re-enumerates the folder, so the
// notice keeps the stale report until a reload. This pins the watcher that
// replaces the bare scan in the hook: scan on open, re-scan on every RETURN to
// the tab (the shared `onTabReturn` edge), stand down with the doc.
//
// Legs:
//   1. DEFECT    — forks reported → files removed on the fake disk → the user
//                  returns → the notice is CLEARED. Neutering the return
//                  subscription in `watchSyncConflicts` fails this leg.
//   2. EDGES     — both carriers of a return (visibilitychange → visible, and
//                  window focus) re-scan.
//   3. DISMISSAL — semantics unchanged: a dismissed report over an UNCHANGED
//                  folder stays quiet through a return; a folder that CHANGED
//                  re-raises on its new signature.
//   4. STAND-DOWN — after the unsubscribe a return scans nothing.
//   5. CENSUS    — the hook enters the WATCHER, never the bare scan (a hook
//                  calling `scanSyncConflicts` directly is the pre-542 shape
//                  and type-checks perfectly); the production callers of the
//                  bare scan are an EXACT set.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { codeOnly } from "./_source-scan";

const mockList = vi.fn();
vi.mock("@/lib/storage", () => ({
  listSidecarNames: (...a: unknown[]) => mockList(...a),
  deleteSidecarSiblings: vi.fn(),
}));

import { watchSyncConflicts } from "@/lib/sync-conflict-scan";
import {
  clearSyncConflictNotices,
  dismissSyncConflictNotice,
  getSyncConflictNotice,
} from "@/lib/sync-conflict-notice";
import { __resetTabReturnForTests } from "@/lib/tab-hidden";

const REPO = path.resolve(__dirname, "../../..");

const FORKED = [
  "notes.json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09).json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09 5).json",
  "editor-state.json",
  "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json",
];
const CLEAN = ["notes.json", "editor-state.json"];

/** Let the fire-and-forget scan's promise chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}
function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}
/** The user comes back to the tab. `__resetTabReturnForTests` makes the
 *  coalescing window transparent, so each call here IS a return. */
async function returnToTab(via: "visibility" | "focus" = "visibility") {
  __resetTabReturnForTests();
  if (via === "visibility") {
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  } else {
    window.dispatchEvent(new Event("focus"));
  }
  await flush();
}

let off: (() => void) | null = null;

beforeEach(() => {
  mockList.mockReset();
  clearSyncConflictNotices();
  __resetTabReturnForTests();
  setVisibility("visible");
});
afterEach(() => {
  off?.();
  off = null;
  clearSyncConflictNotices();
});

describe("sync-conflict watcher (task 542)", () => {
  it("DEFECT — forks deleted outside the app clear the pill on the next return to the tab", async () => {
    mockList.mockResolvedValue(FORKED);
    off = watchSyncConflicts("doc-1");
    await flush();
    expect(getSyncConflictNotice("doc-1")?.total).toBe(3);

    // Gabriel cleans the folder in Finder — nothing in the app is touched.
    mockList.mockResolvedValue(CLEAN);
    expect(getSyncConflictNotice("doc-1")?.total).toBe(3); // still stale: no trigger yet

    await returnToTab("visibility");
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(getSyncConflictNotice("doc-1")).toBeNull();
  });

  it("EDGES — window focus re-scans too (the never-hidden PWA window beside Finder)", async () => {
    mockList.mockResolvedValue(FORKED);
    off = watchSyncConflicts("doc-1");
    await flush();
    mockList.mockResolvedValue(CLEAN);
    await returnToTab("focus");
    expect(getSyncConflictNotice("doc-1")).toBeNull();
  });

  it("EDGES — a return re-scans ONCE, not once per event", async () => {
    mockList.mockResolvedValue(FORKED);
    off = watchSyncConflicts("doc-1");
    await flush();
    __resetTabReturnForTests();
    // A real tab switch: visibilitychange → visible AND window focus, back to back.
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("DISMISSAL — an unchanged folder stays quiet through a return", async () => {
    mockList.mockResolvedValue(FORKED);
    off = watchSyncConflicts("doc-1");
    await flush();
    dismissSyncConflictNotice("doc-1");
    expect(getSyncConflictNotice("doc-1")).toBeNull();
    await returnToTab();
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(getSyncConflictNotice("doc-1")).toBeNull();
  });

  it("DISMISSAL — a folder that CHANGED re-raises on its new signature", async () => {
    mockList.mockResolvedValue(FORKED);
    off = watchSyncConflicts("doc-1");
    await flush();
    dismissSyncConflictNotice("doc-1");
    // One fork removed in Finder, one still there: a different folder state.
    mockList.mockResolvedValue(FORKED.slice(0, 4));
    await returnToTab();
    const n = getSyncConflictNotice("doc-1");
    expect(n).not.toBeNull();
    expect(n!.total).toBe(2);
  });

  it("STAND-DOWN — after the unsubscribe a return scans nothing", async () => {
    mockList.mockResolvedValue(FORKED);
    off = watchSyncConflicts("doc-1");
    await flush();
    off();
    off = null;
    await returnToTab();
    expect(mockList).toHaveBeenCalledTimes(1);
  });
});

describe("sync-conflict watcher — CENSUS", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        walk(p, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push(p);
      }
    }
    return out;
  }

  it("the hook enters the WATCHER and returns its unsubscribe; it never calls the bare scan", () => {
    const useFiles = codeOnly(
      fs.readFileSync(path.join(REPO, "src/hooks/useFiles.ts"), "utf8"),
    );
    // Returned from the effect, so the doc-switch/unmount edge tears the return
    // subscription down with the doc — a fire-and-forget `void watch…` would
    // leak one subscriber per doc ever opened.
    expect(useFiles).toContain("return watchSyncConflicts(currentDocId);");
    expect(useFiles).not.toMatch(/\bscanSyncConflicts\(/);
  });

  it("the production callers of the bare scan are an EXACT set", () => {
    // The watcher (open + return), the runner's post-cleanup re-scan, and the
    // badge's manual row. A fourth caller is a trigger the watcher does not own
    // — say why here, or route it through the watcher.
    const EXPECTED = [
      "src/components/SyncConflictBadge.tsx",
      "src/lib/sync-conflict-scan.ts",
    ];
    const hits: string[] = [];
    for (const file of walk(path.join(REPO, "src"))) {
      const src = codeOnly(fs.readFileSync(file, "utf8"));
      if (/\bscanSyncConflicts\(/.test(src)) hits.push(path.relative(REPO, file));
    }
    expect(hits.sort()).toEqual(EXPECTED);
  });

  it("the watcher takes the SHARED return edge, not a private listener", () => {
    const scan = codeOnly(
      fs.readFileSync(path.join(REPO, "src/lib/sync-conflict-scan.ts"), "utf8"),
    );
    expect(scan).toContain("onTabReturn(");
    expect(scan).not.toMatch(/addEventListener\(/);
    expect(scan).not.toMatch(/setInterval\(/);
  });
});
