// @vitest-environment jsdom
/**
 * Task 1035 — the drag-outline family mounts ONCE, and fades only on its
 * appear/disappear edges.
 *
 * The dock-target outline and the card-lift flash render from WINDOW-GLOBAL
 * module singletons (`useDockDragTarget`, `useCardLiftTarget`) and portal to
 * `document.body`. They used to be mounted by every `EditorPane`, and a body
 * portal escapes a hidden keep-alive slot's `display:none` — so one drag
 * painted N stacked outlines (N translucent glows) at the same rect.
 *
 *   1. CENSUS — the outline primitive is rendered only in `DragOutlines.tsx`,
 *      and `DragOutlines` has exactly one mount site (`src/app/page.tsx`).
 *   2. FADE — null → target fades in once; target → another target (hovering
 *      slot to slot) SNAPS, no new animation; target → null fades out once.
 */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { codeOnly, elementsNamed, REPO_ROOT, trackedFiles } from "@/lib/__tests__/_source-scan";
import { DragOutlines } from "../DragOutlines";
import { setDockDragTarget, type DockDragTarget } from "@/components/editor-layout/dock-drag";
import { setCardLiftTarget } from "@/components/card-lift";

// ── 1. Census ───────────────────────────────────────────────────────────────

describe("drag outlines — one mount site (census)", () => {
  const sources = trackedFiles("src", /\.tsx$/).filter(
    (f) => !f.includes(`${path.sep}__tests__${path.sep}`),
  );
  const rel = (f: string) => path.relative(REPO_ROOT, f);
  const sitesOf = (name: string) =>
    sources.flatMap((f) =>
      elementsNamed(codeOnly(fs.readFileSync(f, "utf8")), name).map(() => rel(f)),
    );

  it("the outline primitive is rendered only by DragOutlines.tsx", () => {
    for (const name of ["DragOutline", "DockOutline", "CardLiftOutline"]) {
      expect(new Set(sitesOf(name))).toEqual(
        new Set(["src/components/drag-outline/DragOutlines.tsx"]),
      );
    }
  });

  it("DragOutlines has exactly one mount site, at app level", () => {
    expect(sitesOf("DragOutlines")).toEqual(["src/app/page.tsx"]);
  });
});

// ── 2. Fade only on the presence edge ───────────────────────────────────────

const slot = (index: number, top: number): DockDragTarget =>
  ({
    side: "right",
    index,
    rect: { left: 10, top, width: 200, height: 40 },
  }) as DockDragTarget;

describe("drag outlines — fade rule", () => {
  let animate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    animate = vi.fn(() => ({ cancel() {} }) as unknown as Animation);
    // jsdom implements neither.
    Object.assign(Element.prototype, { animate, getAnimations: () => [] });
  });

  afterEach(() => {
    act(() => {
      setDockDragTarget(null);
      setCardLiftTarget(null);
      vi.runAllTimers();
    });
    cleanup();
    vi.useRealTimers();
  });

  const outlines = () => document.querySelectorAll("[data-dock-outline]");
  const opacities = () =>
    animate.mock.calls.map((c) => (c[0] as Keyframe[])[1].opacity);

  it("renders one outline; slot → slot snaps; appear/disappear fade once each", () => {
    render(<DragOutlines />);
    expect(outlines()).toHaveLength(0);

    act(() => setDockDragTarget(slot(0, 100)));
    expect(outlines()).toHaveLength(1);
    expect(opacities()).toEqual([1]);

    act(() => setDockDragTarget(slot(1, 300)));
    expect(outlines()).toHaveLength(1);
    // Moved — on the same commit — without replaying the fade.
    const inner = outlines()[0].firstElementChild as HTMLElement;
    expect(inner.style.top).toBe("300px");
    expect(opacities()).toEqual([1]);

    act(() => setDockDragTarget(null));
    expect(opacities()).toEqual([1, 0]);
    // Kept through the fade-out, then gone.
    expect(outlines()).toHaveLength(1);
    act(() => vi.runAllTimers());
    expect(outlines()).toHaveLength(0);
    expect(opacities()).toEqual([1, 0]);
  });

  it("a re-appear during the fade-out fades in again", () => {
    render(<DragOutlines />);
    act(() => setDockDragTarget(slot(0, 100)));
    act(() => setDockDragTarget(null));
    act(() => setDockDragTarget(slot(2, 500)));
    expect(opacities()).toEqual([1, 0, 1]);
    act(() => vi.runAllTimers());
    expect(outlines()).toHaveLength(1);
  });

  it("the card-lift flash rides the same primitive", () => {
    render(<DragOutlines />);
    act(() =>
      setCardLiftTarget({ cardKey: "note:1", rect: { left: 0, top: 0, width: 50, height: 20 } }),
    );
    expect(document.querySelectorAll("[data-card-lift-outline]")).toHaveLength(1);
    expect(opacities()).toEqual([1]);
  });
});
