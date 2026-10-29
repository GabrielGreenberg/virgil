// @vitest-environment jsdom
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFS } from "@/hooks/preferences-defaults";
import { applyTransforms, DEFAULT_TRANSFORMS } from "@/lib/color-transforms";
import { PREF_TO_CSS, resolvePrefCssVars } from "@/lib/preferences-tree";
import {
  PREF_CSS_CACHE_KEY,
  PREFS_STORAGE_KEY,
  TRANSFORMS_STORAGE_KEY,
  prefCssBootstrapScript,
  recordPrefCssPaint,
} from "@/lib/pref-css-bootstrap";
import {
  PREF_CSS_BLOCK_HAND_EDIT_HINT,
  renderPrefCssBlockBody,
  renderPrefCssSeed,
  splitPrefCssBlock,
} from "@/lib/pref-css-table.mjs";

/**
 * Task 902 — first paint shows what the runtime will.
 *
 *  1. ONE table: every runtime `PREF_TO_CSS` row is seeded in the
 *     PROMOTE-DEFAULTS block with exactly the value the runtime paints at the
 *     shipped defaults (the hand `cssVarMap` it replaced lacked ~16 rows).
 *  2. The pre-paint bootstrap replays a customised paint before first paint,
 *     and only while the stored blobs it was resolved from are unchanged.
 *  3. The promoter bakes the snapshot's colour transforms into the shipped
 *     palette, from the RAW colours, so a re-run cannot compound them.
 */

const ROOT = path.resolve(__dirname, "../../..");

