// @vitest-environment jsdom
// The strip drop decides left vs right in the PANE's frame, not the window's
// (task 1394).
//
// The strips belong to ONE `EditorPane`. A Library Reader in the left Library
// panel lies wholly left of `window.innerWidth / 2`, so the retired
// window-centre split sent EVERY drop to its left strip: a right-strip reorder
// moved the icon to the left strip, and a left→right move was impossible. The
// split is now `stripSplitX` over the gesture snapshot's own strips (or the
// pane root, when only one rail is mounted).
import { describe, it, expect, vi } from "vitest";

// drag-drop pulls `@/lib/storage` transitively (vitest_extension_barrel_storage_mock).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
import {
  resolveStripDrop,
  stripSplitX,
  type StripDragGeometry,
  type StripSideGeometry,
} from "../drag-drop";
import type { PanelId } from "@/hooks/useViewPrefs";

const WINDOW_WIDTH = 1600;

function strip(left: number, ids: string[]): StripSideGeometry {
  return {
    left,
    width: 40,
    top: 100,
    slots: ids.map((id, i) => ({
      panelId: id as PanelId,
      top: 100 + i * 40,
      bottom: 136 + i * 40,
      mid: 118 + i * 40,
    })),
  };
}

function snapshot(
  left: StripSideGeometry | null,
  right: StripSideGeometry | null,
  paneRect: { left: number; width: number } | null,
): StripDragGeometry {
  return { centerX: stripSplitX(left, right, paneRect), left, right };
}

describe("strip drop side is decided in the pane's frame (task 1394)", () => {
  it("both strips LEFT of the window centre: a pointer over the right strip resolves right", () => {
    // A Reader in the left Library panel: pane spans 300..700.
    const g = snapshot(strip(300, ["a", "b"]), strip(660, ["c", "d"]), null);
    expect(g.left!.left + g.right!.left).toBeLessThan(WINDOW_WIDTH);
    const drop = resolveStripDrop(g, 680, 150);
    expect(drop.side).toBe("right");
    expect(drop.beforeId).toBe("d");
    // The retired rule would have said left.
    expect(680 < WINDOW_WIDTH / 2).toBe(true);
    expect(resolveStripDrop(g, 320, 150).side).toBe("left");
  });

  it("both strips RIGHT of the window centre: a pointer over the left strip resolves left", () => {
    const g = snapshot(strip(900, ["a", "b"]), strip(1500, ["c"]), null);
    const drop = resolveStripDrop(g, 920, 110);
    expect(drop.side).toBe("left");
    expect(drop.beforeId).toBe("a");
    expect(920 > WINDOW_WIDTH / 2).toBe(true);
    expect(resolveStripDrop(g, 1510, 110).side).toBe("right");
  });

  it("one strip mounted: a drop past the pane's far half resolves to the rail-less side and appends", () => {
    const pane = { left: 300, width: 400 }; // centre 500, left of window centre
    const g = snapshot(strip(300, ["a", "b"]), null, pane);
    const across = resolveStripDrop(g, 650, 120);
    expect(across).toMatchObject({ side: "right", beforeId: null, sideGeom: null });
    expect(resolveStripDrop(g, 320, 120).side).toBe("left");

    const g2 = snapshot(null, strip(1500, ["c"]), { left: 900, width: 640 });
    expect(resolveStripDrop(g2, 1000, 120)).toMatchObject({ side: "left", sideGeom: null });
    expect(resolveStripDrop(g2, 1510, 120).side).toBe("right");
  });

  it("one strip and no pane root: every drop goes to the mounted strip", () => {
    expect(resolveStripDrop(snapshot(strip(300, ["a"]), null, null), 5000, 110).side).toBe("left");
    expect(resolveStripDrop(snapshot(null, strip(300, ["a"]), null), -5000, 110).side).toBe("right");
  });

  it("no strip drop reads window.innerWidth", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "..", "drag-drop.tsx"), "utf8");
    // Code only — the doc comment names the retired rule on purpose.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/window\.innerWidth/);
  });
});
