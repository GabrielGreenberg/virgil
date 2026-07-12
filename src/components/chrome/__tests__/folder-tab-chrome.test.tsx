// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderTabChrome } from "../FolderTabChrome";
import {
  CAP_W,
  CAP_W_TUCKED,
  FOLDER_TAB_VARIANTS,
  INK_SHIFT,
  TAB_TOP_GUTTER,
  middleInsetLeft,
  middleInsetRight,
} from "../folder-tab-geometry";
import { DocumentFolderTab } from "@/components/editor-layout/DocumentFolderTab";
import { PanelFolderTab } from "@library/components/panel-tabs/PanelFolderTab";

// The whole point of the layout-driven chrome: rendering it constructs ZERO
// ResizeObservers (the old PanelFolderTab built two per tab and
// DocumentFolderTab one — all deleted, not parked). jsdom has no native RO;
// install a spy-able stub and assert it is never constructed.
const roConstructed = vi.fn();
class ResizeObserverStub {
  constructor(cb: unknown) {
    roConstructed(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  roConstructed.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function getCaps(container: HTMLElement): SVGSVGElement[] {
  return Array.from(container.querySelectorAll("svg"));
}

describe("FolderTabChrome — layout-driven three-piece silhouette", () => {
  it("constructs NO ResizeObserver and renders two constant-size caps + one stretchable middle", () => {
    const { container } = render(
      <div style={{ position: "relative" }}>
        <FolderTabChrome variant="library" fill="var(--surface)" />
      </div>,
    );
    expect(roConstructed).not.toHaveBeenCalled();

    const caps = getCaps(container);
    expect(caps).toHaveLength(2);
    const v = FOLDER_TAB_VARIANTS.library;
    // Constant width/height attrs from the SSOT — nothing tracks the element.
    expect(caps[0].getAttribute("width")).toBe(String(CAP_W));
    expect(caps[1].getAttribute("width")).toBe(String(CAP_W));
    for (const cap of caps) {
      expect(cap.getAttribute("height")).toBe(String(v.svgH));
      expect(cap.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    }
  });

  it("the RENDERED caps apply INK_SHIFT and the middle sits at TAB_TOP_GUTTER — the ink-cushion contract as rendered, not just as constants", () => {
    // folder-tab-geometry.test.ts pins INK_SHIFT's VALUES; this pins that
    // the render actually THREADS them into the cap transforms. Dropping
    // the translate (or hardcoding translate(0.5, 0.5)) would re-create the
    // pre-task-087 zero-cushion top stroke — the exact "missing top
    // outline" defect this chrome exists to kill — while every
    // constants-only test stayed green.
    for (const variant of ["library", "topbar"] as const) {
      const { container, unmount } = render(
        <div style={{ position: "relative" }}>
          <FolderTabChrome variant={variant} fill="var(--surface)" />
        </div>,
      );
      const groups = Array.from(container.querySelectorAll("g"));
      // Fill layer + stroke layer per cap, both shifted.
      expect(groups).toHaveLength(4);
      for (const g of groups) {
        expect(g.getAttribute("transform")).toBe(
          `translate(${INK_SHIFT.x}, ${INK_SHIFT.y})`,
        );
      }
      // The middle div mirrors the cushion: its border-top ink occupies the
      // same [TAB_TOP_GUTTER, TAB_TOP_GUTTER+1] band as the caps' shoulder
      // stroke.
      const middle = Array.from(container.querySelectorAll("div")).find(
        (d) => d.style.borderTop !== "",
      );
      expect(middle!.style.top).toBe(`${TAB_TOP_GUTTER}px`);
      unmount();
    }
  });

  it("themes via CSS vars: fill flows to the paths/middle, the edge token to stroke + border-top", () => {
    const { container } = render(
      <div style={{ position: "relative" }}>
        <FolderTabChrome variant="library" fill="var(--background)" />
      </div>,
    );
    const fills = Array.from(container.querySelectorAll("path[fill]")).filter(
      (p) => p.getAttribute("fill") !== "none",
    );
    expect(fills.length).toBeGreaterThan(0);
    for (const p of fills) {
      expect(p.getAttribute("fill")).toBe("var(--background)");
    }
    const strokes = Array.from(
      container.querySelectorAll('path[fill="none"]'),
    );
    expect(strokes.length).toBe(2);
    for (const p of strokes) {
      expect(p.getAttribute("stroke")).toContain("var(--library-edge");
    }
    // The middle piece: fill background + 1px top border in the edge color.
    const middle = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.borderTop !== "",
    );
    expect(middle).toBeTruthy();
    expect(middle!.style.borderTop).toContain("var(--library-edge");
    expect(middle!.style.background).toBe("var(--background)");
    expect(middle!.style.top).toBe("1px"); // TAB_TOP_GUTTER
    expect(middle!.style.bottom).toBe("0px"); // seam bridge reaches the base
  });

  it("tucked feet swap in the wider constant cap and slide the middle inward — no other change", () => {
    const { container } = render(
      <div style={{ position: "relative" }}>
        <FolderTabChrome
          variant="library"
          fill="var(--surface)"
          tuckLeft
          tuckRight
        />
      </div>,
    );
    const caps = getCaps(container);
    expect(caps[0].getAttribute("width")).toBe(String(CAP_W_TUCKED));
    expect(caps[1].getAttribute("width")).toBe(String(CAP_W_TUCKED));
    const middle = Array.from(container.querySelectorAll("div")).find(
      (d) => d.style.borderTop !== "",
    );
    expect(middle!.style.left).toBe(`${middleInsetLeft(true)}px`);
    expect(middle!.style.right).toBe(`${middleInsetRight(true, 0)}px`);
    expect(roConstructed).not.toHaveBeenCalled();
  });

  it("topbar variant: --topbar-border edge, 32px caps, right cap overhangs by 1px (the F#8 cushion outside the footprint)", () => {
    const { container } = render(
      <div style={{ position: "relative" }}>
        <FolderTabChrome variant="topbar" fill="var(--main-tab-bg)" />
      </div>,
    );
    const caps = getCaps(container);
    expect(caps[0].getAttribute("height")).toBe(
      String(FOLDER_TAB_VARIANTS.topbar.svgH),
    );
    expect(caps[0].style.left).toBe("0px");
    expect(caps[1].style.right).toBe("-1px");
    const strokes = Array.from(container.querySelectorAll('path[fill="none"]'));
    for (const p of strokes) {
      expect(p.getAttribute("stroke")).toContain("var(--topbar-border");
    }
    expect(roConstructed).not.toHaveBeenCalled();
  });
});

describe("PanelFolderTab — inner active tab wrapper on the shared chrome", () => {
  it("renders children in-flow (layout-owned width), keeps the F#15 floor + seam overlap, constructs no RO", () => {
    const { container, getByText } = render(
      <PanelFolderTab fill="var(--surface)" title="Central" dataTabId="central">
        <span>Central</span>
      </PanelFolderTab>,
    );
    expect(roConstructed).not.toHaveBeenCalled();
    expect(getByText("Central")).toBeTruthy();

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("data-tab-id")).toBe("central");
    expect(wrapper.style.minWidth).toBe("141px"); // 2S + ACTIVE_MIN_CONTENT + 1
    expect(wrapper.style.marginBottom).toBe("-1px"); // FOLDER_TAB_SEAM_OVERLAP
    expect(wrapper.style.height).toBe(
      `${FOLDER_TAB_VARIANTS.library.svgH}px`,
    );
    // The silhouette is present: two caps + middle.
    expect(getCaps(container)).toHaveLength(2);
  });

  it("first-tab tuck flows through to the tucked left cap", () => {
    const { container } = render(
      <PanelFolderTab fill="var(--surface)" tuckLeftFoot>
        <span>Papers</span>
      </PanelFolderTab>,
    );
    const caps = getCaps(container);
    expect(caps[0].getAttribute("width")).toBe(String(CAP_W_TUCKED));
    expect(caps[1].getAttribute("width")).toBe(String(CAP_W));
  });
});

describe("DocumentFolderTab — outer active tab wrapper on the SAME shared chrome", () => {
  it("renders the topbar variant with in-flow content and no RO", () => {
    const { container, getByText } = render(
      <DocumentFolderTab fill="var(--main-tab-bg)" title="paper.tex">
        <span>paper.tex</span>
      </DocumentFolderTab>,
    );
    expect(roConstructed).not.toHaveBeenCalled();
    expect(getByText("paper.tex")).toBeTruthy();
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.height).toBe(
      `${FOLDER_TAB_VARIANTS.topbar.svgH}px`,
    );
    expect(wrapper.style.marginBottom).toBe("-1px");
    const caps = getCaps(container);
    expect(caps).toHaveLength(2);
    for (const cap of caps) {
      expect(cap.getAttribute("height")).toBe(
        String(FOLDER_TAB_VARIANTS.topbar.svgH),
      );
    }
  });
});