function seedBlock(): Map<string, string> {
  const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf-8");
  const body = /PROMOTE-DEFAULTS-START[\s\S]*?\*\/([\s\S]*?)\/\* PROMOTE-DEFAULTS-END \*\//.exec(css)?.[1];
  expect(body, "globals.css has a PROMOTE-DEFAULTS block").toBeTruthy();
  const out = new Map<string, string>();
  for (const line of body!.split("\n")) {
    const m = /^\s*(--[\w-]+):\s*(.*);\s*$/.exec(line);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

describe("one pref→CSS table", () => {
  it("every PREF_TO_CSS row has a first-paint seed equal to its runtime value at the defaults", () => {
    const seed = seedBlock();
    const runtime = new Map(resolvePrefCssVars(DEFAULT_PREFS, DEFAULT_TRANSFORMS));
    const wrong: string[] = [];
    for (const { cssVar } of PREF_TO_CSS) {
      if (seed.get(cssVar) !== runtime.get(cssVar)) {
        wrong.push(`${cssVar}: seed ${seed.get(cssVar) ?? "(none)"} ≠ runtime ${runtime.get(cssVar)}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("the seed carries nothing the runtime does not paint", () => {
    const painted = new Set(PREF_TO_CSS.map((r) => r.cssVar));
    expect([...seedBlock().keys()].filter((v) => !painted.has(v))).toEqual([]);
  });

  // Task 1351: the two checks above parse the block line by line, and their
  // regex skips a line with a trailing comment — so task 1344's hand-added
  // `--code-block-bg-hover: …; /* … */` inside the block went unseen. This one
  // compares the block byte-for-byte with the promoter's own render, from the
  // same JSON sidecar the promoter reads.
  it("the managed block is byte-for-byte what the promoter writes", () => {
    const css = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf-8");
    const block = splitPrefCssBlock(css);
    expect(block, "globals.css has a PROMOTE-DEFAULTS block").toBeTruthy();
    const editorDefaults = JSON.parse(
      readFileSync(path.join(ROOT, "src/hooks/usePreferences.defaults.json"), "utf-8"),
    );
    const want = renderPrefCssBlockBody(renderPrefCssSeed(editorDefaults), block!.indent);
    expect(block!.body, PREF_CSS_BLOCK_HAND_EDIT_HINT).toBe(want);
  });

  it("the promoter no longer reads a second hand map", () => {
    const registry = JSON.parse(
      readFileSync(path.join(ROOT, "src/lib/dev-prefs-registry.json"), "utf-8"),
    );
    expect(registry.cssVarMap).toBeUndefined();
  });
});

describe("pre-paint bootstrap", () => {
  const run = () => new Function(prefCssBootstrapScript())();

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("replays the recorded paint while the stored blobs are unchanged", () => {
    const prefs = { ...DEFAULT_PREFS, backgroundColor: "#123456" };
    const transforms = { ...DEFAULT_TRANSFORMS, hue: 40 };
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    localStorage.setItem(TRANSFORMS_STORAGE_KEY, JSON.stringify(transforms));
    recordPrefCssPaint(resolvePrefCssVars(prefs, transforms));

    run();
    const s = document.documentElement.style;
    expect(s.getPropertyValue("--background")).toBe(applyTransforms("#123456", transforms));
    // Derived rows ride the same record.
    expect(s.getPropertyValue("--panel-border")).toBe("none");
  });

  it("does not replay a record resolved from other prefs", () => {
    const prefs = { ...DEFAULT_PREFS, backgroundColor: "#123456" };
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    recordPrefCssPaint(resolvePrefCssVars(prefs, DEFAULT_TRANSFORMS));
    // Another window edits the prefs; this record is now stale.
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ ...prefs, backgroundColor: "#654321" }));

    run();
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("");
  });

  it("with nothing customised there is no record — the seed is the palette", () => {
    localStorage.setItem(PREF_CSS_CACHE_KEY, "stale");
    recordPrefCssPaint(resolvePrefCssVars(DEFAULT_PREFS, DEFAULT_TRANSFORMS));
    expect(localStorage.getItem(PREF_CSS_CACHE_KEY)).toBeNull();
    run();
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("survives a corrupt record", () => {
    localStorage.setItem(PREF_CSS_CACHE_KEY, "{not json");
    expect(run).not.toThrow();
  });

  it("is injected into the document head by the root layout", () => {
    const layout = readFileSync(path.join(ROOT, "src/app/layout.tsx"), "utf-8");
    expect(layout).toMatch(/__html:\s*prefCssBootstrapScript\(\)/);
  });
});

describe("promoter bakes colour transforms into the shipped palette", () => {
  const FILES = [
    "src/lib/dev-prefs-registry.json",
    "src/hooks/useViewPrefs.defaults.json",
    "src/hooks/usePreferences.defaults.json",
    "src/lib/panel-theme.defaults.json",
    "src/lib/print.defaults.json",
    "library/lib/list-columns.defaults.json",
    "src/app/globals.css",
  ];
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(path.join(tmpdir(), "pref-css-bake-"));
    for (const f of FILES) {
      mkdirSync(path.dirname(path.join(tmp, f)), { recursive: true });
      cpSync(path.join(ROOT, f), path.join(tmp, f));
    }
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  /** Run the promoter; returns its exit status and the --changed-out list. */
  const runPromoter = (snapshot: object, dryRun = false) => {
    const snap = path.join(tmp, "snapshot.json");
    const changedOut = path.join(tmp, "changed.txt");
    writeFileSync(snap, JSON.stringify(snapshot));
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "tools/promote-defaults.mjs"),
        "--root", tmp, "--snapshot", snap, "--changed-out", changedOut,
        ...(dryRun ? ["--dry-run"] : []),
      ],
      { encoding: "utf-8" },
    );
    const changed = readFileSync(changedOut, "utf-8").split("\n").filter(Boolean);
    return { status: r.status, stderr: r.stderr, changed };
  };
  const promote = (snapshot: object) => {
    const r = runPromoter(snapshot);
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(readFileSync(path.join(tmp, "src/hooks/usePreferences.defaults.json"), "utf-8"));
  };

  it("ships the transformed colour, idempotently, and leaves non-colours raw", () => {
    const transforms = { contrast: 10, hue: 30, brightness: -5 };
    const snapshot = {
      "virgil-editor-prefs": { ...DEFAULT_PREFS, backgroundColor: "#a0b0c0", editorFontSize: 1.1 },
      "virgil-editor-transforms": transforms,
    };
    const once = promote(snapshot);
    expect(once.backgroundColor).toBe(applyTransforms("#a0b0c0", transforms));
    expect(once.editorFontSize).toBe(1.1);

    const twice = promote(snapshot);
    expect(twice).toEqual(once);

    // …and the first-paint seed is rendered from the baked value.
    const css = readFileSync(path.join(tmp, "src/app/globals.css"), "utf-8");
    expect(css).toContain(`--background: ${applyTransforms("#a0b0c0", transforms)};`);
  });

  // Task 1120: two registry entries fold into usePreferences.defaults.json
  // (replace-all, then bake-transforms). "Changed" is a property of the FINAL
  // bytes — a re-run after a promotion with non-identity transforms is a
  // no-op in BOTH modes: exit 0 and an empty --changed-out (sync-defaults'
  // --check and its commit leg read exactly those two signals).
  it("a re-run after a baked promotion reports no drift — dry or commit", () => {
    const snapshot = {
      "virgil-editor-prefs": { ...DEFAULT_PREFS, backgroundColor: "#a0b0c0" },
      "virgil-editor-transforms": { contrast: 0, hue: 30, brightness: 0 },
    };
    const first = runPromoter(snapshot);
    expect(first.status, first.stderr).toBe(0);
    expect(first.changed).toContain("src/hooks/usePreferences.defaults.json");

    const dry = runPromoter(snapshot, true);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.changed).toEqual([]);

    const again = runPromoter(snapshot);
    expect(again.status, again.stderr).toBe(0);
    expect(again.changed).toEqual([]);
  });
});
