// Task 1360 — the pre-card `suggestions.json` store is RETIRED.
//
// The bug: no panel rendered the store and no skill wrote it, yet its hook was
// still mounted, and its first pending entry's `original_text` reached the
// editor as a `highlightText` prop. `Editor.applyHighlight` painted that quote,
// MOVED THE CARET to it and scrolled it into view on every open — a highlight
// with no control to dismiss it (the doors that advanced it had no UI).
//
// The fix is deletion, not a gate: the hook, its types, the pane-state bubble
// slices, the layout's gate and the editor's text-quote highlight path are all
// gone, and the sidecar is a `legacy` row (read and written by nothing). These
// source-level guards fail if any piece of that path is re-introduced.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LEGACY_SIDECAR_FILENAMES, SIDECAR_VALUE } from "../sidecar-value";
import { SIDECAR_COLLECTIONS } from "../sidecar-merge";

const ROOT = resolve(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

describe("suggestions.json is a retired legacy sidecar (task 1360)", () => {
  it("is declared legacy, unmounted and unmerged", () => {
    expect(SIDECAR_VALUE["suggestions.json"]).toMatchObject({ mount: false, legacy: true });
    expect(LEGACY_SIDECAR_FILENAMES).toContain("suggestions.json");
    expect(SIDECAR_COLLECTIONS["suggestions.json"]).toBeUndefined();
  });

  it("has no hook, and the frozen sample paper no longer carries one", () => {
    expect(existsSync(resolve(ROOT, "src/hooks/useSuggestions.ts"))).toBe(false);
    expect(
      existsSync(resolve(ROOT, "samples/annotation-history/virgil/suggestions.json")),
    ).toBe(false);
  });

  it("no editor surface carries a text-quote highlight input", () => {
    // The position-based `highlightRange` (search / diagnostics) is the ONE
    // highlight input; a quote string has no producer and must not return.
    for (const f of [
      "src/components/Editor.tsx",
      "src/components/EditorPane.tsx",
      "src/components/EditorLayout.tsx",
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/highlightText\s*[?:=]/);
      expect(src, f).not.toMatch(/\bhighlightText=\{/);
      expect(src, f).not.toContain("currentSuggestion");
    }
  });
});
