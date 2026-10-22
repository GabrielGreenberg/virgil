import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GAP_WIDTH_PX,
  GRIP_CENTER_WITH_SYNC_PILL,
  clampCodeSplitEditorPx,
  codeSplitEditorBoundsPx,
} from "../split-with-code";

/**
 * The code splitter honours the shared gutter contract (task 813).
 *
 * 1. Its gutter width is the SAME number every other editor gutter renders at
 *    (`--pod-gap`). `GAP_WIDTH_PX` is a TS constant because the drag math needs
 *    it, so the equality is pinned here rather than trusted to a comment (the
 *    comment once claimed a match while the values were 8 vs 10).
 * 2. The shared `.band-grip` pill's centre along the gutter is a SEAM
 *    (`--band-grip-center`, default 50%), and the splitter moves it clear of
 *    its own centred sync-arrows pill — otherwise the grip hid underneath.
 */
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const splitter = readFileSync(
  path.join(ROOT, "src/components/editor-layout/split-with-code.tsx"),
  "utf8",
);

/** Bodies of every rule block headed by `selector` (the shared
 *  multi-selector rule and the per-orientation one both qualify). */
const ruleBodies = (selector: string): string[] => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...globals.matchAll(new RegExp(`${esc}\\s*\\{([^}]*)\\}`, "g"))].map(
    (m) => m[1],
  );
};

describe("code splitter — gutter width is --pod-gap", () => {
  it("GAP_WIDTH_PX equals --pod-gap as declared in globals.css", () => {
    const m = globals.match(/--pod-gap:\s*(\d+(?:\.\d+)?)px\s*;/);
    expect(m, "--pod-gap declaration not found").not.toBeNull();
    expect(GAP_WIDTH_PX).toBe(Number(m![1]));
  });
});

describe("shared grip — centre-along-gutter seam", () => {
  it.each([
    [".drag-gap-v.band-grip::after", "top"],
    [".drag-gap-h.band-grip::after", "left"],
  ])("%s centres via --band-grip-center (50%% fallback) on `%s`", (sel, prop) => {
    const re = new RegExp(`\\b${prop}:\\s*var\\(--band-grip-center,\\s*50%\\)`);
    expect(ruleBodies(sel).some((b) => re.test(b))).toBe(true);
  });

  it("the splitter moves the grip off-centre, clear of the sync pill", () => {
    // Sync pill half-height ≈ 20px + drag-grip half-height 22px ⇒ ≥ 42px.
    const offset = Number(GRIP_CENTER_WITH_SYNC_PILL.match(/50% \+ (\d+)px/)?.[1]);
    expect(offset).toBeGreaterThanOrEqual(42);
    expect(splitter).toMatch(/"--band-grip-center":\s*GRIP_CENTER_WITH_SYNC_PILL/);
  });
});

/**
 * One owner of "what split is legal?" (task 1053). The drag clamp and the
 * render-time width both read `codeSplitEditorBoundsPx`; the store keeps only
 * a [0, 1] sanity clamp. Before, the store re-clamped to a fixed [0.05, 0.95]
 * ratio range, so a drag released at the editor-min edge (ratio ≈ 0.029 in a
 * 1000 px container) stored 0.05 and the divider jumped ~20 px.
 */
describe("code splitter — the split a drag ends on is the one stored", () => {
  const viewPrefs = readFileSync(path.join(ROOT, "src/hooks/useViewPrefs.ts"), "utf8");
  const storeClamp = (r: number) => Math.max(0, Math.min(1, r));
  /** drag clamp → commit ratio → store → render width, as the component does. */
  const releaseAt = (pointerPx: number, w: number) => {
    const track = w - GAP_WIDTH_PX;
    const applied = clampCodeSplitEditorPx(pointerPx, w);
    const stored = storeClamp(applied / track);
    const rendered = clampCodeSplitEditorPx(Math.round(stored * track), w);
    return { applied, rendered };
  };

  it.each([
    ["min edge, 1000 px", -500, 1000],
    ["max edge, 1000 px", 5000, 1000],
    ["min edge, 6000 px", -500, 6000],
    ["max edge, 6000 px", 99999, 6000],
    ["mid, 1400 px", 700, 1400],
  ])("%s: rendered width equals the last applied width", (_l, px, w) => {
    const { applied, rendered } = releaseAt(px, w);
    expect(Math.abs(rendered - applied)).toBeLessThanOrEqual(0.5);
  });

  it("bounds: editor keeps its sliver, code keeps its minimum", () => {
    const { min, max } = codeSplitEditorBoundsPx(1000);
    expect(min).toBe(24);
    expect(max).toBe(1000 - GAP_WIDTH_PX - 240);
    // Too narrow for both: collapses to the sliver, never inverts.
    const narrow = codeSplitEditorBoundsPx(100);
    expect(narrow.max).toBe(narrow.min);
  });

  it("setCodePaneRatio carries no fixed ratio range", () => {
    const body = viewPrefs.match(/const setCodePaneRatio = useCallback\(([\s\S]*?)\}, \[update\]\);/)?.[1];
    expect(body, "setCodePaneRatio not found").toBeTruthy();
    expect(body).not.toMatch(/0\.05|0\.95/);
    expect(body).toMatch(/Math\.max\(0, Math\.min\(1, ratio\)\)/);
  });
});
