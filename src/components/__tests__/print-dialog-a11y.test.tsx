// @vitest-environment jsdom
/**
 * Task 609 — the print dialog's content IS on/off state, so it must reach
 * assistive tech: every option row is a `checkbox` with `aria-checked`, named
 * by its VISIBLE label (the disabled marginalia row included — its "why" is a
 * description, not the name), and the active font size is `aria-pressed`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// The component graph reaches the storage barrel, whose FSA backend vitest
// cannot resolve; nothing here touches disk.
vi.mock("@/lib/storage", () => ({}));

import PrintDialog from "@/components/PrintDialog";
import { DEFAULT_PRINT_OPTIONS, PRINT_FONT_SIZES, type PrintOptions } from "@/lib/print";

afterEach(cleanup);

function open(overrides: Partial<PrintOptions> = {}, marginaliaLive = true) {
  const options: PrintOptions = { ...DEFAULT_PRINT_OPTIONS, ...overrides };
  const onOptionsChange = vi.fn();
  render(
    <PrintDialog
      open
      onClose={() => {}}
      options={options}
      onOptionsChange={onOptionsChange}
      marginaliaLive={marginaliaLive}
    />,
  );
  return { options, onOptionsChange };
}

describe("PrintDialog exposes its state to assistive tech", () => {
  it("names each option row by its visible label and states whether it is checked", () => {
    const { options } = open();
    const row = screen.getByRole("checkbox", { name: "Marginalia markers" });
    expect(row.getAttribute("aria-checked")).toBe(String(options.elements.marginalia));
  });

  it("keeps the disabled marginalia row's visible label as its name; the hint is its description", () => {
    open({}, false);
    const row = screen.getByRole("checkbox", { name: "Marginalia markers" });
    expect(row).toHaveProperty("disabled", true);
    expect(row.getAttribute("aria-description")).toBe("Enable marginalia in the editor first.");
    expect(row.getAttribute("data-hint")).toBe("Enable marginalia in the editor first.");
  });

  it("clicking a row flips it through onOptionsChange", () => {
    const { options, onOptionsChange } = open();
    fireEvent.click(screen.getByRole("checkbox", { name: "Marginalia markers" }));
    expect(onOptionsChange).toHaveBeenCalledTimes(1);
    const next = onOptionsChange.mock.calls[0][0] as PrintOptions;
    expect(next.elements.marginalia).toBe(!options.elements.marginalia);
  });

  it("marks exactly the active font size pressed", () => {
    open({ fontSizeRem: PRINT_FONT_SIZES[0] });
    const sizeButtons = screen
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-pressed"));
    expect(sizeButtons).toHaveLength(PRINT_FONT_SIZES.length);
    expect(sizeButtons.map((b) => b.getAttribute("aria-pressed"))).toEqual(
      PRINT_FONT_SIZES.map((_, i) => String(i === 0)),
    );
  });
});
