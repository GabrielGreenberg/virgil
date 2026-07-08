// @vitest-environment node
//
// Anchor-state SSOT guardrail (task 056) — the CI half of the "one anchor-state
// authority" contract, mirroring the keystroke-sanctity + scroll-reposition
// grep-allowlists.
//
// After task 056 every one of the 10 omni builders derives `OmniItem.anchorState`
// from the single SSOT `resolveAnchorState(pos, intent)` (src/links/anchor-state.ts)
// instead of an inline formula. Three formula families used to reinvent the rule:
//
//   • the 2-way `pos == null ? "orphaned" : "anchored"` (ignored free intent),
//   • the Errors inline 3-way `paraId == null ? "free" : pos == null ? ...`,
//   • the hardcoded free/orphan/anchored string literals.
//
// A builder that hand-rolls `anchorState` again — a ternary or a bare string
// literal — silently reintroduces the mis-badge class (a deliberately-parked
// `unanchored` citation/footnote rendering as a red "orphaned" error). This test
// walks every `src/panels/*/omni.tsx` and asserts every `anchorState:` property
// value is a `resolveAnchorState(` call, nothing else.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANELS = path.resolve(HERE, "../.."); // src/panels/

/** Every `src/panels/<Panel>/omni.tsx` builder. */
function omniBuilderFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(PANELS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(PANELS, entry.name, "omni.tsx");
    try {
      readFileSync(file);
      out.push(file);
    } catch {
      // no omni.tsx in this panel folder
    }
  }
  return out;
}

/**
 * Find every `anchorState:` property assignment whose value is NOT a
 * `resolveAnchorState(` call. Matches the value token immediately following the
 * `anchorState:` key (skipping whitespace/newlines) and flags anything that
 * isn't the SSOT call — a `"literal"`, a `pos == null ? …` ternary, or any
 * other hand-rolled derivation.
 */
function inlineAnchorStateOffenders(source: string): string[] {
  const offenders: string[] = [];
  const re = /anchorState:\s*([^\n,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const value = m[1].trim();
    if (!value.startsWith("resolveAnchorState(")) offenders.push(value);
  }
  return offenders;
}

describe("anchor-state SSOT guardrail", () => {
  it("every omni.tsx builder derives anchorState from resolveAnchorState — no inline ternary/literal", () => {
    const files = omniBuilderFiles();
    // Sanity: we actually found the builders (guards against a path-resolution
    // regression silently passing this test on an empty set).
    expect(files.length).toBeGreaterThanOrEqual(10);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const offender of inlineAnchorStateOffenders(source)) {
        violations.push(`${path.relative(PANELS, file)} → anchorState: ${offender}`);
      }
    }

    expect(
      violations,
      `Every omni builder must derive anchorState via resolveAnchorState(pos, intent) ` +
        `(the SSOT in src/links/anchor-state.ts). Inline derivations reintroduce the ` +
        `task-056 mis-badge class. Offending sites:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });
});
