import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssCommentsStripped } from "@/lib/__tests__/_source-scan";

/**
 * CANVAS PAINT CENSUS (task 1177) — the canvas COLOUR and the canvas PAINT are
 * two tokens.
 *
 * `--background` is read as a solid colour in ~20 places (`color-mix()`,
 * box-shadow spreads, gradient stops, Tailwind `bg-background`); a gradient
 * assigned to it is invalid in every one of them, silently. Zen's warm→cool
 * canvas therefore rides `--canvas-paint`, and every surface that IS the
 * canvas or masks as it paints that token, so they all show ONE
 * viewport-fixed gradient instead of flat bands over it.
 */
const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const css = cssCommentsStripped(read("src/app/globals.css"));

describe("canvas paint census", () => {
  it("--background is never assigned a gradient", () => {
    const values = [...css.matchAll(/--background\s*:\s*([^;{}]+);/g)].map((m) => m[1]);
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) expect(v).not.toMatch(/gradient\(/);
  });

  it("zen paints the warm→cool gradient through --canvas-paint, and keeps --background solid", () => {
    const zen = css.match(/body\[data-zen-mode="on"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(zen).toMatch(/--canvas-paint:\s*var\(--zen-canvas\)/);
    expect(zen).toMatch(/--canvas-matte:\s*transparent/);
    expect(zen).toMatch(/--background:\s*var\(--topbar-bg\)/);
    // Bottom warm, top cool, pinned to the viewport so every painter agrees.
    expect(css).toMatch(
      /--zen-canvas:\s*linear-gradient\(to top, var\(--zen-canvas-warm\), var\(--zen-canvas-cool\)\) fixed;/,
    );
    expect(css).toMatch(/\.canvas-paint\s*\{\s*background:\s*var\(--canvas-paint\);\s*\}/);
  });

  it("the canvas root and the pod's masks paint --canvas-paint, not the colour", () => {
    const layout = read("src/components/EditorLayout.tsx");
    expect(layout).toContain('className="flex flex-col h-screen canvas-paint"');
    expect(layout).not.toMatch(/h-screen bg-\[var\(--background\)\]/);

    const pane = read("src/components/EditorPane.tsx");
    for (const cap of ["data-editor-pod-cap\n", "data-editor-pod-cap-bottom\n"]) {
      const at = pane.indexOf(cap);
      expect(at, cap).toBeGreaterThan(-1);
      const style = pane.slice(at, at + 1500);
      expect(style).toContain("background: 'var(--canvas-paint)'");
    }
    expect(pane).toContain("0 0 0 var(--pod-gap) var(--canvas-matte)");
    expect(pane).not.toContain("0 0 0 var(--pod-gap) var(--background)");
  });
});
