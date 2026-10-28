// @vitest-environment jsdom
//
// Task 1341 — the Example card's "?" help is a per-dialect FACT read from
// `EXAMPLE_DIALECT_HELP`, keyed by the example's OWN dialect. Before 1341 the
// card hard-wired an expex explainer, so a linguex example taught `\xe`,
// `\pex` and `\begingl` — syntax its paper does not define, and whose package
// the requirements pass refuses to inject there (task 543).

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("@/components/RichTextField", () => ({
  default: () => <div data-testid="rtf" />,
}));
vi.mock("@/components/BorrowedMainText", () => ({
  BorrowedMainText: () => <div data-testid="borrowed" />,
  default: () => <div data-testid="borrowed" />,
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent } from "@testing-library/react";
import { ExampleCard } from "@/panels/Examples/ExampleCard";
import type { ExampleInfo } from "@/components/Editor";
import { EXAMPLE_DIALECT_HELP, type ExampleDialect } from "@/lib/example-dialect";

afterEach(cleanup);

function exampleOf(dialect: ExampleDialect): ExampleInfo {
  return {
    exampleId: `ex-${dialect}`,
    pos: 0,
    number: 1,
    kind: "single",
    tag: "",
    label: "",
    dialect,
    preview: "Colorless green ideas sleep furiously.",
    subLabelRange: "",
    bodyText: "Colorless green ideas sleep furiously.",
    bodyContent: null,
    items: [],
    latex: "",
  };
}

/** Render EXPANDED (the footer + help live there) and open the help. */
function openHelp(dialect: ExampleDialect): HTMLElement {
  const { container } = render(
    <ExampleCard
      example={exampleOf(dialect)}
      isSelected={false}
      onSelect={() => {}}
      onJump={() => {}}
      isPoppedOut
    />,
  );
  const toggle = container.querySelector<HTMLButtonElement>(
    "button[aria-controls]",
  );
  expect(toggle).not.toBeNull();
  fireEvent.click(toggle!);
  const pane = container.querySelector<HTMLElement>("[data-example-help]");
  expect(pane).not.toBeNull();
  expect(pane!.id).toBe(toggle!.getAttribute("aria-controls"));
  return pane!;
}

describe("Example card help follows the example's dialect (task 1341)", () => {
  it("a linguex example's help teaches linguex, never expex syntax", () => {
    const pane = openHelp("linguex");
    expect(pane.getAttribute("data-example-help")).toBe("linguex");
    const text = pane.textContent ?? "";
    expect(text).toContain("\\ex.");
    expect(text).toContain("\\a.");
    for (const expexOnly of ["\\xe", "\\pex", "\\begingl", "\\glft", "<tag>"]) {
      expect(text).not.toContain(expexOnly);
    }
  });

  it("an expex example's help is the expex explainer", () => {
    const pane = openHelp("expex");
    const text = pane.textContent ?? "";
    for (const expex of ["\\ex … \\xe", "\\pex … \\xe", "\\begingl … \\endgl", "\\ex<*>"]) {
      expect(text).toContain(expex);
    }
  });

  it("the table covers every dialect with non-empty help", () => {
    const dialects: ExampleDialect[] = ["expex", "linguex"];
    expect(Object.keys(EXAMPLE_DIALECT_HELP).sort()).toEqual([...dialects].sort());
    for (const d of dialects) {
      expect(EXAMPLE_DIALECT_HELP[d].intro.length).toBeGreaterThan(0);
      expect(EXAMPLE_DIALECT_HELP[d].lines.length).toBeGreaterThan(0);
    }
  });
});
