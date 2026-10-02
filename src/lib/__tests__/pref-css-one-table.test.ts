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

  const promote = (snapshot: object) => {
    const snap = path.join(tmp, "snapshot.json");
    writeFileSync(snap, JSON.stringify(snapshot));
    const r = spawnSync(
      process.execPath,
      [path.join(ROOT, "tools/promote-defaults.mjs"), "--root", tmp, "--snapshot", snap],
      { encoding: "utf-8" },
    );
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
});
