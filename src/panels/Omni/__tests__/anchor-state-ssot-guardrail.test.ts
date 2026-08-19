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
//
// TASK 369 — the derivation MOVED, and the law did not. The six
// paragraph-anchored builders no longer derive their own rows at all: they read
// them from `buildOmniAnchorRows` (`src/panels/_shared/omni-anchor-rows.ts`),
// the one reader of the one card-anchor authority, and forward
// `row.anchorState`. So a forward of exactly that field is admitted — but ONLY
// from a file that actually imports the shared reader, and the shared reader is
// censused by the SAME rule, so the chain still terminates at
// `resolveAnchorState`. Anything else in either place is still a violation.

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
function inlineAnchorStateOffenders(source: string, forwardOk: boolean): string[] {
  const offenders: string[] = [];
  const re = /anchorState:\s*([^\n,]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const value = m[1].trim();
    if (value.startsWith("resolveAnchorState(")) continue;
    // The ONLY admitted forward: the shared reader's already-SSOT-derived
    // field, in a file that demonstrably goes through that reader.
    if (forwardOk && value === "row.anchorState") continue;
    offenders.push(value);
  }
  return offenders;
}

/** True iff this file reads its rows from the shared omni-anchor reader. */
function usesSharedReader(source: string): boolean {
  return /import\s*\{[^}]*\bbuildOmniAnchorRows\b[^}]*\}\s*from\s*["'][^"']*omni-anchor-rows["']/.test(
    source,
  );
}

describe("anchor-state SSOT guardrail", () => {
  it("every omni.tsx builder derives anchorState from resolveAnchorState — no inline ternary/literal", () => {
    const files = omniBuilderFiles();
    // Sanity: we actually found the builders (guards against a path-resolution
    // regression silently passing this test on an empty set).
    expect(files.length).toBeGreaterThanOrEqual(10);

    // The shared reader is censused by the SAME rule and admits NO forward —
    // it is where the chain has to terminate at `resolveAnchorState`.
    const SHARED_READER = path.join(PANELS, "_shared", "omni-anchor-rows.ts");
    const readerSource = readFileSync(SHARED_READER, "utf8");
    expect(
      inlineAnchorStateOffenders(readerSource, false),
      "src/panels/_shared/omni-anchor-rows.ts is the ONE reader every " +
        "paragraph-anchored builder forwards from — every anchorState it " +
        "produces must come from resolveAnchorState.",
    ).toEqual([]);

    const violations: string[] = [];
    let forwarders = 0;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const forwardOk = usesSharedReader(source);
      if (forwardOk) forwarders++;
      for (const offender of inlineAnchorStateOffenders(source, forwardOk)) {
        violations.push(`${path.relative(PANELS, file)} → anchorState: ${offender}`);
      }
    }
    // Sanity: the forward exemption is only meaningful if builders really take
    // it — otherwise a rename of the shared reader would silently turn this
    // leg back into the pre-369 one with nothing failing.
    expect(forwarders).toBeGreaterThanOrEqual(6);

    expect(
      violations,
      `Every omni builder must derive anchorState via resolveAnchorState(pos, intent) ` +
        `(the SSOT in src/links/anchor-state.ts). Inline derivations reintroduce the ` +
        `task-056 mis-badge class. Offending sites:\n  ${violations.join("\n  ")}`,
    ).toEqual([]);
  });
});
