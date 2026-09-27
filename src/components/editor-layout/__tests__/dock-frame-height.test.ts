// Task 792 — "how tall is this pane's visible scrollport?" has ONE answer.
//
// EditorScrollbar measures the row's clientHeight and writes it as
// `--scroll-viewport-h` (RO-driven, equality-bailed). EditorPane's pod
// geometry reads it. The side column's sticky dock frame used to re-derive the
// same height from a window formula (`100dvh - 32px`), which is false in the
// Library Reader (the scrollport sits under the Library's chrome) and under
// WCO (the bar grows to the OS title-bar strip) — the band's bottom edge,
// resize handle and bin slot fell below the visible pane.
//
// jsdom resolves no CSS vars, so this is a source census: the frame height
// (and the column-wide `--dock-slot-frame-h` that caps expanded card bodies)
// must read the measured var, the pre-measure fallback must name the bar
// token, and no pane height anywhere in src/components may be spelled as a
// viewport minus a bare 32px bar literal.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { strip, trackedFiles } from "@/lib/__tests__/_source-scan";

const REPO = path.resolve(__dirname, "../../../..");
const COLUMN = path.join(REPO, "src/components/editor-layout/panel-column.tsx");

describe("dock frame height derives from the measured scrollport (task 792)", () => {
  const src = strip(readFileSync(COLUMN, "utf8"), true);

  it("frameH reads --scroll-viewport-h with a bar-token fallback", () => {
    const m = src.match(/const frameH\s*=\s*('[^']*'|"[^"]*"|`[^`]*`)/);
    expect(m, "panel-column.tsx must declare `const frameH = …`").not.toBeNull();
    const expr = m![1];
    expect(expr).toMatch(/var\(--scroll-viewport-h,/);
    expect(expr).toMatch(/var\(--bar-base-h\)/);
    expect(expr).not.toMatch(/32px/);
  });

  it("the frame's height and --dock-slot-frame-h are both frameH", () => {
    expect(src).toMatch(/\['--dock-slot-frame-h' as string\]:\s*frameH/);
    expect(src).toMatch(/height:\s*frameH/);
  });

  it("no src/components file sizes a pane as a viewport minus a bare 32px", () => {
    const offenders: string[] = [];
    for (const abs of trackedFiles("src/components", /\.(tsx?|css)$/)) {
      if (abs.includes("__tests__")) continue;
      const body = strip(readFileSync(abs, "utf8"), true);
      if (/100d?vh\s*-\s*32px/.test(body)) offenders.push(path.relative(REPO, abs));
    }
    expect(offenders).toEqual([]);
  });
});
