// @vitest-environment jsdom
/**
 * Task 1218 — the drop bar's rounding is stated ONCE, in CSS, per shape.
 *
 * `Indicator.tsx` used to set an inline `borderRadius: 1` on every bar, and an
 * inline style beats a class rule — so the expex tall bar's
 * `.dropmode-bar-vertical { border-radius: var(--radius-xs) }` was dead CSS and
 * the tall bar always rendered at 1px. jsdom resolves no CSS vars, so this
 * asserts the SPECIFIED inline style (none) and the stated CSS rules.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Placement } from "../types";

let placement: Placement | null = null;
vi.mock("../controller", () => ({
  useDropSession: () => (placement ? { placement } : null),
}));

import { DropModeIndicator } from "../Indicator";

afterEach(() => {
  cleanup();
  placement = null;
});

const editor = {} as Placement["editor"];
const SHAPES: Array<[string, Placement]> = [
  ["horizontal gap", { kind: "between-blocks", editor, insertPos: 0, rect: { x: 0, y: 0, width: 300, height: 2 } }],
  ["vertical (expex) bar", { kind: "between-blocks", editor, insertPos: 0, rect: { x: 0, y: 0, width: 2, height: 80 } }],
  ["paragraph side", { kind: "paragraph-side", editor, paragraphId: "p", side: "left", rect: { x: 0, y: 0, width: 2, height: 40 } }],
  ["inline caret", { kind: "inline-cursor", editor, pos: 1, rect: { x: 0, y: 0, width: 2, height: 16 } }],
];

describe("DropModeIndicator — no inline radius overrides the per-shape CSS", () => {
  it.each(SHAPES)("%s: the bar carries no inline border-radius", (_name, p) => {
    placement = p;
    render(<DropModeIndicator />);
    const bar = document.body.querySelector<HTMLElement>("[class*='dropmode-bar-']");
    expect(bar).not.toBeNull();
    expect(bar!.style.borderRadius).toBe("");
  });

  it("the vertical bar is tagged so its --radius-xs rule applies", () => {
    placement = SHAPES[1][1];
    render(<DropModeIndicator />);
    expect(document.body.querySelector(".dropmode-bar-vertical")).not.toBeNull();
  });

  it("globals.css states each shape's radius; the vertical rule comes LAST (equal specificity)", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
    const hairline = css.indexOf(
      ".dropmode-bar-gap,\n.dropmode-bar-side,\n.dropmode-bar-inline {\n  border-radius: 1px;\n}",
    );
    const vertical = css.indexOf(".dropmode-bar-vertical {\n  border-radius: var(--radius-xs);\n}");
    expect(hairline).toBeGreaterThan(-1);
    expect(vertical).toBeGreaterThan(hairline);
  });
});
