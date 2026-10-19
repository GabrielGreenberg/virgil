import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "@/lib/__tests__/_source-scan";
import {
  ICON_STRIP_WIDTH_VAR,
  normalViewPodBasis,
  PANE_ROW_GAP_PX,
  type NormalViewSide,
} from "../normal-view-rails";

/**
 * Task 1178 — zen shows the page at normal view's width. Normal view stores no
 * page width (the editor column is the row minus the rails); zen unmounts the
 * rails and takes `normalViewPodBasis` from the SAME inputs, centred. These
 * legs pin the derivation, and that normal view's markup reads the same terms.
 */

const globals = readFileSync(path.join(REPO_ROOT, "src/app/globals.css"), "utf8");
const tokenPx = (name: string) => {
  const m = globals.match(new RegExp(`${name}:\\s*(\\d+)px`));
  if (!m) throw new Error(`${name} not found in globals.css`);
  return Number(m[1]);
};
const TOKENS = { stripWidth: tokenPx(ICON_STRIP_WIDTH_VAR), panelMin: tokenPx("--panel-min") };

/** Evaluate the SHIPPED basis string at a row width — `100%` is the row,
 *  the vars are the globals.css tokens — clamped at 0 like a flex basis. */
function normalViewPodWidth(
  rowWidth: number,
  sides: { left: NormalViewSide; right: NormalViewSide },
  tokens: typeof TOKENS,
): number {
  const expr = normalViewPodBasis(sides)
    .replace(/^calc\((.*)\)$/, "$1")
    .replaceAll("100%", String(rowWidth))
    .replaceAll(`var(${ICON_STRIP_WIDTH_VAR})`, String(tokens.stripWidth))
    .replaceAll("var(--panel-min)", String(tokens.panelMin))
    .replaceAll("max(", "Math.max(")
    .replace(/(\d+)px/g, "$1");
  expect(expr).toMatch(/^[\d\s.+\-(),]*(Math\.max[\d\s.+\-(),]*)*$/);
  return Math.max(0, Function(`return (${expr});`)() as number);
}

const open = (panelPref = 320): NormalViewSide => ({ present: true, collapsed: false, panelPref });
const collapsed = (panelPref = 320): NormalViewSide => ({ present: true, collapsed: true, panelPref });
const none: NormalViewSide = { present: false, collapsed: false, panelPref: 320 };

describe("the shipped basis, evaluated in px", () => {
  const S = TOKENS.stripWidth;
  const G = PANE_ROW_GAP_PX;

  it("both sides with open panels", () => {
    expect(normalViewPodWidth(1600, { left: open(320), right: open(400) }, TOKENS)).toBe(
      1600 - (S + 320 + G) - (S + 400 + G),
    );
  });

  it("one side empty mounts no rail at all", () => {
    expect(normalViewPodWidth(1600, { left: open(320), right: none }, TOKENS)).toBe(
      1600 - (S + 320 + G),
    );
  });

  it("no rails: the pod is the whole row", () => {
    expect(normalViewPodWidth(1200, { left: none, right: none }, TOKENS)).toBe(1200);
  });

  it("a collapsed panel keeps its strip and drops its width", () => {
    expect(normalViewPodWidth(1600, { left: collapsed(500), right: open(320) }, TOKENS)).toBe(
      1600 - (S + G) - (S + 320 + G),
    );
  });

  it("a pref under --panel-min renders at the floor", () => {
    expect(normalViewPodWidth(1600, { left: open(10), right: none }, TOKENS)).toBe(
      1600 - (S + TOKENS.panelMin + G),
    );
  });

  it("a narrow window never goes negative", () => {
    expect(normalViewPodWidth(300, { left: open(320), right: open(320) }, TOKENS)).toBe(0);
  });
});

describe("normalViewPodBasis — the CSS zen ships", () => {
  it("encodes exactly the model's terms", () => {
    expect(normalViewPodBasis({ left: open(320), right: collapsed(200) })).toBe(
      `calc(100% - var(${ICON_STRIP_WIDTH_VAR}) - max(320px, var(--panel-min)) - ${PANE_ROW_GAP_PX}px - var(${ICON_STRIP_WIDTH_VAR}) - ${PANE_ROW_GAP_PX}px)`,
    );
  });

  it("no rails: the full row", () => {
    expect(normalViewPodBasis({ left: none, right: none })).toBe("100%");
  });

  it("is symmetric in the sides, so centring does not change the width", () => {
    // Zen centres the pod with auto margins; the width is a SUM of both
    // rails, so which side held the panel does not matter.
    const a = normalViewPodWidth(1400, { left: open(320), right: none }, TOKENS);
    const b = normalViewPodWidth(1400, { left: none, right: open(320) }, TOKENS);
    expect(a).toBe(b);
  });
});

describe("normal view reads the same terms (the two views cannot drift)", () => {
  const pane = readFileSync(path.join(REPO_ROOT, "src/components/EditorPane.tsx"), "utf8");
  const column = readFileSync(
    path.join(REPO_ROOT, "src/components/editor-layout/panel-column.tsx"),
    "utf8",
  );

  it("the icon strip has the STATED token width", () => {
    expect(pane).toContain("style={{ width: `var(${ICON_STRIP_WIDTH_VAR})` }}");
  });

  it("the row gap is the shared constant", () => {
    expect(pane).toContain("gap: PANE_ROW_GAP_PX,");
  });

  it("the panel column's basis is its pref under the --panel-min floor", () => {
    expect(column).toContain("flex: collapsed ? '0 0 0px' : `0 0 ${panelPref}px`");
    expect(column).toContain("'var(--panel-min)'");
  });

  it("zen's editor column takes the derived basis, centred, and mounts no zen margins", () => {
    expect(pane).toContain("normalViewPodBasis({");
    expect(pane).toContain('{ flex: `0 1 ${zenPodBasis}`, marginInline: "auto" }');
    expect(pane).not.toMatch(/ZenMargin|zenLeftMargin|zenRightMargin/);
  });

  it("the zen derivation reads the inputs the rails render from", () => {
    expect(pane).toContain('panelPref: viewPrefs.getPanelWidth("left", "omni")');
    expect(pane).toContain('panelPref: viewPrefs.getPanelWidth("right", "omni")');
    expect(pane).toContain("present: visiblePanelsLeft.length > 0");
    expect(pane).toContain("present: visiblePanelsRight.length > 0");
    // …and the rail it subtracts is exactly what normal view mounts.
    expect(pane).toContain(
      "{!codeSplit.active && !viewPrefs?.zenMode && visiblePanelsLeft.length > 0 && (",
    );
    expect(pane).toContain('viewPrefs.getPanelWidth(side, "omni")');
  });
});
