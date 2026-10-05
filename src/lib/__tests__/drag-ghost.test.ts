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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  attachClampedDragGhost,
  buildTextDragGhost,
  DRAG_GHOST_LIFT,
  stampDragGhostLayer,
} from "../drag-ghost";
import { DRAG_GHOST_Z } from "@/floats/float-policy";
import { walkFiles } from "./_source-scan";

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

  it("honors size/opacity overrides (the outline + bib-chrome ghosts)", () => {
    const g = buildTextDragGhost("§ pod", {
      maxWidthPx: 200,
      padding: "4px 12px",
      radius: "var(--radius-md, 6px)",
      fontSizePx: 13,
      opacity: 0.92,
    });
    const css = g.style.cssText;
    expect(css).toContain("max-width: 200px");
    expect(css).toContain("padding: 4px 12px");
    expect(css).toContain("var(--radius-md");
    expect(css).toContain("font-size: 13px");
    expect(css).toContain("opacity: 0.92");
  });

  it("never authors a lift of its own — the layer door owns it (task 817)", () => {
    const g = buildTextDragGhost("plain");
    expect(g.style.cssText).not.toContain("box-shadow");
    expect(g.style.cssText).not.toContain("filter");
    expect(g.style.cssText).not.toContain("opacity");
  });
});

describe("the drag-ghost layer door (task 817)", () => {
  it("stampDragGhostLayer applies the one lift token, the ghost z, and pointer inertness", () => {
    const el = document.createElement("div");
    stampDragGhostLayer(el);
    expect(DRAG_GHOST_LIFT).toBe("var(--shadow-drag-ghost-filter)");
    expect(el.style.filter).toBe(DRAG_GHOST_LIFT);
    expect(el.style.zIndex).toBe(String(DRAG_GHOST_Z));
    expect(el.style.pointerEvents).toBe("none");
    expect(el.style.position).toBe("");
  });

  it("attachClampedDragGhost stamps every ghost it attaches, whatever the builder returned", () => {
    const built = document.createElement("div");
    const dt = { setDragImage: () => {} } as unknown as DataTransfer;
    attachClampedDragGhost({
      dragStartEvent: { dataTransfer: dt, clientX: 10, clientY: 10 } as unknown as DragEvent,
      buildGhost: () => built,
      cursorOffsetX: 0,
      cursorOffsetY: 0,
    });
    expect(built.isConnected).toBe(true);
    expect(built.style.filter).toBe(DRAG_GHOST_LIFT);
    expect(built.style.zIndex).toBe(String(DRAG_GHOST_Z));
    document.dispatchEvent(new Event("dragend"));
    expect(built.isConnected).toBe(false);
  });
});

// ── Source guard: the clamp SSOT is the ONLY raw setDragImage caller ─────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/
const LIBRARY = path.resolve(HERE, "../../../library"); // the Library silo
const SSOT = path.resolve(SRC, "lib/drag-ghost.ts"); // the one sanctioned caller

function walk(dir: string, hits: string[]): void {
  for (const full of walkFiles(dir)) {
    const name = path.basename(full);
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

// ── Lift census (task 817): one lift, one door ───────────────────────────────
// Seven ghosts once painted five lifts — two read the token, two a copied raw
// `0 4px 12px`, one a `0 2px 8px`, one the FLOATING-PANEL `--shadow-float`, two
// none — because the text builder took a free-text `box-shadow` and every other
// ghost styled itself. The lift now lives in `stampDragGhostLayer`; these pins
// make a hand-picked ghost lift fail CI.
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const visit = (dir: string) => {
    for (const full of walkFiles(dir, { skipDirs: ["__tests__"] })) {
      const name = path.basename(full);
      if (!/\.(ts|tsx)$/.test(name) || name.includes(".test.")) continue;
      out.push([path.relative(path.resolve(SRC, ".."), full), readFileSync(full, "utf8")]);
    }
  };
  visit(SRC);
  visit(LIBRARY);
  return out;
}

describe("drag-ghost lift census (task 817)", () => {
  const all = sources();

  it("the lift token and the ghost z are spelled in TS only by the door", () => {
    const tokenReaders = all
      .filter(([, t]) => t.includes("--shadow-drag-ghost-filter"))
      .map(([f]) => f);
    expect(tokenReaders).toEqual(["src/lib/drag-ghost.ts"]);
    const zReaders = all
      .filter(([, t]) => /\bDRAG_GHOST_Z\b/.test(t))
      .map(([f]) => f)
      .sort();
    expect(zReaders).toEqual(["src/floats/float-policy.ts", "src/lib/drag-ghost.ts"]);
  });

  it("no ghost-building file hand-picks a lift", () => {
    // A ghost-building file: attaches through the clamp, or stamps the layer
    // itself. In those files no inline `box-shadow:` string and no
    // `.style.boxShadow =` / `.style.filter =` assignment may appear — the
    // stamp is the only place a ghost gets its elevation.
    const builders = all.filter(
      ([f, t]) =>
        f !== "src/lib/drag-ghost.ts" &&
        (/attachClampedDragGhost\s*\(/.test(t) || /stampDragGhostLayer\s*\(/.test(t)),
    );
    expect(builders.length).toBeGreaterThanOrEqual(7);
    const hits: string[] = [];
    for (const [f, t] of builders)
      t.split("\n").forEach((line, i) => {
        if (/box-shadow\s*:|\.style\.(boxShadow|filter)\s*=/.test(line))
          hits.push(`${f}:${i + 1} — ${line.trim().slice(0, 90)}`);
      });
    expect(
      hits,
      "a drag ghost's lift is stampDragGhostLayer's (drag-ghost.ts) — delete the hand-picked shadow",
    ).toEqual([]);
  });
});
