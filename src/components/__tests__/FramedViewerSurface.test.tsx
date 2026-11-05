// @vitest-environment jsdom
//
// Contract for the shared framed-viewer surface (task 2026-07-03-015): both the
// docs compiled-PDF pane and the Library PDF pane render through ONE component,
// so the inset (4px on three sides) + pod border/radius/shadow live in exactly
// one place and can't drift. It stands on the colour the viewer paints around its
// pages, and its only knobs are the bottom and left insets.

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import FramedViewerSurface from "../FramedViewerSurface";

afterEach(cleanup);

/** The inner pod carries the backdrop fill + pod chrome; find it by test id. */
function renderSurface(props: React.ComponentProps<typeof FramedViewerSurface>) {
  const { container } = render(<FramedViewerSurface {...props} />);
  const outer = container.firstElementChild as HTMLElement;
  const pod = outer.firstElementChild as HTMLElement;
  return { outer, pod };
}

describe("FramedViewerSurface", () => {
  it("insets the child by 4px on three sides, --pod-gap below by default", () => {
    const { outer } = renderSurface({ children: <i /> });
    expect(outer.style.paddingTop).toBe("4px");
    expect(outer.style.paddingLeft).toBe("4px");
    expect(outer.style.paddingRight).toBe("4px");
    expect(outer.style.paddingBottom).toBe("var(--pod-gap)");
  });

  it("honors an overridden bottom inset (docs zen mode passes 4)", () => {
    const { outer } = renderSurface({
      paddingBottom: 4,
      children: <i />,
    });
    expect(outer.style.paddingBottom).toBe("4px");
  });

  it("carries the pod border, radius, and shadow on the inner frame", () => {
    const { pod } = renderSurface({ children: <i /> });
    expect(pod.style.borderRadius).toBe("var(--pod-radius)");
    expect(pod.style.border).toBe("var(--pod-border)");
    expect(pod.style.boxShadow).toBe("var(--pod-shadow)");
  });

  it("stands on the colour the viewer paints around its pages", () => {
    const { pod } = renderSurface({ children: <i /> });
    expect(pod.style.background).toBe("var(--topbar-bg)");
  });

  it("renders its children inside the pod (overlays anchor to it)", () => {
    const { pod } = renderSurface({
      children: <span data-testid="viewer">x</span>,
    });
    expect(pod.querySelector('[data-testid="viewer"]')).not.toBeNull();
  });
});
