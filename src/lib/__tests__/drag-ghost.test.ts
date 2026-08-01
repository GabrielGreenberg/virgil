// @vitest-environment jsdom
//
// Drag-ghost SSOT — the tokenized text-ghost builder + the "no raw
// setDragImage" source guard (task 268).
//
// Two drag sources (CitationCard, OutlinePanel) used to hand-roll a native
// `e.dataTransfer.setDragImage(ghost, …)` — handing the visual to the OS, which
// tracks it up into the title bar / browser chrome where it vanishes, flips to
// "no-drop", or reads as a window tear-off. `drag-ghost.ts` exists to kill
// exactly that (suppress the native ghost with a 1×1 PNG, render a
// viewport-clamped DOM ghost). Both sites, plus BibEntryCard's hard-coded cream
// palette and bib-entry-chrome, are now routed through `attachClampedDragGhost`
// + the shared `buildTextDragGhost`. These tests pin:
//
//   1. buildTextDragGhost renders tokenized chrome (no raw hex), truncates on
//      `maxChars`, honors the per-site overrides, and — crucially — never sets
//      `position` (attachClampedDragGhost owns positioning).
//   2. A source grep: NO non-test file under src/ or library/ calls raw
//      `.setDragImage(` except the SSOT itself. A new drag source that bypasses
//      the clamp (reintroducing the tear-off bug) fails CI.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildTextDragGhost } from "../drag-ghost";

describe("buildTextDragGhost", () => {
  it("renders a tokenized card by default — no raw hex, no position", () => {
    const g = buildTextDragGhost("Some heading");
    const css = g.style.cssText;
    expect(g.textContent).toBe("Some heading");
    expect(css).toContain("background: var(--surface");
    expect(css).toContain("var(--border-light");
    expect(css).toContain("var(--ink-body");
    expect(css).toContain("border-radius: var(--radius-xs");
    // Palette flows through tokens — never a raw color literal (hex is allowed
    // only as a var() first-paint fallback, e.g. `var(--surface, #ffffff)`).
    expect(css).not.toContain("background: #");
    expect(css).not.toContain("1px solid #");
    expect(css).not.toContain("color: #");
    // Positioning is attachClampedDragGhost's job — the builder must not set it.
    expect(g.style.position).toBe("");
  });

  it("truncates the label to maxChars with an ellipsis", () => {
    const long = "x".repeat(120);
    const g = buildTextDragGhost(long, { maxChars: 80 });
    expect(g.textContent).toBe("x".repeat(80) + "…");
    // Under the cap, the text is untouched (no stray ellipsis).
    const short = buildTextDragGhost("short", { maxChars: 80 });
    expect(short.textContent).toBe("short");
  });

  it("applies the citation cream override via tokens", () => {
    const g = buildTextDragGhost("cite", {
      maxChars: 80,
      bg: "var(--citation-ghost-bg, #fdf8e1)",
      border: "var(--citation-border-color, #e0d5a8)",
      ink: "var(--citation-color, #6b6245)",
    });
    const css = g.style.cssText;
    expect(css).toContain("var(--citation-ghost-bg");
    expect(css).toContain("var(--citation-border-color");
    expect(css).toContain("var(--citation-color");
  });

  it("honors size/shadow/opacity overrides (the outline + bib-chrome ghosts)", () => {
    const g = buildTextDragGhost("§ pod", {
      maxWidthPx: 200,
      padding: "4px 12px",
      radius: "var(--radius-md, 6px)",
      fontSizePx: 13,
      shadow: "0 2px 8px rgba(0,0,0,0.12)",
      opacity: 0.92,
    });
    const css = g.style.cssText;
    expect(css).toContain("max-width: 200px");
    expect(css).toContain("padding: 4px 12px");
    expect(css).toContain("var(--radius-md");
    expect(css).toContain("font-size: 13px");
    expect(css).toContain("box-shadow: 0 2px 8px");
    expect(css).toContain("opacity: 0.92");
  });

  it("omits shadow and opacity when not requested", () => {
    const css = buildTextDragGhost("plain").style.cssText;
    expect(css).not.toContain("box-shadow");
    expect(css).not.toContain("opacity");
  });
});

// ── Source guard: the clamp SSOT is the ONLY raw setDragImage caller ─────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo
const SSOT = path.resolve(SRC, "lib/drag-ghost.ts"); // the one sanctioned caller

function walk(dir: string, hits: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".git") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, hits);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    if (name.includes(".test.")) continue; // tests mock a fake dataTransfer
    if (full === SSOT) continue; // the SSOT suppresses the native ghost here
    const text = readFileSync(full, "utf8");
    if (/\.setDragImage\s*\(/.test(text)) {
      hits.push(path.relative(path.resolve(SRC, ".."), full));
    }
  }
}

describe("drag-ghost SSOT source guard", () => {
  it("has no raw setDragImage caller outside drag-ghost.ts", () => {
    const hits: string[] = [];
    walk(SRC, hits);
    walk(LIBRARY, hits);
    expect(
      hits,
      `raw setDragImage bypasses the clamped-ghost SSOT (drag-ghost.ts) — ` +
        `route the ghost through attachClampedDragGhost instead:\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});
