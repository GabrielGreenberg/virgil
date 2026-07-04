// @vitest-environment jsdom
//
// Contract for the shared framed-viewer surface (task 2026-07-03-015): both the
// docs compiled-PDF pane and the Library PDF pane render through ONE component,
// so the inset (4px on three sides) + pod border/radius/shadow live in exactly
// one place and can't drift. The only knob is `backdrop` — `dark` (#525659, the
// docs pane) vs `manila` (var(--library-bg), the Library pane) — plus an
// overridable bottom inset.

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
    const { outer } = renderSurface({ backdrop: "manila", children: <i /> });
    expect(outer.style.paddingTop).toBe("4px");
    expect(outer.style.paddingLeft).toBe("4px");
    expect(outer.style.paddingRight).toBe("4px");
    expect(outer.style.paddingBottom).toBe("var(--pod-gap)");
  });

  it("honors an overridden bottom inset (docs zen mode passes 4)", () => {
    const { outer } = renderSurface({
      backdrop: "dark",
      paddingBottom: 4,
      children: <i />,
    });
    expect(outer.style.paddingBottom).toBe("4px");
  });

  it("carries the pod border, radius, and shadow on the inner frame", () => {
    const { pod } = renderSurface({ backdrop: "dark", children: <i /> });
    expect(pod.style.borderRadius).toBe("var(--pod-radius)");
    expect(pod.style.border).toBe("var(--pod-border)");
    expect(pod.style.boxShadow).toBe("var(--pod-shadow)");
  });

  it("maps backdrop='dark' to the docs #525659 fill", () => {
    const { pod } = renderSurface({ backdrop: "dark", children: <i /> });
    // jsdom normalizes the hex to rgb().
    expect(pod.style.background).toBe("rgb(82, 86, 89)");
  });

  it("maps backdrop='manila' to the Library --library-bg fill", () => {
    const { pod } = renderSurface({ backdrop: "manila", children: <i /> });
    expect(pod.style.background).toBe("var(--library-bg)");
  });

  it("renders its children inside the pod (overlays anchor to it)", () => {
    const { pod } = renderSurface({
      backdrop: "manila",
      children: <span data-testid="viewer">x</span>,
    });
    expect(pod.querySelector('[data-testid="viewer"]')).not.toBeNull();
  });
});
