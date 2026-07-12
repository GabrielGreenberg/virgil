// @vitest-environment jsdom
//
// Pins the drag shield's singleton + restore contract: one lazily-created
// fixed full-viewport overlay per gesture, idempotent mount/unmount, and the
// body's pre-gesture inline cursor/user-select restored verbatim on unmount.

import { describe, it, expect, beforeEach } from "vitest";
import {
  mountDragShield,
  unmountDragShield,
  isDragShieldMounted,
} from "../drag-shield";

const query = () =>
  document.querySelectorAll<HTMLDivElement>("[data-pane-drag-shield]");

beforeEach(() => {
  unmountDragShield();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

describe("drag-shield", () => {
  it("mounts one fixed full-viewport hit-testable overlay", () => {
    expect(isDragShieldMounted()).toBe(false);
    mountDragShield("col-resize");
    expect(isDragShieldMounted()).toBe(true);
    const nodes = query();
    expect(nodes.length).toBe(1);
    const s = nodes[0].style;
    expect(s.position).toBe("fixed");
    expect(s.top).toBe("0px");
    expect(s.right).toBe("0px");
    expect(s.bottom).toBe("0px");
    expect(s.left).toBe("0px");
    expect(s.pointerEvents).toBe("auto");
    expect(Number(s.zIndex)).toBeGreaterThan(1000);
    expect(s.cursor).toBe("col-resize");
  });

  it("owns the gesture cursor + user-select:none on body, restored on unmount", () => {
    // Pre-existing inline styles must survive the round-trip verbatim.
    document.body.style.cursor = "pointer";
    document.body.style.userSelect = "text";
    mountDragShield("row-resize");
    expect(document.body.style.cursor).toBe("row-resize");
    expect(document.body.style.userSelect).toBe("none");
    unmountDragShield();
    expect(document.body.style.cursor).toBe("pointer");
    expect(document.body.style.userSelect).toBe("text");
  });

  it("mount is idempotent (retargets the cursor, never a second overlay)", () => {
    mountDragShield("col-resize");
    mountDragShield("row-resize");
    const nodes = query();
    expect(nodes.length).toBe(1);
    expect(nodes[0].style.cursor).toBe("row-resize");
    expect(document.body.style.cursor).toBe("row-resize");
  });

  it("unmount is idempotent", () => {
    mountDragShield("col-resize");
    unmountDragShield();
    unmountDragShield();
    expect(query().length).toBe(0);
    expect(isDragShieldMounted()).toBe(false);
  });
});
