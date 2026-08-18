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
 *  5. CLICK-THROUGH CHROME — every `pointer-events: auto` overlay painted
 *     above the editor goes click-through for the session's duration, so the
 *     cursor falls through to the editor for hit-testing. The rule shipped in
 *     Wave 0 for floating panels and its member list was never completed: the
 *     MARGIN chrome (grab handles, marginalia markers, the overflow pill and
 *     the orphan dock) sits inside `.ProseMirror`'s own 88/72px padding band,
 *     and an overlay there does not merely eat a hover — it makes
 *     `document.elementFromPoint` answer with a node OUTSIDE `view.dom`, which
 *     sends `posAtCoords` down its wrap-around `getClientRects()` fallback over
 *     EVERY top-level block, twice, per throttled move (task 351).
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

  it("leg 5 — every margin overlay is click-through for the drop session", () => {
    const css = read("src/app/globals.css");
    // The four hooks the margin chrome actually emits. Each must appear under
    // a `body[data-drop-mode-active]` rule whose declaration is
    // `pointer-events: none`.
    const HOOKS = [
      ".text-object-grab-handle",
      ".marginalia-marker",
      "[data-marginalia-overflow]",
      "[data-marginalia-orphan-dock]",
    ];
    // Collect every drop-mode rule that turns pointer events off.
    const clickThrough = new Set<string>();
    const RULE = /((?:body\[data-drop-mode-active[^{]*?)\{[^}]*\})/g;
    for (const m of css.match(RULE) ?? []) {
      if (!/pointer-events\s*:\s*none/.test(m)) continue;
      const selector = m.slice(0, m.indexOf("{"));
      for (const hook of HOOKS) if (selector.includes(hook)) clickThrough.add(hook);
    }
    expect([...clickThrough].sort()).toEqual([...HOOKS].sort());
    // …and the hooks must still be what the components EMIT. A rename that
    // silently un-covers the rule fails here rather than in a browser: the
    // CSS above would keep matching nothing at all.
    const marginalia = read("src/components/Marginalia.tsx");
    expect(marginalia).toContain("marginalia-marker");
    expect(marginalia).toContain("data-marginalia-overflow");
    expect(marginalia).toContain("data-marginalia-orphan-dock");
    expect(read("src/text-objects/TextObjectGrabHandle.tsx")).toContain(
      "text-object-grab-handle",
    );
  });

  it("leg 6 — the move path is frame-coalesced and snapshot-backed", () => {
    const controller = stripComments(read("src/components/drop-mode/controller.ts"));
    // The raw handler schedules; it never runs the hit-test inline (the
    // pre-351 fast branch of the 16 ms wall-clock gate).
    expect(controller).toContain("scheduleMovePass()");
    expect(controller).toContain("requestAnimationFrame(runMovePass)");
    // The ONE end path cancels the queued frame and disarms the snapshot, so
    // no ending can leave a stale pass or a stale geometry behind it.
    expect(controller).toContain("cancelMovePass()");
    expect(controller).toContain("disarmMoveGeometry()");
    // Auto-scroll's arming test reads the SNAPSHOT, never the container.
    const autoScroll = stripComments(read("src/components/drop-mode/auto-scroll.ts"));
    expect(autoScroll).not.toContain("getBoundingClientRect");
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
