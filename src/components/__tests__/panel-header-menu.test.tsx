// @vitest-environment jsdom
//
// A panel's three-dots menu sits at the right end of its header, after the
// header's own controls and before any ×. A tool in the tool gutter mounts no
// chrome provider, so it has no × at all: its tool button is what closes it.

import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { render, cleanup, screen } from "@testing-library/react";
import { PanelChromeProvider, PanelHeader } from "@/components/panel-primitives";

afterEach(cleanup);

const header = () => (
  <PanelHeader title="Outline" menu={<button type="button">menu</button>}>
    <button type="button">control</button>
  </PanelHeader>
);

/** True when `a` comes before `b` in document order. */
const before = (a: HTMLElement, b: HTMLElement) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("the panel header's menu", () => {
  it("follows the title and the header's own controls", () => {
    render(header());
    const menu = screen.getByRole("button", { name: "menu" });
    expect(before(screen.getByText("Outline"), menu)).toBe(true);
    expect(before(screen.getByRole("button", { name: "control" }), menu)).toBe(true);
  });

  it("has no × without a chrome provider, which is the tool gutter's case", () => {
    render(header());
    expect(screen.queryByRole("button", { name: "Close panel" })).toBeNull();
  });

  it("stays left of the × in a docked panel", () => {
    render(<PanelChromeProvider value={{ onClose: () => {} }}>{header()}</PanelChromeProvider>);
    const close = screen.getByRole("button", { name: "Close panel" });
    expect(before(screen.getByRole("button", { name: "menu" }), close)).toBe(true);
  });
});
