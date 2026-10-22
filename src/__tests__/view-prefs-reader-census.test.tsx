// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO_ROOT, commentsStripped, walkFiles } from "@/lib/__tests__/_source-scan";
import { VIEW_PREF_KEYS } from "@/lib/view-prefs/registry";

vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => "census-window" }));
// `useViewPrefs` transitively pulls `@/lib/storage`, whose runtime
// `require("@/lib/storage-fsa")` vitest's resolver can't alias. `loadPrefs`
// never touches a storage backend (it reads localStorage directly).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { loadPrefs, useViewPrefs } from "@/hooks/useViewPrefs";

/**
 * VIEW-PREF READER CENSUS — a persisted view pref is a PROMISE that some
 * production code reads it (task 2026-10-22-1243).
 *
 * `inert-preference-controls.test.ts` (task 326) asks this question for
 * `EditorPreferences`; nothing asked it for `ViewPrefs`, and `pageWidth` is
 * what that cost. Its gutters were retired one at a time — the zen margins
 * last (task 1178, which made zen's page width DERIVED) — and each retirement
 * left the pref a little more complete-looking and a little less alive: a typed
 * field, a clamping setter, a shipped default, a promote row, a whitelist
 * entry, and a member of every user's stored global blob, with no reader and a
 * setter whose only caller was a test. Every plumbing axis but the one that
 * mattered.
 *
 * The leg: every DIRECT `ViewPrefs` key (the structural half; the registry
 * half arrives via `VIEW_PREF_REGISTRY`, whose rows are read through
 * `RegistryPrefs` and guarded beside it) is NAMED by production code outside
 * the store itself. "Named" is word-boundary presence in comment-stripped
 * source, the same proxy task 326 uses — a key the store owns but nothing else
 * so much as mentions cannot be reaching a pixel. The store files are excluded
 * because the store mentions every key it owns (type, default, setter, scrub).
 *
 * A legitimately store-internal key goes in `STORE_INTERNAL` with its reason.
 * A retired key goes in `RETIRED_PREF_KEYS` (`useViewPrefs.ts`) — task 115's
 * pattern — so stored blobs are scrubbed of it rather than round-tripping it.
 */

/** The store: these files spell every key by construction. */
const STORE_FILE = /(?:^|\/)src\/hooks\/useViewPrefs\.ts$|(?:^|\/)src\/lib\/view-prefs\//;

/** Direct keys read only inside the store, each with why that is honest.
 *  Empty today; an entry is a reviewed decision, never a silencer. */
const STORE_INTERNAL: Readonly<Record<string, string>> = {};

const registryKeys = new Set<string>(VIEW_PREF_KEYS as readonly string[]);

function directKeys(): string[] {
  localStorage.clear();
  // `loadPrefs` with no stored blob is `DEFAULT_PREFS`, which is total over
  // `ViewPrefs` — so its keys ARE the vocabulary, never a hand list.
  return Object.keys(loadPrefs()).filter((k) => !registryKeys.has(k));
}

const productionSources: { rel: string; code: string }[] = walkFiles(
  path.join(REPO_ROOT, "src"),
  { skipDirs: ["__tests__"] },
)
  .filter((f) => /\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
  .map((f) => path.relative(REPO_ROOT, f))
  .filter((rel) => !STORE_FILE.test(rel))
  .map((rel) => ({ rel, code: commentsStripped(readFileSync(path.join(REPO_ROOT, rel), "utf8")) }));

function readersOf(key: string): string[] {
  const re = new RegExp(`\\b${key}\\b`);
  return productionSources.filter((s) => re.test(s.code)).map((s) => s.rel);
}

describe("view-pref reader CENSUS — every direct ViewPrefs key reaches production code", () => {
  it("the scan is not vacuous: it sees the store's vocabulary and a known reader", () => {
    const keys = directKeys();
    expect(keys.length).toBeGreaterThan(10);
    expect(productionSources.length).toBeGreaterThan(100);
    // `editorLeftMargin` is painted through `useMarginEdit` — a canary that the
    // walk reaches the hooks directory and the comment stripper keeps code.
    expect(readersOf("editorLeftMargin")).toContain("src/hooks/useMarginEdit.ts");
  });

  it("no direct ViewPrefs key is named only by the store", () => {
    const unread = directKeys()
      .filter((k) => !(k in STORE_INTERNAL))
      .filter((k) => readersOf(k).length === 0);
    expect(
      unread,
      "these ViewPrefs keys have no production reader outside useViewPrefs.ts / lib/view-prefs/. " +
        "Retire each (drop the field, setter, default, promote row; add it to RETIRED_PREF_KEYS " +
        "so stored blobs are scrubbed — task 115 / 1243), or record it in STORE_INTERNAL with a reason.",
    ).toEqual([]);
  });

  it("every STORE_INTERNAL entry is a live key with a stated reason", () => {
    const keys = new Set(directKeys());
    for (const [k, why] of Object.entries(STORE_INTERNAL)) {
      expect(keys.has(k), `${k}: not a ViewPrefs key any more — drop the entry`).toBe(true);
      expect(why.trim().length, `${k}: state why it is store-internal`).toBeGreaterThan(20);
    }
  });
});

describe("pageWidth retirement (task 1243): a stored blob loads clean and re-persists without it", () => {
  const GLOBAL_KEY = "virgil-view-prefs/global";
  const readGlobal = () => JSON.parse(localStorage.getItem(GLOBAL_KEY) || "{}");

  beforeEach(() => localStorage.clear());

  it("drops a stored pageWidth from the loaded prefs, keeping its neighbours", () => {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify({ pageWidth: 880, editorLeftMargin: 170 }));
    const prefs = loadPrefs() as unknown as Record<string, unknown>;
    expect("pageWidth" in prefs).toBe(false);
    // Canary: the same load carries a live key through, so a loader that
    // returned defaults wholesale cannot pass the assertion above vacuously.
    expect(prefs.editorLeftMargin).toBe(170);
  });

  it("the next global write does not carry it back to disk", () => {
    localStorage.setItem(GLOBAL_KEY, JSON.stringify({ pageWidth: 880, editorLeftMargin: 170 }));
    const { result } = renderHook(() => useViewPrefs());
    act(() => {
      result.current.setEditorLeftMargin(180);
    });
    const disk = readGlobal();
    expect(disk.editorLeftMargin).toBe(180);
    expect("pageWidth" in disk).toBe(false);
  });
});
