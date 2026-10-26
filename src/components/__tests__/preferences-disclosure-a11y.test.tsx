// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import PreferenceTree from "@/components/PreferenceTree";
import SmartPreferences from "@/components/SmartPreferences";
import { DEFAULT_PREFS } from "@/hooks/usePreferences";
import type { PrefNode } from "@/lib/preferences-tree";

/**
 * Preferences' collapsible headers and its link-lock announce their state
 * (task 1305). Both headers were `<button onClick={() => setOpen(!open)}>`
 * around a bare rotating svg — no `aria-expanded`, no `type`, no ring — and
 * the lock conveyed on/off by accent ink alone. They now render through
 * `PodDisclosure`, and the lock is an `iconbtn-toggle` with `aria-pressed`.
 */
describe("Preferences disclosures and lock announce their state", () => {
  it("a PreferenceTree group header is a disclosure whose aria-expanded flips", () => {
    const tree: PrefNode[] = [{ label: "Typography", children: [], defaultOpen: false }];
    render(<PreferenceTree tree={tree} prefs={DEFAULT_PREFS} onUpdate={() => {}} />);
    const header = screen.getByRole("button", { name: /typography/i });
    expect(header.getAttribute("type")).toBe("button");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });

  it("a SmartPreferences section header is a disclosure whose aria-expanded flips", () => {
    render(<SmartPreferences prefs={DEFAULT_PREFS} onUpdate={() => {}} />);
    const headers = document.querySelectorAll("button[aria-expanded]");
    expect(headers.length).toBeGreaterThan(0);
    const first = headers[0] as HTMLButtonElement;
    expect(first.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("false");
  });

  it("the link-lock is a pressed-state toggle with a fixed name", () => {
    render(<SmartPreferences prefs={DEFAULT_PREFS} onUpdate={() => {}} />);
    const locks = screen.getAllByRole("button", { name: "Lock to parent" });
    expect(locks.length).toBeGreaterThan(0);
    const lock = locks[0];
    expect(lock.className).toMatch(/\biconbtn-toggle\b/);
    expect(lock.hasAttribute("data-iconbtn-exempt")).toBe(false);
    const before = lock.getAttribute("aria-pressed");
    expect(["true", "false"]).toContain(before);
    fireEvent.click(lock);
    expect(lock.getAttribute("aria-pressed")).toBe(before === "true" ? "false" : "true");
    expect(lock.getAttribute("aria-label")).toBe("Lock to parent");
  });
});
