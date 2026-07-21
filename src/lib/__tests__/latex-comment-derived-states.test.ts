import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { DERIVED_CSS } from "@/lib/preferences-tree";
import { DEFAULT_PREFS, deriveLight } from "@/hooks/usePreferences";

/**
 * task 193 — the inline LaTeX-comment node's hover / node-selection washes now
 * DERIVE from `latexCommentColor`, so recoloring comments no longer desyncs the
 * interaction states from the (already-derived) rest wash. This is the
 * task-175 `--footnote-bg-hover` class one inline-kind over: a frozen
 * interaction-state literal sitting over a live/derived base.
 *
 * Locks both halves: the DERIVED_CSS producers exist and track the preference,
 * AND the globals.css consumers actually read the vars (the "token defined,
 * consumer never swept" drift class the color-token-consumers test guards).
 */
const ROOT = path.resolve(__dirname, "..", "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

function derived(cssVar: string) {
  return DERIVED_CSS.find((e) => e.cssVar === cssVar);
}

describe("latex-comment interaction washes are derived from latexCommentColor", () => {
  it("registers --latex-comment-bg-hover and --latex-comment-bg-active in DERIVED_CSS", () => {
    expect(derived("--latex-comment-bg-hover")).toBeDefined();
    expect(derived("--latex-comment-bg-active")).toBeDefined();
  });

  it("tracks latexCommentColor — a recolor moves the wash", () => {
    const hover = derived("--latex-comment-bg-hover")!;
    const active = derived("--latex-comment-bg-active")!;
    const recolored = { ...DEFAULT_PREFS, latexCommentColor: "#883333" };
    // Follows the new hue…
    expect(hover.compute(recolored)).toBe(deriveLight("#883333", 0.16));
    expect(active.compute(recolored)).toBe(deriveLight("#883333", 0.22));
    // …and is genuinely different from the default-hue value (not frozen).
    expect(hover.compute(recolored)).not.toBe(hover.compute(DEFAULT_PREFS));
    expect(active.compute(recolored)).not.toBe(active.compute(DEFAULT_PREFS));
  });

  it("does NOT move when an unrelated preference changes", () => {
    const hover = derived("--latex-comment-bg-hover")!;
    const other = { ...DEFAULT_PREFS, footnoteColor: "#123456" };
    expect(hover.compute(other)).toBe(hover.compute(DEFAULT_PREFS));
  });

  it("sits on the same ray as the rest wash — hover darker than rest, active darker than hover", () => {
    const base = derived("--latex-comment-bg")!.compute(DEFAULT_PREFS);
    const hover = derived("--latex-comment-bg-hover")!.compute(DEFAULT_PREFS);
    const active = derived("--latex-comment-bg-active")!.compute(DEFAULT_PREFS);
    const lum = (hex: string) =>
      parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
    // Higher deriveLight opacity ⇒ closer to the accent ⇒ lower channel sum.
    expect(lum(hover)).toBeLessThan(lum(base));
    expect(lum(active)).toBeLessThan(lum(hover));
  });

  it("reproduces today's literals' RED channel at the default color (zero visual change)", () => {
    // The retired literals were #e8f0f8 (hover) / #e0ecf5 (active); 0.16/0.22
    // reproduce their dominant red channel exactly at #7191b0.
    expect(derived("--latex-comment-bg-hover")!.compute(DEFAULT_PREFS)).toBe("#e8edf2");
    expect(derived("--latex-comment-bg-active")!.compute(DEFAULT_PREFS)).toBe("#e0e7ee");
  });
});

describe("globals.css consumers read the derived vars (no frozen literal)", () => {
  it(".latex-comment:hover reads --latex-comment-bg-hover, not a frozen hex", () => {
    expect(globals).toMatch(/\.latex-comment:hover\s*\{[^}]*var\(--latex-comment-bg-hover/);
  });

  it(".latex-comment.ProseMirror-selectednode reads --latex-comment-bg-active", () => {
    expect(globals).toMatch(
      /\.latex-comment\.ProseMirror-selectednode\s*\{[^}]*var\(--latex-comment-bg-active/,
    );
  });

  it("the retired hover/selectednode blue literals no longer appear in rule bodies", () => {
    // #e8f0f8 / #e0ecf5 were the frozen hover/selectednode backgrounds.
    expect(globals).not.toMatch(/background:\s*#e8f0f8/);
    expect(globals).not.toMatch(/background:\s*#e0ecf5/);
  });

  it(".latex-comment-handle:hover tracks its heading-annotation base, not a frozen #7fa8c8", () => {
    expect(globals).toMatch(
      /\.latex-comment-handle:hover\s*\{[^}]*color-mix\([^)]*--heading-annotation-border/,
    );
    expect(globals).not.toMatch(/background:\s*#7fa8c8/);
  });
});
