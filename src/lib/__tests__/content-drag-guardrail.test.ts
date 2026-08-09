/**
 * Content-drag stability guardrail (perf Wave 2, P4) — the grep-allowlist
 * sibling of the pane-drag / window-resize / keystroke-subscriber laws.
 *
 * The law: a content drag (drop-mode session) is a LAYOUT GESTURE — it
 * publishes `kind:"content"` on the LayoutGestureBus from the drop-mode
 * controller (the single chokepoint), its overlay moves by TRANSFORM (React
 * renders on edges only), and its move path never mints, flushes, or walks
 * the doc. Each leg below pins the shape a regression would take:
 *
 *  1. PUBLISHER EXCLUSIVITY — `beginContentGesture`/`endContentGesture` are
 *     importable but only the controller may call them: a second caller is
 *     a second gesture owner, and an unpaired begin wedges every parked
 *     geometry follower app-wide.
 *  2. UNIVERSAL SELECTOR STAYS DEAD — the Wave-0 fix scoped the drop-mode
 *     user-select rule to the body element; the `*` form was a measured
 *     36 ms full-tree style recalc per drag edge.
 *  3. TRANSFORM-ONLY OVERLAY — the lift overlay's JSX must never set
 *     `transform` (the imperative motion channel owns it; a style-diff
 *     write would clobber live motion), and LiftHost must keep the
 *     RAF-coalesced translate3d path.
 *  4. NO MID-DRAG MINT — the hit-test resolves anchors with `mint: false`
 *     on the move path (minting per pointermove was the D4 drag cliff:
 *     full doc walk + dispatch + synchronous .tex flush per move).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Strip comments so prose mentioning a pattern can't read as live code. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("content-drag guardrail", () => {
  it("leg 1 — the controller is the ONLY content-gesture publisher caller", () => {
    // Search both silos for call sites of the publisher pair.
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const out = execSync(
      `grep -rln "beginContentGesture\\|endContentGesture" src library --include="*.ts" --include="*.tsx" || true`,
      { cwd: ROOT, encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f: string) => !f.includes("__tests__"))
      .sort();
    expect(out).toEqual([
      "src/components/drop-mode/controller.ts",
      "src/lib/pane-resize/layout-gesture-bus.ts",
    ]);
  });

  it("leg 2 — the universal drop-mode selector stays dead", () => {
    const css = read("src/app/globals.css");
    // The Wave-0 D5 fix: no `... *` descendant-universal form under the
    // drop-mode attr, in any quoting variant.
    expect(/body\[data-drop-mode-active[^\]]*\]\s+\*/.test(css)).toBe(false);
    // The scoped body rule (the Wave-0 replacement) must still exist — a
    // total disappearance would mean the drag lost its selection shield.
    expect(/body\[data-drop-mode-active[^\]]*\]\s*\{/.test(css)).toBe(true);
  });

  it("leg 3 — the lift overlay is transform-only: JSX never writes transform, LiftHost drives translate3d", () => {
    const overlay = stripComments(read("src/text-objects/LiftedTextOverlay.tsx"));
    // No `transform:` style property in the overlay component (the
    // willChange hint is allowed; the motion itself is imperative).
    expect(/[^-\w]transform\s*:/.test(overlay)).toBe(false);
    const host = stripComments(read("src/text-objects/LiftHost.tsx"));
    expect(host.includes("translate3d")).toBe(true);
    expect(host.includes("motionTargetsRef")).toBe(true);
    // The per-move handler must not commit React state unconditionally: the
    // setOverlay calls inside the move path are mode-EDGE-gated. Structural
    // pin: onMove exists and schedules the motion RAF.
    expect(host.includes("scheduleMotion()")).toBe(true);
  });

  it("leg 4 — the hit-test move path never mints", () => {
    const hitTest = stripComments(read("src/components/drop-mode/hit-test.ts"));
    // Every resolveAnchorableBlock CALL (first arg `editor`, not the
    // declaration's typed parameter list) carries mint:false.
    const calls = hitTest.match(/resolveAnchorableBlock\(\s*editor\s*,[\s\S]*?\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call).toContain("mint: false");
    }
  });
});
