// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import { DEFAULT_PREFS } from "@/hooks/preferences-defaults";
import { DEFAULT_TRANSFORMS } from "@/lib/color-transforms";
import { resolvePrefCssVars } from "@/lib/preferences-tree";
import { prefCssBootstrapScript, recordPrefCssPaint } from "@/lib/pref-css-bootstrap";
import {
  DEFAULT_THEME_COLOR,
  THEME_COLOR_CSS_VAR,
  THEME_COLOR_META_SELECTOR,
  themeColorFromVars,
  writeThemeColorMeta,
} from "@/lib/theme-color";

/**
 * Task 1274 — the browser/PWA chrome colour has ONE source per phase, all
 * derived from the top-bar paint. It used to be spelled four times with three
 * hexes (manifest, layout meta, a dead `--theme-color` alias, the pref
 * default), so every launch showed a stale title strip until the post-mount
 * writer ran.
 */

const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf-8");

function seedValue(cssVar: string): string | undefined {
  const css = read("src/app/globals.css");
  const body = /PROMOTE-DEFAULTS-START[\s\S]*?\*\/([\s\S]*?)\/\* PROMOTE-DEFAULTS-END \*\//.exec(css)?.[1] ?? "";
  const m = new RegExp(`^\\s*${cssVar}:\\s*(.*);\\s*$`, "m").exec(body);
  return m?.[1];
}

describe("CENSUS: one default chain for the chrome colour", () => {
  it("manifest theme_color === layout meta default === runtime paint at defaults === first-paint seed", () => {
    const runtime = themeColorFromVars(resolvePrefCssVars(DEFAULT_PREFS, DEFAULT_TRANSFORMS));
    expect(runtime).toBe(DEFAULT_THEME_COLOR);
    expect(manifest().theme_color).toBe(DEFAULT_THEME_COLOR);
    expect(seedValue(THEME_COLOR_CSS_VAR)).toBe(DEFAULT_THEME_COLOR);
  });

  it("manifest.ts and layout.tsx spell no chrome-colour literal", () => {
    expect(read("src/app/manifest.ts")).toMatch(/theme_color:\s*DEFAULT_THEME_COLOR\b/);
    const layout = read("src/app/layout.tsx");
    expect(layout).toMatch(/<meta name="theme-color" content=\{DEFAULT_THEME_COLOR\} \/>/);
    expect(layout).not.toMatch(/theme-color"\s+content="#/);
  });

  it("the meta precedes the prefs bootstrap that rewrites it pre-paint", () => {
    const layout = read("src/app/layout.tsx");
    const meta = layout.indexOf('<meta name="theme-color"');
    const boot = layout.indexOf("prefCssBootstrapScript()");
    expect(meta).toBeGreaterThan(-1);
    expect(boot).toBeGreaterThan(meta);
  });

  it("the dead --theme-color alias stays deleted", () => {
    expect(read("src/app/globals.css")).not.toMatch(/--theme-color\s*:/);
  });

  it("EditorLayout writes the meta through the one door, from the resolved paint", () => {
    const src = read("src/components/EditorLayout.tsx");
    expect(src).toMatch(/writeThemeColorMeta\(themeColorFromVars\(vars\)\)/);
    expect(src).not.toMatch(/meta\[name="theme-color"\]/);
  });
});

describe("the meta is correct before first paint", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.head.innerHTML = "";
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", DEFAULT_THEME_COLOR);
    document.head.appendChild(meta);
  });
  const metaContent = () =>
    document.querySelector(THEME_COLOR_META_SELECTOR)?.getAttribute("content");
  const run = () => new Function(prefCssBootstrapScript())();

  it("the bootstrap replay writes the recorded top-bar colour into the meta", () => {
    const prefs = { ...DEFAULT_PREFS, topbarBackground: "#123456" };
    localStorage.setItem("virgil-editor-prefs", JSON.stringify(prefs));
    const vars = resolvePrefCssVars(prefs, DEFAULT_TRANSFORMS);
    recordPrefCssPaint(vars);
    run();
    expect(metaContent()).toBe("#123456");
    expect(metaContent()).toBe(themeColorFromVars(vars));
  });

  it("a stale record leaves the meta on the shipped default", () => {
    const prefs = { ...DEFAULT_PREFS, topbarBackground: "#123456" };
    localStorage.setItem("virgil-editor-prefs", JSON.stringify(prefs));
    recordPrefCssPaint(resolvePrefCssVars(prefs, DEFAULT_TRANSFORMS));
    localStorage.setItem("virgil-editor-prefs", JSON.stringify({ ...prefs, topbarBackground: "#654321" }));
    run();
    expect(metaContent()).toBe(DEFAULT_THEME_COLOR);
  });

  it("the runtime writer applies the transformed paint, and tolerates no meta", () => {
    const vars = resolvePrefCssVars(
      { ...DEFAULT_PREFS, topbarBackground: "#336699" },
      { ...DEFAULT_TRANSFORMS, hue: 40 },
    );
    writeThemeColorMeta(themeColorFromVars(vars));
    expect(metaContent()).toBe(themeColorFromVars(vars));
    expect(metaContent()).not.toBe("#336699");
    document.head.innerHTML = "";
    expect(() => writeThemeColorMeta("#000000")).not.toThrow();
  });
});
