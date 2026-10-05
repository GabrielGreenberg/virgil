// @vitest-environment jsdom
/**
 * Task 950 — the ONE segmented choice: the active segment announces
 * `aria-pressed="true"` and every other `"false"`; a disabled segment keeps a
 * hint that says WHY (and exposes it as its description, the label stays its
 * name); the "on" paint is the solid control-selected path, never `--accent`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { SegmentedToggle, SEGMENT_ON } from "@/components/SegmentedToggle";

afterEach(cleanup);

function mount(over: { disabledLibrary?: boolean; value?: "local" | "library" } = {}) {
  const onChange = vi.fn();
  const outer = vi.fn();
  render(
    <div onMouseDown={outer} onClick={outer}>
      <SegmentedToggle
        ariaLabel="Search scope"
        value={over.value ?? "local"}
        onChange={onChange}
        isolatePointer
        options={[
          { value: "local", label: "Local", hint: "Search local" },
          {
            value: "library",
            label: "Library",
            hint: "Search library",
            disabled: over.disabledLibrary,
            disabledHint: "Connect the central library to search master.bib.",
          },
        ]}
      />
    </div>,
  );
  return { onChange, outer };
}

describe("SegmentedToggle", () => {
  it("is a named group whose active segment alone is pressed", () => {
    mount({ value: "library" });
    expect(screen.getByRole("group", { name: "Search scope" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Local" }).getAttribute("aria-pressed")).toBe("false");
    const lib = screen.getByRole("button", { name: "Library" });
    expect(lib.getAttribute("aria-pressed")).toBe("true");
    expect(lib.className).toContain(SEGMENT_ON);
    expect(lib.className).not.toMatch(/accent/);
    expect(lib.className).toContain("focus-ring");
  });

  it("a disabled segment's hint names the reason, as hint and description", () => {
    const { onChange } = mount({ disabledLibrary: true });
    const lib = screen.getByRole("button", { name: "Library" }) as HTMLButtonElement;
    expect(lib.disabled).toBe(true);
    expect(lib.getAttribute("data-hint")).toBe("Connect the central library to search master.bib.");
    expect(lib.getAttribute("aria-description")).toBe(
      "Connect the central library to search master.bib.",
    );
    fireEvent.click(lib);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("an enabled segment keeps its ordinary hint and reports its value", () => {
    const { onChange, outer } = mount();
    const lib = screen.getByRole("button", { name: "Library" });
    expect(lib.getAttribute("data-hint")).toBe("Search library");
    expect(lib.hasAttribute("aria-description")).toBe(false);
    fireEvent.mouseDown(lib);
    fireEvent.click(lib);
    expect(onChange).toHaveBeenCalledWith("library");
    // isolatePointer: the host's header gesture never sees the press.
    expect(outer).not.toHaveBeenCalled();
  });
});
