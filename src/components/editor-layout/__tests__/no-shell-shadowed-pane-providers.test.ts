/**
 * Census (task 870): no provider is mounted by BOTH the shell (EditorLayout)
 * and the pane (EditorPane).
 *
 * Every EditorPane mounts its own per-doc providers. A copy of one of them in
 * EditorLayout is SHADOWED for everything inside the pane — so any behaviour
 * left wired to the shell copy acts on state no pane surface writes, and the
 * drift is invisible (both copies type-check, both render). Task 870 found
 * three at once behind four such shell copies: a new card's recently-added pin
 * that never released (the auto-clear sat under the shell tracker), a
 * Bibliography → citation ring driven by a shell `selectedBibKey` no panel
 * wrote, and a toolbar-override reset that cleared a shell `overrideEditor`
 * nothing read.
 *
 * A shared mount is allowed only where the shell copy serves something OUTSIDE
 * every pane, or is a configuration INPUT the pane reads rather than per-pane
 * state — each named below with its reason.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codeOnly, REPO_ROOT } from "../../../lib/__tests__/_source-scan";

const SHARED_MOUNT_ALLOWED: Record<string, string> = {
  CollabProvider:
    "the shell's value is the ACTIVE pane's bubbled collab (paneState), mounted for the topbar, which sits outside every pane",
  EditorChromeProvider:
    "a configuration INPUT: the shell wraps each EditorPane in it to say which chrome the pane shows; not per-pane state",
};

function providerMounts(rel: string): Set<string> {
  const src = codeOnly(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
  const out = new Set<string>();
  for (const m of src.matchAll(/<([A-Z][A-Za-z]*(?:\.Provider|Provider))[\s>]/g)) {
    out.add(m[1]);
  }
  return out;
}

describe("shell/pane provider census", () => {
  const shell = providerMounts("src/components/EditorLayout.tsx");
  const pane = providerMounts("src/components/EditorPane.tsx");

  it("discovers the pane's per-doc providers (the scan is not vacuous)", () => {
    for (const p of ["SelectionsProvider", "RecentlyAddedProvider", "EditorRefProvider", "CitationDisplayProvider"]) {
      expect(pane.has(p), p).toBe(true);
    }
    expect(shell.size).toBeGreaterThan(0);
  });

  it("no provider is mounted by both the shell and the pane, outside the allowlist", () => {
    const both = [...shell].filter((p) => pane.has(p) && !(p in SHARED_MOUNT_ALLOWED));
    expect(
      both,
      "EditorLayout mounts a provider EditorPane also mounts — the pane's copy shadows it. Move the behaviour into the pane (task 870).",
    ).toEqual([]);
  });

  it("every allowlist row is still a real shared mount (no stale exemptions)", () => {
    for (const p of Object.keys(SHARED_MOUNT_ALLOWED)) {
      expect(shell.has(p) && pane.has(p), p).toBe(true);
    }
  });

  it("the recently-added auto-clear is mounted by the pane, not the shell", () => {
    const shellSrc = codeOnly(readFileSync(path.join(REPO_ROOT, "src/components/EditorLayout.tsx"), "utf8"));
    const paneSrc = codeOnly(readFileSync(path.join(REPO_ROOT, "src/components/EditorPane.tsx"), "utf8"));
    expect(shellSrc).not.toMatch(/<RecentlyAddedAutoClear\b/);
    expect(paneSrc).toMatch(/<RecentlyAddedAutoClear\b/);
  });
});
