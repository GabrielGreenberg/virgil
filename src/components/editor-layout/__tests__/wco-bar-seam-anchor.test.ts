import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WCO bar seam-anchor contract (task 289, sibling of task 094).
 *
 * The Virgil bar (`.virgil-bar`) grows TALLER than its 32px base under Window
 * Controls Overlay — via `min-height` only, with NO vertical padding — so any
 * CENTER-anchored bar child's optical center = `seam − H/2`, which rises as the
 * bar height H grows. Task 094 seam-anchored only the tab TITLE wrappers
 * (`self-end mb-[3px]`, optical center at `seam − 15`, height-independent),
 * which left the titles seam-anchored while the "+" and the StatusCluster icons
 * stayed center-anchored — so under the folded WCO bar the titles dropped BELOW
 * the "+"/icons.
 *
 * This pins the fix: the WHOLE bar row shares ONE seam (bottom) anchor. Every
 * bar content group is 24px tall (`.topbarbtn` = 24px; `InlineTabLabel` =
 * h-[24px]), so `self-end mb-[3px]` lands each group's optical center at
 * `seam − 15` uniformly — one baseline in BOTH the base and WCO-folded bar.
 *
 * These are source-string contracts (jsdom has no layout, so a pixel-baseline
 * assertion is impossible here); the live BOTH-states eyeball via `?wco-debug`
 * is owed to Gabriel. The point of the pins is to fail loudly if any group
 * silently re-drifts back to a center anchor — the exact 094→289 regression.
 */

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "../../.."); // …/src
const read = (rel: string) => readFileSync(resolve(srcRoot, rel), "utf8");

describe("WCO bar seam-anchor (task 289)", () => {
  it("the bar row bottom-anchors the whole cluster (items-end, not items-center)", () => {
    const topBar = read("components/editor-layout/TopBar.tsx");
    // The single className that owns the bar row's cross-axis alignment.
    expect(topBar).toMatch(/className=\{`virgil-bar flex items-end /);
    // The center anchor must be gone from that row — it's the H/2 drift bug.
    expect(topBar).not.toMatch(/className=\{`virgil-bar flex items-center /);
  });

  it("StatusCluster's icon row is seam-anchored with the 094 offset", () => {
    const cluster = read("components/editor-layout/StatusCluster.tsx");
    // Root icon-row div: seam-anchored (self-end) + lifted 3px to seam−15.
    // Inner items-center still centers the buttons within the 24px row.
    expect(cluster).toMatch(
      /className="shrink-0 flex items-center self-end mb-\[3px\] px-2"/,
    );
  });

  it("the '+' (TabPlusMenu) is seam-anchored, not self-center", () => {
    const plus = read("components/TabPlusMenu.tsx");
    expect(plus).toMatch(/className="self-end mb-\[3px\] inline-flex"/);
    // The old self-center wrapper floated the "+" up with the WCO bar height.
    expect(plus).not.toMatch(/className="self-center inline-flex"/);
  });

  it("the tab-title wrappers keep the 094 seam anchor (regression guard)", () => {
    const strip = read("components/editor-layout/TabStrip.tsx");
    // Inline (inactive) tab wrappers.
    expect(strip).toMatch(/className="self-end mb-\[3px\] shrink-0"/);
    // The strip itself fills the bar height and keeps tabs at the seam.
    expect(strip).toMatch(/className="flex items-end flex-1 min-w-0 gap-0\.5 px-2 self-stretch relative"/);
  });
});
